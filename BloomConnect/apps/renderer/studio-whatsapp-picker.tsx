import {useEffect,useMemo,useRef,useState} from 'react';
import type {Attachment} from '../../packages/shared/contracts';
import {Button,useData} from './context';
import {DetailDrawer} from './design';
import {visibleInboxMessage} from './inbox-messages';
import {DocumentThumbnail} from './pdf';

const digits=(value:string)=>value.replace(/\D/g,'');
const localNumber=(value:string)=>digits(value).replace(/^(?:0094|94|0)/,'');
export function useStudioWhatsAppChats(){
 const {data:{customers,messages,attachments}}=useData();
 return useMemo(()=>{
  const ids=new Set(messages.filter(visibleInboxMessage).map(message=>message.customer_id));
  for(const file of attachments)if(file.message_id&&file.customer_id)ids.add(file.customer_id);
  return customers.filter(owner=>ids.has(owner.id)).sort((a,b)=>(b.last??'').localeCompare(a.last??'')||a.name.localeCompare(b.name));
 },[customers,messages,attachments]);
}
export const chatLabel=(owner:ReturnType<typeof useStudioWhatsAppChats>[number])=>owner.phone?owner.name+' · '+owner.phone:owner.name;
const downloadState=(file:Attachment)=>['Available to download','Failed','Cancelled','Pending','Downloading'].includes(file.status);
function pendingFileType(file:Attachment,kind?:string):Attachment|undefined{
 const extension=file.name.split('.').at(-1)?.toLowerCase();
 if(extension==='pdf')return {...file,status:'Ready',mime:'application/pdf'};
 if(extension&&['doc','docx','ppt','pptx'].includes(extension))return {...file,status:'Needs conversion'};
 if(extension&&['jpg','jpeg','png','webp'].includes(extension))return {...file,status:'Ready',mime:'image/'+extension};
 if(kind==='image')return {...file,status:'Ready',mime:'image/jpeg'};
}

export function StudioWhatsAppPicker({accept,onOpen,onClose,busy,failure,chat,setChat,fileType,setScanType,single=false}:{
 accept:(file:Attachment)=>boolean;onOpen:(files:Attachment[])=>Promise<boolean>;onClose:()=>void;busy:boolean;failure:string;chat:string;setChat:(id:string)=>void;single?:boolean;
 fileType:'pdf'|'photo'|'word';setScanType?:(value:'pdf'|'photo')=>void;
}){
 const {data,refresh,run}=useData();
 const allChats=useStudioWhatsAppChats();
 const [customer,setCustomer]=useState(''),[document,setDocument]=useState(''),[selected,setSelected]=useState<string[]>([]),[shown,setShown]=useState(50);
 const [updating,setUpdating]=useState(''),[notice,setNotice]=useState(''),[chatError,setChatError]=useState('');
 const syncInFlight=useRef(false),lastAutoSync=useRef('');
 const chatFiles=data.attachments.filter(file=>file.message_id&&file.customer_id===chat);
 const messageKinds=new Map(data.messages.filter(message=>message.customer_id===chat).map(message=>[message.id,message.kind]));
 const available=chatFiles.filter(accept);
 const query=customer.trim().toLowerCase(),phoneQuery=/^[+\d\s().-]+$/.test(query)?localNumber(query):'';
 const chats=allChats.filter(owner=>owner.id===chat||!query||owner.name.toLowerCase().includes(query)||!!phoneQuery&&localNumber(owner.phone??'').includes(phoneQuery));
 const visible=chatFiles.filter(file=>{
  if(!file.name.toLowerCase().includes(document.trim().toLowerCase()))return false;
  if(accept(file))return true;
  const pending=downloadState(file)?pendingFileType(file,messageKinds.get(file.message_id??'')):undefined;
  return !!pending&&accept(pending);
 });
 const picked=selected.flatMap(id=>available.find(file=>file.id===id)??[]);
 const canSync=data.connection.mode==='web'&&data.connection.status==='Connected';
 const typeLabel={pdf:'PDFs',photo:'photos',word:'Word documents'}[fileType];
 async function loadChat(){
  if(!chat||updating||syncInFlight.current)return;
  syncInFlight.current=true;
  setUpdating('chat');setNotice('');setChatError('');
  try{
   const result=await window.bloom.call('webChatSync',{id:chat});
   await refresh();
   setNotice(result.documents?'Chat documents loaded. Download any file you want to open.':'No documents found in the available chat history.');
  }catch(error){setChatError(error instanceof Error?error.message:String(error))}
  finally{syncInFlight.current=false;setUpdating('')}
 }
 useEffect(()=>{
  if(!chat){lastAutoSync.current='';return}
  if(!canSync||updating||lastAutoSync.current===chat)return;
  lastAutoSync.current=chat;
  void loadChat();
 },[chat,canSync,updating]);
 async function download(file:Attachment){
  if(updating)return;
  setUpdating(file.id);setChatError('');
  try{await window.bloom.call('retryMedia',{id:file.id});await refresh()}
  catch(error){setChatError(error instanceof Error?error.message:String(error))}
  finally{setUpdating('')}
 }
 return <DetailDrawer title="Open from WhatsApp" onClose={onClose} presentation="wide">
  <div className="stack studio-whatsapp-picker">
   <div className="form-grid">
    <label>Find WhatsApp chat<input type="search" value={customer} onChange={e=>setCustomer(e.target.value)} placeholder="Name or WhatsApp number"/></label>
    <label>WhatsApp chat<select value={chat} disabled={busy||!!updating} onChange={e=>{setChat(e.target.value);setSelected([]);setDocument('');setShown(50);setNotice('');setChatError('')}}>
     <option value="">Select a customer name and number</option>
     {chats.map(owner=><option key={owner.id} value={owner.id}>{chatLabel(owner)}</option>)}
    </select></label>
    <label>Document name<input type="search" value={document} disabled={!chat} onChange={e=>{setDocument(e.target.value);setShown(50)}} placeholder="Search by filename"/></label>
   </div>
   {setScanType&&<div className="actions" role="group" aria-label="WhatsApp file type">
    {([['photo','Photos'],['pdf','PDFs']] as const).map(([value,label])=><Button key={value} className="secondary" aria-pressed={fileType===value} disabled={busy} onClick={()=>{
     setScanType(value);setSelected([]);setDocument('');setShown(50);
    }}>{label}</Button>)}
   </div>}
   {chat&&canSync&&<div className="actions"><Button className="secondary" disabled={busy||!!updating} onClick={()=>void loadChat()}>{updating==='chat'?'Loading documents…':'Load chat documents'}</Button></div>}
   {notice&&<small role="status">{notice}</small>}
   <div className="studio-whatsapp-results">
    {visible.slice(0,shown).map(file=>{
     if(downloadState(file))return <div className="studio-whatsapp-file studio-whatsapp-download" key={file.id}>
      <span><strong>{file.name}</strong>{file.download?.error&&<small role="alert">{file.download.error}</small>}</span>
      {['Pending','Downloading'].includes(file.status)?<>
       <span role="status">{file.status==='Pending'?'Waiting to download':'Downloading'}
        {file.download?.total?<progress aria-label="Attachment download" max={file.download.total} value={file.download.bytes}/>:<progress aria-label="Attachment download"/>}
       </span>
       <Button className="secondary" onClick={()=>void run('cancelMedia',{id:file.id})}>Cancel download</Button>
      </>:<Button className="secondary" disabled={busy||!!updating} onClick={()=>void download(file)}>{updating===file.id?'Downloading…':file.status==='Failed'?'Retry download':'Download'}</Button>}
     </div>;
     return <label className="studio-whatsapp-file" key={file.id}>
      <input type={single?'radio':'checkbox'} name={single?'studio-whatsapp-source':undefined} aria-label={'Select '+file.name} checked={selected.includes(file.id)} disabled={busy||selected.length>=40&&!selected.includes(file.id)}
       onChange={e=>setSelected(e.target.checked?single?[file.id]:[...selected,file.id]:selected.filter(id=>id!==file.id))}/>
      <span className="studio-whatsapp-file-name">{fileType==='photo'&&<DocumentThumbnail id={file.id}/>}<strong>{file.name}</strong></span>
      {file.status==='Needs conversion'&&<small>Converts to PDF</small>}
     </label>;
    })}
    {!visible.length&&<p>{updating==='chat'?'Loading documents for this number…':chat?'No matching '+typeLabel+' in the selected chat.':chats.length?'Select a WhatsApp chat to see its '+typeLabel+'.':'No WhatsApp chats match this search.'}</p>}
   </div>
   {visible.length>shown&&<Button className="quiet" onClick={()=>setShown(shown+50)}>Show more documents</Button>}
   {failure&&<small role="alert">{failure}</small>}
   {chatError&&<small role="alert">{chatError}</small>}
   <div className="actions">
    <Button disabled={busy||!picked.length} onClick={async()=>{if(await onOpen(picked))onClose()}}>{busy?'Opening…':picked.length>1?'Open '+picked.length+' files':'Open selected'}</Button>
    <small role="status">{picked.length} selected</small>
    {picked.length>0&&<Button className="quiet" disabled={busy} onClick={()=>setSelected([])}>Clear selection</Button>}
   </div>
  </div>
 </DetailDrawer>;
}
