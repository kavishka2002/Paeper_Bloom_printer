const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fork,spawnSync}=require('node:child_process');
const {mkdtemp,writeFile,readFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const {buildSync}=require('esbuild');
const helper=buildSync({stdin:{contents:"export {selectPages} from './packages/printing/layout'; export {signed} from './packages/whatsapp-adapters/cloud';",resolveDir:process.cwd()},write:false,bundle:true,platform:'node',format:'cjs'}).outputFiles[0].text;
const sandbox={exports:{}};
new Function('module','exports','require',helper)(sandbox,sandbox.exports,require);
const {selectPages,signed}=sandbox.exports;
test('page ranges are sorted, deduplicated and bounded',()=>{
 assert.deepEqual(selectPages('3, 1-3, 5',5),[1,2,3,5]);
 assert.throws(()=>selectPages('0',5));
 assert.throws(()=>selectPages('10-3',20));
 assert.throws(()=>selectPages('',101));
});
test('webhook signature covers the exact raw request bytes',()=>{
 const {createHmac}=require('node:crypto');
 const raw=Buffer.from('{"ok":true}');
 const signature='sha256='+createHmac('sha256','secret').update(raw).digest('hex');
 assert.equal(signed(raw,'secret',signature),true);
 assert.equal(signed(Buffer.concat([raw,Buffer.from(' ')]),'secret',signature),false);
 assert.equal(signed(raw,'secret','sha256=f0'),false);
});
function start(root,fixture=false){
 const child=fork(resolve(process.env.BLOOMCONNECT_TEST_ENGINE??'dist/engine.cjs'),[root],{env:{...process.env,BLOOMCONNECT_TEST_WEBHOOK:'1'},execArgv:fixture?['--require',resolve('tests/'+(fixture==='web'?'web':'cloud')+'-fixture.cjs')]:[],serialization:'advanced',stdio:['ignore','ignore','inherit','ipc']});
 let next=0;
 return {call(operation,input){return new Promise((resolve,reject)=>{
  const id=++next;
  const timer=setTimeout(()=>{child.off('message',handler);reject(new Error('engine timeout: '+operation))},7000);
  const handler=response=>{if(response.id!==id)return;clearTimeout(timer);child.off('message',handler);if(response.error)reject(new Error(response.error));else resolve(response.result)};
  child.on('message',handler);child.send({id,operation,input});
 })},stop(){return new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null){resolve();return}child.once('exit',resolve);child.kill()})}};
}
test('engine validates inputs, imports and deduplicates, persists billing and creates a backup',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bloom-test-'));
 let engine=start(root);
 try{
  const settings={shop:'Test workspace',language:'en',printer:'',mono:1200,colour:3500,photo:10000};
  assert.equal((await engine.call('snapshot',null)).settings,null);
  await engine.call('setup',settings);
  await assert.rejects(engine.call('customer',{name:'',phone:'',notes:'',tag:''}));
  await engine.call('customer',{name:'Local test',phone:'',notes:'',tag:''});
  const customer=(await engine.call('snapshot',null)).customers[0].id;
  const path=join(root,'test.png');
  const png=await require('sharp')({create:{width:16,height:16,channels:3,background:'#10b981'}}).png().toBuffer();
  await writeFile(path,png);
  assert.equal(await engine.call('importLocal',{paths:[path],customer}),1);
  assert.equal(await engine.call('importLocal',{paths:[path],customer}),0);
  const file=(await engine.call('snapshot',null)).attachments[0].id;
  assert.equal((await engine.call('getPreview',{id:file})).mime,'image/png');
  const order={files:[file],copies:2,paper:'A4',colour:false,price:1200,discount:100,charge:200};
  await assert.rejects(engine.call('order',{...order,customer:null}),/same customer/);
  const id=await engine.call('order',{...order,customer});
  assert.match(id,/^BC-\d{4}-00001$/);
  await engine.call('payment',{id,amount:1000,method:'Cash'});
  await assert.rejects(engine.call('payment',{id,amount:9999,method:'Cash'}),/outstanding/);
  const q=await engine.call('printStart',{id,printer:'Test queue'});
  await engine.call('printFinish',{id:q,error:'',partial:false});
  assert.equal((await engine.call('snapshot',null)).queue[0].status,'Submitted');
  await engine.call('queue',{id:q,status:'Completed'});
  const before=await engine.call('snapshot',null);
  assert.equal(before.jobs[0].paid,1000);
  assert.equal(before.jobs[0].total,2500);
  assert.equal(before.queue[0].status,'Completed');
  assert.equal(await engine.call('saveBackup',{path:join(root,'backup')}),true);
  assert.equal((await readFile(join(root,'backup','bloomconnect.sqlite'))).subarray(0,15).toString(),'SQLite format 3');
  const validated=spawnSync(process.execPath,['scripts/validate-backup.cjs',join(root,'backup')],{encoding:'utf8'});
  assert.equal(validated.status,0,validated.stderr);
  assert.match(validated.stdout,/Backup validated/);
  await engine.stop();
  engine=start(root);
  const after=await engine.call('snapshot',null);
  assert.equal(after.settings.shop,settings.shop);
  assert.equal(after.jobs[0].paid,1000);
  assert.equal(after.attachments[0].customer_id,customer);
 }finally{await engine.stop();await rm(root,{recursive:true,force:true})}
});
test('signed Cloud events produce one customer, media record, automatic order and permitted reply',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bloom-cloud-'));
 const engine=start(root,true);
 try{
  const {createHmac}=require('node:crypto');
  const config={version:'v25.0',phoneId:'1234567890',token:'unused-fixture-token-value',appSecret:'fixture-secret-material',verifyToken:'fixture-verify-token'};
  await engine.call('setup',{shop:'Webhook test',language:'en',printer:'',mono:1200,colour:3500,photo:10000});
  await engine.call('connect',config);
  await engine.call('rule',{name:'Create test print order',trigger:'pdf',keyword:'',actions:['order'],text:'',enabled:true,graph:''});
  const address=await engine.call('webhookAddress',null);
  const endpoint='http://127.0.0.1:'+address.port+'/whatsapp/webhook';
  const challenge=await fetch(endpoint+'?hub.mode=subscribe&hub.verify_token='+config.verifyToken+'&hub.challenge=fixture');
  assert.equal(await challenge.text(),'fixture');
  const sender='15555550123'; // Synthetic metadata is used exclusively inside this test.
  const body=JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{
   metadata:{phone_number_id:config.phoneId},
   contacts:[{wa_id:sender,profile:{name:'Webhook test customer'}}],
   messages:[{from:sender,id:'wamid.fixture-doc',timestamp:String(Math.floor(Date.now()/1000)),type:'document',document:{id:'123456789',filename:'print.pdf'}}]
  }}]}]});
  const signature='sha256='+createHmac('sha256',config.appSecret).update(body).digest('hex');
  const event=header=>fetch(endpoint,{method:'POST',body,headers:{'x-hub-signature-256':header}});
  assert.equal((await event('invalid')).status,403);
  assert.equal((await event(signature)).status,200);
  assert.equal((await event(signature)).status,200);
  let state;
  for(let attempt=0;attempt<40;attempt++){
   state=await engine.call('snapshot',null);
   if(state.jobs.length)break;
   await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.equal(state.customers.length,1);
  assert.equal(state.customers[0].phone,sender);
  assert.equal(state.messages.length,1);
  assert.equal(state.attachments[0].status,'Ready');
  assert.equal(state.jobs.length,1);
  assert.deepEqual(state.jobs[0].files,[state.attachments[0].id]);
  await engine.call('rule',{id:'automatic-reply-test',name:'Automatic reply test',trigger:'message',keyword:'',actions:['reply'],text:'Automatic received.',enabled:true,graph:''});
  const automatic=JSON.parse(body);
  automatic.entry[0].changes[0].value.messages=[{from:sender,id:'wamid.auto-incoming',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Hello'}}];
  const automaticBody=JSON.stringify(automatic);
  const automaticSignature='sha256='+createHmac('sha256',config.appSecret).update(automaticBody).digest('hex');
  for(let duplicate=0;duplicate<2;duplicate++)assert.equal((await fetch(endpoint,{method:'POST',body:automaticBody,headers:{'x-hub-signature-256':automaticSignature}})).status,200);
  let automaticState;
  for(let attempt=0;attempt<60;attempt++){
   automaticState=await engine.call('snapshot',null);
   if(automaticState.messages.some(m=>m.direction==='outgoing'&&m.body==='Automatic received.'))break;
   await new Promise(resolve=>setTimeout(resolve,30));
  }
  assert.equal(automaticState.messages.filter(m=>m.direction==='outgoing'&&m.body==='Automatic received.').length,1);
  await engine.call('rule',{id:'automatic-reply-test',name:'Automatic reply test',trigger:'message',keyword:'',actions:['reply'],text:'Automatic received.',enabled:false,graph:''});
  await engine.call('rule',{id:'batched-reply',name:'Batch test',trigger:'message',keyword:'',actions:['reply'],text:'Batch received.',debounceSeconds:1,enabled:true,graph:''});
  for(let i=0;i<10;i++){
   const batch=JSON.parse(automaticBody);batch.entry[0].changes[0].value.messages[0].id='wamid.batch-'+i;
   const payload=JSON.stringify(batch),sig='sha256='+createHmac('sha256',config.appSecret).update(payload).digest('hex');
   assert.equal((await fetch(endpoint,{method:'POST',body:payload,headers:{'x-hub-signature-256':sig}})).status,200);
  }
  for(let attempt=0;attempt<100;attempt++){
   const batchState=await engine.call('snapshot',null);
   if(batchState.messages.some(m=>m.body==='Batch received.'))break;
   await new Promise(resolve=>setTimeout(resolve,40));
  }
  assert.equal((await engine.call('snapshot',null)).messages.filter(m=>m.body==='Batch received.').length,1);
  const log=await engine.call('notificationLog',null);assert.equal(log.filter(n=>n.rule_id==='batched-reply'&&n.status==='Accepted').length,1);
  await engine.call('rule',{id:'batched-reply',name:'Batch test',trigger:'message',keyword:'',actions:['reply'],text:'Batch received.',debounceSeconds:1,enabled:false,graph:''});
  const eventRules=[['order-created','Registered {job_id}'],['printing-started','Started {job_id}'],['pickup','Pickup {job_id}: {total_amount}'],['collected','Collected {job_id}'],['price-confirmed','Price {job_id}: {total_amount}']];
  for(const [trigger,text] of eventRules)await engine.call('rule',{id:'event-'+trigger,name:trigger,trigger,keyword:'',actions:['reply'],text,debounceSeconds:0,enabled:true,graph:''});
  const eventOrder=await engine.call('order',{customer:state.customers[0].id,files:[state.attachments[0].id],copies:1,paper:'A4',colour:false,price:2300,discount:0,charge:0});
  await assert.rejects(engine.call('confirmPrice',{id:eventOrder,total:2299}),/price changed/);
  await engine.call('confirmPrice',{id:eventOrder,total:2300});
  await engine.call('confirmPrice',{id:eventOrder,total:2300});
  const readyNotice='ඔබගේ ඇණවුම මුද්‍රණය කිරීමට සූදානම්. රැකියා අංකය: '+eventOrder;
  const queuedNotice='ඔබගේ ඇණවුම මුද්‍රණ පෝලිමට එක් කර ඇත. රැකියා අංකය: '+eventOrder;
  const completedNotice='ඔබගේ මුද්‍රණ කටයුතු අවසන් වී ඇත. රැකියා අංකය: '+eventOrder+'. මුළු මුදල: රු. 23.00';
  await engine.call('stage',{id:eventOrder,status:'Ready to Print'});
  await engine.call('stage',{id:eventOrder,status:'Processing'});
  await engine.call('stage',{id:eventOrder,status:'Ready to Print'});
  await engine.call('stage',{id:eventOrder,status:'Printing'});
  assert.equal((await engine.call('snapshot',null)).messages.some(m=>m.body===completedNotice),false);
  const failedSubmission=await engine.call('printStart',{id:eventOrder,printer:'Fixture only'});
  await engine.call('printFinish',{id:failedSubmission,error:'Test printer rejected job',partial:false});
  const cancelledSubmission=await engine.call('printStart',{id:eventOrder,printer:'Fixture only',duplex:'manualLongEdge'});
  await engine.call('printFinish',{id:cancelledSubmission,error:'Cancelled after the front pass',partial:true,cancelled:true});
  await assert.rejects(engine.call('queue',{id:cancelledSubmission,status:'Completed'}),/cannot be updated/);
  assert.equal((await engine.call('snapshot',null)).messages.some(m=>m.body===queuedNotice),false);
  const submission=await engine.call('printStart',{id:eventOrder,printer:'Fixture only'});
  await engine.call('printFinish',{id:submission,error:'',partial:false});
  await engine.call('printFinish',{id:submission,error:'',partial:false});
  assert.equal((await engine.call('snapshot',null)).messages.some(m=>m.body===completedNotice),false);
  await engine.call('queue',{id:submission,status:'Completed'});await engine.call('stage',{id:eventOrder,status:'Ready for Pickup'});await engine.call('stage',{id:eventOrder,status:'Completed'});
  const stageMessages=(await engine.call('snapshot',null)).messages;
  for(const text of ['Registered '+eventOrder,readyNotice,'Started '+eventOrder,queuedNotice,completedNotice,'Pickup '+eventOrder+': 23.00','Collected '+eventOrder,'Price '+eventOrder+': 23.00'])assert.equal(stageMessages.filter(m=>m.body===text).length,1);
  const eventLog=await engine.call('notificationLog',null);assert.ok(eventLog.filter(n=>n.rule_id.startsWith('event-')).every(n=>n.sendAttempts.length===1&&n.status==='Accepted'));
  await engine.call('reply',{id:state.customers[0].id,text:'Received.'});
  assert.equal((await engine.call('snapshot',null)).messages.at(-1).status,'accepted');
  const stale=JSON.parse(body);
  const envelope=stale.entry[0].changes[0].value;
  envelope.contacts=[];
  envelope.messages=[{from:'15555550124',id:'wamid.stale',timestamp:String(Math.floor(Date.now()/1000)-36*3600),type:'text',text:{body:'Old message'}}];
  const staleBody=JSON.stringify(stale);
  const staleSignature='sha256='+createHmac('sha256',config.appSecret).update(staleBody).digest('hex');
  assert.equal((await fetch(endpoint,{method:'POST',body:staleBody,headers:{'x-hub-signature-256':staleSignature}})).status,200);
  const staleCustomer=(await engine.call('snapshot',null)).customers.find(c=>c.phone==='15555550124');
  await assert.rejects(engine.call('reply',{id:staleCustomer.id,text:'Received.'}),/Meta Cloud API reply window has expired/);
  await engine.call('logout',null);
  await assert.rejects(engine.call('reply',{id:state.customers[0].id,text:'Received.'}),/offline/);
 }finally{await engine.stop();await rm(root,{recursive:true,force:true})}
});

test('WhatsApp Web QR, direct message attachment intake, automation and replies use the same workspace',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bloom-web-test-'));
 const engine=start(root,'web');
 try{
  await engine.call('setup',{shop:'Web test',language:'en',printer:'',mono:1200,colour:3500,photo:10000});
  await engine.call('rule',{name:'Print Web PDF',trigger:'pdf',keyword:'',actions:['order'],text:'',enabled:true,graph:''});
  await engine.call('webConnect',null);
  let sawQR=false;
  let state;
  for(let attempt=0;attempt<120;attempt++){
   state=await engine.call('snapshot',null);
   if(!sawQR&&/^data:image\/png;base64,/.test(state.connection.qr??'')){
    sawQR=true;
    await writeFile(join(root,'release-qr'),'Ready');
   }
   if(state.jobs.length&&state.messages.length===6)break;
   await new Promise(resolve=>setTimeout(resolve,35));
  }
  assert.equal(sawQR,true);
  assert.equal(state.connection.status,'Connected');
  assert.equal(state.connection.qr,undefined);
  assert.equal(state.jobs.length,1);
  assert.equal(state.customers.length,2);
  assert.equal(state.messages.length,6);
  assert.equal(state.messages.find(m=>m.id==='fixture-old-out').direction,'outgoing');
  assert.equal(state.messages.find(m=>m.id==='fixture-old-pdf').unread,0);
  assert.equal(state.customers.find(c=>c.name==='WhatsApp contact').phone,'');
  assert.equal(state.attachments.length,3);
  assert.equal(state.messages.find(m=>m.id==='phone-sent').direction,'outgoing');
  const historical=state.attachments.find(file=>file.message_id==='fixture-old-pdf');
  assert.equal(historical.name,'old-handout.pdf');
  assert.equal(historical.status,'Available to download');
  await engine.call('retryMedia',{id:historical.id});
  const downloaded=await engine.call('snapshot',null);
  assert.equal(downloaded.attachments.find(file=>file.id===historical.id).status,'Ready');
  assert.equal(downloaded.jobs.length,1);
  await engine.call('webSync',null);
  assert.equal((await engine.call('snapshot',null)).messages.length,6);
  assert.equal(state.attachments.find(file=>file.name==='WhatsApp document').status,'Ready');
  const outgoingFile=state.attachments.find(file=>file.name==='sent-handout.pdf');
  assert.equal(outgoingFile.status,'Available to download');
  await engine.call('retryMedia',{id:outgoingFile.id});
  const afterOutgoingDownload=await engine.call('snapshot',null);
  assert.equal(afterOutgoingDownload.attachments.find(file=>file.id===outgoingFile.id).status,'Ready');
  assert.equal(afterOutgoingDownload.jobs.length,1);
  const selected=await engine.call('webChatSync',{id:state.customers.find(c=>c.phone).id});
  assert.deepEqual(selected,{messages:1,documents:1,partial:false});
  await engine.call('webChatSync',{id:state.customers.find(c=>c.phone).id});
  const afterSelectedSync=await engine.call('snapshot',null);
  assert.equal(afterSelectedSync.attachments.filter(file=>file.name==='older-notes.pdf').length,1);
  assert.equal(afterSelectedSync.messages.some(message=>message.kind==='notification_template'),false);
  assert.equal(afterSelectedSync.jobs.length,1);
  await engine.call('rule',{name:'Old chat automatic reply',trigger:'pickup',keyword:'',actions:['reply'],text:'Ready.',enabled:true,graph:''});
  await assert.rejects(engine.call('stage',{id:state.jobs[0].id,status:'Ready for Pickup'}),/Confirm physical printing/);
  assert.notEqual((await engine.call('snapshot',null)).jobs[0].status,'Ready for Pickup');
  const confirmed=await engine.call('printStart',{id:state.jobs[0].id,printer:'Fixture only'});
  await engine.call('printFinish',{id:confirmed,error:'',partial:false});
  await engine.call('queue',{id:confirmed,status:'Completed'});
  await engine.call('stage',{id:state.jobs[0].id,status:'Ready for Pickup'});
  const afterAutomation=await engine.call('snapshot',null);
  assert.equal(afterAutomation.messages.length,afterSelectedSync.messages.length);
  assert.equal(afterAutomation.activity.some(a=>a.kind==='Automation failed'&&a.detail==='Old chat automatic reply'),true);
  await engine.call('reply',{id:state.customers.find(c=>c.phone).id,text:'Received.'});
  assert.equal((await engine.call('snapshot',null)).messages.at(-1).direction,'outgoing');
  await engine.call('logout',null);
  assert.equal((await engine.call('snapshot',null)).connection.status,'Disconnected');
 }finally{await engine.stop();await rm(root,{recursive:true,force:true})}
});


test('WhatsApp Web reconnects automatically and restores the provider after restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bloom-web-reconnect-'));
 let engine=start(root,'web');
 const waitFor=async(status)=>{
  for(let attempt=0;attempt<240;attempt++){
   const state=await engine.call('snapshot',null);
   if(state.connection.status===status)return state;
   await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.fail('Did not reach '+status);
 };
 try{
  await writeFile(join(root,'release-qr'),'Ready');
  await engine.call('webConnect',null);
  const initial=await waitFor('Connected');
  await writeFile(join(root,'disconnect-web'),'Disconnect');
  await waitFor('Offline');
  const restored=await waitFor('Connected');
  assert.equal(restored.connection.phone,initial.connection.phone);
  await engine.stop();
  engine=start(root,'web');
  await waitFor('Connected');
  await engine.call('logout',null);
  await new Promise(resolve=>setTimeout(resolve,5500));
  assert.equal((await engine.call('snapshot',null)).connection.status,'Disconnected');
 }finally{await engine.stop();await rm(root,{recursive:true,force:true})}
});

test('calculated orders persist exact per-file totals, settings and reasoned overrides',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bloom-calculated-order-'));
 let engine=start(root);
 try{
  await engine.call('setup',{shop:'Calculation shop',language:'en',printer:'',mono:1000,colour:5000,photo:10000});
  const path=join(root,'photo.png');
  await writeFile(path,await require('sharp')({create:{width:10,height:10,channels:3,background:'white'}}).png().toBuffer());
  await engine.call('importLocal',{paths:[path],customer:null});
  const file=(await engine.call('snapshot',null)).attachments[0].id;
  const settings={documentPages:1,copies:3,pricing:{basis:'sheet',mono:1000,colour:5000}};
  const printSettings={printer:'',copies:3,paper:'A4',colour:false,landscape:false,duplex:'simplex',range:'',rotation:0,fit:'contain',layout:'single'};
  const order={customer:null,files:[file],copies:3,paper:'A4',colour:false,price:99999,discount:100,charge:200,calculations:[{id:file,settings}],printSettings};
  const estimate=await engine.call('printEstimate',{documentPages:10,duplex:'longEdge',pricing:{basis:'sheet',mono:1000,colour:5000}});
  assert.equal(estimate.totalPhysicalSheets,5);assert.equal(estimate.finalTotal,5000);
  const id=await engine.call('order',order);
  let job=(await engine.call('snapshot',null)).jobs.find(job=>job.id===id);
  assert.equal(job.total,3100);assert.equal(job.calculations[0].result.totalPhysicalSheets,3);assert.equal(job.printSettings.copies,3);
  await assert.rejects(engine.call('order',{...order,calculations:[{id:'wrong-file',settings}]}),/every order file/);
  await assert.rejects(engine.call('order',{...order,calculations:[{id:file,settings:{...settings,copies:2}}]}),/match/);
  await assert.rejects(engine.call('quote',{id,total:2500,reason:' '}));
  await engine.call('quote',{id,total:2500,reason:'Agreed customer discount'});
  assert.ok((await engine.call('snapshot',null)).activity.some(item=>item.detail.includes('Agreed customer discount')));
  await engine.stop();engine=start(root);
  job=(await engine.call('snapshot',null)).jobs.find(job=>job.id===id);
  assert.equal(job.total,2500);assert.equal(job.calculations[0].result.finalTotal,3000);
  assert.equal(job.printSettings.nup,1);
 }finally{await engine.stop();await rm(root,{recursive:true,force:true})}
});

test('v2 to v5 migration preserves customers, orders, payments and supports repeated startup',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bloom-migration-'));
 let engine=start(root);
 try{
  await engine.call('setup',{shop:'Existing shop',language:'en',printer:'',mono:1000,colour:5000,photo:10000});
  await engine.call('customer',{name:'Existing customer',phone:'94712345678',notes:'Keep this',tag:'School'});
  const customer=(await engine.call('snapshot',null)).customers[0].id;
  const path=join(root,'old.png');await writeFile(path,await require('sharp')({create:{width:12,height:12,channels:3,background:'white'}}).png().toBuffer());
  await engine.call('importLocal',{paths:[path],customer});const file=(await engine.call('snapshot',null)).attachments[0].id;
  const id=await engine.call('order',{customer,files:[file],copies:1,paper:'A4',colour:false,price:1000,discount:0,charge:0});
  await engine.call('payment',{id,amount:500,method:'Cash'});
  await engine.stop();
  const {DatabaseSync}=require('node:sqlite');
  const db=new DatabaseSync(join(root,'bloomconnect.sqlite'));
  // Recreate the previous version's exact schema by removing only new, empty tables in this isolated fixture.
  db.exec('DROP TABLE notification_attempts; DROP TABLE notification_outbox; DROP TABLE print_calculations; DROP TABLE print_order_config; PRAGMA user_version=2;');db.close();
  engine=start(root);
  const after=await engine.call('snapshot',null);
  assert.equal(after.settings.shop,'Existing shop');assert.equal(after.customers[0].notes,'Keep this');assert.equal(after.jobs[0].total,1000);assert.equal(after.jobs[0].paid,500);
  assert.deepEqual(after.jobs[0].calculations,[]);assert.equal(after.attachments[0].id,file);
  await engine.stop();engine=start(root);assert.equal((await engine.call('snapshot',null)).jobs[0].id,id);
  const check=new DatabaseSync(join(root,'bloomconnect.sqlite'),{readOnly:true});
  assert.equal(check.prepare('PRAGMA user_version').get().user_version,5);assert.deepEqual(check.prepare('PRAGMA foreign_key_check').all(),[]);check.close();
 }finally{await engine.stop();await rm(root,{recursive:true,force:true})}
});

test('printer failures and interrupted submissions require safe confirmation before reprint',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bloom-printer-recovery-'));
 let engine=start(root);
 try{
  const path=join(root,'file.png');await writeFile(path,await require('sharp')({create:{width:10,height:10,channels:3,background:'white'}}).png().toBuffer());
  await engine.call('importLocal',{paths:[path],customer:null});const file=(await engine.call('snapshot',null)).attachments[0].id;
  const id=await engine.call('order',{customer:null,files:[file],copies:1,paper:'A4',colour:false,price:1000,discount:0,charge:0});
  const first=await engine.call('printStart',{id,printer:'Test only'});
  await engine.call('printFinish',{id:first,error:'Windows did not confirm submission',partial:true});
  await assert.rejects(engine.call('printStart',{id,printer:'Test only'}),/Confirm or close/);
  await engine.call('queue',{id:first,status:'Cancelled'});
  const second=await engine.call('printStart',{id,printer:'Test only'});
  await engine.call('printFinish',{id:second,error:'Preparation failed before submission',partial:false});
  const third=await engine.call('printStart',{id,printer:'Test only'});
  await engine.stop();engine=start(root);
  let snapshot=await engine.call('snapshot',null);
  assert.equal(snapshot.queue.find(item=>item.id===third).status,'Unconfirmed');
  await assert.rejects(engine.call('printStart',{id,printer:'Test only'}),/Confirm or close/);
  await engine.call('queue',{id:third,status:'Completed'});
  const reprint=await engine.call('printStart',{id,printer:'Test only'});
  await engine.call('printFinish',{id:reprint,error:'',partial:false});
  snapshot=await engine.call('snapshot',null);
  assert.equal(snapshot.queue.length,4);assert.equal(snapshot.jobs.length,1);assert.equal(snapshot.jobs[0].total,1000);
  assert.equal(snapshot.queue.find(item=>item.id===reprint).status,'Submitted');
  await assert.rejects(engine.call('printStart',{id,printer:'Test only'}),/Confirm or close/);
 }finally{await engine.stop();await rm(root,{recursive:true,force:true})}
});

test('bulk photo settings, mixed PDF/photo order and reprint snapshots preserve customer ownership',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bloom-photo-order-'));let engine=start(root);
 try{
  await engine.call('setup',{shop:'Photo test',language:'en',printer:'',mono:1000,colour:5000,photo:10000});
  await engine.call('customer',{name:'Photo owner',phone:'',notes:'',tag:''});const customer=(await engine.call('snapshot',null)).customers[0].id;
  const paths=[];for(let i=0;i<2;i++){const path=join(root,'photo-'+i+'.png');await writeFile(path,await require('sharp')({create:{width:20+i,height:20,channels:3,background:i?'red':'blue'}}).png().toBuffer());paths.push(path)}
  const pdf=join(root,'notes.pdf');await writeFile(pdf,Buffer.from('%PDF-1.7\n% fixture for order storage only\n'));paths.push(pdf);
  await engine.call('importLocal',{paths,customer});const files=(await engine.call('snapshot',null)).attachments,photos=files.filter(f=>f.mime.startsWith('image/'));
  const options={printer:'',paper:'A4',copies:1,colour:true,landscape:false,duplex:'simplex',range:'',rotation:0,fit:'contain',layout:'single',marginMm:5,gapMm:2,photoBatch:false,photoItems:Object.fromEntries(photos.map(p=>[p.id,{widthMm:50.8,heightMm:50.8,quantity:3}]))};
  await engine.call('savePricingRule',{name:'A4 duplex photography',paper:'A4',method:'photo',duplex:true,policy:{basis:'photo',mono:100,colour:500,paperPerSheet:400,finishing:150}});
  const pricedPhotos={customer,files:photos.map(p=>p.id),copies:1,paper:'A4',colour:true,price:4350,discount:0,charge:0,printSettings:{...options,duplex:'manualLongEdge',photoGrid:{rows:1,columns:1},photoBatch:true}};
  await assert.rejects(engine.call('order',{...pricedPhotos,price:5550}),/Photo price changed/);
  const duplexOrder=await engine.call('order',pricedPhotos);
  assert.equal((await engine.call('snapshot',null)).jobs.find(j=>j.id===duplexOrder).total,4350);
  const id=await engine.call('order',{customer,files:files.map(f=>f.id),copies:1,paper:'A4',colour:true,price:15000,discount:0,charge:0,printSettings:options});
  await assert.rejects(engine.call('order',{customer:null,files:files.map(f=>f.id),copies:1,paper:'A4',colour:true,price:15000,discount:0,charge:0,printSettings:options}),/same customer/);
  await assert.rejects(engine.call('order',{customer,files:photos.map(f=>f.id),copies:1,paper:'A4',colour:true,price:9999,discount:0,charge:0,printSettings:{...options,photoBatch:true}}),/Photo price changed/);
  await engine.call('payment',{id,amount:1000,method:'Cash'});
  await assert.rejects(engine.call('updatePhotoOrder',{id,files:files.map(f=>f.id),printSettings:options,total:999,reason:'Invalid reduction'}),/lower than payments/);
  await assert.rejects(engine.call('updatePhotoOrder',{id,files:[photos[0].id],printSettings:options,total:15000,reason:'Remove original files'}),/Keep every original/);
  await engine.call('updatePhotoOrder',{id,files:files.map(f=>f.id),printSettings:options,total:18000,reason:'Operator revised the photo and PDF quote'});
  await engine.call('rule',{name:'Whole order confirmed',trigger:'print-completed',keyword:'',actions:['notify'],text:'All files verified',enabled:true,graph:''});
  const entry=await engine.call('printStart',{id,printer:'Fixture only',...options,fileSelection:photos.map(p=>p.id)});await engine.call('printFinish',{id:entry,error:'',partial:false});await engine.call('queue',{id:entry,status:'Completed'});
  await assert.rejects(engine.call('stage',{id,status:'Ready for Pickup'}),/Confirm physical printing/);
  assert.equal((await engine.call('snapshot',null)).activity.some(a=>a.kind==='Operator notification'&&a.detail==='All files verified'),false);
  const pdfEntry=await engine.call('printStart',{id,...options,printer:'Fixture only',fileSelection:files.filter(f=>f.mime==='application/pdf').map(f=>f.id)});await engine.call('printFinish',{id:pdfEntry,error:'',partial:false});await engine.call('queue',{id:pdfEntry,status:'Completed'});
  await engine.call('stage',{id,status:'Ready for Pickup'});
  assert.equal((await engine.call('snapshot',null)).activity.filter(a=>a.kind==='Operator notification'&&a.detail==='All files verified').length,1);
  const reprint=await engine.call('printStart',{id,...options,printer:'Fixture only'});await engine.call('printFinish',{id:reprint,error:'',partial:false});
  await engine.stop();engine=start(root);const saved=await engine.call('snapshot',null);
  assert.equal(saved.jobs.find(j=>j.id===id).printSettings.photoItems[photos[0].id].quantity,3);
  assert.equal(saved.jobs.find(j=>j.id===id).total,18000);assert.equal(saved.queue.length,3);
  assert.equal(JSON.parse(saved.queue[0].settings).photoItems[photos[1].id].widthMm,50.8);
 }finally{await engine.stop();await rm(root,{recursive:true,force:true})}
});

test('conversion preserves original files, reuses prepared assets, and stores printer-specific manual feed profiles',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bloom-universal-files-'));const engine=start(root);
 try{
  const text=join(root,'sample.txt'),image=join(root,'sample.tiff');
  await writeFile(text,'Original customer text');
  await writeFile(image,await require('sharp')({create:{width:24,height:32,channels:3,background:'red'}}).tiff().toBuffer());
  assert.equal(await engine.call('importLocal',{paths:[text,image],customer:null}),2);
  const imported=(await engine.call('snapshot',null)).attachments;
  assert.ok(imported.every(file=>file.status==='Needs conversion'));
  const tiff=imported.find(file=>file.name==='sample.tiff');
  await assert.rejects(engine.call('convertDocument',{id:tiff.id,mode:'notes'}),/only for PowerPoint/);
  const imageId=await engine.call('convertDocument',{id:tiff.id});
  assert.equal(await engine.call('convertDocument',{id:tiff.id}),imageId);
  const files=(await engine.call('snapshot',null)).attachments;
  assert.equal(files.find(file=>file.id===imageId).mime,'image/png');
  assert.equal(files.find(file=>file.id===tiff.id).status,'Needs conversion');
  await engine.call('saveBackup',{path:join(root,'backup')});
  const backup=await require('node:fs/promises').readdir(join(root,'backup','documents'));
  assert.ok(backup.some(file=>file.endsWith('.tiff'))&&backup.some(file=>file.endsWith('.txt'))&&backup.some(file=>file.endsWith('.png')));
  const printer={printer:'Fixture printer',landscape:true,edge:'short'};
  const profile={first:'back',reverseSecond:true,rotateSecond:false,instructions:'Reload blank side up.'};
  await engine.call('saveManualFeedProfile',{...printer,profile,verified:true});
  assert.deepEqual(await engine.call('manualFeedProfile',printer),profile);
  assert.equal(await engine.call('manualFeedProfile',{...printer,landscape:false}),null);
 }finally{await engine.stop();await rm(root,{recursive:true,force:true})}
});

test('scanner workers cancel, preserve originals and prepare a combined PDF for the existing order pipeline',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bloom-scanner-'));const engine=start(root);
 try{
  await engine.call('setup',{shop:'Scan test',language:'en',printer:'',mono:1000,colour:3000,photo:0});
  const sharp=require('sharp');
  const path=join(root,'receipt.png'),other=join(root,'notes.png');
  const receipt=await sharp({create:{width:340,height:550,channels:3,background:'#d1bf8b'}}).png().toBuffer();
  const notes=await sharp({create:{width:500,height:350,channels:3,background:'#bbbbbb'}}).png().toBuffer();
  await writeFile(path,receipt);await writeFile(other,notes);
  assert.equal(await engine.call('importLocal',{paths:[path,other],customer:null}),2);
  const source=(await engine.call('snapshot',null)).attachments;
  const a=source.find(file=>file.name==='receipt.png').id,b=source.find(file=>file.name==='notes.png').id;
  const settings={mode:'gray',brightness:0,contrast:10,white:90,shadow:95,sharpness:12,denoise:8,threshold:50,rotation:0,skew:0};
  const interrupted=assert.rejects(engine.call('scanPreview',{id:a,token:'cancelled',settings}),/Scan cancelled/);
  await engine.call('cancelScan',{token:'cancelled'});await interrupted;
  const preview=await engine.call('scanPreview',{id:a,token:'inspect',settings});
  assert.equal(preview.detected,false);
  assert.ok(preview.warnings.some(warning=>warning.includes('entire image')));
  assert.ok(preview.warnings.some(warning=>warning.includes('blurry')));
  assert.equal(await sharp(Buffer.from(preview.image)).metadata().then(meta=>meta.width),340);
  const first=await engine.call('saveScan',{id:a,token:'save-a',settings});
  const second=await engine.call('saveScan',{id:b,token:'save-b',settings});
  assert.notEqual(first,a);
  assert.deepEqual(Buffer.from((await engine.call('getPreview',{id:a})).bytes),receipt);
  assert.deepEqual(await readFile(other),notes);
  const pdf=await engine.call('combineScans',{token:'combine',pages:[{id:second,rotation:90},{id:first,rotation:0}],layout:'a4',marginMm:8});
  const bytes=Buffer.from((await engine.call('getPreview',{id:pdf})).bytes);
  assert.match(bytes.toString('ascii'),/\/Count 2/);
  const job=await engine.call('order',{customer:null,files:[pdf],copies:1,paper:'A4',colour:false,price:2000,discount:0,charge:0});
  const printable=await engine.call('printable',{id:job});
  assert.deepEqual(printable.map(file=>[file.id,file.mime]),[[pdf,'application/pdf']]);
 }finally{await engine.stop();await rm(root,{recursive:true,force:true})}
});
