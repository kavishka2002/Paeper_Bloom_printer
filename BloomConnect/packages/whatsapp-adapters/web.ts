import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Client, LocalAuth, type Chat, type Contact, type Message} from 'whatsapp-web.js';
import QRCode from 'qrcode';
import {launch,type Browser,type ConsoleMessage,type HTTPRequest,type Page} from 'puppeteer-core';
import {installWhatsAppAuthStateFallback,whatsappAccountIsReadyFromPage,whatsappAuthStateFromPage} from './auth-state';
import {collect} from './cloud';
export {whatsappAuthStateFromPage} from './auth-state';

export type WebMessage={id:string;phone:string;name:string;kind:string;text:string;created:string;chat?:string;outgoing?:boolean;file?:{remote:string;name:string}};
type Identity={chat:string;phone:string;name:string};
type QRInfo={clientId:string;generatedAt:string};
type Callbacks={
  qrPending:(info:QRInfo)=>void;
  qr:(image:string,info:QRInfo)=>void;
  qrExpired:(info:QRInfo)=>void;
  authenticated:()=>void;
  ready:(account:string,phone:string)=>void;
  offline:(reason:string,retry?:boolean)=>void;
  progress:(status:string)=>void;
  diagnostic:(event:string,detail:string)=>void;
  message:(message:WebMessage)=>void;
  ack:(id:string,status:string)=>void;
};
const QR_DISPLAY_LIFETIME_MS=30_000;
async function historyWithin<T>(request:Promise<T>,ms=8_000):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    return await Promise.race([request,new Promise<never>((_,reject)=>{
      timer=setTimeout(()=>reject(new Error('WhatsApp history request timed out.')),ms);
    })]);
  }finally{clearTimeout(timer)}
}
function safeErrorText(value:string,limit:number){
  return value
    .replace(/https?:\/\/[^\s?#,]+(?:\?[^\s,]*)?/g,'[url]')
    .replace(/[A-Za-z0-9+/_=-]{40,}/g,'[redacted]')
    .replace(/[\r\n\t]+/g,' ').slice(0,limit);
}
function errorDetail(error:unknown){
  return safeErrorText(error instanceof Error?error.message:String(error),240);
}
function errorStack(error:unknown){
  const stack=error instanceof Error?error.stack:undefined;
  return safeErrorText(stack??String(error),1200);
}
function expectedBrowserRevision(){
  const revisions=Reflect.get(require('puppeteer-core'),'PUPPETEER_REVISIONS');
  if(typeof revisions!=='object'||revisions===null)return undefined;
  const chrome=Reflect.get(revisions,'chrome');
  return typeof chrome==='string'?chrome:undefined;
}
export function phoneFromChat(chat:string){
  return /^([1-9]\d{6,14})@(?:c\.us|s\.whatsapp\.net)$/.exec(chat)?.[1]??'';
}
function findBrowser(){
  const configured=process.env.BLOOMCONNECT_CHROME_PATH;
  if(configured){
    if(!existsSync(configured))throw new Error('Configured Chromium executable was not found.');
    return configured;
  }
  const bases=[process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.LOCALAPPDATA];
  const locations=bases.filter((base):base is string=>Boolean(base));
  const paths=[
    ...locations.map(base=>join(base,'Google','Chrome','Application','chrome.exe')),
    ...locations.map(base=>join(base,'Microsoft','Edge','Application','msedge.exe')),
    ...locations.map(base=>join(base,'Chromium','Application','chrome.exe'))
  ];
  const browser=paths.find(path=>existsSync(path));
  if(!browser)throw new Error('Install Microsoft Edge or Google Chrome and try again.');
  return browser;
}

export function isWhatsAppSystemMessage(kind:string){
  return ['notification','notification_template','e2e_notification','gp2','protocol','revoked'].includes(kind);
}

export class WebAdapter {
  private client?:Client;
  private readonly profile:string;
  private browser?:Browser;
  private readonly auth:LocalAuth;
  private readonly clientId=randomUUID();
  private stopped=false;
  private startPromise?:Promise<void>;
  private stopPromise?:Promise<{warning?:string}|undefined>;
  private logoutRequested=false;
  private sessionCleared=false;
  private stoppedWithAuthenticatedSession=false;
  private browserClosePromise?:Promise<void>;
  private authenticated=false;
  private hasBeenReady=false;
  private readySessionAtStop=false;
  private startupStage='browser launch';
  private startupTimer?:ReturnType<typeof setTimeout>;
  private qrWaitTimer?:ReturnType<typeof setTimeout>;
  private qrExpiryTimer?:ReturnType<typeof setTimeout>;
  private authStatePoll?:ReturnType<typeof setInterval>;
  private authStateInFlight=false;
  private activeInject?:Promise<void>;
  private readonly pageDisposers:Array<()=>void>=[];
  private monitoredPage?:Page;
  private stopQrTimers(){
    clearTimeout(this.qrWaitTimer);
    clearTimeout(this.qrExpiryTimer);
    this.qrWaitTimer=undefined;
    this.qrExpiryTimer=undefined;
  }
  private stopAuthStateWatch(){
    if(this.authStatePoll)clearInterval(this.authStatePoll);
    this.authStatePoll=undefined;
  }
  private async runInject(inject:()=>Promise<void>){
    if(this.activeInject)return this.activeInject;
    const active=inject();
    this.activeInject=active;
    try{await active}finally{if(this.activeInject===active)this.activeInject=undefined}
  }
  private monitorPage(page:Page){
    if(this.monitoredPage===page)return;
    this.monitoredPage=page;
    const waitForFunction=page.waitForFunction.bind(page);
    page.waitForFunction=(async(...args:Parameters<Page['waitForFunction']>)=>{
      const predicate=args[0];
      const source=typeof predicate==='string'?predicate:predicate.toString();
      if(source.includes('Debug')&&source.includes('VERSION')){
        this.startupStage='WhatsApp Web readiness wait (window.Debug.VERSION)';
      }else if(source.includes('WAWebSocketModel')&&source.includes('Socket')&&source.includes('state')){
        this.startupStage='WhatsApp authentication-state wait (WAWebSocketModel.Socket.state)';
      }else if(source.includes('WWebJS')){
        this.startupStage='WhatsApp utility-injection readiness wait (window.WWebJS)';
      }
      const options=args[1];
      const timeout=typeof options==='object'&&options!==null?Reflect.get(options,'timeout'):undefined;
      this.callbacks.diagnostic('WhatsApp wait started',`Client ${this.clientId}; ${this.startupStage}${typeof timeout==='number'?`; timeout ${timeout} ms`:''}`);
      try{return await waitForFunction(...args)}catch(error){
        this.callbacks.diagnostic('WhatsApp wait failed',`Client ${this.clientId}; stage ${this.startupStage}; ${errorStack(error)}`);
        throw error;
      }
    }) as Page['waitForFunction'];
    const onConsole=(message:ConsoleMessage)=>{
      if(message.type()==='error')this.callbacks.diagnostic('Browser console error',errorDetail(message.text()));
    };
    const onPageError=(error:unknown)=>this.callbacks.diagnostic('WhatsApp page error',errorDetail(error));
    const onRequestFailed=(failedRequest:HTTPRequest)=>{
      let host='';
      try{host=new URL(failedRequest.url()).hostname}catch{}
      if(host==='web.whatsapp.com'){
        this.callbacks.diagnostic('WhatsApp request failed',`${failedRequest.resourceType()}; ${errorDetail(failedRequest.failure()?.errorText??'Network request failed')}`);
      }
    };
    page.on('console',onConsole);
    page.on('pageerror',onPageError);
    page.on('requestfailed',onRequestFailed);
    this.pageDisposers.push(
      ()=>page.off('console',onConsole),
      ()=>page.off('pageerror',onPageError),
      ()=>page.off('requestfailed',onRequestFailed)
    );
  }
  private clearPageMonitors(){
    for(const dispose of this.pageDisposers.splice(0))dispose();
    this.monitoredPage=undefined;
  }
  private async closeBrowserOnce(){
    if(this.browserClosePromise)return this.browserClosePromise;
    const browser=this.browser;
    if(!browser?.isConnected())return;
    const closing=browser.close();
    this.browserClosePromise=closing;
    try{await closing}finally{if(this.browserClosePromise===closing)this.browserClosePromise=undefined}
  }
  private watchAuthState(page:Page,inject:()=>Promise<void>){
    if(this.authStatePoll)return;
    const reportFailure=(error:unknown)=>{
      if(this.stopped||this.ready||!this.authStatePoll)return;
      this.stopAuthStateWatch();
      const reason=errorDetail(error);
      this.callbacks.diagnostic('Authentication recovery failed',`Client ${this.clientId}; ${reason}`);
      this.callbacks.offline('WhatsApp authenticated, but BloomConnect could not finish initializing: '+reason);
    };
    const poll=async()=>{
      if(this.stopped||this.ready||this.authStateInFlight||!this.authStatePoll)return;
      this.authStateInFlight=true;
      try{
        if(!await page.evaluate(whatsappAccountIsReadyFromPage)||this.stopped||this.ready||!this.authStatePoll)return;
        const installed=await page.evaluate(()=>typeof (window as Window&{onAppStateHasSyncedEvent?:()=>Promise<unknown>}).onAppStateHasSyncedEvent==='function');
        if(!installed)await this.runInject(inject);
        await page.evaluate(async()=>{
          const callback=(window as Window&{onAppStateHasSyncedEvent?:()=>Promise<unknown>}).onAppStateHasSyncedEvent;
          if(typeof callback!=='function')throw new Error('WhatsApp did not expose its account-sync callback.');
          await callback();
        });
      }catch(error){
        reportFailure(error);
      }finally{this.authStateInFlight=false}
    };
    this.authStatePoll=setInterval(()=>{void poll().catch(reportFailure)},500);
    void poll().catch(reportFailure);
  }
  private watchStartup(){
    clearTimeout(this.startupTimer);
    this.startupTimer=setTimeout(()=>{
      if(!this.stopped&&!this.ready){
        this.callbacks.diagnostic('Engine startup timed out',`Client ${this.clientId}; stage ${this.startupStage}`);
        this.callbacks.offline('WhatsApp Web did not finish starting. Retry the connection or view the error details.');
      }
    },90_000);
  }
  private ready=false;
  private qrGeneration=0;
  private expiredQrGeneration=0;
  private readonly incoming=new Map<string,Message>();
  private readonly chats=new Map<string,string>();
  account='';
  constructor(root:string, private readonly callbacks:Callbacks){
    const dataPath=join(root,'whatsapp-web');
    this.profile=join(dataPath,'session');
    this.auth=new LocalAuth({dataPath});
  }
  private createClient(browser:Browser){
    const callbacks=this.callbacks;
    const client=new Client({
      authStrategy:this.auth,
      authTimeoutMs:60_000,
      puppeteer:{browserWSEndpoint:browser.wsEndpoint()},
      // The upstream runtime accepts false to retain the browser's native identity.
      userAgent:false as unknown as string,

      webVersionCache:{type:'none'},
      takeoverOnConflict:false
    });
    const afterBrowserInitialized=this.auth.afterBrowserInitialized.bind(this.auth);
    this.auth.afterBrowserInitialized=async()=>{
      await afterBrowserInitialized();
      const page=client.pupPage;
      if(!page)return;
      const goto=page.goto;
      // The linking UI and app runtime can start before background resources finish loading.
      page.goto=async(url,options)=>{
        page.goto=goto;
        if(!/^https:\/\/web\.whatsapp\.com\/?$/.test(url))return goto.call(page,url,options);
        const result=await goto.call(page,url,{...options,waitUntil:'domcontentloaded',timeout:40_000});
        const ready=await page.waitForFunction(()=>{
          const app=window as Window&{Debug?:{VERSION?:string};require?:unknown};
          return /^\/login\/?$/.test(location.pathname)||Boolean(app.Debug?.VERSION&&typeof app.require==='function');
        },{timeout:35_000});
        await ready.dispose();
        return result;
      };
    };
    client.on('qr',raw=>{
      if(this.stopped||this.ready||this.authenticated)return;
      if(typeof raw!=='string'||raw.length===0){
        this.callbacks.offline('WhatsApp supplied an empty QR payload. Restart WhatsApp Engine and try again.');
        return;
      }
      this.publishQr(QRCode.toDataURL(raw,{
        width:400,
        margin:4,
        errorCorrectionLevel:'M',
        color:{dark:'#000000',light:'#FFFFFF'}
      }));
    });
    this.attachClientEvents(client);
    return client;
  }
  private publishQr(rendered:Promise<string>,source:'event'|'login page'='event'){
    const callbacks=this.callbacks;
    this.stopQrTimers();
    clearTimeout(this.startupTimer);
    this.ready=false;
    const generation=++this.qrGeneration;
    const info:QRInfo={clientId:this.clientId,generatedAt:new Date().toISOString()};
    const testLifetime=Number(process.env.BLOOMCONNECT_TEST_QR_TTL_MS);
    const lifetime=Number.isFinite(testLifetime)&&testLifetime>0?testLifetime:QR_DISPLAY_LIFETIME_MS;
    const expiresAt=Date.now()+lifetime;
    callbacks.qrPending(info);
    callbacks.diagnostic(source==='event'?'QR event received':'QR read from WhatsApp login page',`Client ${this.clientId}; generated ${info.generatedAt}`);
    this.qrExpiryTimer=setTimeout(()=>{
      if(this.stopped||this.ready||generation!==this.qrGeneration)return;
      this.expiredQrGeneration=generation;
      callbacks.qrExpired(info);
      callbacks.diagnostic('QR expired',`Client ${this.clientId}; generated ${info.generatedAt}`);
    },lifetime);
    void rendered.then(image=>{
      if(!this.stopped&&!this.ready&&generation===this.qrGeneration&&generation!==this.expiredQrGeneration&&Date.now()<expiresAt){
        callbacks.qr(image,info);
        callbacks.diagnostic('QR generated',`Client ${this.clientId}; ${info.generatedAt}`);
        callbacks.diagnostic('QR last updated',`Client ${this.clientId}; ${info.generatedAt}`);
      }
    }).catch(error=>{
      if(this.stopped||generation!==this.qrGeneration)return;
      this.stopQrTimers();
      this.qrGeneration++;
      const detail=errorDetail(error);
      callbacks.diagnostic('QR rendering failed',`Client ${this.clientId}; ${detail}`);
      callbacks.offline('WhatsApp provided a QR code that BloomConnect could not render. Restart WhatsApp Engine and try again.');
    });
  }
  private attachClientEvents(client:Client){
    const callbacks=this.callbacks;
    client.on('authenticated',()=>{
      // WhatsApp Web can emit an extra sync/authenticated event after ready.
      if(this.stopped||this.ready||this.authenticated)return;
      this.stopQrTimers();
      this.stopAuthStateWatch();
      this.watchStartup();
      this.qrGeneration++;
      this.authenticated=true;
      callbacks.diagnostic('Authentication started',`Client ${this.clientId}`);
      callbacks.authenticated();
    });
    client.on('ready',()=>{
      const chat=client.info?.wid?._serialized;
      if(!chat||this.stopped||this.ready)return;
      clearTimeout(this.startupTimer);
      this.stopQrTimers();
      this.stopAuthStateWatch();
      this.qrGeneration++;
      this.ready=true;
      this.authenticated=true;
      this.hasBeenReady=true;
      this.account='web:'+chat;
      callbacks.diagnostic('Client ready',`Client ${this.clientId}`);
      callbacks.diagnostic('Connected account',phoneFromChat(chat)||'Phone number unavailable');
      callbacks.ready(this.account,phoneFromChat(chat));
    });
    client.on('auth_failure',()=>{
      clearTimeout(this.startupTimer);
      this.stopQrTimers();
      this.stopAuthStateWatch();
      this.ready=false;this.authenticated=false;this.qrGeneration++;
      if(!this.stopped){
        callbacks.diagnostic('Authentication failed',`Client ${this.clientId}`);
        callbacks.offline('WhatsApp Web authentication failed. Reconnect and scan a fresh QR code.');
      }
    });
    client.on('disconnected',()=>{
      const shouldRetry=this.hasBeenReady;
      this.hasBeenReady=false;
      clearTimeout(this.startupTimer);
      this.stopQrTimers();
      this.stopAuthStateWatch();
      this.ready=false;this.authenticated=false;this.qrGeneration++;
      if(!this.stopped){
        callbacks.diagnostic('Client disconnected',`Client ${this.clientId}`);
        callbacks.offline('The linked device went offline. Reconnect or link it again.',shouldRetry);
      }
    });
    const capture=(msg:Message,outgoing=false)=>{
      if(!this.ready||this.stopped)return;
      void this.captureIncoming(msg,outgoing).catch(error=>callbacks.diagnostic('Message capture failed',errorDetail(error)));
    };
    client.on('message',msg=>capture(msg));
    client.on('message_create',msg=>{
      if(msg.fromMe)capture(msg,true);
    });
    client.on('message_ack',(message,ack)=>{
      if(this.ready&&message.fromMe&&message.id?._serialized){
        const state=ack===-1?'failed':ack>=3?'read':ack===2?'delivered':ack===1?'sent':'';
        if(state)callbacks.ack(message.id._serialized,state);
      }
    });
  }
  private async waitForQrLogin(page:Page){
    let previous='';
    while(!this.stopped){
      // WhatsApp serves its native linking UI separately from the signed-in client.
      const result=await page.evaluate(()=>{
        if(location.origin!=='https://web.whatsapp.com'||!/^\/login\/?$/.test(location.pathname))return null;
        const canvas=document.querySelector<HTMLCanvasElement>('canvas[aria-label="Scan this QR code to link a device"]');
        if(!canvas?.width||!canvas.height||!canvas.getClientRects().length)return '';
        const image=document.createElement('canvas');
        const margin=24;
        image.width=canvas.width+margin*2;
        image.height=canvas.height+margin*2;
        const context=image.getContext('2d');
        if(!context)return '';
        context.fillStyle='#fff';
        context.fillRect(0,0,image.width,image.height);
        context.drawImage(canvas,margin,margin);
        return image.toDataURL('image/png');
      }).catch((error:unknown)=>{
        if(this.stopped||/Execution context was destroyed|Cannot find context with specified id/.test(String(error)))return undefined;
        throw error;
      });
      if(this.stopped)return;
      if(result===null){
        if(previous){
          this.stopQrTimers();
          this.qrGeneration++;
          this.callbacks.authenticated();
          this.watchStartup();
        }
        return;
      }
      if(result&&result!==previous){
        previous=result;
        this.publishQr(Promise.resolve(result),'login page');
      }
      await new Promise(resolve=>setTimeout(resolve,250));
    }
  }
  private supportCurrentQrLogin(client:Client){
    const compatibleClient=client as Client&{inject:()=>Promise<void>};
    const inject=compatibleClient.inject.bind(client);
    let login:Promise<void>|undefined;
    const injectClient=async(page:Page)=>{
      this.startupStage='WhatsApp auth-state compatibility setup';
      if(!await page.evaluate(installWhatsAppAuthStateFallback)){
        throw new Error('WhatsApp Web did not expose the QR login state.');
      }
      const state=await page.evaluate(whatsappAuthStateFromPage);
      this.callbacks.diagnostic('Authentication state',`Client ${this.clientId}; ${state===false?'unavailable':state.state}`);
      this.callbacks.progress('Checking Authentication');
      this.startupStage='WhatsApp client injection and authentication-state wait';
      await this.runInject(inject);
      this.watchAuthState(page,inject);
    };
    compatibleClient.inject=async()=>{
      if(this.stopped||login)return;
      const page:Page|undefined=client.pupPage;
      if(!page)throw new Error('WhatsApp Web did not open a browser page.');
      this.monitorPage(page);
      this.callbacks.progress('WhatsApp Web Loaded');
      this.callbacks.diagnostic('WhatsApp Web loaded',`Client ${this.clientId}`);
      if(!/^https:\/\/web\.whatsapp\.com\/login\/?(?:[?#]|$)/.test(page.url?.()??'')){
        await injectClient(page);
        return;
      }
      this.startupStage='WhatsApp Web QR login';
      login=(async()=>{
        await this.waitForQrLogin(page);
        if(this.stopped)return;
        await page.waitForFunction(()=>Boolean((window as Window&{Debug?:{VERSION?:string}}).Debug?.VERSION),{timeout:60_000});
        if(!this.stopped)await injectClient(page);
      })().catch(error=>{
        if(this.stopped)return;
        this.callbacks.diagnostic('QR login failed',errorStack(error));
        this.callbacks.offline('WhatsApp Web could not finish linking: '+errorDetail(error));
      }).finally(()=>{login=undefined});
    };
    this.startupStage='WhatsApp Web navigation';
    return client.initialize();
  }
  start(){
    if(this.stopped)return Promise.reject(new Error('This WhatsApp client has already been stopped.'));
    if(this.startPromise)return this.startPromise;
    this.startPromise=this.startClient();
    return this.startPromise;
  }
  private async startClient(){
    this.watchStartup();
    try{
      this.startupStage='browser launch';
      const executablePath=findBrowser();
      this.browser=await launch({
        executablePath,
        userDataDir:this.profile,
        headless:true,
        timeout:30000,
        protocolTimeout:120000,
        args:[
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--window-size=1280,800'
        ]
      });
      if(this.stopped)return;
      this.startupStage='browser handshake';
      this.callbacks.diagnostic('Browser executable',executablePath);
      const browserVersion=await this.browser.version();
      if(this.stopped)return;
      const browserMajor=/Chrome\/(\d+)\./.exec(browserVersion)?.[1];
      const expectedRevision=expectedBrowserRevision();
      const puppeteerMajor=/^(\d+)\./.exec(expectedRevision??'')?.[1];
      if(browserMajor&&puppeteerMajor&&browserMajor!==puppeteerMajor){
        this.callbacks.diagnostic('Browser compatibility warning',`Detected Chrome ${browserVersion}; Puppeteer expects Chrome ${expectedRevision}.`);
      }
      this.callbacks.progress('Browser Started');
      this.callbacks.diagnostic('Browser started',`Client ${this.clientId}; ${browserVersion}`);
      this.callbacks.diagnostic('Engine started',`Client ${this.clientId}; ${browserVersion}`);
      this.client=this.createClient(this.browser);
      this.browser.on?.('disconnected',()=>{
        if(!this.stopped){
          const shouldRetry=this.hasBeenReady;
          this.hasBeenReady=false;
          this.ready=false;
          this.authenticated=false;
          clearTimeout(this.startupTimer);
          this.stopQrTimers();
          this.qrGeneration++;
          this.callbacks.diagnostic('Browser disconnected',`Client ${this.clientId}`);
          this.callbacks.offline('WhatsApp browser closed. Restart WhatsApp Engine to reconnect.',shouldRetry);
        }
      });
      this.startupStage='WhatsApp Web navigation';
      await this.supportCurrentQrLogin(this.client);
      if(!this.stopped&&!this.ready&&this.qrGeneration===0){
        this.qrWaitTimer=setTimeout(()=>{
          if(this.stopped||this.ready||this.qrGeneration!==0)return;
          this.callbacks.diagnostic('QR event timeout',`Client ${this.clientId}; no fresh QR event arrived`);
          this.callbacks.offline('WhatsApp Web did not provide a fresh QR event. Restart WhatsApp Engine and view the connection error.');
        },20_000);
      }
      this.callbacks.diagnostic('Engine initialized',`Client ${this.clientId}`);
    }catch(error){
      if(!this.stopped){
        const trace=errorStack(error);
        this.callbacks.diagnostic('Engine initialization failed',`Stage ${this.startupStage}; Client ${this.clientId}; ${trace}`);
        throw new Error(`WhatsApp Web ${this.startupStage} failed: ${errorDetail(error)}`);
      }
      throw error;
    }finally{
      if(this.stopped)await this.closeBrowserOnce();
    }
  }
  private isDirect(chat:string){return /^\d+@(?:c\.us|lid|s\.whatsapp\.net)$/.test(chat)}
  private async identity(chat:string,contact?:Contact,name?:string):Promise<Identity>{
    let phone=phoneFromChat(chat)||phoneFromChat(contact?.id?._serialized??'');
    if(!phone&&chat.endsWith('@lid')){
      const [match]=await historyWithin(this.client!.getContactLidAndPhone([chat]),3_000).catch(()=>[]);
      phone=phoneFromChat(match?.pn??'');
    }
    if(phone)this.chats.set(phone,chat);
    return {chat,phone,name:contact?.name||contact?.pushname||name||phone||'WhatsApp contact'};
  }
  private async captureIncoming(msg:Message,outgoing=false){
    const chat=outgoing?msg.to:msg.from;
    if(msg.fromMe!==outgoing||!this.isDirect(chat))return;
    const contact=await historyWithin(outgoing?this.client!.getContactById(chat):msg.getContact(),3_000).catch(()=>undefined);
    const info=this.normalize(msg,await this.identity(chat,contact),outgoing);
    if(info&&!this.stopped&&this.ready)this.callbacks.message(info);
  }
  private normalize(msg:Message,identity:Identity,historical=false):WebMessage|undefined{
    if(!msg.id?._serialized||!Number.isFinite(msg.timestamp)||Math.abs(msg.timestamp)>9_999_999_999)return;
    const id=msg.id._serialized;
    const kind=String(msg.type);
    if(isWhatsAppSystemMessage(kind))return;
    const rawName=(msg.rawData as {filename?:unknown}|undefined)?.filename;
    const file=(kind==='image'||kind==='document')&&(msg.hasMedia||historical)
      ?{remote:id,name:typeof rawName==='string'&&rawName?rawName:kind==='image'?'WhatsApp image':'WhatsApp document'}:undefined;
    if(file&&msg.hasMedia){
      this.incoming.set(id,msg);
      if(this.incoming.size>250)this.incoming.delete(this.incoming.keys().next().value!);
    }
    return {...identity,id,kind,text:file&&!msg.hasMedia?'':msg.body??'',created:new Date(msg.timestamp*1000).toISOString(),outgoing:msg.fromMe,file};
  }
  private async fetchHistory(chat:Chat,limit:number){
    let partial=false;
    let messages=await historyWithin(chat.fetchMessages({limit})).catch(()=>{
      partial=true;
      return historyWithin(chat.fetchMessages({}),3_000).catch(()=>[] as Message[]);
    });
    if(!messages.length&&chat.lastMessage)messages=[chat.lastMessage];
    return {messages,partial};
  }
  async syncChat(knownChats:string[],phone:string){
    if(!this.ready||this.stopped)throw new Error('Connect WhatsApp Web before loading documents.');
    const client=this.client!;
    const candidates=[...knownChats];
    const mapped=phone?this.chats.get(phone):undefined;
    if(mapped)candidates.push(mapped);
    if(phone)candidates.push(phone+'@c.us');
    for(const id of new Set(candidates)){
      if(!this.isDirect(id))continue;
      const chat=await historyWithin(client.getChatById(id),3_000).catch(()=>undefined);
      if(!chat||chat.isGroup)continue;
      const contact=await historyWithin(chat.getContact(),3_000).catch(()=>undefined);
      const identity=await this.identity(chat.id._serialized,contact,chat.name);
      const {messages,partial}=await this.fetchHistory(chat,200);
      const normalized=messages.flatMap(message=>{
        const result=this.normalize(message,identity,true);
        return result?[result]:[];
      });
      return {messages:normalized,partial};
    }
    throw new Error('WhatsApp Web could not find this chat. Open it on your phone and retry.');
  }
  async syncHistory(consume:(messages:WebMessage[])=>void,isSaved?:(id:string)=>boolean){
    if(!this.ready||this.stopped)throw new Error('Link WhatsApp Web before syncing chats.');
    const chats=(await historyWithin(this.client!.getChats())).filter(chat=>!chat.isGroup&&this.isDirect(chat.id._serialized))
      .sort((a,b)=>(b.timestamp??0)-(a.timestamp??0)).slice(0,30);
    let failed=0;
    let imported=0;
    const sync=async(chat:Chat)=>{
      if(!this.ready||this.stopped)throw new Error('WhatsApp Web disconnected during chat sync.');
      const latest=chat.lastMessage?.id?._serialized;
      if(latest&&isSaved?.(latest)){
        imported++;
        return;
      }
      const [contact,{messages:history,partial}]=await Promise.all([
        historyWithin(chat.getContact(),3_000).catch(()=>undefined),
        this.fetchHistory(chat,20)
      ]);
      const identity=await this.identity(chat.id._serialized,contact,chat.name);
      if(partial)failed++;
      const messages=history.flatMap(message=>{
        const normalized=this.normalize(message,identity,true);
        return normalized?[normalized]:[];
      });
      if(this.ready&&!this.stopped&&messages.length){
        consume(messages);
        imported+=messages.length;
      }
    };
    for(let i=0;i<chats.length;i+=4)await Promise.all(chats.slice(i,i+4).map(sync));
    return {chats:chats.length,failed,imported};
  }
  async download(id:string){
    if(!this.ready)throw new Error('WhatsApp Web is offline.');
    const msg=this.incoming.get(id)??await this.client!.getMessageById(id);
    if(!msg?.hasMedia)throw new Error('WhatsApp Web no longer has this attachment.');
    const media=await msg.downloadMediaStream();
    if(!media)throw new Error('WhatsApp Web did not return the attachment.');
    return collect(media.stream,32*1024*1024);
  }
  async send(phone:string,text:string,knownChat?:string){
    if(!this.ready)throw new Error('WhatsApp Web is offline.');
    const chat=this.chats.get(phone)||(knownChat&&this.isDirect(knownChat)?knownChat:undefined)
      ||(phone?(await this.client!.getNumberId(phone))?._serialized:undefined);
    if(!chat)throw new Error('The customer’s WhatsApp chat could not be resolved.');
    const message=await this.client!.sendMessage(chat,text,{sendSeen:false});
    if(!message?.id?._serialized)throw new Error('WhatsApp Web did not confirm the message.');
    return message.id._serialized;
  }
  async stop(logout=false){
    if(logout)this.logoutRequested=true;
    if(this.stopPromise){
      try{
        const result=await this.stopPromise;
        if(logout&&!this.sessionCleared){
          this.callbacks.diagnostic('Remote logout unavailable',`Client ${this.clientId}; browser was already stopped`);
          if(this.browser?.isConnected())throw new Error('Cannot clear the WhatsApp authentication session while its browser is still running.');
          await this.auth.logout();
          this.sessionCleared=true;
          if(this.stoppedWithAuthenticatedSession){
            return {warning:'The local session was cleared, but WhatsApp did not confirm remote logout. Remove BloomConnect from Linked devices on your phone if it still appears there.'};
          }
        }
        return result;
      }catch(error){
        if(!logout)throw error;
        this.callbacks.diagnostic('Engine cleanup retry',`Client ${this.clientId}; ${errorDetail(error)}`);
        this.stopPromise=undefined;
      }
    }
    if(!this.stopped){
      this.readySessionAtStop=this.ready&&this.authenticated;
      this.stoppedWithAuthenticatedSession=this.authenticated;
      this.stopped=true;
      this.ready=false;
      this.authenticated=false;
      this.account='';
      clearTimeout(this.startupTimer);
      this.stopQrTimers();
      this.stopAuthStateWatch();
      this.qrGeneration++;
      this.clearPageMonitors();
    }
    const stopping=this.stopClient(this.readySessionAtStop,this.stoppedWithAuthenticatedSession);
    this.stopPromise=stopping;
    void stopping.catch(()=>{if(this.stopPromise===stopping)this.stopPromise=undefined});
    return this.stopPromise;
  }
  private async stopClient(remoteLogoutEligible:boolean,hadAuthenticatedSession:boolean){
    let logoutError:unknown;
    let remoteLogoutAttempted=false;
    const shutdownErrors:unknown[]=[];
    if(this.logoutRequested){
      const page=this.client?.pupPage;
      if(remoteLogoutEligible&&page&&this.browser?.isConnected()){
        remoteLogoutAttempted=true;
        try{
          this.callbacks.diagnostic('Remote logout started',`Client ${this.clientId}`);
          await this.client!.logout();
          this.callbacks.diagnostic('Remote logout request completed',`Client ${this.clientId}`);
        }catch(error){
          logoutError=error;
          this.callbacks.diagnostic('Remote logout failed',`Client ${this.clientId}; ${errorStack(error)}`);
        }
      }
    }
    try{await this.closeBrowserOnce()}catch(error){shutdownErrors.push(error)}
    if(this.startPromise)try{await this.startPromise}catch(error){
      this.callbacks.diagnostic('Startup stopped during cleanup',`Client ${this.clientId}; ${errorDetail(error)}`);
    }
    try{await this.client?.destroy()}catch(error){shutdownErrors.push(error)}
    try{await this.closeBrowserOnce()}catch(error){shutdownErrors.push(error)}
    this.clearPageMonitors();
    this.client?.removeAllListeners();
    this.browser?.removeAllListeners();
    if(this.logoutRequested&&!remoteLogoutAttempted&&hadAuthenticatedSession){
      this.callbacks.diagnostic('Remote logout unavailable',`Client ${this.clientId}; the browser was not in a confirmed ready state`);
    }
    if(this.logoutRequested&&!this.sessionCleared){
      if(this.browser?.isConnected()){
        shutdownErrors.push(new Error('Cannot clear the WhatsApp authentication session while its browser is still running.'));
      }else try{await this.auth.logout();this.sessionCleared=true}catch(error){shutdownErrors.push(error)}
    }
    if(shutdownErrors.length){
      this.callbacks.diagnostic('Engine shutdown failed',`Client ${this.clientId}; ${errorStack(shutdownErrors[0])}`);
      throw shutdownErrors[0];
    }
    if(logoutError||(this.logoutRequested&&hadAuthenticatedSession&&!remoteLogoutAttempted)){
      const reason=errorDetail(logoutError);
      this.callbacks.diagnostic('Remote logout not confirmed',`Client ${this.clientId}; local authentication was cleared`);
      return {warning:'The local session was cleared, but WhatsApp did not confirm remote logout. Remove BloomConnect from Linked devices on your phone if it still appears there.'+(logoutError?' Technical detail: '+reason:'')};
    }
    this.callbacks.diagnostic('Engine stopped',`Client ${this.clientId}`);
  }
}
