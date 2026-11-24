const {EventEmitter}=require('node:events');
const {Readable}=require('node:stream');
const {existsSync,mkdirSync,writeFileSync,unlinkSync,appendFileSync}=require('node:fs');
const {rm}=require('node:fs/promises');
const {join}=require('node:path');
const Module=require('node:module');
const root=process.argv[2];
const browser=join(root,'Microsoft','Edge','Application');
mkdirSync(browser,{recursive:true});
writeFileSync(join(browser,'msedge.exe'),'test fixture');
process.env.ProgramFiles=root;
const contact='94710000000@c.us';
const secondContact='94710000002@c.us';
const id='false_94710000000@c.us_fixture';
let clientCount=0;
const record=(event,index)=>appendFileSync(join(root,'web-lifecycle.log'),event+':'+index+'\n');
const incoming={
 fromMe:false,from:contact,id:{_serialized:id},timestamp:Math.floor(Date.now()/1000)-36*3600,type:'document',body:'Please print',hasMedia:true,
 async getContact(){return {id:{_serialized:contact},name:'Web fixture customer'}},
 async downloadMediaStream(){return {stream:Readable.from([Buffer.from('%PDF-1.7\n% test attachment')])}}
};
const secondIncoming={...incoming,from:secondContact,id:{_serialized:'second-account-message'},type:'chat',hasMedia:false,body:'Second account message',
 async getContact(){return {id:{_serialized:secondContact},name:'Second account customer'}}};
class Client extends EventEmitter{
 options={};
 constructor(...args){super(...args);this.index=++clientCount;this.isSecondAccount=existsSync(join(root,'switch-account'));this.account=this.isSecondAccount?'94710000002@c.us':'94710000001@c.us';this.message=this.isSecondAccount?secondIncoming:incoming;this.readyOnce=false}
 markReady(){
 if(this.readyOnce)return;
 this.readyOnce=true;
 this.info={wid:{_serialized:this.account}};
 this.emit('authenticated');
 this.emit('ready');
 if(!this.isSecondAccount){
  this.emit('message',incoming);
  this.emit('message',incoming);
  this.emit('message',{...incoming,from:'94710000000@g.us',id:{_serialized:'group'}});
  this.emit('message',{...incoming,id:{_serialized:'system-only'},type:'notification_template',hasMedia:false});
  this.emit('message_create',{...incoming,fromMe:true,to:contact,id:{_serialized:'phone-sent'},type:'chat',hasMedia:false,body:'Sent from phone'});
  this.emit('message_create',{...incoming,fromMe:true,to:contact,id:{_serialized:'phone-sent-pdf'},rawData:{filename:'sent-handout.pdf'}});
  this.emit('message',{...incoming,from:'12345@lid',id:{_serialized:'lid-direct'},type:'chat',hasMedia:false,body:'LID direct message',getContact:async()=>undefined});
 }else this.emit('message',secondIncoming);
 }
 async initialize(){
 mkdirSync(join(root,'whatsapp-web','session','Default'),{recursive:true});
 writeFileSync(join(root,'whatsapp-web','session','Default','Preferences'),'fixture session');
 const socketModel={};
 const connectionModel={Conn:{ref:'synthetic-qr-ref'}};
 global.window={require:name=>name==='WAWebSocketModel'?socketModel:name==='WAWebConnModel'?connectionModel:name==='WAWebUserPrefsMeUser'?{
  getMaybeMePnUser:()=>process.env.BLOOMCONNECT_TEST_WEB_COMPAT_INJECT_ERROR==='1'&&existsSync(join(root,'release-qr'))?{_serialized:this.account}:undefined,
  getMaybeMeLidUser:()=>undefined
 }:{}};
 const nativeLogin=process.env.BLOOMCONNECT_TEST_WEB_NATIVE_LOGIN==='1';
 const linked=()=>existsSync(join(root,'release-qr'));
 this.pupPage=Object.assign(new EventEmitter(),{
 url:()=>nativeLogin&&!linked()?'https://web.whatsapp.com/login/':'https://web.whatsapp.com/',
 evaluate:async predicate=>{
  if(nativeLogin&&predicate.toString().includes('querySelector'))return linked()?null:'data:image/png;base64,fixture-native-qr';
  return new Function('return ('+predicate.toString()+')')()();
 },waitForFunction:async(predicate)=>{
  if(process.env.BLOOMCONNECT_TEST_WEB_AUTH_STATE_TIMEOUT==='1'&&predicate.toString().includes('WAWebSocketModel'))throw new Error('Waiting failed:60000ms exceeded');
  return {jsonValue:async()=>{
  const value=typeof predicate==='function'?predicate():true;
  return value&&typeof value==='object'?value:{need:value==='UNPAIRED_IDLE',state:value};
 }}}});
 await this.inject();
 record('initialize',this.index);
 this.qrRefreshTimer=setInterval(()=>{
  const marker=join(root,'emit-refreshed-qr');
  if(!existsSync(marker))return;
  unlinkSync(marker);
  this.emit('qr','synthetic-refreshed-link-data');
 },25);
  this.disconnectTimer=setInterval(()=>{
   const marker=join(root,'disconnect-web');
   if(existsSync(marker)){unlinkSync(marker);this.emit('disconnected','fixture network loss')}
  },25);
  this.timer=setInterval(()=>{
   if(!existsSync(join(root,'release-qr')))return;
   clearInterval(this.timer);
   if(!nativeLogin&&process.env.BLOOMCONNECT_TEST_WEB_COMPAT_INJECT_ERROR!=='1')this.markReady();
  },25);
 }
 async inject(){
 this.injectCalls=(this.injectCalls??0)+1;
 record('inject-'+this.injectCalls,this.index);
 if(process.env.BLOOMCONNECT_TEST_WEB_NATIVE_LOGIN==='1'){
  this.markReady();
  return;
 }
 if(process.env.BLOOMCONNECT_TEST_WEB_COMPAT_INJECT_ERROR==='1'&&this.injectCalls===1)throw new Error('fixture QR hook changed');
 if(process.env.BLOOMCONNECT_TEST_WEB_COMPAT_INJECT_ERROR==='1'&&this.injectCalls===2)global.window.onAppStateHasSyncedEvent=async()=>{this.emit('authenticated');this.markReady()};
  const state=await this.pupPage.waitForFunction(()=>window.require?.('WAWebSocketModel')?.Socket?.state);
  if(typeof window.require?.('WAWebSocketModel')?.Socket?.on!=='function')throw new Error('WhatsApp socket event hook was not installed');
  if((await state.jsonValue()).need&&process.env.BLOOMCONNECT_TEST_WEB_NO_QR_EVENT!=='1')this.emit('qr','synthetic-link-data');
 record('initialized',this.index);
 }
 async getChats(){
 if(existsSync(join(root,'delay-initial-chats'))&&!this.chatListRequested){
  this.chatListRequested=true;
  return [];
 }
 return [{
 id:{_serialized:this.message.from},isGroup:false,name:this.isSecondAccount?'Second account customer':'Web fixture customer',
 lastMessage:existsSync(join(root,'skip-cached-history'))?this.message:undefined,
 getContact:()=>this.message.getContact(),
 fetchMessages:async()=>{
  if(existsSync(join(root,'skip-cached-history')))throw new Error('Already cached chat should not fetch its history');
  return !this.isSecondAccount?[
   {...incoming,id:{_serialized:'fixture-old-pdf'},rawData:{filename:'old-handout.pdf'},timestamp:incoming.timestamp-600},
   {...incoming,id:{_serialized:'fixture-old-out'},fromMe:true,type:'chat',hasMedia:false,body:'Earlier reply',timestamp:incoming.timestamp-500}
 ]:[secondIncoming]},
 }]}
 async getChatById(id){
 if(id!==this.message.from)throw new Error('Unexpected chat');
  const [chat]=await this.getChats();
 if(this.isSecondAccount)return {...chat,fetchMessages:async()=>[secondIncoming]};
  return {...chat,fetchMessages:async({limit})=>{
   if(limit===200)throw new Error('Earlier WhatsApp history is unavailable');
   if(limit!==undefined)throw new Error('Expected the cached-history fallback');
   return [
    {...incoming,id:{_serialized:'deep-document'},rawData:{filename:'older-notes.pdf'},timestamp:incoming.timestamp-8000},
    {...incoming,id:{_serialized:'deep-image'},type:'image',timestamp:incoming.timestamp-7000,
     async downloadMediaStream(){
      const image=await require('sharp')({create:{width:1,height:1,channels:3,background:'#ffffff'}}).png().toBuffer();
      return {stream:Readable.from([image])};
     }},
    {...incoming,id:{_serialized:'deep-notification'},type:'notification_template',hasMedia:false}
   ];
  }};
 }
 async getContactById(){return this.message.getContact()}
 async getContactLidAndPhone(){return []}
 async getMessageById(){return this.message}
 async sendMessage(chat){if(chat!==this.message.from)throw new Error('Unexpected chat');return {id:{_serialized:'true_'+this.message.from+'_fixture'}}}
 async destroy(){record('destroy',this.index);clearInterval(this.timer);clearInterval(this.disconnectTimer);clearInterval(this.qrRefreshTimer)}
 async logout(){record('logout',this.index);if(process.env.BLOOMCONNECT_TEST_WEB_LOGOUT_ERROR)throw new Error(process.env.BLOOMCONNECT_TEST_WEB_LOGOUT_ERROR)}
}
const load=Module._load;
Module._load=function(request,...args){
 if(request==='puppeteer-core')return {PUPPETEER_REVISIONS:{chrome:'146.0.7680.31'},launch:async()=>{
  record('launch',clientCount+1);
  const lock=join(root,'lock-profile-once');
  if(existsSync(lock)){unlinkSync(lock);throw new Error('The browser is already running for this profile.')}
  if(process.env.BLOOMCONNECT_TEST_WEB_START_ERROR)throw new Error(process.env.BLOOMCONNECT_TEST_WEB_START_ERROR);
  if(process.env.BLOOMCONNECT_TEST_WEB_LAUNCH_DELAY)await new Promise(resolve=>setTimeout(resolve,Number(process.env.BLOOMCONNECT_TEST_WEB_LAUNCH_DELAY)));
  let connected=true;
  return Object.assign(new EventEmitter(),{wsEndpoint:()=> 'ws://fixture',userAgent:async()=> 'Test browser',version:async()=> 'Chrome/fixture',isConnected:()=>connected,close:async()=>{if(connected){connected=false;record('browser-close',clientCount)}}});
 }};
 if(request==='whatsapp-web.js')return {Client,LocalAuth:class{
  constructor(options){this.dataPath=options.dataPath}
  async logout(){record('auth-clear',clientCount);await rm(join(this.dataPath,'session'),{recursive:true,force:true})}
 }};
 return load.call(this,request,...args)
};
