import {mkdirSync} from 'node:fs';
import {queryCapabilities,validatePrinter,openPrinterDialog,windowsBridge} from '../../packages/printing/windows';
import {isVirtualPrinter} from '../../packages/printing/capabilities';
import {normalizedSettings,type ManualFeedProfile} from '../../packages/printing/settings';
import {paperDimensions} from '../../packages/printing/paper';
import {paperSizes} from '../../packages/printing/calculation';
import {app,BrowserWindow,clipboard,dialog,ipcMain,safeStorage,session,protocol,net,shell} from 'electron';
import {performSupportAction} from '../../packages/shared/support';
import {fork,type ChildProcess} from 'node:child_process';
import {join,isAbsolute} from 'node:path';
import {mkdir,mkdtemp,readFile,rename,rm,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {schemas,type Operation,type Input,type Payment} from '../../packages/shared/contracts';
let main:BrowserWindow;
let startupSplash:BrowserWindow|undefined;
let child:ChildProcess;
let root:string;
let stopping=false;
let sequence=0;
const awaiting=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timeout:NodeJS.Timeout}>();
const printViews=new Map<number,{data:unknown;ready:(error:string)=>void}>();
const index='bloom://workspace/index.html';
const startupUrl='bloom://workspace/startup.html';
protocol.registerSchemesAsPrivileged([{scheme:'bloom',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
const vault=()=>join(root,'credentials.dpapi');
function engine<T=unknown>(operation:string,input:unknown):Promise<T>{
  return new Promise((resolve,reject)=>{
    if(!child?.connected){reject(new Error('The background engine is restarting.'));return}
    const id=++sequence;
    const timeout=setTimeout(()=>{awaiting.delete(id);reject(new Error('The engine took too long. Check the current status before retrying.'))},120000);
    awaiting.set(id,{resolve:value=>resolve(value as T),reject,timeout});
    child.send({id,operation,input},error=>{if(error){clearTimeout(timeout);awaiting.delete(id);reject(new Error('The engine is unavailable.'))}});
  });
}
function startEngine(){
  const processChild=fork(join(__dirname,'engine.cjs'),[root],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},serialization:'advanced',stdio:['ignore','ignore','ignore','ipc']});child=processChild;
  processChild.on('message',(msg:{id:number;type?:string;error?:string;result?:unknown})=>{
    if(msg.type==='changed'){if(main&&!main.isDestroyed())main.webContents.send('bloom:changed');return}
    const pending=awaiting.get(msg.id);if(!pending)return;
    clearTimeout(pending.timeout);awaiting.delete(msg.id);
    if(msg.error)pending.reject(new Error(msg.error));else pending.resolve(msg.result);
  });
  processChild.on('error',()=>{});
  processChild.on('exit',()=>{for(const pending of awaiting.values()){clearTimeout(pending.timeout);pending.reject(new Error('The engine restarted. Check current status before retrying.'))}awaiting.clear();
    if(!stopping)setTimeout(()=>{startEngine();void restore()},2500);
  });
}
async function restore(){
  try{if(safeStorage.isEncryptionAvailable()){const input=JSON.parse(safeStorage.decryptString(await readFile(vault())));await engine('restoreConnection',input)}}catch{ /* Missing or unavailable credentials require operator setup. */ }
}
const windowOptions={icon:join(__dirname,'ui','bloomconnect-logo.png'),webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}};
function lock(win:BrowserWindow){win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault())}
function startWorkspaceWindow(window:BrowserWindow,visible:boolean,verify:boolean){
  if(!visible&&!verify)return;
  const splash=new BrowserWindow({
    width:410,height:214,show:false,center:true,frame:false,resizable:false,skipTaskbar:true,
    backgroundColor:'#0a1028',title:'Starting BloomConnect',
    webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}
  });
  startupSplash=splash;lock(splash);
  let stage={value:28,label:'Starting print engine'},shownAt=0,finished=false;
  async function update(value:number,label:string){
    if(splash.isDestroyed())return false;
    return splash.webContents.executeJavaScript(`(() => {
      const bar=document.getElementById('progress');
      if(!bar)return false;
      bar.value=${value};
      document.getElementById('percent').textContent=${JSON.stringify(value+'%')};
      document.getElementById('stage').textContent=${JSON.stringify(label)};
      if(bar.value===100)document.body.dataset.complete='true';
      return bar.value===${value};
    })()`).catch(()=>false) as Promise<boolean>;
  }
  const splashReady=splash.loadURL(startupUrl).then(async()=>{
    if(splash.isDestroyed())return false;
    if(visible){splash.show();shownAt=Date.now()}
    if(verify&&!await splash.webContents.executeJavaScript("document.querySelector('.brand img')?.naturalWidth>0"))return false;
    return update(stage.value,stage.label);
  }).catch(()=>false);
  let resolveDone:(value:{loaded:boolean;completed:boolean;reason:string;mainWasHidden:boolean})=>void;
  const done=new Promise<{loaded:boolean;completed:boolean;reason:string;mainWasHidden:boolean}>(resolve=>{resolveDone=resolve});
  const finish=async(reason:'ready'|'fallback')=>{
    if(finished)return;
    finished=true;clearTimeout(fallback);
    const mainWasHidden=!window.isDestroyed()&&!window.isVisible();
    const loaded=await splashReady;
    const completed=loaded&&await update(100,'Opening workspace');
    if(shownAt)await new Promise(resolve=>setTimeout(resolve,Math.max(230,540-(Date.now()-shownAt))));
    if(!window.isDestroyed()&&visible)window.show();
    if(!splash.isDestroyed())splash.destroy();
    if(startupSplash===splash)startupSplash=undefined;
    resolveDone({loaded,completed,reason,mainWasHidden});
  };
  const fallback=setTimeout(()=>void finish('fallback'),12000);
  window.webContents.once('dom-ready',()=>{
    stage={value:68,label:'Loading workspace data'};
    void splashReady.then(loaded=>{if(loaded&&!finished)void update(stage.value,stage.label)});
  });
  window.once('closed',()=>{
    clearTimeout(fallback);
    if(!splash.isDestroyed())splash.destroy();
    if(startupSplash===splash)startupSplash=undefined;
  });
  return {finish,done};
}
function trusted(event:Electron.IpcMainInvokeEvent){return main&&!main.isDestroyed()&&event.sender.id===main.webContents.id&&event.senderFrame?.url===index}
const escape=(value:unknown)=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]??c));
async function selectedPrintFiles(input:Input<'savePrintPdf'>){
 const available=await engine<{id:string}[]>('printable',{id:input.id});
 if(!input.fileSelection)return available;
 if(new Set(input.fileSelection).size!==input.fileSelection.length||input.fileSelection.some(id=>!available.some(file=>file.id===id)))throw new Error('Print selection must contain unique files from this order.');
 return input.fileSelection.map(id=>available.find(file=>file.id===id)!);
}
async function printOrder(input:Input<'print'>){
  const manual=input.duplex==='manualLongEdge'||input.duplex==='manualShortEdge';
  const list=await main.webContents.getPrintersAsync();
  if(!list.some(p=>p.name===input.printer))throw new Error('Select an available Windows printer.');
  const verified=normalizedSettings(input);
  const capabilities=await queryCapabilities(join(__dirname,'windows.ps1'),input.printer,verified);
  validatePrinter(verified,capabilities);
  if(verified.duplex!=='simplex'&&isVirtualPrinter(capabilities.driver))throw new Error('Two-sided printing requires a physical printer.');
  if(Object.keys(verified.photoItems).length){
    const margins=verified.margins??{left:verified.marginMm,right:verified.marginMm,top:verified.marginMm,bottom:verified.marginMm};
    for(const edge of ['left','right','top','bottom'] as const)if(Math.max(margins[edge],verified.printable?.[edge]??0)+.1<capabilities.printable[edge])throw new Error('Photo layout exceeds this printer printable area. Refresh the printer selection and review the new layout before printing.');
  }
  const native=verified.tray!==undefined||!!verified.driverDpi;
  if(native&&isVirtualPrinter(capabilities.driver))throw new Error('Use a physical printer for explicit tray or resolution settings.');
  const files=await selectedPrintFiles(input);
  if(!files.length)throw new Error('This order has no files.');
  if(input.booklet&&(input.nup!==2||input.duplex==='simplex'||!input.landscape))throw new Error('Booklets require landscape paper, two pages per side and duplex.');
  const edge=input.duplex==='manualLongEdge'?'long':'short';
  const profile=manual&&verified.orientation!=='auto'
    ?await engine<ManualFeedProfile|null>('manualFeedProfile',{printer:input.printer,landscape:verified.orientation==='landscape'||verified.orientation==='legacy'&&input.landscape,edge})
    :null;
  const first=input.manualFirstSide??profile?.first??'front',second=first==='front'?'back':'front';
  const entry=await engine<string>('printStart',{...input,manualFirstSide:manual?first:undefined,manualFeedApplied:profile??undefined});
  let attempted=false;
  let secondAttempted=false;
  async function submitPass(pass:Input<'print'>,reverse=false,rotate=false,secondPass=false){
    const win=new BrowserWindow({...windowOptions,show:false,paintWhenInitiallyHidden:true});
    lock(win);
    const viewId=win.webContents.id;
    try{
      const rendered=new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Print preparation timed out.')),90000);
        printViews.set(viewId,{data:{input:pass,files},ready:error=>{clearTimeout(timer);if(error)reject(new Error(error));else resolve()}});
        win.once('closed',()=>{clearTimeout(timer);reject(new Error('Print view closed.'))});
      });
      await Promise.all([win.loadURL(index+'?print=1'),rendered]);
      if(reverse||rotate)await win.webContents.executeJavaScript(`{
        const sheets=[...document.querySelectorAll('.sheet')];
        if(${reverse})sheets[0].parentElement.append(...sheets.reverse());
        if(${rotate})for(const sheet of sheets)sheet.querySelector('canvas').style.transform='rotate(180deg)';
      }`);
      const [width,height]=paperDimensions(input.paper,input.customPaper);
      const pageSize={width:Math.round(width*1000),height:Math.round(height*1000)};
      const manifest=await win.webContents.executeJavaScript('window.__printManifest') as {widthMm:number;heightMm:number;hasColour:boolean;sides:number};
      const landscape=Math.abs(width-height)<.001?input.landscape:Math.abs(manifest.widthMm-height)<.01&&Math.abs(manifest.heightMm-width)<.01;
      const colour=manifest.hasColour;
      if(colour&&!capabilities.colour)throw new Error('The selected printer does not advertise colour printing.');
      const duplexMode=pass.duplex==='longEdge'?'longEdge':pass.duplex==='shortEdge'?'shortEdge':'simplex';
      if(native){
        const folder=await mkdtemp(join(tmpdir(),'bloom-native-print-'));
        try{
          const pages:string[]=[];
          for(let index=0;index<manifest.sides;index++){
            const png=await win.webContents.executeJavaScript(`(() => {
              const source=document.querySelectorAll('.sheet canvas')[${index}];
              if(!${rotate})return source.toDataURL('image/png');
              const output=document.createElement('canvas');output.width=source.width;output.height=source.height;
              const ctx=output.getContext('2d');ctx.translate(output.width,output.height);ctx.rotate(Math.PI);ctx.drawImage(source,0,0);
              return output.toDataURL('image/png');
            })()`) as string;
            const path=join(folder,index+'.png');
            await writeFile(path,Buffer.from(png.slice('data:image/png;base64,'.length),'base64'));
            pages.push(path);
          }
          attempted=true;
          if(secondPass)secondAttempted=true;
          const result=await windowsBridge(join(__dirname,'windows.ps1'),'submit',{printer:input.printer,widthMm:width,heightMm:height,landscape,colour,duplex:duplexMode,tray:verified.tray,dpi:verified.driverDpi,title:input.id,pages});
          if(!result?.submitted||result.pages!==pages.length)throw new Error('Windows did not confirm all prepared sides.');
        }finally{await rm(folder,{recursive:true,force:true})}
        return;
      }
      attempted=true;
      if(secondPass)secondAttempted=true;
      await new Promise<void>((resolve,reject)=>win.webContents.print({silent:true,deviceName:input.printer,landscape,color:colour,copies:1,collate:false,duplexMode,pageSize,margins:{marginType:'none'},printBackground:true},(success,reason)=>success?resolve():reject(new Error(reason||'Windows did not confirm submission.'))));
    }finally{printViews.delete(viewId);if(!win.isDestroyed())win.destroy()}
  }
  try{
    await submitPass(manual?{...input,sideSelection:first}:input);
    if(manual){
      const result=await dialog.showMessageBox(main,{
        type:'question',title:'Manual two-sided printing',message:'Reload the '+first+'-side sheets',
        detail:(profile?profile.instructions+' ': 'Wait until the first pass finishes. Reload the same sheets with the blank side positioned for your printer. ')+'Confirm the '+edge+'-edge flip and set the stack order before printing the '+second+' sides.',
        buttons:['Print '+second+' sides','Print '+second+' sides in reverse order','Cancel'],defaultId:profile?.reverseSecond?1:0,cancelId:2,
        checkboxLabel:'Rotate the second pass 180 degrees',checkboxChecked:profile?.rotateSecond??false
      });
      if(result.response===2)throw new Error('Manual duplex was cancelled after the first pass. Check the sheets before starting another job.');
      await submitPass({...input,sideSelection:second},result.response===1,result.checkboxChecked,true);
    }
    await engine('printFinish',{id:entry,error:'',partial:false});
  }catch(error){
    await engine('printFinish',{id:entry,error:error instanceof Error?error.message:'Printer submission failed.',partial:attempted,cancelled:manual&&attempted&&!secondAttempted});
    throw error;
  }
  return {entry};
}
async function savePreparedPdf(input:Input<'savePrintPdf'>){
  const selected=await dialog.showSaveDialog(main,{defaultPath:input.id+'-prepared.pdf',filters:[{name:'PDF',extensions:['pdf']}]});
  if(!selected.filePath)return false;
  const files=await selectedPrintFiles(input);
  const win=new BrowserWindow({...windowOptions,show:false,paintWhenInitiallyHidden:true});lock(win);
  try{
    const rendered=new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('PDF preparation timed out.')),90000);
      printViews.set(win.webContents.id,{data:{input,files},ready:error=>{clearTimeout(timer);error?reject(new Error(error)):resolve()}});
    });
    await Promise.all([win.loadURL(index+'?print=1'),rendered]);
    const bytes=await win.webContents.printToPDF({preferCSSPageSize:true,printBackground:true,margins:{top:0,bottom:0,left:0,right:0}});
    await writeFile(selected.filePath,bytes);return true;
  }finally{printViews.delete(win.webContents.id);win.destroy()}
}
if(process.env.BLOOMCONNECT_SMOKE_DIR){mkdirSync(process.env.BLOOMCONNECT_SMOKE_DIR,{recursive:true});app.setPath('userData',process.env.BLOOMCONNECT_SMOKE_DIR)}
if(!app.requestSingleInstanceLock())app.quit();
else void app.whenReady().then(async()=>{
  if(process.env.BLOOMCONNECT_SMOKE_DIR)app.setPath('userData',process.env.BLOOMCONNECT_SMOKE_DIR);
  app.setName('BloomConnect');
  if(process.platform==='win32')app.setAppUserModelId('lk.bloomconnect.desktop');
  root=app.getPath('userData');await mkdir(root,{recursive:true});
  protocol.handle('bloom',request=>{
    const url=new URL(request.url);
    if(request.method!=='GET'||url.host!=='workspace'||!/^\/(?:index\.html|startup\.(?:html|css)|bloomconnect-logo\.png|assets\/(?:pdfjs\/(?:cmaps|standard_fonts|wasm|iccs)\/)?[\w-]+(?:\.[\w-]+)*)$/.test(url.pathname))return new Response('Not found',{status:404});
    return net.fetch(pathToFileURL(join(__dirname,'ui',url.pathname.slice(1))).href);
  });
  session.defaultSession.setPermissionRequestHandler((_web,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  startEngine();void restore();
  main=new BrowserWindow({...windowOptions,webPreferences:{...windowOptions.webPreferences,backgroundThrottling:process.env.BLOOMCONNECT_SMOKE_VISUAL!=='1'&&process.env.BLOOMCONNECT_SMOKE_PRINT!=='1'},width:1450,height:950,minWidth:1000,minHeight:700,backgroundColor:'#0a1028',show:false,paintWhenInitiallyHidden:true,title:'BloomConnect',autoHideMenuBar:true});
  lock(main);
  const startup=startWorkspaceWindow(main,!process.env.BLOOMCONNECT_SMOKE_DIR,process.env.BLOOMCONNECT_SMOKE_STARTUP==='1');
  ipcMain.handle('bloom:startup-ready',event=>{if(trusted(event))void startup?.finish('ready')});
  ipcMain.handle('bloom:drop-files',async(event,paths:unknown,customer:unknown)=>{if(!trusted(event))throw new Error('Untrusted import request.');const owner=schemas.import.parse({customer});if(!Array.isArray(paths)||!paths.length||paths.length>40||paths.some(path=>typeof path!=='string'||path.length>4096||!isAbsolute(path)))throw new Error('Drop between 1 and 40 local files.');return engine('importLocal',{paths,customer:owner.customer})});
  ipcMain.handle('bloom:print-data',event=>printViews.get(event.sender.id)?.data);
  ipcMain.on('bloom:print-ready',(event,error:unknown)=>{if(typeof error==='string')printViews.get(event.sender.id)?.ready(error.slice(0,500))});
  ipcMain.handle('bloom:call',async(event,operation:unknown,data:unknown)=>{
    if(typeof operation!=='string'||!Object.hasOwn(schemas,operation))throw new Error('Invalid operation.');
    const op=operation as Operation;
    if(!trusted(event)){
      if(op==='preview'&&printViews.has(event.sender.id)&&event.senderFrame?.url===index+'?print=1'){
        const input=schemas.preview.parse(data);return engine('getPreview',input);
      }
      throw new Error('Unauthorized request.');
    }
    const input=schemas[op].parse(data);
    switch(op){
      case 'appInfo':return {version:app.getVersion()};
      case 'supportAction':return performSupportAction(schemas.supportAction.parse(input).action,url=>shell.openExternal(url),value=>clipboard.writeText(value));
      case 'printers':return main.webContents.getPrintersAsync();
      case 'printerCapabilities':{const request=schemas.printerCapabilities.parse(input);return queryCapabilities(join(__dirname,'windows.ps1'),request.printer,request.settings?normalizedSettings(request.settings):undefined)}
      case 'printerDialog':{const request=schemas.printerDialog.parse(input);const installed=await main.webContents.getPrintersAsync();if(!installed.some(p=>p.name===request.printer))throw new Error('Select an installed printer.');return openPrinterDialog(request.printer,request.kind)}
      case 'savePrintPdf':return savePreparedPdf(schemas.savePrintPdf.parse(input));
      case 'connect':{
        if(!safeStorage.isEncryptionAvailable())throw new Error('Windows credential protection is unavailable.');
        const config=schemas.connect.parse(input);
        const temp=vault()+'.'+randomUUID();
        await writeFile(temp,safeStorage.encryptString(JSON.stringify(config)));
        try{await engine('connect',config);await rename(temp,vault())}catch(error){await unlink(temp).catch(()=>{});throw error}return;
      }
      case 'logout':await engine(op,input);await unlink(vault()).catch(error=>{if(error.code!=='ENOENT')throw error});return;
      case 'import':{
        const selection=await dialog.showOpenDialog(main,{properties:['openFile','multiSelections'],filters:[{name:'Printable documents and images',extensions:['pdf','ppt','pptx','doc','docx','xls','xlsx','txt','jpg','jpeg','png','webp','tif','tiff','heic','heif']}]});
        if(selection.canceled)return 0;
        return engine('importLocal',{...schemas.import.parse(input),paths:selection.filePaths});
      }
      case 'preview':return engine('getPreview',input);
      case 'print':return printOrder(schemas.print.parse(input));
      case 'exportScannedPdf':{
        const {id}=schemas.exportScannedPdf.parse(input);
        const selected=await dialog.showSaveDialog(main,{defaultPath:'BloomConnect processed scan.pdf',filters:[{name:'PDF',extensions:['pdf']}]});
        if(selected.canceled||!selected.filePath)return false;
        const file=await engine<{mime:string;bytes:Uint8Array}>('getPreview',{id});
        if(file.mime!=='application/pdf')throw new Error('Select a processed PDF to export.');
        await writeFile(selected.filePath,file.bytes);return true;
      }
      case 'backup':{
        const selection=await dialog.showOpenDialog(main,{properties:['openDirectory','createDirectory']});if(selection.canceled)return false;
        return engine('saveBackup',{path:join(selection.filePaths[0],'BloomConnect-backup-'+randomUUID())});
      }
      case 'receipt':{
        const {payment,shop}=await engine<{payment:Payment;shop:string}>('receiptData',input);
        const selection=await dialog.showSaveDialog(main,{defaultPath:'Receipt-'+payment.job_id+'.pdf',filters:[{name:'PDF',extensions:['pdf']}]});
        if(!selection.filePath)return false;
        const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});lock(win);
        try{
          const doc='<meta charset="utf-8"><h1>'+escape(shop)+'</h1><h2>Payment receipt</h2><p>Receipt '+escape(payment.id)+'</p><p>Order '+escape(payment.job_id)+'</p><p>'+escape(new Date(payment.created).toLocaleString('en-LK',{timeZone:'Asia/Colombo'}))+'</p><p>'+escape(payment.method)+' · LKR '+(payment.amount/100).toFixed(2)+'</p>';
          await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(doc));
          await writeFile(selection.filePath,await win.webContents.printToPDF({pageSize:'A5'}));return true;
        }finally{win.destroy()}
      }
      default:return engine(op,input);
    }
  });
  await main.loadURL(index);
  if(process.env.BLOOMCONNECT_SMOKE_DIR){
    try{
      if(startup&&process.env.BLOOMCONNECT_SMOKE_STARTUP==='1'){
        const result=await startup.done;
        if(!result.loaded||!result.completed||!result.mainWasHidden||result.reason!=='ready')throw new Error('Startup popup did not complete after the workspace loaded.');
        await writeFile(join(root,'startup-smoke.json'),JSON.stringify(result));
      }
      const snapshot=await engine<{settings:unknown}>('snapshot',null);
      if(process.env.BLOOMCONNECT_SMOKE_VISUAL==='1'&&!snapshot.settings){
        await main.webContents.executeJavaScript(`(async()=>{
          for(let i=0;i<100&&!document.querySelector('.onboarding-card');i++)await new Promise(resolve=>setTimeout(resolve,50));
          if(!document.querySelector('.onboarding-card'))throw new Error('Setup wizard did not render.');
          await new Promise(resolve=>setTimeout(resolve,180));
        })()`);
        await writeFile(join(root,'setup-wizard.png'),(await main.capturePage()).toPNG());
        await main.webContents.executeJavaScript(`(async()=>{
          const action=label=>[...document.querySelectorAll('.wizard-actions button')].find(button=>button.textContent.trim()===label);
          const wait=()=>new Promise(resolve=>setTimeout(resolve,70));
          action('Continue').click();await wait();
          const shop=document.querySelector('.onboarding-card input');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(shop,'Smoke test');
          shop.dispatchEvent(new Event('input',{bubbles:true}));await wait();
          for(let i=0;i<5;i++){action('Continue').click();await wait()}
          action('Finish setup').click();
          for(let i=0;i<100&&!document.querySelector('main[data-page="Dashboard"]');i++)await new Promise(resolve=>setTimeout(resolve,60));
          if(!document.querySelector('main[data-page="Dashboard"]'))throw new Error('Setup wizard did not finish.');
        })()`);
      }
      await engine('setup',{shop:'Smoke test',language:'en',printer:'',mono:1000,colour:5000,photo:10000});
      await main.loadURL(index);
      const verify=await engine<{settings:{shop:string}}>('snapshot',null);
      const rendered=await main.webContents.executeJavaScript("new Promise(resolve => { const t = Date.now(); const poll = setInterval(() => { const shown = document.body.innerText.includes('Welcome to Smoke test.'); if (shown || Date.now()-t > 10000) { clearInterval(poll); resolve(shown) } }, 100) })");
      if(process.env.BLOOMCONNECT_SMOKE_STARTUP==='1'&&!await main.webContents.executeJavaScript("document.querySelector('.hero-brand img')?.decode().then(()=>true,()=>false)"))throw new Error('Dashboard logo did not load.');
      if(process.env.BLOOMCONNECT_SMOKE_ABOUT==='1'){
        main.setSize(1000,700);
        const result=await main.webContents.executeJavaScript(`(async()=>{
          const wait=async(test)=>{for(let i=0;i<120;i++){const result=test();if(result)return result;await new Promise(resolve=>setTimeout(resolve,60))}throw Error('About test expected content did not appear')};
          const button=(name,scope=document)=>[...scope.querySelectorAll('button')].find(b=>!b.disabled&&b.textContent.trim()===name);
          (await wait(()=>document.querySelector('nav button[aria-label="Settings"]'))).click();
          (await wait(()=>button('About BloomConnect'))).click();
          const about=await wait(()=>document.querySelector('.about-page'));
          await wait(()=>about.innerText.includes('Version '+${JSON.stringify(app.getVersion())}));
          const click=async(name,scope)=>{(await wait(()=>button(name,scope))).click();await new Promise(resolve=>setTimeout(resolve,100))};
          for(const action of ['Chat on WhatsApp','Call Support','Copy Phone Number'])await click(action,about);
          await wait(()=>about.innerText.includes('Support number copied.'));
          const footer=await wait(()=>document.querySelector('.app-footer'));
          await click('076 766 0922',footer);
          await click('WhatsApp',footer);
          const themes=[];
          for(let i=0;i<2;i++){
            const theme=document.documentElement.dataset.theme;
            if(footer.scrollWidth>footer.clientWidth+1||getComputedStyle(footer).position==='fixed')throw Error('Footer does not fit compact layout');
            themes.push(theme);
            document.querySelector('button[aria-label="Toggle theme"]').click();
            await wait(()=>document.documentElement.dataset.theme!==theme);
          }
          let rejected=false;
          try{await window.bloom.call('supportAction',{action:'whatsapp',url:'https://example.com'})}catch{rejected=true}
          if(!rejected)throw Error('Support link overrides must be rejected');
          return {version:${JSON.stringify(app.getVersion())},themes,compact:true,invalidUrlRejected:true};
        })()`);
        await writeFile(join(root,'about-smoke.json'),JSON.stringify(result));
      }
      if(verify.settings.shop!=='Smoke test'||!rendered)throw new Error('Smoke assertion failed');
      const sample=join(root,'smoke-sample.pdf');
      const scanFixture=process.env.BLOOMCONNECT_SMOKE_SCAN;
      if(scanFixture)await writeFile(sample,await readFile(scanFixture));
      else await writeFile(sample,await main.webContents.printToPDF({pageSize:'A4'}));
      await engine('importLocal',{paths:[sample],customer:null});
      await main.loadURL(index);
      const preview=await main.webContents.executeJavaScript(`(async()=>{
        const wait=async(test,label='PDF preview')=>{
          for(let i=0;i<${scanFixture||process.env.BLOOMCONNECT_SMOKE_QUICK_PDF==='1'?600:100};i++){const value=test();if(value)return value;await new Promise(resolve=>setTimeout(resolve,100))}
          throw new Error(label+' '+document.body.innerText.slice(-2200));
        };
        const button=label=>[...document.querySelectorAll('button')].find(item=>item.textContent.trim()===label);
        (await wait(()=>button('Documents'))).click();
        (await wait(()=>button('smoke-sample.pdf'))).click();
        const canvas=await wait(()=>document.querySelector('.preview canvas:not([hidden])'));
        if(${JSON.stringify(process.env.BLOOMCONNECT_SMOKE_QUICK_PDF==='1')}){
          (await wait(()=>button('Print PDF'))).click();
          const popup=await wait(()=>document.querySelector('dialog[open][aria-label="PDF Print Preview"]'));
          await wait(()=>popup.querySelector('.preview small')?.textContent?.includes('210 x 297'),'rendered A4 sheet');
          await wait(()=>popup.querySelector('.print-calculation-summary'),'sheet estimate');
          if(![...popup.querySelectorAll('.print-calculation-summary>div')].some(item=>item.querySelector('small')?.textContent==='Physical sheets'&&item.querySelector('strong')?.textContent==='1'))throw Error('Popup did not calculate the physical sheet count');
          if(!popup.querySelector('.quick-pdf-help')?.textContent.includes('1-3, 5'))throw Error('Print example missing');
          for(const label of ['Actual size','Match paper to PDF page size','Page Setup','Landscape']){
            if(!popup.textContent.includes(label))throw Error('Missing PDF print setting: '+label);
          }
          const radios=[...popup.querySelectorAll('.quick-pdf-scale input[type="radio"]')];
          if(radios.length!==4||radios.some(radio=>radio.getBoundingClientRect().width>18))throw Error('PDF scaling buttons are misaligned');
          if(radios.some(radio=>radio.nextElementSibling.getBoundingClientRect().left-radio.getBoundingClientRect().right>12))throw Error('PDF scaling label is separated from its button');
          const submit=popup.querySelector('.print-sticky-actions button[type="submit"]');
          if(!submit||submit.disabled)throw Error('Quick PDF submit disabled');
          if(!submit.form.checkValidity())throw Error([...submit.form.querySelectorAll(':invalid')].map(el=>el.closest('label')?.innerText+' '+el.validationMessage).join(' | '));
          submit.click();
          await wait(()=>popup.innerText.includes('Order created.'),'order confirmation');
          popup.querySelector('button[aria-label="Close details"]').click();
          await wait(()=>!popup.isConnected,'popup close');
        }
        if(!${JSON.stringify(!!scanFixture)})return canvas.width>0&&canvas.height>0;
        const checkScan=(surface,label)=>{
          const pixels=surface.getContext('2d').getImageData(0,0,surface.width,surface.height).data;
          let dark=0;
          for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>200&&pixels[i]<110&&pixels[i+1]<110&&pixels[i+2]<110)dark++;
          if(dark<surface.width*surface.height*.005)throw new Error(label+' scanned page body did not render. Dark pixels: '+dark);
        };
        checkScan(canvas,'Source');
        const snapshot=await window.bloom.call('snapshot',null);
        const file=snapshot.attachments.find(item=>item.name==='smoke-sample.pdf');
        const printSettings={printer:'',paper:'A4',copies:1,colour:false,landscape:false,duplex:'manualLongEdge',range:'',rotation:0,fit:'contain',layout:'single'};
        const id=await window.bloom.call('order',{customer:null,files:[file.id],copies:1,paper:'A4',colour:false,price:0,discount:0,charge:0,printSettings});
        (await wait(()=>document.querySelector('nav button[aria-label="Print Studio"]'))).click();
        const order=await wait(()=>document.querySelector('select[aria-label="Order"]'));
        await wait(()=>[...order.options].some(option=>option.value===id));
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(order,id);
        order.dispatchEvent(new Event('change',{bubbles:true}));
        const sheet=await wait(()=>document.querySelector('.studio-workspace .preview canvas:not([hidden])'));
        checkScan(sheet,'Final sheet');
        if(sheet.getBoundingClientRect().height>sheet.parentElement.clientHeight+1)throw new Error('Fit preview clipped the scanned sheet');
        return true;
      })()`);
      if(!preview)throw new Error('PDF preview smoke assertion failed');
      if(process.env.BLOOMCONNECT_SMOKE_SCANNER==='1'){
        const sharp=(await import('sharp')).default;
        const paths:string[]=[];
        for(const [index,shade] of ['#daca9f','#bdbdbd'].entries()){
          const filename=join(root,'scanner-photo-'+index+'.png');
          const sample=Buffer.from('<svg width="410" height="570"><rect width="410" height="570" fill="#4a423b"/><path d="M55 26 L371 60 L345 543 L39 511 Z" fill="'+shade+'"/><path d="M91 155h207 M91 176h210 M91 195h167 M91 216h212 M91 237h190" stroke="#36342c" stroke-width="4"/><circle cx="263" cy="390" r="26" stroke="#af2639" stroke-width="4" fill="none"/></svg>');
          await writeFile(filename,await sharp(sample).png().toBuffer());paths.push(filename);
        }
        await engine('importLocal',{paths,customer:null});
        await main.loadURL(index);
        const verification=await main.webContents.executeJavaScript(`(async()=>{
          const wait=async(test)=>{for(let i=0;i<180;i++){const value=test();if(value)return value;await new Promise(r=>setTimeout(r,80))}throw Error('Scanner smoke failed: '+document.body.innerText.slice(-1400))};
          const button=(text,root=document)=>[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===text&&!b.disabled);
          (await wait(()=>document.querySelector('nav button[aria-label="Documents"]'))).click();
          for(const i of [0,1])(await wait(()=>document.querySelector('input[aria-label="Select scanner-photo-'+i+'.png"]'))).click();
          (await wait(()=>button('Scan selected photos'))).click();
          const editor=await wait(()=>document.querySelector('dialog[open][aria-label="Document Scanner"]'));
          (await wait(()=>button('Auto Scan Selected',editor))).click();
          await wait(()=>editor.querySelectorAll('.scan-page-row').length===2&&[...editor.querySelectorAll('.scan-page-row')].every(row=>row.innerText.includes('Ready to review')));
          await wait(()=>editor.querySelector('img[alt="Original document photo"]')?.naturalWidth&&editor.querySelector('img[alt="Cleaned document preview"]')?.naturalWidth);
          (await wait(()=>editor.querySelector('button[aria-label="Move page 2 earlier"]'))).click();
          await wait(()=>editor.querySelector('.scan-page-row')?.innerText.includes('scanner-photo-1'));
          (await wait(()=>button('Print All',editor))).click();
          await wait(()=>document.querySelector('main[data-page="Print Studio"]')&&document.body.innerText.includes('Processed scan (2 pages).pdf'));
          const state=await window.bloom.call('snapshot',null);
          if(!state.jobs.some(job=>job.calculations?.some(calc=>calc.settings.documentPages===2)))throw Error('Scanned PDF did not reach order pricing');
          return {beforeAfter:true,processedPages:2,reordered:true,openedPrintStudio:true};
        })()`);
        await writeFile(join(root,'scanner-smoke.json'),JSON.stringify(verification));
      }
      if(process.env.BLOOMCONNECT_SMOKE_PRINT==='1'){
        const source=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
        const fixture=join(root,'advanced-ten-pages.pdf');
        try{
          await source.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<style>@page{size:A4;margin:10mm}body{margin:0}section{height:260mm;break-after:page;font:80px sans-serif}section:last-child{break-after:auto}</style>'+Array.from({length:10},(_,i)=>'<section>Page '+(i+1)+'</section>').join('')));
          await writeFile(fixture,await source.webContents.printToPDF({pageSize:'A4',preferCSSPageSize:true}));
        }finally{source.destroy()}
        await engine('importLocal',{paths:[fixture],customer:null});
        await main.loadURL(index);
        const result=await main.webContents.executeJavaScript(`(async()=>{
          const wait=async(test)=>{for(let i=0;i<200;i++){const result=test();if(result)return result;await new Promise(resolve=>setTimeout(resolve,80))}throw new Error('Advanced studio wait failed: '+document.body.innerText.slice(-2000))};
          const snapshot=await window.bloom.call('snapshot',null);
          const file=snapshot.attachments.find(item=>item.name==='advanced-ten-pages.pdf');
          const printSettings={printer:'',paper:'A4',copies:1,colour:false,landscape:false,duplex:'longEdge',range:'',rotation:0,fit:'contain',layout:'single',nup:2,booklet:false,binding:'left',marginMm:5,gapMm:2,borders:true};
          const id=await window.bloom.call('order',{customer:null,files:[file.id],copies:1,paper:'A4',colour:false,price:0,discount:0,charge:0,printSettings,calculations:[{id:file.id,settings:{documentPages:10,pagesPerSide:2,duplex:'longEdge',pricing:{basis:'sheet',mono:1000,colour:5000}}}]});
          (await wait(()=>[...document.querySelectorAll('nav button')].find(button=>button.getAttribute('aria-label')==='Print Studio'))).click();
          const order=await wait(()=>document.querySelector('select[aria-label="Order"]'));
          await wait(()=>[...order.options].some(option=>option.value===id));
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(order,id);order.dispatchEvent(new Event('change',{bubbles:true}));
          await wait(()=>document.querySelector('.print-calculation-summary'));
          const field=label=>[...document.querySelectorAll('.studio-workspace label')].find(item=>item.textContent.startsWith(label))?.querySelector('select');
          const value=label=>[...document.querySelectorAll('.print-calculation-summary>div')].find(item=>item.querySelector('small')?.textContent===label)?.querySelector('strong')?.textContent;
          await wait(()=>value('Physical sheets')==='3');
          if(value('Selected pages')!=='10')throw new Error('Expected genuine ten-page PDF');
          const nup=field('Pages per side');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(nup,'4');nup.dispatchEvent(new Event('change',{bubbles:true}));
          await wait(()=>value('Physical sheets')==='2');
          const button=(name,root=document)=>[...root.querySelectorAll('button')].find(item=>item.textContent.trim()===name);
          (await wait(()=>button('Advanced'))).click();
          const notes=[...document.querySelectorAll('.studio-workspace label')].find(item=>item.textContent.includes('Three slides with writing lines')).querySelector('input');
          notes.click();
          await wait(()=>value('Physical sheets')==='2'&&field('Pages per side')?.value==='3');
          (await wait(()=>button('Booklet Wizard'))).click();
          const wizard=await wait(()=>document.querySelector('dialog[open][aria-label="Booklet Wizard"]'));
          (await wait(()=>button('Next',wizard))).click();
          (await wait(()=>button('Next',wizard))).click();
          const duplex=await wait(()=>wizard.querySelector('select'));
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(duplex,'shortEdge');duplex.dispatchEvent(new Event('change',{bubbles:true}));
          (await wait(()=>button('Next',wizard))).click();
          (await wait(()=>button('Next',wizard))).click();
          (await wait(()=>button('Apply and preview',wizard))).click();
          await wait(()=>value('Physical sheets')==='3');
          await wait(()=>document.querySelector('.studio-workspace .preview canvas:not([hidden])')&&!document.body.innerText.includes('Rendering final sheet'));
          return {id,file:file.id,selectedPages:value('Selected pages'),sheets:value('Physical sheets'),preview:document.querySelector('.studio-workspace .preview canvas').toDataURL()};
        })()`);
        main.webContents.debugger.attach('1.3');
        await main.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});
        await main.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        await new Promise(resolve=>setTimeout(resolve,250));
        await writeFile(join(root,'advanced-studio-booklet.png'),(await main.capturePage()).toPNG());
        main.webContents.debugger.detach();
        const options=schemas.print.parse({id:result.id,printer:'Smoke only - no submission',paper:'A4',copies:1,colour:false,landscape:true,duplex:'shortEdge',range:'',rotation:0,fit:'contain',layout:'single',nup:2,booklet:true,binding:'left',marginMm:5,gapMm:2,borders:true});
        const printWindow=new BrowserWindow({...windowOptions,show:false,paintWhenInitiallyHidden:true});lock(printWindow);
        try{
          const prepared=new Promise<void>((resolve,reject)=>{
            const timer=setTimeout(()=>reject(new Error('Advanced print preparation timed out.')),60000);
            printViews.set(printWindow.webContents.id,{data:{input:options,files:[{id:result.file}]},ready:error=>{clearTimeout(timer);error?reject(new Error(error)):resolve()}});
          });
          await Promise.all([printWindow.loadURL(index+'?print=1'),prepared]);
          const output=await printWindow.webContents.executeJavaScript(`({sides:document.querySelectorAll('.sheet').length,first:document.querySelector('.sheet canvas').toDataURL()})`);
          if(output.sides!==6)throw new Error('Booklet must prepare six imposed sides.');
          if(output.first!==result.preview)throw new Error('Preview does not match the submitted raster layout.');
          const printers=await main.webContents.getPrintersAsync();
          await writeFile(join(root,'advanced-print-smoke.json'),JSON.stringify({logicalPages:Number(result.selectedPages),physicalSheets:Number(result.sheets),imposedSides:output.sides,previewMatchesPreparedSide:true,threeUpHandoutVerified:true,bookletWizardVerified:true,availablePrinters:printers.map(printer=>printer.name),physicalPrintingExecuted:false}));
        }finally{printViews.delete(printWindow.webContents.id);printWindow.destroy()}
      }

      if(process.env.BLOOMCONNECT_SMOKE_PHOTO==='1'){
        const sharp=(await import('sharp')).default;
        const paths=[];
        for(const [i,background] of ['#c42c46','#176ca4'].entries()){
          const path=join(root,'photo-fixture-'+i+'.png');
          await writeFile(path,await sharp({create:{width:600,height:400,channels:3,background}}).png().toBuffer());paths.push(path);
        }
        await engine('importLocal',{paths,customer:null});
        const snapshot=await engine<{attachments:{id:string;mime:string}[]}>('snapshot',null),photos=snapshot.attachments.filter(a=>a.mime==='image/png');
        const settings=normalizedSettings({printer:'',paper:'A4',copies:1,colour:true,landscape:false,duplex:'simplex',range:'',rotation:0,fit:'contain',layout:'single',marginMm:5,gapMm:2,autoRotate:true,photoBatch:true,photoItems:Object.fromEntries(photos.map((p,i)=>[p.id,{widthMm:i?50.8:101.6,heightMm:i?50.8:152.4,quantity:i?6:2,rotation:0,fit:'contain',brightness:110,contrast:95,saturation:85,sharpness:20,flipX:true,crop:{x:.05,y:.1,width:.9,height:.8}}]))});
        const id=await engine<string>('order',{customer:null,files:photos.map(p=>p.id),copies:1,paper:'A4',colour:true,price:20000,discount:0,charge:0,printSettings:settings});
        await main.loadURL(index);
        const preview=await main.webContents.executeJavaScript(`(async()=>{
          const wait=async(test)=>{for(let i=0;i<250;i++){const result=test();if(result)return result;await new Promise(r=>setTimeout(r,80))}throw new Error('Photo smoke timeout: '+document.body.innerText.slice(-1500))};
          (await wait(()=>[...document.querySelectorAll('nav button')].find(b=>b.getAttribute('aria-label')==='Print Studio'))).click();
          const select=await wait(()=>document.querySelector('select[aria-label="Order"]'));
          await wait(()=>[...select.options].some(o=>o.value===${JSON.stringify(id)}));
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(id)});select.dispatchEvent(new Event('change',{bubbles:true}));
          await wait(()=>document.body.innerText.includes('Customer photo library'));
          const button=text=>[...document.querySelectorAll('.studio-workspace button')].find(b=>b.textContent===text);
          (await wait(()=>button('Deselect'))).click();
          await wait(()=>document.querySelector('.print-calculation-summary').innerText.includes('Requested prints\\n0'));
          (await wait(()=>button('Select All'))).click();
          await wait(()=>document.querySelector('.print-calculation-summary').innerText.includes('Requested prints\\n8'));
          const canvas=await wait(()=>document.querySelector('.studio-workspace .preview canvas:not([hidden])'));
          await wait(()=>!document.body.innerText.includes('Rendering final sheet'));
          const first=canvas.toDataURL(),summary=document.querySelector('.print-calculation-summary').innerText;
          const metric=label=>[...document.querySelectorAll('.print-calculation-summary>div')].find(item=>item.querySelector('small')?.textContent===label)?.querySelector('strong')?.textContent;
          (await wait(()=>button('A4 landscape: 4 photos per side'))).click();
          await wait(()=>!canvas.hidden&&canvas.width>canvas.height&&metric('Physical photo sheets')==='2'&&metric('Printed photo sides')==='2');
          (await wait(()=>button('Full page: 1 photo per side'))).click();
          const sides=await wait(()=>[...document.querySelectorAll('.studio-workspace label')].find(label=>label.textContent.startsWith('Photo printing sides'))?.querySelector('select'));
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(sides,'manualLongEdge');sides.dispatchEvent(new Event('change',{bubbles:true}));
          await wait(()=>!canvas.hidden&&metric('Physical photo sheets')==='4'&&metric('Printed photo sides')==='8'&&document.body.innerText.includes('Sheet 1 / 4 (Front)'));
          (await wait(()=>button('Next'))).click();
          await wait(()=>!canvas.hidden&&document.body.innerText.includes('Sheet 1 / 4 (Back)'));
          return {first,summary,landscapeGridVerified:true,fullPageDuplexVerified:true};
        })()`);
        const win=new BrowserWindow({...windowOptions,show:false,paintWhenInitiallyHidden:true});lock(win);
        try{
          const prepared=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Photo preparation timeout')),60000);printViews.set(win.webContents.id,{data:{input:{id,...settings},files:photos},ready:error=>{clearTimeout(timer);error?reject(new Error(error)):resolve()}})});
          await Promise.all([win.loadURL(index+'?print=1'),prepared]);
          const output=await win.webContents.executeJavaScript(`({first:document.querySelector('.sheet canvas').toDataURL(),sheets:document.querySelectorAll('.sheet').length})`);
          if(output.first!==preview.first)throw new Error('Photo preview and prepared output differ.');
          const exported=await win.webContents.printToPDF({preferCSSPageSize:true,printBackground:true,margins:{top:0,bottom:0,left:0,right:0}});await writeFile(join(root,'photo-prepared.pdf'),exported);
          await writeFile(join(root,'photo-smoke.json'),JSON.stringify({photos:photos.length,requestedPrints:8,sheets:output.sheets,previewMatchesPrepared:true,pdfExported:true,physicalPrintingExecuted:false,summary:preview.summary,landscapeGridVerified:preview.landscapeGridVerified,fullPageDuplexVerified:preview.fullPageDuplexVerified}));
          await writeFile(join(root,'photo-studio.png'),(await main.capturePage()).toPNG());
        }finally{printViews.delete(win.webContents.id);win.destroy()}
      }

      if(process.env.BLOOMCONNECT_SMOKE_VISUAL==='1'){
        await engine('customer',{name:'Visual test customer',phone:'',notes:'',tag:'Sample'});
        const docs=await engine<{attachments:{id:string}[]}>('snapshot',null);
        const order=await engine<string>('order',{customer:null,files:[docs.attachments[0].id],copies:1,paper:'A4',colour:false,price:15000,discount:0,charge:0});
        await engine('payment',{id:order,amount:5000,method:'Cash'});
        await engine('rule',{name:'Visual test reply',trigger:'message',keyword:'',actions:['reply'],text:'Thank you for your message.',enabled:false,graph:''});
        await main.loadURL(index);
        const devtools=main.webContents.debugger;
        devtools.attach('1.3');
        await devtools.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
        async function capture(name:string){
          await writeFile(join(root,'visual-progress.txt'),name);
          const screenshot=await main.capturePage();
          if(screenshot.isEmpty())throw new Error('Desktop screenshot was empty: '+name);
          await writeFile(join(root,name+'.png'),screenshot.toPNG());
        }
        const size=(width:number,height:number)=>devtools.sendCommand('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        const routes=['Dashboard','WhatsApp Inbox','Customers','Documents','Automation Engine','Workflow Builder','Auto Replies','Engine Logs','Print Studio','Print Queue','Orders','Print History','Payments','Reports','Settings','Backup'];
        async function navigate(route:string){
          return main.webContents.executeJavaScript(`(async()=>{
            const route=${JSON.stringify(route)};
            for(let i=0;i<120;i++){
              const action=[...document.querySelectorAll('nav[aria-label="Workspace"] button')].find(button=>button.getAttribute('aria-label')===route);
              if(action){action.click();break}
              await new Promise(resolve=>setTimeout(resolve,80));
            }
            for(let i=0;i<100;i++){
              const heading=document.querySelector('main h1');
              if(heading?.textContent===route&&document.querySelector('.page-surface > *'))break;
              await new Promise(resolve=>setTimeout(resolve,60));
            }
            const shell=document.querySelector('.workspace');
            if(document.querySelector('main h1')?.textContent!==route||!shell)throw new Error('Page did not render: '+route);
            if(shell.scrollWidth-shell.clientWidth>3)throw new Error('Page overflows the workspace: '+route);
            if(!document.fonts.check('400 13px "Inter Variable"'))await document.fonts.ready;
          })()`);
        }
        try{
          await size(1366,768);
          for(const route of routes){
            await navigate(route);
            await capture('1366-'+route.toLowerCase().replaceAll(' ','-'));
            await main.webContents.executeJavaScript(`(async()=>{
              const route=${JSON.stringify(route)};
              const checks={'Customers':['Visual test customer','dialog[open]'], 'Orders':[${JSON.stringify(order)},'dialog[open]'],'Payments':['Preview','dialog[open]'],'Print Queue':['Board','.queue-lanes'],'Print Studio':['smoke-sample.pdf','.preview canvas:not([hidden])'],'Workflow Builder':['Visual mode','.react-flow'],'Auto Replies':['Visual test reply','.reply-preview'],'Settings':['Print Pricing','input[type=number]']};
              const check=checks[route];if(!check)return;
              if(route==='Workflow Builder'){
                for(const label of ['Next: Actions','Next: Review']){
                  const next=[...document.querySelectorAll('main button')].find(button=>button.textContent.trim()===label);
                  if(!next)throw new Error('Workflow wizard step did not render.');
                  next.click();await new Promise(resolve=>setTimeout(resolve,70));
                }
              }
              const button=[...document.querySelectorAll('main button')].find(button=>route==='Customers'?button.textContent.trim().endsWith(check[0]):button.textContent.trim()===check[0]);
              if(!button)throw new Error('Control missing: '+route+' '+check[0]);
              button.click();
              for(let i=0;i<75&&!document.querySelector(check[1]);i++)await new Promise(resolve=>setTimeout(resolve,40));
              if(!document.querySelector(check[1]))throw new Error('Control did not open: '+route+' '+check[0]);
              document.querySelector('dialog[open] button[aria-label="Close details"]')?.click();
            })()`);
            if(['Workflow Builder','Print Studio','Auto Replies'].includes(route))await capture('1366-'+route.toLowerCase().replaceAll(' ','-')+'-detail');
          }
          await size(1440,900);await navigate('Documents');await capture('1440-documents');
          await size(1920,1080);await navigate('Dashboard');
          await main.webContents.executeJavaScript(`(async()=>{
            document.querySelector('button[aria-label="Collapse sidebar"]').click();
            document.querySelector('button[aria-label="Toggle theme"]').click();
            for(let i=0;i<60;i++){
              if(document.querySelector('.app-shell').dataset.collapsed==='true'&&document.documentElement.dataset.theme==='dark')return;
              await new Promise(resolve=>setTimeout(resolve,40));
            }
            throw new Error('Sidebar or theme toggle did not update.');
          })()`);
          await capture('1920-dashboard-dark');
          await main.webContents.executeJavaScript(`(async()=>{
            const language=document.querySelector('select[aria-label="Language"]');
            language.value='si';language.dispatchEvent(new Event('change',{bubbles:true}));
            for(let i=0;i<100;i++){
              if(document.querySelector('main h1')?.textContent==='මුල් පිටුව'){await document.fonts.ready;return}
              await new Promise(resolve=>setTimeout(resolve,60));
            }
            throw new Error('The Sinhala navigation did not render.');
          })()`);
          await capture('1920-sinhala');
        }finally{devtools.detach()}
        await writeFile(join(root,'visual.json'),JSON.stringify({routes:routes.length,resolutions:[1366,1440,1920],dark:true,sinhala:true}));
      }
      await writeFile(join(root,'smoke.json'),JSON.stringify({persistedBeforeRun:!!snapshot.settings,rendered,pdfPreview:preview,setup:true}));app.exit(0);
    }catch(error){await writeFile(join(root,'smoke-error.txt'),String(error));app.exit(1)}
  }
}).catch(async error=>{
  if(process.env.BLOOMCONNECT_SMOKE_DIR)await writeFile(join(process.env.BLOOMCONNECT_SMOKE_DIR,'smoke-error.txt'),String(error)).catch(()=>{});
  else dialog.showErrorBox('BloomConnect could not start',error instanceof Error?error.message:'Application startup failed.');
  app.exit(1);
});
app.on('second-instance',()=>{if(startupSplash&&!startupSplash.isDestroyed()&&startupSplash.isVisible()){startupSplash.focus();return}if(main&&!main.isDestroyed()){if(main.isMinimized())main.restore();main.focus()}});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{stopping=true;if(child?.connected)child.disconnect()});
