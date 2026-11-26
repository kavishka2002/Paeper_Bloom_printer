import {storeDownload,identifyLargeMedia,storedMediaName,removePartialDownloads} from './media-storage';
import {effectivePhotoPricing,findPhotoPricing,quotePhotos} from '../printing/photo-pricing';
import {convertOfficeDocument,officeDocument,officeExtensions} from '../printing/office';
import {Worker} from 'node:worker_threads';
import {scanSettingsSchema,type ScanPreview} from '../shared/scan';
import type {ScanWork} from '../printing/scan-worker';
import {packsPhotoCopies,planPhotos,type DocumentInfo} from '../printing/plan';
import {defaultPresets} from '../printing/presets';
import {calculatePrint,calculateBulk} from '../printing/calculation';
import {batchPdfFileSchema} from '../printing/settings';
import {createServer} from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,copyFile,readdir,stat,rename,unlink} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {type SQLInputValue} from 'node:sqlite';
import sharp from 'sharp';
import {openDatabase} from '../database';
import {WebAdapter,isWhatsAppSystemMessage,type WebMessage} from '../whatsapp-adapters/web';
import {CloudAdapter,collect,signed,webhook} from '../whatsapp-adapters/cloud';
import {schemas,type Attachment,type Customer,type Job,type Message,type Rule,type Snapshot,type Input,type Operation} from '../shared/contracts';
import {notificationTemplates} from '../shared/notification-templates';
import {billMessage} from '../shared/bill-message';

const root=process.argv[2];
const mediaDir=join(root,'documents');
const mediaRecovery=removePartialDownloads(mediaDir);
const store=openDatabase(join(root,'bloomconnect.sqlite'));
const {db}=store;
const run=(sql:string,...values:SQLInputValue[])=>db.prepare(sql).run(...values);
const row=<T>(sql:string,...values:SQLInputValue[])=>db.prepare(sql).get(...values) as T|undefined;
const rows=<T>(sql:string,...values:SQLInputValue[])=>db.prepare(sql).all(...values) as T[];
if(!store.setting('universalPrintPresetsAdded')){
  store.atomic(()=>{
    const saved=store.setting<{id:string}[]>('printPresets');
    if(saved)store.save('printPresets',[...saved,...defaultPresets().slice(15).filter(preset=>!saved.some(item=>item.id===preset.id))]);
    store.save('universalPrintPresetsAdded',true);
  });
}
const now=()=>new Date().toISOString();
const scanJobs=new Map<string,{cancel:()=>void}>();
function scanWork<T>(token:string,input:ScanWork):Promise<T>{
  if(scanJobs.size)throw new Error('A document scan is already running.');
  const worker=new Worker(join(__dirname,'scan-worker.cjs'),{workerData:input});
  return new Promise((resolve,reject)=>{
   let settled=false;
   const finish=(error?:Error,value?:T)=>{
    if(settled)return;
    settled=true;clearTimeout(timeout);scanJobs.delete(token);void worker.terminate().catch(()=>{});
    if(error)reject(error);else resolve(value!);
   };
   const timeout=setTimeout(()=>finish(new Error('The scan took too long. Try a smaller image or fewer pages.')),100000);
   scanJobs.set(token,{cancel:()=>finish(new Error('Scan cancelled.'))});
   worker.once('message',(result:{value?:T;error?:string})=>finish(result.error?new Error(result.error):undefined,result.value));
   worker.once('error',error=>finish(error));
   worker.once('exit',()=>finish(new Error('The scan worker closed before producing an output.')));
  });
}
store.atomic(()=>{
  const rules=rows<{data:string}>('SELECT data FROM automation_rules').map(row=>JSON.parse(row.data) as Rule);
  for(const template of notificationTemplates){
    if(template.event!=='ready-to-print'&&template.event!=='print-queued'&&template.event!=='print-completed'&&template.event!=='pickup')continue;
    const id='default-'+template.event;
    const existing=rules.find(rule=>rule.id===id);
    if(existing){
      const legacySinhala=template.event==='print-queued'?template.si.replace('\nඇණවුම් අංකය:',' රැකියා අංකය:'):template.si;
      const previousSinhala=legacySinhala.replace('රැකියා අංකය:', 'Job Number:');
      const previousEnglish=template.event==='print-queued'?template.en.replace('\nOrder reference:', ' Job Number:'):template.en;
      const oldPickup=template.event==='pickup'&&['Your order is ready for pickup. Job Number: {job_id}. Total: Rs. {total_amount}','ඔබගේ ඇණවුම ලබාගැනීමට සූදානම්. Job Number: {job_id}. මුළු මුදල: රු. {total_amount}'].includes(existing.text);
      if(existing.trigger===template.event&&(oldPickup||[template.en,previousEnglish,legacySinhala,previousSinhala].includes(existing.text))){
        run('UPDATE automation_rules SET data=? WHERE id=?',JSON.stringify({...existing,text:template.si}),id);
      }
      continue;
    }
    if(rules.some(rule=>rule.trigger===template.event&&rule.actions.includes('reply')))continue;
    const rule:Rule={id,name:template.name,trigger:template.event,keyword:'',actions:['reply'],text:template.si,debounceSeconds:0,enabled:true,graph:''};
    run('INSERT INTO automation_rules VALUES (?,?)',id,JSON.stringify(rule));
  }
});
const interrupted=run("UPDATE print_queue SET status='Unconfirmed',error='BloomConnect restarted before submission was confirmed. Check the printer output before retrying.' WHERE status='Printing'");
if(interrupted.changes)store.audit('Printer recovery','Interrupted submissions require operator verification.');
let changeTimer:ReturnType<typeof setTimeout>|undefined;
const changed=()=>{
  if(changeTimer||!process.connected)return;
  changeTimer=setTimeout(()=>{
    changeTimer=undefined;
    if(process.connected)process.send?.({type:'changed'},()=>{});
  },45);
  changeTimer.unref();
};
let adapter:CloudAdapter|undefined;
let web:WebAdapter|undefined;
let stoppingWeb:WebAdapter|undefined;
let webTransition=false;
let webOperation=0;
let cloudTransition=false;
let webRetry:ReturnType<typeof setTimeout>|undefined;
let webRetryAttempt=0;
let shuttingDown=false;
if(store.setting('whatsappProvider')==='web'&&!row('SELECT key FROM settings WHERE key=?','lastWebAccount')){
  const accounts=rows<{id:string}>("SELECT id FROM whatsapp_accounts WHERE id LIKE 'web:%' LIMIT 2");
  if(accounts.length===1)store.save('lastWebAccount',accounts[0].id);
}
function retryWeb(){
  if(shuttingDown||webRetry||store.setting('whatsappProvider')!=='web')return;
  const delay=[1200,5000,10000,30000][webRetryAttempt];
  webRetryAttempt=Math.min(webRetryAttempt+1,3);
  connection={...connection,status:'Reconnecting',detail:'WhatsApp will reconnect automatically. Saved chats are still available.'};
  changed();
  webRetry=setTimeout(()=>{
    webRetry=undefined;
    if(!shuttingDown&&store.setting('whatsappProvider')==='web')void connectWeb(null,true).catch(()=>{});
  },delay);
}
let connection:Snapshot['connection']={status:'Disconnected',phone:'',webhook:false};
let networkBusy=false;
const inflight=new Set<string>();
const mediaDownloads=new Map<string,{promise:Promise<void>;controller:AbortController}>();
const downloadStatus=new Map<string,NonNullable<Attachment['download']>>();
const downloadSlots=[Promise.resolve(),Promise.resolve()];
let nextDownloadSlot=0;
const printFiles=(id:string)=>rows<{attachment_id:string}>('SELECT attachment_id FROM print_job_files WHERE job_id=? ORDER BY rowid',id).map(x=>x.attachment_id);
const jobQuery='SELECT j.*,COALESCE((SELECT SUM(amount) FROM payments WHERE job_id=j.id),0) AS paid FROM print_jobs j';
const attachmentFields='id,customer_id,message_id,name,mime,status,created,bytes';
const skipsAutoMessages=(id:string)=>store.setting<boolean>('skipAutoMessages:'+id)===true;
function setAutoMessagePreference(id:string,skip:boolean){
  store.save('skipAutoMessages:'+id,skip);
  if(skip){
    run("UPDATE notification_outbox SET status='Cancelled',error='Automatic WhatsApp messages are disabled for this order' WHERE status='Pending' AND (substr(event_key,instr(event_key,':')+1)=? OR substr(event_key,instr(event_key,':')+1) LIKE ?)",id,id+':%');
  }
}
function job(id:string){const data=row<Job>(jobQuery+' WHERE j.id=?',id);if(!data)throw new Error('Order not found.');return data}
// Older versions always submitted every order file. Retain that historical selection explicitly.
for(const legacy of rows<{id:string;job_id:string;settings:string|null}>('SELECT id,job_id,settings FROM print_queue')){
 try{const settings=JSON.parse(legacy.settings??'{}');if(!settings.fileSelection)run('UPDATE print_queue SET settings=? WHERE id=?',JSON.stringify({...settings,fileSelection:printFiles(legacy.job_id)}),legacy.id)}catch{}
}
function allFilesConfirmed(id:string){
 const covered=new Set<string>(),observed=new Set<string>();
 for(const entry of rows<{settings:string|null;status:string}>("SELECT settings,status FROM print_queue WHERE job_id=? AND status!='Cancelled' ORDER BY created DESC,rowid DESC",id)){
  try{for(const file of JSON.parse(entry.settings??'{}').fileSelection??[]){if(!observed.has(file)){observed.add(file);if(entry.status==='Completed')covered.add(file)}}}catch{}
 }
 const files=printFiles(id);return files.length>0&&files.every(file=>covered.has(file));
}
function visibleMessageAccount(){
 const savedWebAccount=store.setting('whatsappProvider')==='web'?store.setting<string>('lastWebAccount'):null;
 return web?.account||adapter?.config.phoneId||savedWebAccount;
}
const automationRules=()=>rows<{data:string}>('SELECT data FROM automation_rules ORDER BY rowid').map(r=>JSON.parse(r.data) as Rule);
function snapshot():Snapshot{
 const activeAccount=visibleMessageAccount();
 return {
  settings:store.setting('shop'),customers:rows('SELECT * FROM customers ORDER BY last DESC'),
  messages:activeAccount
    ?rows('SELECT id,customer_id,body,kind,direction,status,created,unread FROM messages WHERE account_id=? ORDER BY created',activeAccount)
    :connection.mode==='web'?[]:rows('SELECT id,customer_id,body,kind,direction,status,created,unread FROM messages ORDER BY created'),
  attachments:rows<Attachment>('SELECT '+attachmentFields+' FROM attachments ORDER BY created DESC').map(file=>({...file,download:downloadStatus.get(file.id)})),
  jobs:rows<Job>(jobQuery+' ORDER BY j.id DESC').map(j=>({...j,skipAutoMessages:skipsAutoMessages(j.id),files:printFiles(j.id),printSettings:JSON.parse(row<{settings:string}>('SELECT settings FROM print_order_config WHERE job_id=?',j.id)?.settings??'null')??undefined,calculations:rows<{attachment_id:string;input:string;result:string}>('SELECT * FROM print_calculations WHERE job_id=?',j.id).map(c=>({id:c.attachment_id,settings:JSON.parse(c.input),result:JSON.parse(c.result)}))})),
  payments:rows('SELECT * FROM payments ORDER BY created DESC'),queue:rows('SELECT * FROM print_queue ORDER BY created DESC'),
  rules:automationRules(),
  activity:rows('SELECT * FROM activity_logs ORDER BY id DESC LIMIT 300'),connection
 }
}
function createOrder(input:Input<'order'>){
  if(new Set(input.files).size!==input.files.length)throw new Error('Select each file once.');
  const batch=input.printSettings?.batchPdfFiles;
  if(batch&&(!input.calculations||Object.keys(batch).length!==input.files.length||input.files.some(id=>!Object.hasOwn(batch,id))))throw new Error('Provide print settings and calculations for every PDF in the batch.');
  for(const id of input.files){const a=row<Attachment>('SELECT * FROM attachments WHERE id=?',id);if(!a||a.status!=='Ready'||a.customer_id!==input.customer)throw new Error('Select ready files belonging to the same customer.');if(batch&&a.mime!=='application/pdf')throw new Error('Select only PDFs for a PDF batch.')}
  let photoSnapshot:unknown;
  const photoOptions=input.printSettings;
  if(photoOptions&&Object.keys(photoOptions.photoItems??{}).length){
    const ids=Object.keys(photoOptions.photoItems!);
    if(ids.some(id=>!input.files.includes(id)))throw new Error('Photo settings must reference files in this order.');
    const documents=ids.map(id=>{const a=row<Attachment>('SELECT * FROM attachments WHERE id=?',id)!;return {id,mime:a.mime,pages:[{widthMm:1,heightMm:1,blank:false,ink:'colour',coverage:1}]} as DocumentInfo});
    const plan=planPhotos(photoOptions,documents),shop=store.setting<Input<'setup'>>('shop');
    if(!shop)throw new Error('Configure shop photo pricing first.');
    const {policy}=effectivePhotoPricing(findPhotoPricing(store.setting<Input<'savePricingRule'>[]>('printPricingRules')??[],photoOptions)?.policy,shop,photoOptions.duplex);
    const quote=quotePhotos(plan,policy),photoTotal=quote.total;
    photoSnapshot={sides:plan.sides,photoCount:plan.photoCount,physicalSheets:quote.physicalSheets,quote,rate:shop.photo,total:photoTotal,created:now()};
    if(ids.length===input.files.length&&!input.calculations&&input.price*input.copies!==photoTotal)throw new Error('Photo price changed. Refresh the layout and configured shop rate before saving.');
  }
  const prefix='BC-'+new Intl.DateTimeFormat('en',{year:'numeric',timeZone:'Asia/Colombo'}).format(new Date())+'-';
  const number=(row<{n:number}>('SELECT MAX(CAST(substr(id,9) AS INTEGER)) AS n FROM print_jobs WHERE id LIKE ?',prefix+'%')?.n??0)+1;
  const id=prefix+String(number).padStart(5,'0');
  const calculations=input.calculations;
  if(calculations&&(calculations.length!==input.files.length||new Set(calculations.map(item=>item.id)).size!==input.files.length||calculations.some(item=>!input.files.includes(item.id))))throw new Error('Provide exactly one calculation for every order file.');
  if(calculations&&input.printSettings){
    const options=input.printSettings;
    if(options.copies!==input.copies||options.paper!==input.paper||options.colour!==input.colour)throw new Error('Order settings must match the saved print configuration.');
    for(const item of calculations){
      const settings=item.settings;
      const fileOptions=batch?.[item.id]??options;
      const copies=batch?fileOptions.copies:options.fileCopies?.[item.id]??options.copies;
      const attachment=row<{mime:string}>('SELECT mime FROM attachments WHERE id=?',item.id)!;
      const packed=!batch&&packsPhotoCopies(attachment.mime,options);
      if(packed&&(settings.documentPages!==copies||settings.selectedPages?.length!==copies))throw new Error('Photo calculation must include every requested copy.');
      if(settings.copies!==(packed?1:copies)||settings.paper!==fileOptions.paper||settings.pagesPerSide!==(fileOptions.nup??1)||settings.duplex!==fileOptions.duplex||settings.imposition!==(fileOptions.booklet?'booklet':fileOptions.poster?.enabled?'poster':'ordinary')||(fileOptions.booklet&&settings.signaturePages!==fileOptions.signaturePages))throw new Error('Calculated settings must match the saved print configuration.');
    }
  }
  const estimate=calculations?calculateBulk(calculations.map(item=>({...item,customer:input.customer}))):undefined;
  if(estimate?.needsConfirmation)throw new Error('Confirm uncertain colour pages before creating the order.');
  const total=(estimate?.finalTotal??input.price*input.copies)+input.charge-input.discount;
  if(total<0||!Number.isSafeInteger(total))throw new Error('Check the price and discount.');
  run('INSERT INTO print_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?)',id,input.customer,'New',input.copies,input.paper,+input.colour,total,now());
  for(const file of input.files)run('INSERT INTO print_job_files VALUES (?,?)',id,file);
  if(calculations)for(const item of calculations)run('INSERT INTO print_calculations VALUES (?,?,?,?,?)',id,item.id,JSON.stringify(item.settings),JSON.stringify(estimate!.files.find(file=>file.id===item.id)!.calculation),now());
  if(input.printSettings)run('INSERT INTO print_order_config VALUES (?,?)',id,JSON.stringify({...input.printSettings,
    orderAdjustments:calculations&&(input.charge||input.discount)?{charge:input.charge,discount:input.discount}:undefined}));
  if(photoSnapshot)store.save('photoLayout:'+id,photoSnapshot);
  if(input.customer&&input.skipAutoMessages!==undefined)setAutoMessagePreference(id,input.skipAutoMessages);
  store.audit('Order created',id);queueMicrotask(()=>void automation({id,jobId:id,kind:'order-created',customer:input.customer}));return id;
}
async function identify(bytes:Buffer,name:string){
  if(bytes.subarray(0,5).toString()==='%PDF-')return {extension:'pdf',mime:'application/pdf'};
  try{
    const info=await sharp(bytes,{limitInputPixels:40_000_000}).metadata();
    if(info.format==='jpeg'||info.format==='png'||info.format==='webp'){
      await sharp(bytes,{limitInputPixels:40_000_000}).resize(64,64,{fit:'inside'}).png().toBuffer();
      return {extension:info.format==='jpeg'?'jpg':info.format,mime:'image/'+info.format};
    }
    if(info.format==='tiff'||info.format==='heif'){
      if((info.pages??1)>1)throw new Error('Multi-page images must be exported to PDF before importing.');
      try{await sharp(bytes,{limitInputPixels:40_000_000}).resize(64,64,{fit:'inside'}).png().toBuffer()}
      catch{throw new Error('The installed image decoder cannot read this TIFF or HEIC image. Export it to PNG or PDF.')}
      return {extension:info.format==='tiff'?'tiff':'heic',mime:'image/'+info.format,needsConversion:true};
    }
  }catch(e){if(e instanceof Error&&/^(Multi-page|The installed image decoder)/.test(e.message))throw e}
  const office=officeDocument(name,bytes);
  if(office)return {...office,needsConversion:true};
  throw new Error('Import a valid PDF, supported image, Office document, or UTF-8/UTF-16 text file.');
}
async function saveMedia(id:string,bytes:Buffer){
  if(bytes.length>32*1024*1024)throw new Error('The file exceeds 32 MB.');
  const {extension,mime,needsConversion}=await identify(bytes,row<{name:string}>('SELECT name FROM attachments WHERE id=?',id)?.name??'');
  const hash=createHash('sha256').update(bytes).digest('hex');
  const path=hash+'.'+extension;
  await mkdir(mediaDir,{recursive:true});
  const temp=join(mediaDir,'.'+randomUUID()+'.tmp');
  try{await writeFile(temp,bytes,{flag:'wx',flush:true});await rename(temp,join(mediaDir,path))}
  finally{await unlink(temp).catch(()=>{})}
  run("UPDATE attachments SET mime=?,status=?,bytes=?,hash=?,path=? WHERE id=?",mime,needsConversion?'Needs conversion':'Ready',bytes.length,hash,path,id);
}
function mediaError(error:unknown){
  const code=(error as NodeJS.ErrnoException)?.code;
  if(code==='ENOSPC')return 'The documents drive is full. Free disk space and retry.';
  if(code==='EACCES'||code==='EPERM')return 'BloomConnect could not write to its documents folder.';
  const message=error instanceof Error?error.message:'';
  if(/^(WhatsApp|Meta|Connect the original|Unexpected media|Large attachments|The attachment|Import a valid|Multi-page|The installed image)/.test(message))return message;
  return 'The attachment download was interrupted or could not be read. Retry while WhatsApp is connected.';
}
function receiveMedia(id:string):Promise<void>{
  const existing=mediaDownloads.get(id);
  if(existing)return existing.controller.signal.aborted?existing.promise.catch(()=>{}).then(()=>receiveMedia(id)):existing.promise;
  const controller=new AbortController();
  run("UPDATE attachments SET status='Pending' WHERE id=? AND remote IS NOT NULL AND status IN ('Available to download','Cancelled','Failed')",id);
  changed();
  const index=nextDownloadSlot++%downloadSlots.length;
  const promise=downloadSlots[index].then(()=>downloadMedia(id,controller.signal)).finally(()=>mediaDownloads.delete(id));
  downloadSlots[index]=promise.catch(()=>{});
  mediaDownloads.set(id,{promise,controller});
  return promise;
}
async function downloadMedia(id:string,signal:AbortSignal){
  if(signal.aborted)return;
  const a=row<Attachment&{remote:string;account_id:string}>('SELECT a.*,m.account_id FROM attachments a JOIN messages m ON m.id=a.message_id WHERE a.id=?',id);
  if(a&&['Ready','Needs conversion'].includes(a.status))return;
  const current=a?.account_id.startsWith('web:')?web:adapter;
  const account=current instanceof WebAdapter?current.account:current?.config.phoneId;
  if(!a||!current||a.account_id!==account){
    const message='Connect the original WhatsApp account to retry this attachment.';
    if(a){
      run("UPDATE attachments SET status='Failed' WHERE id=?",id);
      downloadStatus.set(id,{bytes:0,error:message});changed();
    }
    throw new Error(message);
  }
  inflight.add(id);
  run("UPDATE attachments SET status='Downloading' WHERE id=?",id);
  downloadStatus.set(id,{bytes:0});changed();
  let lastUpdate=0;
  try{
    await mediaRecovery;
    const source=await current.download(a.remote,signal);
    const saved=await storeDownload(mediaDir,source,signal,(bytes,total)=>{
      if(Date.now()-lastUpdate<300)return;
      lastUpdate=Date.now();downloadStatus.set(id,{bytes,total});changed();
    },async(path,bytes)=>{
      if(bytes<=32*1024*1024)return identify(await readFile(path),a.name);
      return identifyLargeMedia(path);
    });
    run("UPDATE attachments SET mime=?,status=?,bytes=?,hash=?,path=? WHERE id=?",saved.mime,saved.needsConversion?'Needs conversion':'Ready',saved.bytes,saved.hash,saved.path,id);
    downloadStatus.delete(id);
    const retries=store.setting<Record<string,{attempt:number;due:number}>>('mediaRetries')??{};delete retries[id];store.save('mediaRetries',retries);
    const message=a.message_id?row<Message>('SELECT * FROM messages WHERE id=?',a.message_id):undefined;
    if(message?.status==='history'||message?.direction==='outgoing')return;
    const fresh=row<Attachment>('SELECT * FROM attachments WHERE id=?',id)!;
    await automation({id,kind:'files-received',customer:a.customer_id,file:id});
    if(fresh.status==='Needs conversion')return;
    const kind=fresh.mime==='application/pdf'?'pdf':'image';
    await automation({id,kind,customer:a.customer_id,file:id});
    if(kind==='pdf')await automation({id,kind:'document',customer:a.customer_id,file:id});
  }catch(error){if(!['Ready','Needs conversion'].includes(row<Attachment>('SELECT * FROM attachments WHERE id=?',id)?.status??'')){
      if(signal.aborted){run("UPDATE attachments SET status='Cancelled' WHERE id=?",id);downloadStatus.delete(id);return}
      run("UPDATE attachments SET status='Failed' WHERE id=?",id);
      downloadStatus.set(id,{bytes:0,error:mediaError(error)});
      const retries=store.setting<Record<string,{attempt:number;due:number}>>('mediaRetries')??{},attempt=(retries[id]?.attempt??0)+1;
      retries[id]={attempt,due:Date.now()+Math.min(300000,5000*2**attempt)};store.save('mediaRetries',retries);
    }store.audit('Attachment processing issue',a.name+' - '+(error instanceof Error?error.message:String(error)));throw error} 
  finally{inflight.delete(id);changed()}
}
setInterval(()=>{
 if(!['Connected','API reachable'].includes(connection.status))return;
 const retries=store.setting<Record<string,{attempt:number;due:number}>>('mediaRetries')??{};
 for(const [id,retry] of Object.entries(retries).filter(([,r])=>r.attempt<5&&r.due<=Date.now()).slice(0,3)){
  const record=row<{account_id:string}>('SELECT m.account_id FROM attachments a JOIN messages m ON m.id=a.message_id WHERE a.id=?',id);
  if(record?.account_id===(web?.account??adapter?.config.phoneId))void receiveMedia(id).catch(()=>{});
 }
},5000).unref();
function connectedWhatsAppAccount(){
  return ['Connected','API reachable'].includes(connection.status)?(web?.account||adapter?.config.phoneId):undefined;
}
function notificationAccount(customer:string){
  const account=web?.account||adapter?.config.phoneId||
    (store.setting('whatsappProvider')==='web'?store.setting<string>('lastWebAccount'):undefined);
  return account&&row('SELECT customer_id FROM conversations WHERE account_id=? AND customer_id=?',account,customer)?account:undefined;
}
class ReplyBlocked extends Error{}
async function reply(id:string,text:string,automated=false,expectedAccount?:string){
  const current=web??adapter;
  const account=connectedWhatsAppAccount();
  if(!current||!account||expectedAccount&&account!==expectedAccount)throw new ReplyBlocked('WhatsApp is offline.');
  const webReply=current instanceof WebAdapter?current:null;
  const customer=row<Customer>('SELECT * FROM customers WHERE id=?',id);
  if(!customer)throw new Error('Customer not found.');
  const inbound=row<{created:string}>("SELECT MAX(created) created FROM messages WHERE customer_id=? AND account_id=? AND direction='incoming'",id,account);
  if(!webReply||automated){
    const age=Date.now()-Date.parse(inbound?.created??'');
    if(!Number.isFinite(age)||age<0||age>=86400000){
      throw new ReplyBlocked(webReply?'Automatic replies require a customer message in the last 24 hours.':'The Meta Cloud API reply window has expired. Ask the customer to message you again before replying here.');
    }
  }
  if(webReply&&!row('SELECT customer_id FROM conversations WHERE account_id=? AND customer_id=?',account,id)){
    throw new ReplyBlocked('Open an existing conversation from this linked WhatsApp account before sending a reply.');
  }
  const aliasPrefix='webContact:'+account+':';
  const alias=webReply?row<{key:string}>('SELECT key FROM settings WHERE substr(key,1,?)=? AND value=? ORDER BY key LIMIT 1',aliasPrefix.length,aliasPrefix,JSON.stringify(id))?.key.slice(aliasPrefix.length):undefined;
  if(!customer.phone&&!alias)throw new ReplyBlocked('WhatsApp could not identify the recipient for this conversation.');
  const message=webReply?await webReply.send(customer.phone,text,alias):await current.send(customer.phone,text);
  run("INSERT INTO messages VALUES (?,?,?,?,?,'outgoing','accepted',?,0) ON CONFLICT(id) DO UPDATE SET status=CASE WHEN messages.status='history' THEN 'accepted' ELSE messages.status END",message,account,id,text,'text',now());return message;
}
type Event={jobId?:string;id:string;kind:string;customer:string|null;file?:string;text?:string};
function matches(rule:Rule,event:Event){
  return rule.enabled&&(rule.trigger===event.kind||(rule.trigger==='keyword'&&event.kind==='message'&&!!rule.keyword&&event.text?.toLowerCase().includes(rule.keyword.toLowerCase())));
}
async function automation(event:Event){
  const rules=automationRules();
  const matching=rules.filter(rule=>matches(rule,event));
  const customPickup=event.kind==='pickup'&&matching.some(rule=>rule.id!=='default-pickup'&&rule.actions.includes('reply'));
  const pickupReply=event.kind==='print-completed'&&rules.some(rule=>rule.enabled&&rule.trigger==='pickup'&&rule.actions.includes('reply'));
  for(const rule of matching){
    if(customPickup&&rule.id==='default-pickup')continue;
    if(pickupReply&&rule.id==='default-print-completed')continue;
    const eventKey=event.kind+':'+event.id;
    const reservation=run("INSERT OR IGNORE INTO automation_executions VALUES (?,?,'Running',?)",rule.id,eventKey,now());
    if(!reservation.changes)continue;
    let status='Completed';
    try{
      for(const action of rule.actions){
        if(action==='order'){
          if(!event.file)throw new Error('An imported attachment is required.');
          const settings=store.setting<Input<'setup'>>('shop');if(!settings)throw new Error('Set pricing first.');
          store.atomic(()=>createOrder({customer:event.customer,files:[event.file!],copies:1,paper:'A4',colour:false,price:event.kind==='image'?settings.photo:settings.mono,discount:0,charge:0}));

        }
        if(action==='notify')store.audit('Operator notification',rule.text||rule.name);
        if(action==='label'&&event.customer)run('UPDATE customers SET tag=? WHERE id=?',rule.text.slice(0,120),event.customer);
        if(action==='reply'&&!(event.jobId&&skipsAutoMessages(event.jobId))){
          if(!event.customer||!rule.text)throw new Error('A customer and reply text are required.');
          const order=event.jobId?job(event.jobId):undefined;
          const values:Record<string,string>={
            job_id:order?.id??'',total_amount:((order?.total??0)/100).toFixed(2),
            customer_name:row<Customer>('SELECT name FROM customers WHERE id=?',event.customer)?.name??'',
            shop_name:store.setting<Input<'setup'>>('shop')?.shop??'BloomConnect'
          };
          let text=rule.text.replace(/\{(job_id|total_amount|customer_name|shop_name)\}/g,(_,key:string)=>values[key]);
          if(event.kind==='pickup'&&order){
            const config=row<{settings:string}>('SELECT settings FROM print_order_config WHERE job_id=?',order.id);
            const pdfNames=config&&JSON.parse(config.settings).batchPdfFiles
              ?printFiles(order.id).map(id=>row<{name:string}>('SELECT name FROM attachments WHERE id=?',id)?.name??'Document')
              :undefined;
            const bill=billMessage(values.shop_name,order,pdfNames);
            const summary=text.length+bill.length+2>4096&&pdfNames?billMessage(values.shop_name,order):bill;
            text=text.slice(0,4096-summary.length-2)+'\n\n'+summary;
          }
          const account=notificationAccount(event.customer);
          if(!account)throw new Error('This customer has no conversation with the configured WhatsApp account.');
          const delay=(rule.debounceSeconds??0)*1000;
          const due=Date.now()+delay;
          if(delay||connectedWhatsAppAccount()!==account){
            const pending=delay&&!event.jobId?row<{id:string}>("SELECT id FROM notification_outbox WHERE rule_id=? AND customer_id=? AND account_id=? AND status='Pending' AND due>? LIMIT 1",rule.id,event.customer,account,Date.now()):undefined;
            if(pending)run('UPDATE notification_outbox SET due=?,body=? WHERE id=?',due,text,pending.id);
            else run("INSERT INTO notification_outbox(id,rule_id,customer_id,account_id,event_key,body,status,due,created) VALUES (?,?,?,?,?,?,'Pending',?,?)",randomUUID(),rule.id,event.customer,account,eventKey,text,due,now());
            store.audit('Automation reply queued',rule.name);
          }else{
            const logId=randomUUID();
            run("INSERT INTO notification_outbox(id,rule_id,customer_id,account_id,event_key,body,status,due,created) VALUES (?,?,?,?,?,?,'Sending',?,?)",logId,rule.id,event.customer,account,eventKey,text,Date.now(),now());
            await sendNotification({id:logId,customer_id:event.customer,account_id:account,body:text});
          }
        }
      }
    }catch(error){status='Failed';store.audit('Automation error',rule.name+' - '+(error instanceof Error?error.message:'Action failed.'))}
    run('UPDATE automation_executions SET status=? WHERE rule_id=? AND event_id=?',status,rule.id,eventKey);
    store.audit('Automation '+status.toLowerCase(),rule.name);
  }
  changed();
}
async function finishConfirmedOrder(id:string){
  if(!allFilesConfirmed(id))return;
  const order=job(id);
  if(['Cancelled','Completed'].includes(order.status))return;
  if(order.status!=='Ready for Pickup'){
    run("UPDATE print_jobs SET status='Ready for Pickup' WHERE id=?",id);
    store.audit('Order status',id+' · '+order.status+' → Ready for Pickup');
    changed();
  }
  await automation({id,jobId:id,kind:'print-completed',customer:order.customer_id});
  await automation({id,jobId:id,kind:'pickup',customer:order.customer_id});
}
function ingest(account:string,msg:WebMessage,events:Event[],imports:string[],historical=false){
  if(account.startsWith('web:')&&isWhatsAppSystemMessage(msg.kind))return;
  const prior=row<Message>('SELECT * FROM messages WHERE id=?',msg.id);
  if(prior&&(historical||prior.status!=='history'||prior.direction!=='incoming')){
    if(msg.file&&!row('SELECT id FROM attachments WHERE message_id=?',msg.id)){
      run("INSERT INTO attachments (id,customer_id,message_id,name,status,created,remote) VALUES (?,?,?,?,'Available to download',?,?)",randomUUID(),prior.customer_id,msg.id,basename(msg.file.name).slice(0,180),msg.created,msg.file.remote);
    }
    return;
  }
  const alias=msg.chat?'webContact:'+account+':'+msg.chat:undefined;
  const mapped=alias?store.setting<string>(alias):null;
  const byPhone=msg.phone?row<Customer>('SELECT * FROM customers WHERE phone=?',msg.phone):undefined;
  const byChat=mapped?row<Customer>('SELECT * FROM customers WHERE id=?',mapped):undefined;
  const existing=byChat??byPhone;
  const customer=prior?.customer_id??existing?.id??randomUUID();
  if(existing){
    run('UPDATE customers SET created=MIN(created,?),last=MAX(last,?) WHERE id=?',msg.created,msg.created,customer);
    if(msg.phone&&!existing.phone&&!byPhone)run('UPDATE customers SET phone=? WHERE id=?',msg.phone,customer);
  }else if(!prior)run('INSERT INTO customers (id,name,phone,created,last) VALUES (?,?,?,?,?)',customer,msg.name.slice(0,160)||msg.phone,msg.phone,msg.created,msg.created);
  if(alias&&mapped!==customer)store.save(alias,customer);
  run('INSERT OR IGNORE INTO conversations VALUES (?,?)',account,customer);
  const body=msg.text.slice(0,4096);
  if(prior)run("UPDATE messages SET body=?,status='received',unread=1 WHERE id=?",body,msg.id);
  else run('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?)',msg.id,account,customer,body,msg.kind,msg.outgoing?'outgoing':'incoming',historical||msg.outgoing?'history':'received',msg.created,historical||msg.outgoing?0:1);
  if(msg.file){
    const existing=row<{id:string}>('SELECT id FROM attachments WHERE message_id=?',msg.id);
    const id=existing?.id??randomUUID();
    if(!existing)run('INSERT INTO attachments (id,customer_id,message_id,name,status,created,remote) VALUES (?,?,?,?,?,?,?)',id,customer,msg.id,basename(msg.file.name).slice(0,180),historical||msg.outgoing?'Available to download':'Pending',msg.created,msg.file.remote);
    if(!historical&&!msg.outgoing)imports.push(id);
  }
  if(historical||msg.outgoing)return;
  events.push({id:msg.id,kind:'message',customer,text:body});
}
function processIncoming(events:Event[],imports:string[]){
  changed();
  for(const event of events)void automation(event).catch(()=>store.audit('Automation error','An incoming message could not be processed.'));
  for(const id of imports)void receiveMedia(id).catch(()=>{});
}
let syncingWeb:WebAdapter|undefined;
async function syncChatDocuments({id}:Input<'webChatSync'>){
  const current=web;
  if(!current||connection.status!=='Connected')throw new Error('Connect WhatsApp Web before loading documents.');
  const customer=row<Customer>('SELECT * FROM customers WHERE id=?',id);
  if(!customer)throw new Error('Customer not found.');
  const prefix='webContact:'+current.account+':';
  const aliases=rows<{key:string}>('SELECT key FROM settings WHERE substr(key,1,?)=? AND value=?',prefix.length,prefix,JSON.stringify(id))
    .map(item=>item.key.slice(prefix.length));
  const {messages,partial}=await current.syncChat(aliases,customer.phone);
  if(web!==current||connection.status!=='Connected')throw new Error('WhatsApp Web disconnected while loading documents.');
  store.atomic(()=>{for(const message of messages)ingest(current.account,message,[],[],true)});
  const documents=rows<{id:string}>(
    "SELECT a.id FROM attachments a JOIN messages m ON m.id=a.message_id WHERE m.account_id=? AND a.customer_id=? AND a.status='Available to download' ORDER BY a.created DESC LIMIT 20",
    current.account,id);
  changed();
  void (async()=>{
    let next=0;
    const download=async()=>{
      while(next<documents.length&&web===current&&connection.status==='Connected'){
        const {id}=documents[next++];
        await receiveMedia(id).catch(()=>{});
      }
    };
    await Promise.all([download(),download(),download()]);
  })();
  return {messages:messages.length,documents:messages.filter(message=>message.file).length,partial};
}
async function syncWebChats(onConnect=false,skipSaved=false){
  const current=web;
  if(!current||connection.status!=='Connected')throw new Error('Link WhatsApp Web before syncing chats.');
  if(syncingWeb===current)return;
  syncingWeb=current;
  connection={...connection,sync:'Syncing recent chats…'};changed();
  const sync=()=>current.syncHistory(messages=>{
      if(web!==current)return;
      store.atomic(()=>{for(const message of messages)ingest(current.account,message,[],[],true)});
      changed();
  },skipSaved?id=>!!row('SELECT id FROM messages WHERE account_id=? AND id=?',current.account,id):undefined);
  try{
    let result;
    if(onConnect){
      result=await sync().catch(()=>undefined);
      if(!result?.imported){
        await new Promise(resolve=>setTimeout(resolve,1500));
        if(web!==current||connection.status!=='Connected')return;
        result=await sync();
      }
    }else result=await sync();
    if(web===current&&connection.status==='Connected'){
      const sync=result.imported
        ?'Recent chats synced'+(result.failed?' · Some history could not be loaded':'')
        :result.chats?'No messages returned yet. Try Sync recent chats again.':'No direct chats found on WhatsApp Web';
      connection={...connection,sync};
    }
  }catch{
    if(web===current)connection={...connection,sync:'Chat sync failed. Try Sync recent chats again.'};
  }finally{
    if(syncingWeb===current)syncingWeb=undefined;
    changed();
  }
}
async function connectWeb(_input:null=null,automatic=false){
  if(cloudTransition)throw new Error('Wait for Cloud API verification to finish.');
  if(adapter)throw new Error('Log out of the Cloud API connection before linking WhatsApp Web.');
  if(webTransition||connection.status==='Connected')return;
  if(!automatic)webRetryAttempt=0;
  if(webRetry){clearTimeout(webRetry);webRetry=undefined}
  const operation=++webOperation;
  webTransition=true;
  let previous:WebAdapter|undefined;
  try{
    previous=web;web=undefined;stoppingWeb=previous;
    if(previous)await previous.stop();
    if(operation!==webOperation||shuttingDown)return;
    stoppingWeb=undefined;
    web=undefined;
    connection={status:'Starting Engine',mode:'web',phone:'',webhook:false};changed();
    const next=new WebAdapter(root,{
      qrPending(info){
        if(web===next){
          connection={...connection,status:'Waiting for Fresh QR',qr:undefined,qrClientId:info.clientId,qrGeneratedAt:info.generatedAt,detail:undefined};
          changed();
        }
      },
      qr(image,info){
        if(web===next&&connection.qrClientId===info.clientId&&connection.qrGeneratedAt===info.generatedAt){
          connection={...connection,status:'QR Ready',qr:image,detail:undefined};
          changed();
        }
      },
      qrExpired(info){
        if(web===next&&connection.qrClientId===info.clientId&&connection.qrGeneratedAt===info.generatedAt){
          connection={...connection,status:'QR Expired',qr:undefined,detail:'This QR code is no longer fresh. Restart WhatsApp Engine to request a new code.'};
          changed();
        }
      },
      authenticated(){
        if(web===next&&connection.status!=='Connected'){
          connection={...connection,status:'Authenticating',qr:undefined,qrClientId:undefined,qrGeneratedAt:undefined,detail:undefined};
          changed();
        }
      },
      ready(account,phone){
        if(web!==next||connection.status==='Connected')return;
        const restoring=store.setting('lastWebAccount')===account;
        run('INSERT INTO whatsapp_accounts VALUES (?,?) ON CONFLICT(id) DO UPDATE SET phone=excluded.phone',account,phone);
        store.save('lastWebAccount',account);
        webRetryAttempt=0;
        if(webRetry){clearTimeout(webRetry);webRetry=undefined}
        connection={status:'Connected',mode:'web',phone,webhook:false};changed();
        void syncWebChats(true,restoring);
        for(const a of rows<{id:string}>("SELECT a.id FROM attachments a JOIN messages m ON m.id=a.message_id WHERE a.status='Pending' AND m.account_id=? LIMIT 20",account))void receiveMedia(a.id).catch(()=>{});
      },
      offline(detail,retry=false){
        if(web===next){
          connection={...connection,status:'Connection Failed',qr:undefined,qrClientId:undefined,qrGeneratedAt:undefined,detail};
          changed();
          if(retry)retryWeb();
        }
      },
      progress(status){
        if(web===next&&connection.status!=='Connected'&&connection.status!=='Connection Failed'){
          connection={...connection,status,detail:undefined};changed();
        }
      },
      diagnostic(event,detail){store.audit('WhatsApp '+event,detail.slice(0,1800));changed()},
      message(info){
        if(web!==next)return;
        const events:Event[]=[];const imports:string[]=[];
        store.atomic(()=>ingest(next.account,info,events,imports));
        processIncoming(events,imports);
      },
      ack(id,status){if(web===next)updateDelivery(next.account,id,status)}
    });
    web=next;
    store.save('whatsappProvider','web');
    try{await next.start()}catch(error){
      if(web!==next||operation!==webOperation)return;
      const reason=error instanceof Error?error.message:String(error);
      if(process.env.BLOOMCONNECT_WEB_SMOKE==='1')console.error(reason);
      const detail=reason.replace(/https?:\/\/[^\s?#,]+(?:\?[^\s,]*)?/g,'[url]').replace(/[\r\n\t]+/g,' ').slice(0,500);
      connection={status:'Connection Failed',mode:'web',phone:'',webhook:false,detail:'WhatsApp Web could not start: '+(detail||'Unknown startup error.')};changed();
      try{await next.stop()}catch(stopError){
        const stopDetail=stopError instanceof Error?stopError.message.replace(/[\r\n\t]+/g,' ').slice(0,240):'Unknown shutdown error.';
        connection={...connection,detail:connection.detail+' Browser shutdown also failed: '+stopDetail};changed();
      }
      if(web===next&&store.setting('lastWebAccount')&&/already running for|ERR_(?:INTERNET_DISCONNECTED|NETWORK_CHANGED|NAME_NOT_RESOLVED|CONNECTION_[A-Z_]+)/i.test(reason))retryWeb();
    }
  }catch(error){
    if(operation===webOperation){
      if(previous&&!web)web=previous;
      connection={status:'Connection Failed',mode:'web',phone:'',webhook:false,detail:error instanceof Error?error.message:'WhatsApp Web unavailable.'};changed();
    }
    throw error;
  }finally{
    if(operation===webOperation){stoppingWeb=undefined;webTransition=false}
  }
}
function updateDelivery(account:string,id:string,status:string){
  const ranks:Record<string,number>={accepted:0,sent:1,delivered:2,read:3,failed:2};
  const previous=row<Message>("SELECT * FROM messages WHERE id=? AND account_id=? AND direction='outgoing'",id,account);
  if(previous&&ranks[status]>ranks[previous.status]){run('UPDATE messages SET status=? WHERE id=?',status,id);changed()}
}
const server=createServer(async(request,response)=>{
  try{
    const url=new URL(request.url??'/', 'http://localhost');
    const active=adapter;
    if(url.pathname!=='/whatsapp/webhook'||!active){response.writeHead(404).end();return}
    if(request.method==='GET'){
      const verified=url.searchParams.get('hub.mode')==='subscribe'&&url.searchParams.get('hub.verify_token')===active.config.verifyToken;
      if(verified){connection.webhook=true;changed()}
      response.writeHead(verified?200:403,{'Content-Type':'text/plain'}).end(verified?url.searchParams.get('hub.challenge')??'':'');return;
    }
    if(request.method!=='POST'){response.writeHead(405).end();return}
    const raw=await collect(request,2*1024*1024);
    if(!signed(raw,active.config.appSecret,request.headers['x-hub-signature-256'])){response.writeHead(403).end();return}
    const data=webhook.parse(JSON.parse(raw.toString('utf8')));
    const events:Event[]=[];const imports:string[]=[];
    store.atomic(()=>{
      for(const entry of data.entry)for(const change of entry.changes){
        const value=change.value;
        if(change.field!=='messages'||value.metadata?.phone_number_id!==active.config.phoneId)continue;
        connection.webhook=true;
        for(const state of value.statuses??[])updateDelivery(active.config.phoneId,state.id,state.status);
        for(const msg of value.messages??[]){
          const contact=value.contacts?.find(c=>c.wa_id===msg.from);
          const file=msg.document??msg.image;
          ingest(active.config.phoneId,{id:msg.id,phone:msg.from,name:contact?.profile?.name??msg.from,
            created:new Date(Number(msg.timestamp)*1000).toISOString(),kind:msg.type,text:msg.text?.body??file?.caption??'',
            file:file?{remote:file.id,name:file.filename??(msg.image?'WhatsApp image':'WhatsApp document')}:undefined},events,imports);
        }
      }
    });
    response.writeHead(200).end();processIncoming(events,imports);
  }catch{if(!response.headersSent)response.writeHead(400).end()}
});
server.listen(process.env.BLOOMCONNECT_TEST_WEBHOOK==='1'?0:47832,'127.0.0.1');
server.on('error',()=>{store.audit('Webhook unavailable','Local port 47832 could not be opened.');changed()});
run("UPDATE print_queue SET status='Unconfirmed',error='Application closed during submission. Check the printer before retrying.' WHERE status='Printing'");
run("UPDATE attachments SET status='Pending' WHERE status='Downloading'");
run("UPDATE automation_executions SET status='Interrupted' WHERE status='Running'");
run("UPDATE notification_outbox SET status='Unconfirmed',error='Application stopped during sending; verify delivery before any manual retry.' WHERE status='Sending'");
run("UPDATE notification_attempts SET result='Unconfirmed',error='Application stopped during sending' WHERE result='Sending'");
let notificationBusy=false;
async function sendNotification(item:{id:string;customer_id:string;account_id:string;body:string}){
 run("UPDATE notification_outbox SET status='Sending',attempts=attempts+1 WHERE id=?",item.id);
 const attempt=run("INSERT INTO notification_attempts(notification_id,attempted,result) VALUES (?,?,'Sending')",item.id,now()).lastInsertRowid;
 try{
  const message=await reply(item.customer_id,item.body,true,item.account_id);
  run("UPDATE notification_outbox SET status='Accepted',message_id=?,error='' WHERE id=?",message,item.id);
  run("UPDATE notification_attempts SET result='Accepted' WHERE id=?",attempt);
  store.audit('Automation reply accepted',item.id);
 }catch(e){
  const error=e instanceof Error?e.message:String(e);
  const status=e instanceof ReplyBlocked?'Failed':'Unconfirmed';
  run("UPDATE notification_outbox SET status=?,error=? WHERE id=?",status,error,item.id);
  run("UPDATE notification_attempts SET result=?,error=? WHERE id=?",status,error,attempt);
  throw e;
 }
}
async function deliverNotifications(){
 const account=connectedWhatsAppAccount();
 if(shuttingDown||notificationBusy||!account)return;
 notificationBusy=true;let touched=false;
 try{for(const item of rows<{id:string;rule_id:string;customer_id:string;account_id:string;body:string;event_key:string}>("SELECT * FROM notification_outbox WHERE account_id=? AND status='Pending' AND due<=? ORDER BY due,rowid LIMIT 10",account,Date.now())){
  if(shuttingDown||connectedWhatsAppAccount()!==account)break;
  touched=true;const [event,jobId]=item.event_key.split(':');if(['pickup','print-completed'].includes(event)&&!allFilesConfirmed(jobId)){run("UPDATE notification_outbox SET status='Cancelled',error='Order files are not all confirmed printed' WHERE id=?",item.id);continue}
  const storedRule=row<{data:string}>('SELECT data FROM automation_rules WHERE id=?',item.rule_id);
  const rule=storedRule?JSON.parse(storedRule.data) as Rule:undefined;
  if(!rule?.enabled){run("UPDATE notification_outbox SET status='Cancelled',error='Rule disabled' WHERE id=?",item.id);continue}
  await sendNotification(item).catch(e=>store.audit('Automation reply issue',e instanceof Error?e.message:String(e)));

 } }finally{notificationBusy=false;if(touched)changed()}
}
setInterval(()=>void deliverNotifications().catch(e=>store.audit('Automation queue error',String(e))),1000).unref();
async function probe(){
  const current=adapter;if(shuttingDown||!current||networkBusy)return;
  networkBusy=true;
  try{const phone=await current.verify();if(adapter===current){connection={...connection,status:'API reachable',phone};
    for(const a of rows<{id:string}>("SELECT id FROM attachments WHERE status='Pending' AND remote IS NOT NULL LIMIT 20"))void receiveMedia(a.id).catch(()=>{});
  }}catch{if(adapter===current)connection={...connection,status:'Offline'}}finally{networkBusy=false;changed()}
}
setInterval(()=>void probe(),30000).unref();
type HandlerMap={ [K in Operation]?: (input:Input<K>)=>unknown };
const handlers:HandlerMap={
  async importStudioPrint({name,bytes}:Input<'importStudioPrint'>){
    const buffer=Buffer.from(bytes);
    if(buffer.subarray(0,5).toString()!=='%PDF-')throw new Error('Prepare a PDF before opening print settings.');
    const hash=createHash('sha256').update(buffer).digest('hex');
    const existing=row<{id:string}>("SELECT id FROM attachments WHERE customer_id IS NULL AND hash=? AND status='Ready' AND mime='application/pdf'",hash);
    if(existing)return existing.id;
    const id=randomUUID();
    const filename=basename(name).replace(/[^\p{L}\p{N} ._-]/gu,'_').replace(/[. ]+$/,'').slice(0,176)||'PDF Studio output';
    run("INSERT INTO attachments (id,customer_id,name,status,created) VALUES (?,NULL,?,'Pending',?)",id,filename+'.pdf',now());
    try{await saveMedia(id,buffer);return id}
    catch(error){run("UPDATE attachments SET status='Failed' WHERE id=?",id);throw error}
  },
  async confirmPrintSubmissions({id,entries}:Input<'confirmPrintSubmissions'>){
    store.atomic(()=>{
      job(id);
      const pending=rows<{id:string;status:string}>("SELECT id,status FROM print_queue WHERE job_id=? AND status IN ('Printing','Submitted','Unconfirmed')",id);
      const expected=new Set(entries);
      if(pending.some(entry=>entry.status==='Printing'))throw new Error('Wait for the order to finish sending to the printer.');
      if(pending.length!==expected.size||pending.some(entry=>!expected.has(entry.id)))throw new Error('The print queue changed. Refresh and check the order before confirming.');
      run("UPDATE print_queue SET status='Completed' WHERE job_id=? AND status IN ('Submitted','Unconfirmed')",id);
      store.audit('Print queue status',id+' - '+pending.length+' submissions confirmed');
    });
    await finishConfirmedOrder(id);
  },
  notificationLog(){return rows<{id:string}>('SELECT n.id,n.rule_id,n.customer_id,n.event_key,n.status,n.attempts,n.error,n.created,m.status AS delivery_status FROM notification_outbox n LEFT JOIN messages m ON m.id=n.message_id ORDER BY n.created DESC LIMIT 100').map(n=>({...n,sendAttempts:rows('SELECT attempted,result,error FROM notification_attempts WHERE notification_id=? ORDER BY id',n.id)}))},
  printEstimate:calculatePrint,
  printPresets(){return {presets:store.setting('printPresets')??defaultPresets(),defaultId:store.setting('defaultPrintPreset')}},
  savePrintPreset(input){const presets=store.setting<{id:string;name:string;settings:unknown}[]>('printPresets')??defaultPresets();const value={...input,id:input.id??randomUUID()};store.save('printPresets',[...presets.filter(p=>p.id!==value.id),value]);store.audit('Print preset saved',value.name)},
  deletePrintPreset({id}){const presets=store.setting<{id:string}[]>('printPresets')??defaultPresets();store.save('printPresets',presets.filter(p=>p.id!==id));if(store.setting('defaultPrintPreset')===id)store.save('defaultPrintPreset',null)},
  setDefaultPrintPreset({id}){if(id&&!(store.setting<{id:string}[]>('printPresets')??defaultPresets()).some(p=>p.id===id))throw new Error('Preset not found.');store.save('defaultPrintPreset',id)},
  pricingRules(){return store.setting('printPricingRules')??[]},
  savePricingRule(input){const values=store.setting<{id:string}[]>('printPricingRules')??[];const value={...input,id:input.id??randomUUID()};store.save('printPricingRules',[...values.filter(p=>p.id!==value.id),value]);store.audit('Pricing rule saved',value.name)},
  deletePricingRule({id}){const values=store.setting<{id:string}[]>('printPricingRules')??[];store.save('printPricingRules',values.filter(p=>p.id!==id))},
  snapshot,setup(input){store.atomic(()=>{store.save('shop',input);run('INSERT INTO shops VALUES (1,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name',input.shop);store.audit('Settings saved',input.shop)})},
  webConnect:connectWeb,
  webSync:()=>syncWebChats(),
  webChatSync:syncChatDocuments,
  async connect(input){
    if(web||webTransition)throw new Error('Log out of the WhatsApp Web connection first.');
    if(cloudTransition)throw new Error('Cloud API verification is already running.');
    cloudTransition=true;
    try{
      const next=new CloudAdapter(input);
      const phone=await next.verify();
      run('INSERT INTO whatsapp_accounts VALUES (?,?) ON CONFLICT(id) DO UPDATE SET phone=excluded.phone',input.phoneId,phone);
      run('INSERT INTO sessions_metadata VALUES (?,?) ON CONFLICT(account_id) DO UPDATE SET verified_at=excluded.verified_at',input.phoneId,now());
      store.save('whatsappProvider','cloud');adapter=next;connection={status:'API reachable',phone,webhook:false};void probe();
    }finally{cloudTransition=false}
  },
  async logout(){
    if(cloudTransition||(webTransition&&!web&&!stoppingWeb))throw new Error('Wait for the connection to finish starting.');
    if(webRetry){clearTimeout(webRetry);webRetry=undefined}
    webRetryAttempt=0;
    const previous=web??stoppingWeb,previousCloud=adapter,wasWeb=connection.mode==='web'||!!previous;
    const operation=++webOperation;
    web=undefined;stoppingWeb=undefined;adapter=undefined;webTransition=true;
    connection={status:'Logging Out',...(previous||wasWeb?{mode:'web' as const}:{}),phone:'',webhook:false};changed();
    try{
      store.save('whatsappProvider',null);
      store.save('lastWebAccount',null);
      const result=previous?await previous.stop(true):undefined;
      if(operation!==webOperation)return;
      connection={status:'Disconnected',phone:'',webhook:false,...(result?.warning?{mode:'web' as const,detail:result.warning}:{})};
    }catch(error){
      if(!previous&&previousCloud)adapter=previousCloud;
      const detail=error instanceof Error?error.message.replace(/[\r\n\t]+/g,' ').slice(0,200):'Unknown logout error.';
      connection={status:'Connection Failed',...(previous||wasWeb?{mode:'web' as const}:{}),phone:'',webhook:false,detail:'WhatsApp logout could not finish: '+detail};
      throw error;
    }finally{if(operation===webOperation){webTransition=false;changed()}}
  },
  customer(input){const phone=input.phone.replace(/^\+/,'');if(input.id){const c=row<Customer>('SELECT * FROM customers WHERE id=?',input.id);if(!c)throw new Error('Customer not found.');if(c.phone!==phone&&row('SELECT id FROM messages WHERE customer_id=?',c.id))throw new Error('The WhatsApp number is linked to this message history.');run('UPDATE customers SET name=?,phone=?,notes=?,tag=? WHERE id=?',input.name,phone,input.notes,input.tag,c.id)}
    else run('INSERT INTO customers VALUES (?,?,?,?,?,?,?)',randomUUID(),input.name,phone,input.notes,input.tag,now(),now());store.audit('Customer saved',input.name)},
  read({id}){
    const account=visibleMessageAccount();
    if(account)run('UPDATE messages SET unread=0 WHERE customer_id=? AND account_id=?',id,account);
    else run('UPDATE messages SET unread=0 WHERE customer_id=?',id);
  },
  retryMedia:({id})=>receiveMedia(id),
  cancelMedia({id}){
    const active=mediaDownloads.get(id);
    const file=row<Attachment>('SELECT * FROM attachments WHERE id=?',id);
    if(!file?.message_id||['Ready','Needs conversion'].includes(file.status))return;
    active?.controller.abort();
    const retries=store.setting<Record<string,{attempt:number;due:number}>>('mediaRetries')??{};
    delete retries[id];store.save('mediaRetries',retries);
    run("UPDATE attachments SET status='Cancelled' WHERE id=?",id);
    downloadStatus.delete(id);
  },
  order:input=>store.atomic(()=>createOrder(input)),
  quote({id,total,reason}){store.atomic(()=>{const prior=job(id);if(total<prior.paid)throw new Error('The total cannot be below the amount already paid.');
    run('UPDATE print_jobs SET total=? WHERE id=?',total,id);store.audit('Order total updated',id+' · LKR '+(prior.total/100).toFixed(2)+' → '+(total/100).toFixed(2)+' - '+reason)})},
  async confirmPrice({id,total}){
    const order=job(id);
    if(order.total!==total)throw new Error('The price changed. Review the current total before confirming.');
    if(order.status==='Cancelled')throw new Error('Reopen the order before confirming its price.');
    store.audit('Order price confirmed',id+' · '+(total/100).toFixed(2));
    if(order.customer_id)await automation({id:id+':'+total,jobId:id,kind:'price-confirmed',customer:order.customer_id});
  },
  manualFeedProfile({printer,landscape,edge}){
    return store.setting('manualFeed:'+JSON.stringify([printer,landscape,edge]));
  },
  saveManualFeedProfile({printer,landscape,edge,profile}){
    store.save('manualFeed:'+JSON.stringify([printer,landscape,edge]),profile);
    store.audit('Manual duplex profile saved',printer+' · '+edge+' edge');
  },
  async convertDocument({id,mode='pages',includeHidden=false}){
    const source=row<Attachment&{path:string}>("SELECT * FROM attachments WHERE id=? AND status='Needs conversion'",id);
    if(!source?.path)throw new Error('Select an imported file that requires conversion.');
    const presentation=/\.(pptx?)$/i.test(source.path);
    if(!presentation&&(mode!=='pages'||includeHidden))throw new Error('Notes, outline and hidden slides are available only for PowerPoint.');
    const key='converted:'+id+':'+mode+':'+Number(includeHidden);
    const existing=store.setting<string>(key);
    if(existing&&row("SELECT id FROM attachments WHERE id=? AND status='Ready'",existing))return existing;
    if(inflight.has(id))throw new Error('This document is already being converted.');
    inflight.add(id);
    try{
      const original=join(mediaDir,source.path),imageSource=source.mime.startsWith('image/');
      const bytes=imageSource?await sharp(original,{limitInputPixels:40_000_000}).rotate().png().toBuffer():
        await convertOfficeDocument(join(__dirname,'office.ps1'),original,mode,includeHidden);
      const converted=randomUUID();
      const suffix=mode==='pages'?(includeHidden?' (all slides)':''):' ('+mode+(includeHidden?', all slides':'')+')';
      const name=source.name.replace(/\.[^.]+$/,'').slice(0,145)+suffix+(imageSource?'.png':'.pdf');
      run("INSERT INTO attachments (id,customer_id,name,status,created) VALUES (?,?,?,'Pending',?)",converted,source.customer_id,name,now());
      try{await saveMedia(converted,bytes);store.save(key,converted)}
      catch(e){run('DELETE FROM attachments WHERE id=?',converted);throw e}
      store.audit('Document converted',name);
      return converted;
    }finally{inflight.delete(id)}
  },
  async createPhotoCrops({id,crops}){
    const source=readyFile(id);
    if(!source.mime.startsWith('image/'))throw new Error('Select a ready photo to crop.');
    const {data,info}=await sharp(join(mediaDir,source.path),{limitInputPixels:40_000_000})
      .autoOrient().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
    const created:string[]=[];
    try{
      for(const [index,crop] of crops.entries()){
        const left=Math.floor(crop.x*info.width),top=Math.floor(crop.y*info.height);
        const width=Math.min(info.width,Math.ceil((crop.x+crop.width)*info.width))-left;
        const height=Math.min(info.height,Math.ceil((crop.y+crop.height)*info.height))-top;
        const bytes=await sharp(data,{raw:{width:info.width,height:info.height,channels:info.channels}})
          .extract({left,top,width,height}).png().toBuffer();
        const copy=randomUUID(),name=source.name.replace(/\.[^.]+$/,'').slice(0,150)+' (crop '+(index+2)+').png';
        run("INSERT INTO attachments (id,customer_id,name,status,created) VALUES (?,?,?,'Pending',?)",copy,source.customer_id,name,now());
        created.push(copy);
        await saveMedia(copy,bytes);
      }
    }catch(error){
      store.atomic(()=>{for(const copy of created)run('DELETE FROM attachments WHERE id=?',copy)});
      throw error;
    }
    store.audit('Photo crops saved',source.name+' · '+created.length);
    return created;
  },
  async scanPreview({id,token,settings}){
    const source=readyFile(id);
    if(!source.mime.startsWith('image/'))throw new Error('Select a ready photo to scan.');
    return scanWork<ScanPreview>(token,{kind:'preview',path:join(mediaDir,source.path),settings:scanSettingsSchema.parse(settings)});
  },
  cancelScan({token}){scanJobs.get(token)?.cancel()},
  async saveScan({id,token,settings}){
    const source=readyFile(id);
    if(!source.mime.startsWith('image/'))throw new Error('Select a ready photo to scan.');
    const result=await scanWork<{image:Uint8Array}>(token,{kind:'save',path:join(mediaDir,source.path),settings:scanSettingsSchema.parse(settings)});
    const copy=randomUUID(),name=source.name.replace(/\.[^.]+$/,'').slice(0,148)+' (processed scan).png';
    run("INSERT INTO attachments (id,customer_id,name,status,created) VALUES (?,?,?,'Pending',?)",copy,source.customer_id,name,now());
    try{await saveMedia(copy,Buffer.from(result.image));store.save('scan-source:'+copy,id)}
    catch(e){run('DELETE FROM attachments WHERE id=?',copy);throw e}
    store.audit('Processed scan saved',name);
    return copy;
  },
  async combineScans({token,pages,layout,marginMm}){
    const files=pages.map(page=>({...page,asset:readyFile(page.id)}));
    const customer=files[0].asset.customer_id;
    if(files.some(file=>file.asset.customer_id!==customer||!file.asset.mime.startsWith('image/')||!store.setting('scan-source:'+file.id)))throw new Error('Select processed scans belonging to one customer.');
    const result=await scanWork<{image:Uint8Array}>(token,{kind:'pdf',pages:files.map(file=>({path:join(mediaDir,file.asset.path),rotation:file.rotation})),layout,marginMm});
    const pdf=randomUUID(),name=files.length===1?files[0].asset.name.replace(/\.png$/i,'.pdf'):'Processed scan ('+files.length+' pages).pdf';
    run("INSERT INTO attachments (id,customer_id,name,status,created) VALUES (?,?,?,'Pending',?)",pdf,customer,name,now());
    try{await saveMedia(pdf,Buffer.from(result.image));store.save('scan-pages:'+pdf,pages)}
    catch(e){run('DELETE FROM attachments WHERE id=?',pdf);throw e}
    store.audit('Scanned PDF created',name);
    return pdf;
  },
  updatePhotoOrder({id,files,printSettings,total,reason}){return store.atomic(()=>{
    const previous=job(id),original=printFiles(id);
    if(original.some(file=>!files.includes(file))||new Set(files).size!==files.length)throw new Error('Keep every original order file when adding photographs. Deselect files only for a separate print submission.');
    if(row("SELECT id FROM print_queue WHERE job_id=? AND status IN ('Printing','Submitted','Unconfirmed')",id))throw new Error('Confirm or close the current print submission before updating this order.');
    if(total<previous.paid)throw new Error('The updated total cannot be lower than payments already recorded.');
    for(const file of files){const a=readyFile(file);if(a.customer_id!==previous.customer_id)throw new Error('Select files from this customer only.');}
    const ids=Object.keys(printSettings.photoItems??{});
    if(!ids.length||ids.some(file=>!files.includes(file)))throw new Error('Select photo settings for files in this order.');
    const docs=ids.map(file=>{const a=readyFile(file);return {id:file,mime:a.mime,pages:[{widthMm:1,heightMm:1,blank:false,ink:'colour',coverage:1}]} as DocumentInfo});
    const plan=planPhotos(printSettings,docs),shop=store.setting<Input<'setup'>>('shop')!;
    for(const file of files)run('INSERT OR IGNORE INTO print_job_files VALUES (?,?)',id,file);
    run('INSERT INTO print_order_config VALUES (?,?) ON CONFLICT(job_id) DO UPDATE SET settings=excluded.settings',id,JSON.stringify(printSettings));
    run('UPDATE print_jobs SET total=?,paper=?,colour=?,copies=? WHERE id=?',total,printSettings.paper,+printSettings.colour,printSettings.copies,id);
    const {policy}=effectivePhotoPricing(findPhotoPricing(store.setting<Input<'savePricingRule'>[]>('printPricingRules')??[],printSettings)?.policy,shop,printSettings.duplex);
    const quote=quotePhotos(plan,policy);
    store.save('photoLayout:'+id,{sides:plan.sides,photoCount:plan.photoCount,physicalSheets:quote.physicalSheets,quote,rate:shop.photo,total:quote.total,created:now()});
    store.audit('Photo order updated',id+' - '+reason+' - total '+previous.total+' to '+total);
  })},
  async stage({id,status}){
    const previous=job(id);if(previous.status===status)return;
    if(status==='Ready for Pickup'&&!allFilesConfirmed(id))throw new Error('Confirm physical printing in Print Queue before marking ready for pickup.');
    run('UPDATE print_jobs SET status=? WHERE id=?',status,id);
    store.audit('Order status',id+' · '+previous.status+' → '+status);
    const eventByStage:Partial<Record<Job['status'],Rule['trigger']>>={
      'Ready to Print':'ready-to-print',Printing:'printing-started','Ready for Pickup':'pickup',Completed:'collected'
    };
    const kind=eventByStage[status];
    if(kind)await automation({id,jobId:id,kind,customer:previous.customer_id});
  },
  async payment({id,amount,method}){
    const paid=store.atomic(()=>{
      const order=job(id);
      if(order.status==='Cancelled')throw new Error('Payments cannot be recorded for a cancelled order.');
      if(amount>order.total-order.paid)throw new Error('Amount exceeds the outstanding balance.');
      const payment=randomUUID();
      run('INSERT INTO payments VALUES (?,?,?,?,?)',payment,id,amount,method,now());
      run('INSERT INTO receipts VALUES (?,?)',payment,now());
      store.audit('Payment recorded',id);
      return {...order,paid:order.paid+amount};
    });
    if(paid.paid===paid.total)await automation({id,jobId:id,kind:'payment-completed',customer:paid.customer_id});
  },
  reply:({id,text})=>reply(id,text),
  rule(input){const rule={...input,id:input.id??randomUUID()};if(rule.trigger==='keyword'&&!rule.keyword.trim())throw new Error('Enter a keyword.');
    if(rule.actions.includes('order')&&!['pdf','image','document'].includes(rule.trigger))throw new Error('Create order requires a file trigger.');
    if(rule.actions.some(a=>a==='label'||a==='reply')&&!rule.text.trim())throw new Error('Enter the label or reply text.');
    run('INSERT INTO automation_rules VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',rule.id,JSON.stringify(rule));store.audit('Rule saved',rule.name)},
  testRule({id}){const r=automationRules().find(x=>x.id===id);if(!r)throw new Error('Save the rule first.');const event={id:'local',kind:r.trigger==='keyword'?'message':r.trigger,customer:null,text:r.keyword};const matched=matches({...r,enabled:true},event);store.audit('Workflow test',r.name+' · '+(matched?r.actions.join(', ')+' matched (dry run)':'no match'))}
};
function readyFile(id:string){const a=row<Attachment&{path:string}>("SELECT * FROM attachments WHERE id=? AND status='Ready'",id);if(!a||!storedMediaName.test(a.path))throw new Error('The file is not available.');return a}
const internal:Record<string,(input:never)=>unknown>={
  webhookAddress(){if(process.env.BLOOMCONNECT_TEST_WEBHOOK!=='1')throw new Error('Unavailable.');return server.address()},
  async restoreConnection(input:Input<'connect'>){if(store.setting('whatsappProvider')==='web'||web||webTransition)return;adapter=new CloudAdapter(schemas.connect.parse(input));connection={status:'Checking',phone:'',webhook:false};void probe()},
  async importLocal({paths,customer}:{paths:string[];customer:string|null}){let count=0;for(const path of paths){
    if((await stat(path)).size>32*1024*1024)throw new Error('The file exceeds 32 MB.');const bytes=await readFile(path);const hash=createHash('sha256').update(bytes).digest('hex');
    if(row('SELECT id FROM attachments WHERE customer_id IS ? AND hash=?',customer,hash))continue;
    const id=randomUUID();run("INSERT INTO attachments (id,customer_id,name,status,created) VALUES (?,?,?,'Pending',?)",id,customer,basename(path).slice(0,180),now());
    try{await saveMedia(id,bytes);count++}catch(error){run("UPDATE attachments SET status='Failed' WHERE id=?",id);throw error}
  }return count},
  startMedia({id}:Input<'retryMedia'>){
    const input=schemas.retryMedia.parse({id});
    void receiveMedia(input.id).catch(()=>{});
  },
  documentReference({id}:{id:string}){const file=readyFile(id);return {mime:file.mime,name:file.path}},
  async getPreview({id,compatibleImage,imageMaxSide}:Input<'preview'>){
    const attachment=readyFile(id),path=join(mediaDir,attachment.path);
    if((compatibleImage||imageMaxSide)&&attachment.mime.startsWith('image/')){
      try{
        const image=sharp(path,{limitInputPixels:40_000_000}).autoOrient().toColourspace('srgb');
        if(imageMaxSide)image.resize(imageMaxSide,imageMaxSide,{fit:'inside',withoutEnlargement:true});
        const bytes=await image.png({compressionLevel:imageMaxSide?1:6}).toBuffer();
        if(bytes.length>32*1024*1024)throw new Error('Image conversion exceeds the preview limit.');
        return {mime:'image/png',bytes};
      }catch{
        if(!compatibleImage&&attachment.bytes<=32*1024*1024)return {mime:attachment.mime,bytes:await readFile(path)};
        throw new Error(`Could not read photo "${attachment.name}". Re-import the original photo or export it as PNG and try again.`);
      }
    }
    if(attachment.bytes>32*1024*1024)throw new Error('Open this attachment using its local file reference.');
    return {mime:attachment.mime,bytes:await readFile(path)};
  },
  printable({id}:{id:string}){job(id);return printFiles(id).map(id=>{const a=readyFile(id);return {mime:a.mime,path:join(mediaDir,a.path),name:a.name,id}})},
  printStart(input:Input<"print">){return store.atomic(()=>{
    const {id,printer,skipAutoMessages:requestedPreference,...printOptions}=input;
    const order=job(id);
    if(order.status==='Cancelled')throw new Error('Reopen the cancelled order before printing.');
    const skipAutoMessages=schemas.print.shape.skipAutoMessages.parse(requestedPreference);
    const files=printFiles(id),selection=input.fileSelection??files;
    if(new Set(selection).size!==selection.length||selection.some(file=>!files.includes(file)))throw new Error('Print selected files from this order only.');
    const config=row<{settings:string}>('SELECT settings FROM print_order_config WHERE job_id=?',id);
    const printConfig=JSON.parse(config?.settings??'null');
    const batch=printConfig?.batchPdfFiles;
    const mixed=!!printConfig?.pdfSettings&&Object.keys(printConfig.photoItems??{}).length>0&&files.some(file=>!printConfig.photoItems[file]);
    if(batch){
      const proposed=JSON.stringify(batchPdfFileSchema.parse(input));
      if(selection.some(file=>JSON.stringify(batchPdfFileSchema.parse(batch[file]))!==proposed))throw new Error('Every PDF submission must match its billed settings.');
    }
    const pending=rows<{settings:string|null}>("SELECT settings FROM print_queue WHERE job_id=? AND status IN ('Printing','Submitted','Unconfirmed')",id);
    if(pending.some(entry=>{
      if(!batch&&!mixed)return true;
      const submitted=JSON.parse(entry.settings??'null')?.fileSelection??files;
      return selection.some(file=>submitted.includes(file));
    }))throw new Error('Confirm or close the existing printer submission before printing this order again.');
    if(order.customer_id&&skipAutoMessages!==undefined)setAutoMessagePreference(id,skipAutoMessages);
    const entry=randomUUID();
    run("INSERT INTO print_queue (id,job_id,printer,status,created,settings) VALUES (?,?,?,'Printing',?,?)",entry,id,printer,now(),JSON.stringify({id,printer,...printOptions,fileSelection:selection}));
    return entry;
  })},
  async printFinish({id,error,partial,cancelled}:{id:string;error:string;partial:boolean;cancelled?:boolean}){
    const status=cancelled?'Cancelled':error?(partial?'Unconfirmed':'Failed'):'Submitted';
    const updated=run("UPDATE print_queue SET status=?,error=? WHERE id=? AND status='Printing'",status,error,id);
    if(!updated.changes)return;
    store.audit('Printer submission',error||'Accepted by the print subsystem. Verify printed pages at the printer.');
    if(status!=='Submitted')return;
    const entry=row<{job_id:string}>('SELECT job_id FROM print_queue WHERE id=?',id)!;
    const order=job(entry.job_id);
    if(order.customer_id)await automation({id:order.id,jobId:order.id,kind:'print-queued',customer:order.customer_id});
  },
  async queue({id,status}:Input<'queue'>){const item=row<{job_id:string;status:string}>('SELECT * FROM print_queue WHERE id=?',id);if(!item||!['Submitted','Unconfirmed','Failed'].includes(item.status)||status==='Completed'&&item.status==='Failed')throw new Error('This queue entry cannot be updated.');
    run('UPDATE print_queue SET status=? WHERE id=?',status,id);store.audit('Print queue status',item.job_id+' · '+status);
    if(status==='Completed')await finishConfirmedOrder(item.job_id)},
  receiptData({id}:{id:string}){const payment=row('SELECT p.* FROM payments p JOIN receipts r ON r.id=p.id WHERE p.id=?',id);if(!payment)throw new Error('Receipt not found.');return {payment,shop:store.setting<Input<'setup'>>('shop')?.shop??'BloomConnect'}},
  billData({id}:{id:string}){
    const order=job(id);
    const customer=order.customer_id?row<{name:string}>('SELECT name FROM customers WHERE id=?',order.customer_id):undefined;
    return {order,customer:customer?.name??'Walk-in',shop:store.setting<Input<'setup'>>('shop')?.shop??'BloomConnect',
      files:printFiles(id).map(file=>row<{name:string}>('SELECT name FROM attachments WHERE id=?',file)?.name??'Document')};
  },
  attachmentData({id}:{id:string}){const file=readyFile(id);return {name:file.name,mime:file.mime,path:join(mediaDir,file.path)}},
  async saveBackup({path}:{path:string}){await mkdir(join(path,'documents'),{recursive:true});run('VACUUM INTO ?',join(path,'bloomconnect.sqlite'));try{for(const file of await readdir(mediaDir))if(/^[a-f0-9]{64}\./.test(file)&&['pdf','jpg','png','webp','tiff','heic',...officeExtensions].some(ext=>file.endsWith('.'+ext)))await copyFile(join(mediaDir,file),join(path,'documents',file))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}return true}
};
process.on('message',async(message:{id:number;operation:string;input:never})=>{
  if(message.operation==='suspendForLicense'){shutdown();return}
  if(shuttingDown)return;
  try{
    const operation=message.operation as Operation;
    const handler=Object.hasOwn(internal,operation)?internal[operation]:undefined;
    const publicHandler=Object.hasOwn(handlers,operation)?handlers[operation] as ((input:unknown)=>unknown):undefined;
    if(!handler&&!publicHandler)throw new Error('Unsupported engine operation.');
    const result=handler?await handler(message.input):await publicHandler!(schemas[operation].parse(message.input));
    process.send?.({id:message.id,result});
  }catch(error){const detail=error instanceof Error?error.message:'Operation failed.';process.send?.({id:message.id,error:detail.includes('UNIQUE constraint')?'This record already exists.':detail})}
  finally{if(!['snapshot','getPreview','documentReference','printable','receiptData','billData','attachmentData','notificationLog','pricingRules','printPresets','scanPreview','cancelScan'].includes(message.operation))changed()}
});

if(store.setting('whatsappProvider')==='web')void connectWeb().catch(()=>{});
function shutdown(){
  if(shuttingDown)return;
  shuttingDown=true;
  webOperation++;
  if(webRetry)clearTimeout(webRetry);
  server.close();
  for(const download of mediaDownloads.values())download.controller.abort();
  const connectionToStop=web??stoppingWeb;
  web=undefined;
  stoppingWeb=undefined;
  adapter=undefined;
  const shutdownTimeout=setTimeout(()=>{
    store.audit('Engine shutdown timeout','WhatsApp browser cleanup did not finish within 45 seconds.');
    process.exit(1);
  },45_000);
  void (async()=>{
    try{
      await connectionToStop?.stop();
      clearTimeout(shutdownTimeout);
      process.exit(0);
    }catch(error){
      store.audit('Engine shutdown failed',error instanceof Error?error.message.slice(0,240):'Unknown shutdown error.');
      clearTimeout(shutdownTimeout);
      process.exit(1);
    }
  })();
}
process.on('disconnect',shutdown);
