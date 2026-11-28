const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {existsSync}=require('node:fs');
const path=require('node:path');
const {buildSync}=require('esbuild');
const puppeteer=require('puppeteer-core');

async function checkWorkflow(){
 const fixture=path.resolve('apps/renderer/ux-check-'+process.pid+'.jsx');
 const html=fixture.replace(/jsx$/,'html');
 const chrome=[process.env.BLOOM_TEST_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(value=>value&&existsSync(value));
 assert.ok(chrome,'Set BLOOM_TEST_BROWSER to the path of Chrome or Edge.');
 let server,browser,page,step='Start the browser';
 try{
  const code=buildSync({stdin:{contents:"export {scannedPdf} from './packages/printing/scan-pdf';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
  const mod={exports:{}};
  new Function('module','exports','require',code)(mod,mod.exports,require);
  const raster={width:36,height:48,data:new Uint8Array(36*48*3).fill(205)};
  const pdf=Buffer.from(mod.exports.scannedPdf(Array(8).fill(raster),'a4',5)).toString('base64');
  await fs.writeFile(fixture,`
   import React,{useState} from 'react';
   import {createRoot} from 'react-dom/client';
   import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
   import {Studio,PdfPrintPopup,Orders,Queue} from './jobs';
   import {PdfWorkspace} from './pdf-workspace';
   import {preparePrint} from './pdf';
   import {InboxView} from './records';
   import {ctx} from './context';
   import {useWorkspace} from './state';
   import {calculateBulk} from '../../packages/printing/calculation';
   import './style.css';
   import './theme.css';
   const bytes=Uint8Array.from(atob('${pdf}'),c=>c.charCodeAt(0));
   const printer='TOSHIBA e-STUDIO257';
   const capabilities={name:printer,driver:'TOSHIBA Universal Printer 2',colour:false,duplex:true,status:3,error:5,offline:false,
    papers:[{widthMm:210,heightMm:297}],printable:{left:4,right:4,top:4,bottom:4},trays:[],resolutions:[]};
   const file={id:'fixture',name:'fixture.pdf',mime:'application/pdf',customer_id:'customer',message_id:'message',status:'Ready',created:'2026-11-22T01:00:00Z',bytes:bytes.length};
   const second={...file,id:'second',name:'second.pdf'};
   const photoA={...file,id:'photo-a',message_id:'photo-message-a',name:'photo-a.png',mime:'image/png'};
   const photoB={...photoA,id:'photo-b',message_id:'photo-message-b',name:'photo-b.png'};
   const imageCanvas=document.createElement('canvas');
   imageCanvas.width=36;imageCanvas.height=48;
   const context=imageCanvas.getContext('2d');
   context.fillStyle='#777';context.fillRect(0,0,36,48);
   context.fillStyle='#111';context.fillRect(8,16,20,4);
   const photoBytes=Uint8Array.from(atob(imageCanvas.toDataURL().split(',')[1]),c=>c.charCodeAt(0));
   const data={attachments:[file,second,photoA,photoB],customers:[{id:'customer',name:'Test customer',phone:'94770000000',last:file.created}],jobs:[],queue:[],payments:[],
    messages:[{id:'message',customer_id:'customer',direction:'incoming',kind:'document',status:'ready',unread:0,created:file.created,body:'PDF'},
     ...[photoA,photoB].map(photo=>({id:photo.message_id,customer_id:'customer',direction:'incoming',kind:'image',status:'ready',unread:0,created:photo.created,body:''}))],
    settings:{printer,photo:500,mono:500,colour:1000,paperRates:{A3:{mono:2000},Legal:{mono:1500}}},connection:{mode:'web',status:'Connected'}};
   window.attempts=[];window.orders=[];window.bills=[];window.replies=[];window.exports=[];window.printerSettingsOpened=0;
   window.navigate=view=>{
    if(view==='WhatsApp')data.settings.printer='Microsoft Print to PDF';
    useWorkspace.getState().set({view,customer:'customer'});
   };
   window.addOfficeFile=()=>{
    data.attachments.push({...file,id:'office-file',message_id:'office-message',name:'linked-slides.pptx',mime:'application/x-bloom-office-pptx',status:'Needs conversion'});
    data.messages.push({id:'office-message',customer_id:'customer',direction:'incoming',kind:'document',status:'ready',unread:0,created:file.created,body:''});
    window.navigate('WhatsApp');
   };
   window.openBulkChat=()=>{
    const customer='bulk-customer';
    data.customers.push({id:customer,name:'Bulk customer',phone:'94716667777',last:file.created});
    ['bulk-a','bulk-b'].forEach(id=>{
     data.messages.push({id,customer_id:customer,direction:'incoming',kind:'document',status:'ready',unread:0,created:file.created,body:''});
     data.attachments.push({...file,id,name:id+'.pdf',customer_id:customer,message_id:id});
    });
    useWorkspace.getState().set({view:'WhatsApp',customer});
   };
   window.bloom={call:async(op,input)=>{
    if(op==='printerDialog'){window.printerDialogRequest=input;return}
    if(op==='testDuplex'){window.duplexTestRequest=input;return}
    if(op==='fileReference'){
     const image=input.id.startsWith('photo-'), mime=image?'image/png':'application/pdf', data=image?photoBytes:bytes;
     const url=URL.createObjectURL(new Blob([data],{type:mime}));
     return {mime,bytes:data.length,url};
    }
    if(op==='preview')return input.id.startsWith('photo-')?{mime:'image/png',bytes:photoBytes.slice()}:{mime:'application/pdf',bytes:bytes.slice()};
    if(op==='createPhotoCrops'){
     window.savedCrops=input;
     data.attachments.push({...photoA,id:'photo-crop',name:'crop.png',message_id:null});
     return ['photo-crop'];
    }
    if(op==='webChatSync'&&input.id==='history-chat'){
     if(!data.attachments.some(item=>item.id==='history-pdf'))data.attachments.push({...file,id:'history-pdf',message_id:'history-message',customer_id:input.id,name:'history.pdf',mime:'',status:'Available to download'});
     return {messages:1,documents:1,partial:false};
    }
    if(op==='webChatSync')return {messages:0,documents:0,partial:false};
    if(op==='retryMedia'&&input.id==='history-pdf'){
     if(window.holdHistoryDownload)await window.holdHistoryDownload;
     Object.assign(data.attachments.find(item=>item.id===input.id),{mime:'application/pdf',status:'Ready'});
     return;
    }
    if(op==='convertDocument'){
     window.convertedDocument=input;
     data.attachments.push({...file,id:'converted-office',message_id:null,name:'linked-slides.pdf'});
     return 'converted-office';
    }
    if(op==='printerCapabilities'){
     if(input.printer==='Samsung SCX-6545X Series PS')throw new Error('Driver capabilities unavailable');
     return input.printer==='OneNote (Desktop)'?{...capabilities,name:input.printer,driver:'Send to Microsoft OneNote 16 Driver',duplex:false}:capabilities;
    }
    if(op==='printPresets')return {defaultId:null,presets:[]};
    if(op==='pricingRules')return [];
    if(op==='order'){
     window.orders.push(input);
     const id='order-'+window.orders.length;
     const subtotal=input.calculations?calculateBulk(input.calculations.map(item=>({...item,customer:input.customer}))).finalTotal:input.price;
     const total=subtotal+input.charge-input.discount;
     data.jobs.push({id,customer_id:input.customer,files:input.files,printSettings:{...input.printSettings,orderAdjustments:{charge:input.charge,discount:input.discount}},status:'New',paid:0,total,
      paper:input.paper,copies:input.copies,colour:input.colour,created:file.created});
     return id;
    }
    if(op==='print'){
     window.attempts.push(input);
     if(window.attempts.length===1||input.fileSelection?.[0]==='second'&&window.attempts.length===4)throw new Error('Printer stopped during test');
     data.queue.unshift({id:'queue-'+window.attempts.length,job_id:input.id,printer:input.printer,created:new Date().toISOString(),status:'Submitted',settings:JSON.stringify(input)});
     return {entry:'queue-1'};
    }
    if(op==='confirmPrintSubmissions'){
     window.confirmedPrintSubmissions=input;
     for(const entry of data.queue)if(input.entries.includes(entry.id))entry.status='Completed';
    }
    if(op==='bill'){window.bills.push(input);return true}
    if(op==='saveStudioDocument'){window.savedStudioOutput={name:input.name,format:input.format,length:input.bytes.length};return true}
    if(op==='importStudioPrint'){
     window.studioPrintOutput={name:input.name,length:input.bytes.length};
     data.attachments.push({...file,id:'studio-output',customer_id:null,name:input.name+'.pdf'});
     return 'studio-output';
    }
    if(op==='savePrintPdf'){window.exports.push(input);return true}
    if(op==='openPrinterSettings'){window.printerSettingsOpened++;return}
    if(op==='reply'){window.replies.push(input);return 'reply-1'}
    return null;
   }};
   useWorkspace.getState().set({view:'Print Studio',customer:'customer',autoPdfPrint:false});
   function Test(){
    const view=useWorkspace(state=>state.view),[snapshot,setSnapshot]=useState({...data}),[hasPhysical,setHasPhysical]=useState(true);
    window.setPhysicalPrinter=setHasPhysical;
    window.openQueue=()=>useWorkspace.getState().set({view:'Print Queue'});
    window.openPdfWorkspace=()=>{
     data.attachments.push({...photoA,id:'photo-no-extension',name:'WhatsApp image'});
     data.attachments.push({...file,id:'word-source',message_id:'word-source-message',name:'customer-note.docx',mime:'application/x-bloom-office-docx',status:'Needs conversion'},
      {...file,id:'slides-source',message_id:'slides-source-message',name:'customer-slides.pptx',mime:'application/x-bloom-office-pptx',status:'Needs conversion'});
     data.customers.push({id:'history-chat',name:'History customer',phone:'94710000000',last:file.created});
     data.messages.push({id:'history-message',customer_id:'history-chat',direction:'incoming',kind:'document',status:'history',unread:0,created:file.created,body:''});
     useWorkspace.getState().set({view:'PDF Studio'});
    };
    window.dropStudioPdf=()=>{
     const event=new DataTransfer();
     event.items.add(new File([bytes.slice()],'fixture.pdf',{type:'application/pdf'}));
     document.querySelector('.pdf-workspace').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:event}));
    };
    const refresh=async()=>setSnapshot({...data});
    window.openHistoryDownload=async()=>{
     Object.assign(data.attachments.find(item=>item.id==='history-pdf'),{mime:'',status:'Available to download'});
     window.holdHistoryDownload=new Promise(resolve=>{window.finishHistoryDownload=resolve});
     useWorkspace.getState().set({view:'WhatsApp',customer:'history-chat'});
     await refresh();
    };
    return <ctx.Provider value={{data:snapshot,printers:[{name:'Microsoft Print to PDF',displayName:'Microsoft Print to PDF',isDefault:true},{name:'OneNote (Desktop)',displayName:'OneNote (Desktop)',isDefault:false},...(hasPhysical?[{name:printer,displayName:'Toshiba 257',isDefault:false},{name:'Samsung SCX-6545X Series PS',displayName:'Samsung SCX-6545X Series PS',isDefault:false}]:[])],
     run:async(op,input)=>{await window.bloom.call(op,input);await refresh();return true},refresh,error:e=>{window.friendly=e.message}}}>
     {view==='PDF Studio'?<PdfWorkspace/>:view==='Print Studio'?<Studio/>:view==='Orders'?<Orders/>:view==='WhatsApp'?<InboxView/>:<Queue/>}
     <PdfPrintPopup/>
    </ctx.Provider>;
   }
   if(new URLSearchParams(location.search).has('duplex-test')){
    window.printView={load:async()=>({
     input:{id:'test',printer,paper:'A4',copies:1,colour:false,landscape:true,orientation:'landscape',duplex:'auto',range:'',rotation:0,fit:'contain',layout:'single'},
     files:[],testDuplex:true
    }),done:error=>{window.duplexFixtureError=error}};
    void preparePrint();
   }else createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><Test/></QueryClientProvider>);
  `);
  await fs.writeFile(html,'<!doctype html><html><body><main id="root"></main><script type="module" src="./'+path.basename(fixture)+'"></script></body></html>');
  const {createServer}=await import('vite');
  server=await createServer({server:{host:'127.0.0.1',port:0}});
  await server.listen();
  browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--disable-gpu','--no-sandbox']});
  page=await browser.newPage();
  page.setDefaultTimeout(12000);
  await page.setViewport({width:1366,height:720});
  await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/'+path.basename(html));
  async function click(label,scope='main'){
   step='Click '+label;
   const ready=await page.waitForFunction((root,text)=>[...document.querySelectorAll(root+' button')].find(
    button=>button.textContent.trim()===text&&!button.disabled&&button.getClientRects().length),{},scope,label);
   await ready.evaluate(button=>button.click());
   await ready.dispose();
  }
  async function selectCopierInPhotoPreview(){
   await click('Review nearby photos (2 photos)');
   const printerSelect='.photo-quick-print-settings select[aria-label="Printer"]';
   await page.waitForSelector(printerSelect);
   assert.equal(await page.$eval(printerSelect,select=>select.value),'Microsoft Print to PDF');
   await page.select(printerSelect,'Samsung SCX-6545X Series PS');
   await click('1','.photo-quick-layout');
   await page.waitForFunction(()=>{
    const actions=document.querySelector('.photo-review-panel .photo-print-action');
    const print=[...(actions?.querySelectorAll('button')??[])].find(button=>button.textContent.trim()==='Print Now');
    return print&&!print.disabled&&actions.textContent.includes('Printing with the selected margins.');
   });
  }
  if(process.argv.includes('--photo-copier')){
   await page.evaluate(()=>window.navigate('WhatsApp'));
   await selectCopierInPhotoPreview();
   await click('Print Now','.photo-review-panel');
   await page.waitForFunction(()=>window.attempts.some(print=>print.photoBatch&&print.printer==='Samsung SCX-6545X Series PS'));
   const request=await page.evaluate(()=>window.attempts.at(-1));
   assert.equal(request.paper,'A4');
   assert.deepEqual(request.printable,{left:5,right:5,top:5,bottom:5});
   console.log('Photo Print Now submits A4 to a copier with unavailable driver capabilities.');
   return;
  }
  await page.waitForSelector('.studio-files button');
  await page.click('.studio-files button');
  await click('Printer properties','.print-sticky-actions');
  assert.deepEqual(await page.evaluate(()=>window.printerDialogRequest),{printer:'TOSHIBA e-STUDIO257',kind:'properties'});
  await click('Double-sided','.quick-print-types');
  assert.equal(await page.$eval('select[aria-label="Double-Sided Printing"]',select=>select.value),'auto');
  await page.select('select[aria-label="Double-Sided Printing"]','simplex');
  await click('Multiple pages');
  await click('4 pages');
  assert.equal(await page.$eval('.document-print-settings',node=>node.textContent.includes('Advanced options')),false);
  assert.ok(await page.$('.document-print-settings input[placeholder="All pages, or 1-3, 5"]'));
  await page.select('select[aria-label="Page scaling"]','actual');
  assert.equal(await page.$eval('select[aria-label="Page scaling"]',select=>select.value),'actual');
  await page.select('select[aria-label="Page scaling"]','fit');
  await page.click('.quick-pdf-sizing summary');
  assert.equal(await page.$eval('.quick-pdf-sizing select',node=>node.value),'4');
  await page.click('.quick-pdf-sizing summary');
  await page.select('.document-print-settings .form-grid select','A3');
  await page.waitForFunction(()=>document.querySelector('.print-sticky-actions button[type=submit]').disabled);
  assert.equal(await page.$eval('.print-sticky-actions button[type=submit]',node=>node.textContent.trim()),'Print Now');
  await page.select('.document-print-settings .form-grid select','A4');
  await click('Print Now');
  await page.waitForFunction(()=>window.friendly?.includes('Printer stopped'));
  assert.equal(await page.evaluate(()=>window.orders.length),1);
  await click('Print Now');
  await page.waitForFunction(()=>window.attempts.length===2);
  assert.equal(await page.evaluate(()=>window.orders.length),1);
  assert.equal(await page.evaluate(()=>window.attempts[1].nup),4);
  assert.equal(await page.evaluate(()=>window.attempts[1].skipAutoMessages),false);
  await page.evaluate(()=>window.navigate('Orders'));
  await click('Bill / payment');
  await click('Save printable bill','dialog[open]');
  await page.waitForFunction(()=>window.bills.length===1);
  assert.deepEqual(await page.evaluate(()=>window.bills),[{id:'order-1'}]);
  await page.click('dialog[open] button[aria-label="Close details"]');
  await page.evaluate(()=>window.navigate('WhatsApp'));
  await page.waitForSelector('.chat-pdf-pick input');
  assert.equal(await page.$('.inbox-layout .customer-rail'),null);
  assert.ok(await page.$eval('.inbox-layout',layout=>layout.querySelector('.chat').clientWidth/layout.clientWidth>=0.7));
  await page.click('.chat-pdf-pick input');
  await click('Customer details','.chat-title');
  const customerDetails='dialog[open][aria-label="Customer details"]';
  await page.waitForSelector(customerDetails);
  assert.equal(await page.$eval(customerDetails+' .chat-document input[type=checkbox]',node=>node.checked),true);
  await page.click(customerDetails+' button[aria-label="Close details"]');
  await click('Review selected PDFs (1)');
  await page.waitForSelector('dialog[open][aria-label="Customer PDF batch"]');
  const batch='dialog[aria-label="Customer PDF batch"]';
  await page.evaluate(()=>window.setPhysicalPrinter(false));
  await click('Open Windows printer settings',batch);
  assert.equal(await page.evaluate(()=>window.printerSettingsOpened),1);
  assert.equal(await page.evaluate(()=>window.attempts.length),2);
  await page.evaluate(()=>window.setPhysicalPrinter(true));
  await page.waitForFunction(selector=>[...document.querySelector(selector+' select[aria-label="Output printer"]').options].some(option=>option.value==='TOSHIBA e-STUDIO257'),{},batch);
  assert.equal(await page.$eval(batch+' select[aria-label="Output printer"]',select=>select.value),'Microsoft Print to PDF');
  await click('Printer properties',batch);
  assert.deepEqual(await page.evaluate(()=>window.printerDialogRequest),{printer:'Microsoft Print to PDF',kind:'properties'});
  await page.select(batch+' select[aria-label="Output printer"]','TOSHIBA e-STUDIO257');
  assert.equal(await page.$$eval(batch+' .studio-files input[type=checkbox]:checked',nodes=>nodes.length),1);
  await page.type(batch+' input[type=search]','second');
  await page.click(batch+' input[aria-label="Include second.pdf"]');
  await page.click(batch+' input[aria-label="Include second.pdf"]');
  await page.click(batch+' input[aria-label="Include second.pdf"]');
  await page.$eval(batch+' input[type=search]',input=>{
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');
   input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  assert.equal(await page.$$eval(batch+' .studio-files input[type=checkbox]:checked',nodes=>nodes.length),2);
  await click('fixture.pdf',batch);
  await page.select(batch+' .batch-setting-controls fieldset select','A3');
  await click('second.pdf',batch);
  await page.select(batch+' .batch-setting-controls fieldset select','Legal');
  await page.waitForFunction(selector=>document.querySelector(selector+' .print-estimate .total strong')?.textContent==='LKR 280.00',{},batch);
  await page.select(batch+' .batch-setting-controls fieldset select','A4');
  await click('fixture.pdf',batch);
  await page.select(batch+' .batch-setting-controls fieldset select','A4');
  await click('Booklet',batch+' .batch-layout-actions');
  assert.equal(await page.$eval(batch+' select[aria-label="Print sides"]',select=>select.value),'shortEdge');
  await click('Booklet settings',batch+' .batch-layout-actions');
  assert.deepEqual(await page.$$eval(batch+' .booklet-settings-group legend',items=>items.map(item=>item.textContent)),['Paper and finished size','Binding and finishing','Double-sided printing','Margins and creep']);
  await click('Apply and preview',batch);
  await page.waitForFunction(selector=>document.querySelector(selector)?.innerText.includes('Sheet 1 / 2 (Front)'),{},batch);
  await page.select(batch+' select[aria-label="Output printer"]','OneNote (Desktop)');
  await page.waitForFunction(selector=>[...document.querySelectorAll(selector+' button')].some(button=>button.textContent.trim()==='Print Now'&&!button.disabled),{},batch);
  await page.select(batch+' select[aria-label="Output printer"]','TOSHIBA e-STUDIO257');
  await click('Normal layout',batch+' .batch-layout-actions');
  await page.select(batch+' select[aria-label="Print sides"]','auto');
  await page.waitForFunction(selector=>document.querySelector(selector+' .duplex-preview')?.textContent.includes('Portrait · Long edge'),{},batch);
  await page.select(batch+' select[aria-label="Orientation"]','landscape');
  await page.waitForFunction(selector=>document.querySelector(selector+' .duplex-preview')?.textContent.includes('Landscape · Short edge'),{},batch);
  await click('Flip to back',batch+' .duplex-preview');
  await page.waitForFunction(selector=>document.querySelector(selector+' .duplex-preview button')?.textContent==='Flip to front',{},batch);
  await click('Test Double-Sided Printing',batch);
  assert.equal(await page.evaluate(()=>window.duplexTestRequest.duplex),'auto');
  assert.equal(await page.evaluate(()=>window.duplexTestRequest.orientation),'landscape');
  await page.select(batch+' select[aria-label="Print sides"]','longEdge');
  await page.waitForFunction(selector=>document.querySelector(selector+' .duplex-preview')?.textContent.includes('Landscape · Long edge'),{},batch);
  await page.select(batch+' select[aria-label="Output printer"]','OneNote (Desktop)');
  assert.equal(await page.$eval(batch+' select[aria-label="Print sides"]',select=>select.value),'longEdge');
  await page.select(batch+' select[aria-label="Output printer"]','TOSHIBA e-STUDIO257');
  await page.select(batch+' select[aria-label="Print sides"]','simplex');
  await page.select(batch+' select[aria-label="Orientation"]','portrait');
  await click('4 pages',batch);
  assert.equal(await page.$eval(batch+' .page-layout-choices button[aria-pressed="true"]',node=>node.textContent.trim()),'4 pages');
  await click('1 page',batch);
  await click('Advanced settings',batch);
  await page.waitForSelector(batch+' .batch-inline-editor .document-print-sections');
  assert.equal(await page.$$eval('dialog[open]',nodes=>nodes.length),1);
  await click('Booklet',batch+' .batch-inline-editor .quick-print-types');
  await click('Apply and preview','dialog[open][aria-label="Booklet Wizard"]');
  await page.waitForSelector(batch+' .batch-inline-editor',{hidden:true});
  await page.waitForFunction(selector=>document.querySelector(selector+' .batch-layout-actions button[aria-pressed="true"]')?.textContent.trim()==='Booklet',{},batch);
  await click('Normal layout',batch+' .batch-layout-actions');
  await click('Advanced settings',batch);
  await click('Apply settings to this PDF',batch);
  await page.$eval(batch+' fieldset input[type=number]',input=>{
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'2');
   input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await click('second.pdf',batch);
  assert.equal(await page.$eval(batch+' fieldset input[type=number]',input=>input.value),'1');
  await page.select(batch+' select[aria-label="Print sides"]','longEdge');
  await click('fixture.pdf',batch);
  assert.equal(await page.$eval(batch+' fieldset input[type=number]',input=>input.value),'2');
  assert.equal(await page.$eval(batch+' select[aria-label="Print sides"]',select=>select.value),'simplex');
  await page.waitForFunction(selector=>document.querySelector(selector+' .total strong')?.textContent==='LKR 100.00',{},batch);
  await page.type(batch+' .print-estimate input:first-of-type','15');
  await page.type(batch+' .print-estimate label:nth-child(2) input','5');
  await page.waitForFunction(selector=>document.querySelector(selector+' .total strong')?.textContent==='LKR 110.00',{},batch);
  await click('Print Now',batch);
  await click('Print remaining PDFs',batch);
  await page.waitForFunction(()=>window.attempts.length===5);
  await click('View or send combined bill',batch);
  assert.deepEqual(await page.evaluate(()=>window.attempts.slice(2).map(({id,copies,duplex,fileSelection})=>({id,copies,duplex,fileSelection}))),[
   {id:'order-2',copies:2,duplex:'simplex',fileSelection:['fixture']},
   ...Array(2).fill({id:'order-2',copies:1,duplex:'longEdge',fileSelection:['second']})
  ]);
  assert.equal(await page.evaluate(()=>window.orders.length),2);
  await click('Send bill','dialog[aria-label="Bill order-2"]');
  assert.equal(await page.evaluate(()=>window.replies.length),0);
  await click('Send on WhatsApp','dialog[aria-label="Bill order-2"]');
  const [reply]=await page.evaluate(()=>window.replies);
  assert.equal(reply.id,'customer');
  assert.match(reply.text,/fixture\.pdf\s+second\.pdf\s+Total/);
  assert.ok(reply.text.includes('Total LKR 110.00'));
  await page.click('dialog[aria-label="Bill order-2"] button[aria-label="Close details"]');
  await page.select(batch+' select[aria-label="Output printer"]','Microsoft Print to PDF');
  await click('Save PDF',batch);
  await page.waitForFunction(()=>window.exports.length===2);
  assert.ok(await page.evaluate(()=>window.exports.every(input=>input.printer==='Microsoft Print to PDF')));
  await page.click(batch+' button[aria-label="Close details"]');
  await selectCopierInPhotoPreview();
  await page.select('.photo-quick-print-settings select[aria-label="Printer"]','TOSHIBA e-STUDIO257');
  await click('Printer properties','.photo-review-panel');
  assert.deepEqual(await page.evaluate(()=>window.printerDialogRequest),{printer:'TOSHIBA e-STUDIO257',kind:'properties'});
  await click('4','.photo-quick-layout');
  const strip='section[aria-label="Selected photos"]';
  await page.waitForSelector(strip+' canvas[data-loaded="true"]');
  assert.equal(await page.$$eval(strip+' .photo-selected-card',cards=>cards.length),2);
  await page.click(strip+' button[aria-label="Edit photo photo-a.png"]');
  const cropDialog='dialog[aria-label="Edit photo crop"]';
  await page.waitForFunction(selector=>document.querySelector(selector+' img')?.naturalWidth>0,{},cropDialog);
  await page.$eval(cropDialog,dialog=>Promise.all(dialog.getAnimations().map(animation=>animation.finished)));
  const cropSurface=await page.$(cropDialog+' .photo-crop-surface');
  async function dragCrop(left,right){
   await cropSurface.scrollIntoView();
   const cropBox=await cropSurface.boundingBox();
   await page.mouse.move(cropBox.x+cropBox.width*left,cropBox.y+cropBox.height*.2);
   await page.mouse.down();
   await page.mouse.move(cropBox.x+cropBox.width*right,cropBox.y+cropBox.height*.8,{steps:4});
   await page.mouse.up();
  }
  await dragCrop(.1,.4);
  await click('Add crop',cropDialog);
  await dragCrop(.55,.9);
  await click('Use 2 crops',cropDialog);
  await page.waitForSelector(cropDialog,{hidden:true});
  assert.equal(await page.evaluate(()=>window.savedCrops.crops.length),1);
  assert.equal(await page.$$eval(strip+' .photo-selected-card',cards=>cards.length),3);
  await page.click(strip+' button[aria-label="Remove crop.png from selection"]');
  const additionalCharge='.photo-review-panel .photo-charge-fields input';
  await page.click(additionalCharge,{clickCount:3});
  await page.type(additionalCharge,'25.50');
  async function openPhoto(name){
   await page.click(strip+' button[aria-label="Preview '+name+'"]');
   const drawer='dialog[open][aria-label="Photo preview · '+name+'"]';
   await page.waitForSelector(drawer);
   return drawer;
  }
  async function lightening(drawer){
   return page.$$eval(drawer+' details label',labels=>labels.find(label=>label.textContent.includes('Lighten document paper')).querySelector('input').value);
  }
  await page.click(strip+' button[aria-label="Lighten photo-a.png"]');
  let photoDrawer=await openPhoto('photo-a.png');
  assert.equal(await lightening(photoDrawer),'55');
  const lighteningSlider=photoDrawer+' input[type="range"][max="100"]';
  await page.focus(lighteningSlider);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await lightening(photoDrawer),'54');
  await click('Compare original',photoDrawer);
  await page.click(photoDrawer+' button[aria-label="Close details"]');
  photoDrawer=await openPhoto('photo-b.png');
  assert.equal(await lightening(photoDrawer),'0');
  await page.click(photoDrawer+' button[aria-label="Close details"]');
  await click('Lighten all selected','.photo-main-tools');
  photoDrawer=await openPhoto('photo-b.png');
  assert.equal(await lightening(photoDrawer),'55');
  await click('Back to print setup',photoDrawer);
  const layout='.photo-review-panel fieldset select';
  await page.select(layout+'[aria-label="Photos per A4 side"]','3');
  await page.select(layout+'[aria-label="Photo size"]','Custom');
  const customLimit=await page.$eval(layout+'[aria-label="Maximum per side at chosen sizes"]',select=>select.value);
  assert.equal(customLimit,'3');
  await page.select(layout+'[aria-label="Photo size"]','A4');
  await page.select(layout+'[aria-label="Fit photos"]','cover');
  await click('Black & white','.photo-review-panel');
  assert.equal(await page.$$eval('.photo-review-panel button',buttons=>buttons.find(button=>button.textContent.trim()==='Black & white')?.getAttribute('aria-pressed')),'true');
  await page.waitForFunction(()=>document.querySelector('.photo-print-action small')?.textContent.includes('may look soft'));
  await click('Print Now','.photo-review-panel');
  await page.waitForFunction(()=>window.attempts.length===6);
  assert.equal(await page.evaluate(()=>window.orders.length),3);
  assert.equal(await page.evaluate(()=>window.orders.at(-1).colour),false);
  assert.equal(await page.evaluate(()=>window.orders.at(-1).charge),2550);
  const photoPrint=await page.evaluate(()=>window.attempts.at(-1));
  assert.equal(photoPrint.paper,'A4');
  assert.equal(photoPrint.colour,false);
  assert.equal(photoPrint.fit,'cover');
  assert.equal(photoPrint.photoGrid.rows*photoPrint.photoGrid.columns,1);
  const appliedCrop=photoPrint.photoItems['photo-a'].crop;
  assert.ok(appliedCrop.width>.2&&appliedCrop.width<.4,JSON.stringify(appliedCrop));
  assert.deepEqual(Object.values(photoPrint.photoItems).map(item=>item.ink),['mono','mono']);
  await click('Back','.photo-studio-heading');
  await page.waitForSelector('.photo-studio-heading',{hidden:true});
  await page.evaluate(()=>window.openQueue());
  const batchOrder='[data-print-order="order-2"]';
  await page.waitForSelector('tr'+batchOrder);
  assert.equal(await page.$$eval('tr'+batchOrder,rows=>rows.length),1);
  await click('View 2 submissions',batchOrder);
  const submissions='dialog[open] .print-job-card';
  assert.deepEqual(await page.$$eval(submissions+' strong',items=>items.map(item=>item.textContent).sort()),['fixture.pdf','second.pdf']);
  await page.click('dialog[open] button[aria-label="Close details"]');
  await click('Board');
  assert.equal(await page.$$eval('article'+batchOrder,cards=>cards.length),1);
  await click('Confirm all printed',batchOrder);
  await page.waitForFunction(selector=>document.querySelector(selector+' .badge')?.textContent==='Completed',{},batchOrder);
  assert.deepEqual(await page.evaluate(()=>window.confirmedPrintSubmissions),{id:'order-2',entries:['queue-5','queue-3']});
  await page.evaluate(()=>window.openPdfWorkspace());
  await page.waitForSelector('.studio-pdf-drop');
  await click('Open from WhatsApp','.pdf-workspace');
  const chatPicker='dialog[open][aria-label="Open from WhatsApp"]';
  await page.select(chatPicker+' select','history-chat');
  await click('Download',chatPicker);
  await page.waitForSelector(chatPicker+' input[aria-label="Select history.pdf"]');
  await page.type(chatPicker+' input[placeholder="Name or WhatsApp number"]','0770000000');
  assert.match(await page.$eval(chatPicker+' select',select=>[...select.options].find(option=>option.value==='customer').textContent),/Test customer.*94770000000/);
  await page.select(chatPicker+' select','customer');
  const chatNames=()=>page.$$eval(chatPicker+' .studio-whatsapp-file strong',items=>items.map(item=>item.textContent).sort());
  assert.deepEqual(await chatNames(),['fixture.pdf','second.pdf']);
  await page.type(chatPicker+' input[placeholder="Search by filename"]','fixture');
  assert.equal(await page.$$eval(chatPicker+' .studio-whatsapp-file',files=>files.length),1);
  await page.click(chatPicker+' input[aria-label="Select fixture.pdf"]');
  await click('Open selected',chatPicker);
  await page.waitForSelector('.studio-pdf-preview canvas');
  assert.equal(await page.$$eval('.studio-pdf-page',pages=>pages.length),8);
  await page.select('select[aria-label="WhatsApp number"]','history-chat');
  await page.waitForSelector(chatPicker+' input[aria-label="Select history.pdf"]');
  assert.equal(await page.$eval(chatPicker+' select',select=>select.value),'history-chat');
  assert.equal(await page.$(chatPicker+' input[aria-label="Select fixture.pdf"]'),null);
  await page.click(chatPicker+' button[aria-label="Close details"]');
  await click('Prepare output','.studio-pdf-toolbar');
  await click('Save As','.studio-pdf-toolbar');
  await page.waitForFunction(()=>window.savedStudioOutput?.format==='pdf'&&window.savedStudioOutput.length>0);
  await click('Print','.studio-pdf-toolbar');
  await page.waitForSelector('dialog[open][aria-label="PDF Print Preview"]');
  assert.equal(await page.evaluate(()=>window.studioPrintOutput.length===window.savedStudioOutput.length),true);
  await page.click('dialog[open] button[aria-label="Close details"]');
  for(const [tool,expected] of [['Image to PDF',['WhatsApp image','photo-a.png','photo-b.png']],['Word to PDF',['customer-note.docx']],['OCR Scanner',['WhatsApp image','photo-a.png','photo-b.png']]]){
   await click('Tools','.studio-pdf-toolbar');
   await page.$$eval('.studio-pdf-card',(cards,title)=>cards.find(card=>card.querySelector('strong')?.textContent===title).click(),tool);
   await page.select('select[aria-label="WhatsApp number"]','customer');
   await page.waitForSelector(chatPicker+' .studio-whatsapp-file');
   assert.deepEqual(await chatNames(),expected);
   if(tool==='Image to PDF'){
    await page.waitForSelector(chatPicker+' canvas[data-loaded="true"]');
    await page.click(chatPicker+' input[aria-label="Select WhatsApp image"]');
    await click('Open selected',chatPicker);
    await page.waitForFunction(()=>document.querySelector('.pdf-workspace')?.innerText.includes('WhatsApp image.png'));
    continue;
   }
   if(tool==='OCR Scanner'){
    await click('PDFs',chatPicker);
    assert.deepEqual(await chatNames(),['fixture.pdf','second.pdf']);
   }
   await page.click(chatPicker+' button[aria-label="Close details"]');
  }
  await page.evaluate(()=>window.addOfficeFile());
  await click('Convert & print','.chat-message-file');
  await page.waitForSelector('dialog[open][aria-label="PDF Print Preview"]');
  assert.deepEqual(await page.evaluate(()=>window.convertedDocument),{id:'office-file',mode:'pages',includeHidden:false});
  await click('Print several PDFs for this customer','dialog[open][aria-label="PDF Print Preview"]');
  await page.waitForSelector(batch+' select[aria-label="Output printer"]');
  await page.select(batch+' select[aria-label="Output printer"]','OneNote (Desktop)');
  await click('Booklet',batch+' .batch-layout-actions');
  const exportCount=await page.evaluate(()=>window.exports.length);
  await click('Print Now',batch);
  await page.waitForFunction(()=>window.attempts.at(-1)?.printer==='OneNote (Desktop)');
  assert.deepEqual(await page.evaluate(()=>[window.attempts.at(-1).booklet,window.attempts.at(-1).duplex,window.exports.length]),[true,'shortEdge',exportCount]);
  await page.click(batch+' button[aria-label="Close details"]');
  await page.evaluate(()=>window.openBulkChat());
  await click('Review received PDFs (2)');
  await page.waitForSelector(batch+' select[aria-label="Output printer"]');
  assert.equal(await page.$$eval(batch+' .studio-files input[type=checkbox]:checked',inputs=>inputs.length),2);
  await page.select(batch+' select[aria-label="Output printer"]','TOSHIBA e-STUDIO257');
  const beforeBulk=await page.evaluate(()=>window.attempts.length);
  await click('Print Now',batch);
  await page.waitForFunction(count=>window.attempts.length===count+1,{},beforeBulk);
  assert.deepEqual((await page.evaluate(()=>window.attempts.at(-1).fileSelection)).sort(),['bulk-a','bulk-b']);
  await page.waitForFunction(selector=>document.querySelector(selector)?.innerText.includes('2 PDFs sent to the print queue'),{},batch);
  await page.click(batch+' button[aria-label="Close details"]');
  await page.evaluate(()=>window.openHistoryDownload());
  await click('history.pdf · Available to download','.chat');
  const attachmentPreview='dialog[open][aria-label="history.pdf"]';
  await page.waitForSelector(attachmentPreview+' [role="status"]');
  await page.evaluate(()=>window.finishHistoryDownload());
  await page.waitForSelector(attachmentPreview+' canvas:not([hidden])');
  await page.goto(page.url());
  await page.evaluate(()=>localStorage.setItem('lastDocumentPrinter','TOSHIBA e-STUDIO257'));
  await page.waitForFunction(()=>[...document.querySelectorAll('.studio-files button')].some(button=>button.textContent.startsWith('photo-a.png')));
  await page.evaluate(()=>[...document.querySelectorAll('.studio-files button')].find(button=>button.textContent.startsWith('photo-a.png')).click());
  await page.select('.document-print-settings select[aria-label="Printer"]','TOSHIBA e-STUDIO257');
  await page.$eval('.document-print-settings input[type="number"]',input=>{
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'6');
   input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await page.evaluate(()=>{
   const picker=[...document.querySelectorAll('.document-print-settings label')].find(label=>label.textContent.startsWith('Copies per side')).querySelector('select');
   Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(picker,'6');
   picker.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForFunction(()=>{
   const button=document.querySelector('.print-sticky-actions button[type="submit"]');
   const sheet=[...document.querySelectorAll('.print-calculation-summary div')].find(row=>row.firstChild?.textContent==='Physical sheets');
   return button&&!button.disabled&&button.getBoundingClientRect().bottom<=innerHeight&&sheet?.lastChild?.textContent==='1';
  });
  await page.evaluate(()=>{
   const label=[...document.querySelectorAll('.print-sticky-actions label')].find(item=>item.textContent.includes('Skip automatic WhatsApp messages'));
   label.querySelector('input').click();
  });
  assert.equal(await page.$('.print-sticky-actions textarea'),null);
  await click('Print Now');
  await page.waitForFunction(()=>window.attempts[0]?.nup===6&&window.attempts[0]?.copies===6&&window.attempts[0]?.skipAutoMessages===true);
  const duplexFixture=new URL(page.url());
  duplexFixture.searchParams.set('duplex-test','1');
  await page.goto(duplexFixture.href);
  await page.waitForFunction(()=>window.duplexFixtureError!==undefined);
  assert.equal(await page.evaluate(()=>window.duplexFixtureError),'');
  assert.deepEqual(await page.evaluate(()=>({faces:window.__printManifest.faces,width:window.__printManifest.widthMm,height:window.__printManifest.heightMm})),{faces:[false,true],width:297,height:210});
  console.log('Browser UX passed for PDF booklets, Office conversion to print preview, photo printing and grouped print orders.');
 }catch(error){
  console.error(step);
  if(page)console.error(await page.evaluate(()=>document.body.innerText.slice(-2200)));
  throw error;
 }finally{
  await browser?.close();
  await server?.close();
  await Promise.all([fs.unlink(fixture).catch(()=>{}),fs.unlink(html).catch(()=>{})]);
 }
}
checkWorkflow().catch(error=>{console.error(error);process.exitCode=1});
