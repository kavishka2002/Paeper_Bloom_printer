const {EventEmitter}=require('node:events');
const {Readable}=require('node:stream');
const {existsSync,mkdirSync,writeFileSync,unlinkSync}=require('node:fs');
const {join}=require('node:path');
const Module=require('node:module');
const root=process.argv[2];
const browser=join(root,'Microsoft','Edge','Application');
mkdirSync(browser,{recursive:true});
writeFileSync(join(browser,'msedge.exe'),'test fixture');
process.env.ProgramFiles=root;
const contact='94710000000@c.us';
const id='false_94710000000@c.us_fixture';
const incoming={
 fromMe:false,from:contact,id:{_serialized:id},timestamp:Math.floor(Date.now()/1000)-36*3600,type:'document',body:'Please print',hasMedia:true,
 async getContact(){return {id:{_serialized:contact},name:'Web fixture customer'}},
 async downloadMediaStream(){return {stream:Readable.from([Buffer.from('%PDF-1.7\n% test attachment')])}}
};
class Client extends EventEmitter{
 options={};
 async initialize(){
  this.emit('qr','synthetic-link-data');
  this.disconnectTimer=setInterval(()=>{
   const marker=join(root,'disconnect-web');
   if(existsSync(marker)){unlinkSync(marker);this.emit('disconnected','fixture network loss')}
  },25);
  this.timer=setInterval(()=>{
   if(!existsSync(join(root,'release-qr')))return;
   clearInterval(this.timer);
   this.info={wid:{_serialized:'94710000001@c.us'}};
   this.emit('ready');
   this.emit('message',incoming);
   this.emit('message',incoming);
   this.emit('message',{...incoming,from:'94710000000@g.us',id:{_serialized:'group'}});
   this.emit('message',{...incoming,id:{_serialized:'system-only'},type:'notification_template',hasMedia:false});
   this.emit('message_create',{...incoming,fromMe:true,to:contact,id:{_serialized:'phone-sent'},type:'chat',hasMedia:false,body:'Sent from phone'});
   this.emit('message_create',{...incoming,fromMe:true,to:contact,id:{_serialized:'phone-sent-pdf'},rawData:{filename:'sent-handout.pdf'}});
   this.emit('message',{...incoming,from:'12345@lid',id:{_serialized:'lid-direct'},type:'chat',hasMedia:false,body:'LID direct message',getContact:async()=>undefined});
  },25);
 }
 async getChats(){return [{
  id:{_serialized:contact},isGroup:false,name:'Web fixture customer',
  getContact:()=>incoming.getContact(),
  fetchMessages:async()=>[
   {...incoming,id:{_serialized:'fixture-old-pdf'},rawData:{filename:'old-handout.pdf'},timestamp:incoming.timestamp-600},
   {...incoming,id:{_serialized:'fixture-old-out'},fromMe:true,type:'chat',hasMedia:false,body:'Earlier reply',timestamp:incoming.timestamp-500}
  ]
 }]}
 async getChatById(id){
  if(id!==contact)throw new Error('Unexpected chat');
  const [chat]=await this.getChats();
  return {...chat,fetchMessages:async({limit})=>{
   if(limit!==200)throw new Error('Expected the selected-chat history limit');
   return [
    {...incoming,id:{_serialized:'deep-document'},rawData:{filename:'older-notes.pdf'},timestamp:incoming.timestamp-8000},
    {...incoming,id:{_serialized:'deep-notification'},type:'notification_template',hasMedia:false}
   ];
  }};
 }
 async getContactById(){return incoming.getContact()}
 async getContactLidAndPhone(){return []}
 async getMessageById(){return incoming}
 async sendMessage(chat){if(chat!==contact)throw new Error('Unexpected chat');return {id:{_serialized:'true_'+contact+'_fixture'}}}
 async destroy(){clearInterval(this.timer);clearInterval(this.disconnectTimer)}
 async logout(){}
}
const load=Module._load;
Module._load=function(request,...args){if(request==='puppeteer-core')return {launch:async()=>({wsEndpoint:()=> 'ws://fixture',userAgent:async()=> 'Test browser',close:async()=>{}})};if(request==='whatsapp-web.js')return {Client,LocalAuth:class{async logout(){}}};return load.call(this,request,...args)};
