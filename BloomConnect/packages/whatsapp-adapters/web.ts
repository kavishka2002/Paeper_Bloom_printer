import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {Client, LocalAuth, type Chat, type Contact, type Message} from 'whatsapp-web.js';
import QRCode from 'qrcode';
import {launch,type Browser} from 'puppeteer-core';
import {collect} from './cloud';

export type WebMessage={id:string;phone:string;name:string;kind:string;text:string;created:string;chat?:string;outgoing?:boolean;file?:{remote:string;name:string}};
type Identity={chat:string;phone:string;name:string};
type Callbacks={
  qr:(image:string)=>void;
  authenticated:()=>void;
  ready:(account:string,phone:string)=>void;
  offline:(reason:string)=>void;
  message:(message:WebMessage)=>void;
  ack:(id:string,status:string)=>void;
};
export function phoneFromChat(chat:string){
  return /^([1-9]\d{6,14})@(?:c\.us|s\.whatsapp\.net)$/.exec(chat)?.[1]??'';
}
function findBrowser(){
  const bases=[process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.LOCALAPPDATA];
  const locations=bases.filter((base):base is string=>Boolean(base));
  const paths=[...locations.map(base=>join(base,'Google','Chrome','Application','chrome.exe')),...locations.map(base=>join(base,'Microsoft','Edge','Application','msedge.exe'))];
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
  private stopped=false;
  private startupTimer?:ReturnType<typeof setTimeout>;
  private watchStartup(){
    clearTimeout(this.startupTimer);
    this.startupTimer=setTimeout(()=>{
      if(!this.stopped&&!this.ready)this.callbacks.offline("WhatsApp Web took too long to connect. Retrying with the saved session?");
    },180000);
  }
  private ready=false;
  private qrGeneration=0;
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
    client.on('qr',raw=>{
      clearTimeout(this.startupTimer);
      this.ready=false;
      const generation=++this.qrGeneration;
      void QRCode.toDataURL(raw,{width:280,margin:3,errorCorrectionLevel:'M'}).then(image=>{
        if(!this.stopped&&!this.ready&&generation===this.qrGeneration)callbacks.qr(image);
      }).catch(()=>{if(!this.stopped)callbacks.offline('QR code could not be displayed.')});
    });
    client.on('authenticated',()=>{this.watchStartup();this.qrGeneration++;if(!this.stopped)callbacks.authenticated()});
    client.on('ready',()=>{
      const chat=client.info?.wid?._serialized;
      if(!chat||this.stopped)return;
      clearTimeout(this.startupTimer);
      this.ready=true;
      this.account='web:'+chat;
      callbacks.ready(this.account,phoneFromChat(chat));
    });
    client.on('auth_failure',()=>{
      this.ready=false;this.qrGeneration++;
      if(!this.stopped)callbacks.offline('WhatsApp Web authentication failed. Reconnect and scan a fresh QR code.');
    });
    client.on('disconnected',()=>{
      this.ready=false;this.qrGeneration++;
      if(!this.stopped)callbacks.offline('The linked device went offline. Reconnect or link it again.');
    });
    client.on('message',msg=>{if(this.ready&&!this.stopped)void this.captureIncoming(msg).catch(()=>{});});
    client.on('message_create',msg=>{
      if(this.ready&&!this.stopped&&msg.fromMe)void this.captureIncoming(msg,true).catch(()=>{});
    });
    client.on('message_ack',(message,ack)=>{
      if(this.ready&&message.fromMe&&message.id?._serialized){
        const state=ack===-1?'failed':ack>=3?'read':ack===2?'delivered':ack===1?'sent':'';
        if(state)callbacks.ack(message.id._serialized,state);
      }
    });
    return client;
  }
  async start(){
    this.watchStartup();
    try{
      this.browser=await launch({executablePath:findBrowser(),userDataDir:this.profile,headless:true,timeout:25000});
      if(this.stopped)return;
      this.client=this.createClient(this.browser);
      this.browser.on?.('disconnected',()=>{
        if(!this.stopped){this.ready=false;this.callbacks.offline("WhatsApp browser closed. Reconnecting with the saved session?")}
      });
      await this.client.initialize();
    }finally{if(this.stopped)await this.browser?.close().catch(()=>{})}
  }
  private isDirect(chat:string){return /^\d+@(?:c\.us|lid|s\.whatsapp\.net)$/.test(chat)}
  private async identity(chat:string,contact?:Contact,name?:string):Promise<Identity>{
    let phone=phoneFromChat(chat)||phoneFromChat(contact?.id?._serialized??'');
    if(!phone&&chat.endsWith('@lid')){
      const [match]=await this.client!.getContactLidAndPhone([chat]).catch(()=>[]);
      phone=phoneFromChat(match?.pn??'');
    }
    if(phone)this.chats.set(phone,chat);
    return {chat,phone,name:contact?.name||contact?.pushname||name||phone||'WhatsApp contact'};
  }
  private async captureIncoming(msg:Message,outgoing=false){
    const chat=outgoing?msg.to:msg.from;
    if(msg.fromMe!==outgoing||!this.isDirect(chat))return;
    const contact=await (outgoing?this.client!.getContactById(chat):msg.getContact()).catch(()=>undefined);
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
  async syncChat(knownChats:string[],phone:string){
    if(!this.ready||this.stopped)throw new Error('Connect WhatsApp Web before loading documents.');
    const client=this.client!;
    const candidates=[...knownChats];
    const mapped=phone?this.chats.get(phone):undefined;
    if(mapped)candidates.push(mapped);
    if(phone)candidates.push(phone+'@c.us');
    for(const id of new Set(candidates)){
      if(!this.isDirect(id))continue;
      const chat=await client.getChatById(id).catch(()=>undefined);
      if(!chat||chat.isGroup)continue;
      const contact=await chat.getContact().catch(()=>undefined);
      const identity=await this.identity(chat.id._serialized,contact,chat.name);
      let partial=false;
      const messages=await chat.fetchMessages({limit:200}).catch(()=>{
        partial=true;
        return chat.fetchMessages({});
      });
      const normalized=messages.flatMap(message=>{
        const result=this.normalize(message,identity,true);
        return result?[result]:[];
      });
      return {messages:normalized,partial};
    }
    throw new Error('WhatsApp Web could not find this chat. Open it on your phone and retry.');
  }
  async syncHistory(consume:(messages:WebMessage[])=>void){
    if(!this.ready||this.stopped)throw new Error('Link WhatsApp Web before syncing chats.');
    const chats=(await this.client!.getChats()).filter(chat=>!chat.isGroup&&this.isDirect(chat.id._serialized))
      .sort((a,b)=>(b.timestamp??0)-(a.timestamp??0)).slice(0,30);
    let failed=0;
    const sync=async(chat:Chat)=>{
      if(!this.ready||this.stopped)throw new Error('WhatsApp Web disconnected during chat sync.');
      const contact=await chat.getContact().catch(()=>undefined);
      const identity=await this.identity(chat.id._serialized,contact,chat.name);
      let history:Message[];
      try{history=await chat.fetchMessages({limit:20})}
      catch{failed++;history=await chat.fetchMessages({}).catch(()=>[])}
      if(!history.length&&chat.lastMessage&&!isWhatsAppSystemMessage(String(chat.lastMessage.type)))history=[chat.lastMessage];
      const messages=history.flatMap(message=>{
        const normalized=this.normalize(message,identity,true);
        return normalized?[normalized]:[];
      });
      if(this.ready&&!this.stopped&&messages.length)consume(messages);
    };
    for(let i=0;i<chats.length;i+=4)await Promise.all(chats.slice(i,i+4).map(sync));
    return {chats:chats.length,failed};
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
    this.stopped=true;
    clearTimeout(this.startupTimer);
    this.qrGeneration++;
    try{if(logout&&this.ready)await this.client?.logout()}
    finally{
      await this.client?.destroy().catch(()=>{});
      await this.browser?.close().catch(()=>{});
      if(logout)await this.auth.logout();
    }
  }
}
