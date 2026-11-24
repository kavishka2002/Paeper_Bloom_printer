import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {FileText,Plus,Printer,ScanLine,ShoppingBag,Users,Wallet} from 'lucide-react';
import {DetailDrawer,StatCard,Tabs} from './design';
import type {Attachment,Customer} from '../../packages/shared/contracts';
import {useData,Panel,Button,Badge,Table,Empty,match,money,name,stamp,orderStatusLabels} from './context';
import {useWorkspace} from './state';
import {DocumentPreview,DocumentThumbnail,documentPageCount} from './pdf';
import {ScannerDialog} from './scanner';
import {unreadInboxMessage,visibleInboxMessage} from './inbox-messages';
const noCount=()=>{};
export function InboxView(){
 const {data,run,refresh,error}=useData(),state=useWorkspace(),[unread,setUnread]=useState(false),[query,setQuery]=useState(''),[draft,setDraft]=useState('');
 const selectedCustomer=data.customers.find(c=>c.id===state.customer);
 const accountScoped=data.connection.mode==='web'||['Connected','API reachable'].includes(data.connection.status);
 const webConnected=data.connection.mode==='web'&&data.connection.status==='Connected';
 const selectedInInbox=selectedCustomer&&(!accountScoped||data.messages.some(message=>message.customer_id===selectedCustomer.id&&visibleInboxMessage(message)))?selectedCustomer:undefined;
 const [previewCustomer,setPreviewCustomer]=useState<string>();
 const previewInInbox=data.connection.mode==='web'&&data.messages.some(message=>message.customer_id===previewCustomer&&visibleInboxMessage(message))?previewCustomer:undefined;
 const latestCustomer=data.connection.mode==='web'&&!selectedInInbox?data.messages.findLast(visibleInboxMessage)?.customer_id:undefined;
 const active=selectedInInbox??data.customers.find(customer=>customer.id===(previewInInbox??latestCustomer));
 useEffect(()=>{if(!previewInInbox&&latestCustomer)setPreviewCustomer(latestCustomer)},[previewInInbox,latestCustomer]);
 const [syncingChat,setSyncingChat]=useState('');
 const [chatSync,setChatSync]=useState<{id:string;text:string}>();
 const [selectedFiles,setSelectedFiles]=useState<string[]>([]);
 const [filePreview,setFilePreview]=useState<Attachment>();
 const [detailsCustomer,setDetailsCustomer]=useState('');
 const [sending,setSending]=useState(false);
 const [convertingOffice,setConvertingOffice]=useState('');
 async function printOffice(file:Attachment){
  if(convertingOffice)return;
  setConvertingOffice(file.id);
  try{
   const id=await window.bloom.call('convertDocument',{id:file.id,mode:'pages',includeHidden:false});
   await refresh();
   state.set({pdfPrintAttachment:id,pdfBatchDraft:[]});
  }catch(e){error(e)}finally{setConvertingOffice('')}
 }
 const customerFiles=active?data.attachments.filter(file=>file.customer_id===active.id):[];
 const picked=customerFiles.filter(file=>selectedFiles.includes(file.id)&&file.status==='Ready');
 const selectedPdfs=picked.filter(file=>file.mime==='application/pdf');
 const selectedPhotos=picked.filter(file=>file.mime.startsWith('image/'));
 const incomingIds=new Set(data.messages.filter(message=>message.customer_id===active?.id&&message.direction==='incoming').map(message=>message.id));
 const customerOrders=new Map(data.jobs.filter(order=>order.customer_id===active?.id).map(order=>[order.id,order]));
 const submittedPdfs=new Set<string>();
 for(const entry of data.queue){
  const order=customerOrders.get(entry.job_id);
  if(!order||!['Printing','Submitted','Unconfirmed','Completed'].includes(entry.status))continue;
  try{
   const ids:unknown=JSON.parse(entry.settings??'null')?.fileSelection;
   for(const id of Array.isArray(ids)?ids:order.files)submittedPdfs.add(id);
  }catch{for(const id of order.files)submittedPdfs.add(id)}
 }
 const incomingPdfs=customerFiles.filter(file=>file.status==='Ready'&&file.mime==='application/pdf'&&file.message_id&&incomingIds.has(file.message_id)&&!submittedPdfs.has(file.id));
 const incomingBatch=incomingPdfs.slice(0,40).reverse();
 function toggleFile(id:string,checked:boolean){
  setSelectedFiles(items=>checked?(items.includes(id)?items:[...items,id]):items.filter(item=>item!==id));
 }
 function openPrintFiles(files:Attachment[],batch=false){
  if(!active||!files.length)return;
  if(files.length>40){error(new Error('Select up to 40 files for one order.'));return}
  const ids=files.map(file=>file.id);
  setDetailsCustomer('');
  if(files[0].mime==='application/pdf')state.set({pdfPrintAttachment:ids[0],pdfBatchDraft:batch||ids.length>1?ids:[]});
  else state.set({view:'Print Studio',job:'',customer:active.id,photoStudio:true,photoDraft:ids,lightenPhotoDraft:false});
 }
 function showFile(file:Attachment){
  if(file.status==='Ready'){setDetailsCustomer('');setFilePreview(file)}
  else if(['Failed','Available to download'].includes(file.status))void run('retryMedia',{id:file.id});
  else state.set({attachment:file.id,view:'Documents'});
 }
 const messagesByCustomer=useMemo(()=>{
  const grouped=new Map<string,typeof data.messages>();
  for(const message of data.messages)if(visibleInboxMessage(message)){
   const list=grouped.get(message.customer_id)??[];
   list.push(message);grouped.set(message.customer_id,list);
  }
  return grouped;
 },[data.messages]);
 const filesByMessage=useMemo(()=>{
  const grouped=new Map<string,Attachment[]>();
  for(const file of data.attachments)if(file.message_id){
   const files=grouped.get(file.message_id)??[];
   files.push(file);
   grouped.set(file.message_id,files);
  }
  return grouped;
 },[data.attachments]);
 async function loadChatDocuments(id:string){
  if(syncingChat)return;
  setSyncingChat(id);setChatSync(undefined);
  try{
   const result=await window.bloom.call('webChatSync',{id});
   await refresh();
   const text=result.documents?`${result.documents} attachment(s) found. Open a ready file to preview or print it.`:'No attachments found in the history WhatsApp returned for this chat.';
   setChatSync({id,text:text+(result.partial?' WhatsApp could only return history already loaded in this session.':'')});
  }catch(e){error(e)}finally{setSyncingChat('')}
 }
 const conversations=data.customers.map(c=>({c,list:messagesByCustomer.get(c.id)??[]})).filter(({c,list})=>list.length>0&&match(query,c.name,c.phone)&&(!unread||list.some(unreadInboxMessage))).sort((a,b)=>(b.list.at(-1)?.created??b.c.last).localeCompare(a.list.at(-1)?.created??a.c.last));
 const messages=messagesByCustomer.get(active?.id??'')??[];
 const nearbyPhotos=useMemo(()=>{
  const groups=new Map<string,Attachment[]>();
  let group:Attachment[]=[];
  let first='',previousTime=0;
  for(const message of messages){
   const images=filesByMessage.get(message.id)?.filter(file=>file.customer_id===message.customer_id&&file.mime.startsWith('image/'))??[];
   const time=Date.parse(message.created);
   if(message.direction!=='incoming'||images.length!==1||!Number.isFinite(time)){group=[];continue}
   if(!group.length||time<previousTime||time-previousTime>10000){group=[];first=message.id}
   group.push(images[0]);
   if(group.length===2)groups.set(first,group);
   previousTime=time;
  }
  return groups;
 },[messages,filesByMessage]);
 const history=useRef<HTMLDivElement>(null), followNewest=useRef(true), openedCustomer=useRef<string|undefined>(undefined);
 const newest=messages.at(-1)?.id;
 const unreadInChat=messages.filter(unreadInboxMessage);
 const unreadKey=unreadInChat.map(message=>message.id).join('|');
 useEffect(()=>{if(active?.id&&active.id===state.customer&&unreadKey)void run('read',{id:active.id})},[active?.id,state.customer,unreadKey]);
 useLayoutEffect(()=>{
  if(openedCustomer.current!==active?.id){openedCustomer.current=active?.id;followNewest.current=true}
  if(history.current&&followNewest.current)history.current.scrollTop=history.current.scrollHeight;
 },[active?.id,newest]);
 const connected=webConnected||data.connection.status==="API reachable";
 return <div className="stack whatsapp-inbox" data-connected={connected}>
 {!connected&&<div className="connection"><div><strong>WhatsApp · {data.connection.status}</strong>{data.connection.detail&&<p>{data.connection.detail}</p>}{!webConnected&&!data.connection.detail&&data.connection.status!=='API reachable'&&<p>Connect WhatsApp to load chats and documents.</p>}</div>
 {!webConnected&&data.connection.status!=='API reachable'&&<Button className="secondary" onClick={()=>state.set({view:'Automation Engine'})}>Open connection settings</Button>}</div>}
 <div className="inbox-layout panel">
 <aside className="conversation-list"><div className="padded stack"><h2>Conversations</h2>{data.connection.mode==="web"&&data.connection.status==="Connected"&&<><Button className="secondary" disabled={data.connection.sync?.startsWith("Syncing")} onClick={()=>void run("webSync",null)}>Sync recent chats</Button>{data.connection.sync&&<p className="subtle" role="status">{data.connection.sync}</p>}</>}<input aria-label="Find a conversation" placeholder="Find a conversation" value={query} onChange={e=>setQuery(e.target.value)}/><label className="check"><input type="checkbox" checked={unread} onChange={e=>setUnread(e.target.checked)}/> Unread only</label></div>
 {conversations.map(({c,list})=><button key={c.id} className={'conversation '+(active?.id===c.id?'selected':'')} onClick={()=>{state.set({customer:c.id});setDraft('');setSelectedFiles([]);setFilePreview(undefined)}}><span className="avatar">{c.name[0]}</span><span><strong>{c.name}</strong><small>{c.phone}</small><small>{list.at(-1)?.body||list.at(-1)?.kind}</small><small>{stamp(list.at(-1)?.created??c.last)}</small></span>{list.some(unreadInboxMessage)&&<i className="unread unread-count" aria-label={list.filter(unreadInboxMessage).length+" unread"}>{list.filter(unreadInboxMessage).length}</i>}</button>)}
 {!conversations.length&&<Empty title="No conversations found"><p>Search for a customer by name or number, or sync recent chats after connecting.</p></Empty>}</aside>
 <section className="chat"><label className="check quick-pdf-toggle"><input type="checkbox" checked={state.autoPdfPrint} onChange={event=>{const enabled=event.target.checked;localStorage.setItem('autoPdfPrint',enabled?'on':'off');state.set({autoPdfPrint:enabled})}}/> Open print preview for new PDFs</label>{active?<><div className="chat-title"><span className="avatar">{active.name[0]}</span><div><strong>{active.name}</strong><p>{active.phone}</p></div><Button className="secondary chat-details-toggle" onClick={()=>setDetailsCustomer(active.id)}>Customer details</Button></div><div ref={history} className="chat-history" onScroll={e=>{const area=e.currentTarget;followNewest.current=area.scrollHeight-area.scrollTop-area.clientHeight<60}}>{messages.map(m=>{
 const attachments=filesByMessage.get(m.id)??[];
 const album=attachments.filter(file=>file.customer_id===active.id&&file.mime.startsWith('image/'));
 const photoGroup=album.length>1?album:nearbyPhotos.get(m.id)??[];
 const albumReady=photoGroup.every(file=>file.status==='Ready');
 return <div className={'bubble '+m.direction} key={m.id}><div>{m.body||(!attachments.length?m.kind:'')}</div>
 {photoGroup.length>1&&<div className="stack chat-album-print">
  <Button className="secondary" disabled={!albumReady||photoGroup.length>40} onClick={()=>openPrintFiles(photoGroup)}><Printer size={14}/> {album.length>1?'Print album':'Review nearby photos'} ({photoGroup.length} photos)</Button>
  {(!albumReady||photoGroup.length>40)&&<small>{photoGroup.length>40?'Select up to 40 photos for one order.':'Download these photos to print them together.'}</small>}
 </div>}
 {attachments.map(a=><div className="chat-message-file" key={a.id}>
 <button className="file-link" onClick={()=>showFile(a)}><FileText size={16}/>{a.name} · {a.status}</button>
 {a.status==='Needs conversion'&&/\.(docx?|pptx?)$/i.test(a.name)&&<div className="actions"><Button className="secondary" disabled={!!convertingOffice} onClick={()=>void printOffice(a)}><Printer size={14}/> {convertingOffice===a.id?'Converting…':'Convert & print'}</Button></div>}
 {a.status==='Ready'&&a.mime==='application/pdf'&&<div className="actions">
 <label className="check chat-pdf-pick"><input type="checkbox" aria-label={'Select '+a.name+' from chat'} checked={selectedFiles.includes(a.id)} onChange={e=>toggleFile(a.id,e.target.checked)}/> Include in print batch</label>
 <Button className="quiet" onClick={()=>openPrintFiles([a])}><Printer size={14}/> Print PDF</Button>
 </div>}{a.status==='Ready'&&a.mime.startsWith('image/')&&<>
 <button className="chat-photo-thumbnail" aria-label={'Preview '+a.name} onClick={()=>showFile(a)}><DocumentThumbnail id={a.id}/></button>
 <div className="actions">
 <label className="check chat-pdf-pick"><input type="checkbox" aria-label={'Select '+a.name+' from chat'} checked={selectedFiles.includes(a.id)} onChange={e=>toggleFile(a.id,e.target.checked)}/> Include photo in print</label>
 <Button className="quiet" onClick={()=>openPrintFiles([a])}><Printer size={14}/> Print photo</Button>
 <Button className="quiet" onClick={()=>state.set({view:'Documents',attachment:a.id,scannerAttachment:a.id})}><ScanLine size={14}/> Auto Scan &amp; Clean</Button>
 </div></>}
 </div>)}<small>{stamp(m.created)} · {m.status}</small></div>})}</div>
 {(selectedPdfs.length>0||selectedPhotos.length>0||incomingBatch.length>1)&&<div className="actions chat-pdf-toolbar">
  {selectedPdfs.length>0&&<Button disabled={selectedPdfs.length>40} onClick={()=>openPrintFiles(selectedPdfs,true)}>Review selected PDFs ({selectedPdfs.length})</Button>}
  {!selectedPdfs.length&&incomingBatch.length>1&&<Button onClick={()=>openPrintFiles(incomingBatch,true)}><Printer size={15}/> {incomingPdfs.length>40?'Review latest 40 PDFs':'Review received PDFs ('+incomingBatch.length+')'}</Button>}
  {selectedPhotos.length>0&&<Button disabled={selectedPhotos.length>40} onClick={()=>openPrintFiles(selectedPhotos)}>Review selected photos ({selectedPhotos.length})</Button>}
  {picked.length>0&&<Button className="quiet" onClick={()=>setSelectedFiles([])}>Clear selection</Button>}
  {(selectedPdfs.length>40||selectedPhotos.length>40)&&<small role="status">Choose up to 40 files per order.</small>}
 </div>}
 <form className="composer" onSubmit={async e=>{e.preventDefault();if(sending||!draft.trim())return;setSending(true);try{if(await run('reply',{id:active.id,text:draft},'Reply submitted to WhatsApp')&&useWorkspace.getState().customer===active.id)setDraft('')}finally{setSending(false)}}}><input aria-label="Reply" placeholder="Write a reply" value={draft} maxLength={4096} onChange={e=>setDraft(e.target.value)}/><Button type="submit" disabled={sending||!draft.trim()||!['API reachable','Connected'].includes(data.connection.status)}>Send</Button></form></>:<Empty title="Select a conversation"/>}</section></div>
 {active&&detailsCustomer===active.id&&<DetailDrawer title="Customer details" onClose={()=>setDetailsCustomer('')}><div className="stack chat-customer-details"><strong>{active.name}</strong><p>{active.phone||'Phone unavailable'}</p>{active.tag&&<Badge>{active.tag}</Badge>}<p>{money(data.jobs.filter(j=>j.customer_id===active.id&&j.status!=='Cancelled').reduce((n,j)=>n+j.total-j.paid,0))} outstanding</p><Button className="secondary" onClick={()=>state.set({view:'Customers',customer:active.id})}>View customer</Button><Button onClick={()=>state.set({view:'Print Studio',job:'',customer:active.id,photoStudio:true})}>Print customer photos</Button><h3>Chat documents</h3>{webConnected&&<Button className="secondary" disabled={!!syncingChat} onClick={()=>void loadChatDocuments(active.id)}>{syncingChat===active.id?"Loading documents…":"Load chat documents"}</Button>}{chatSync?.id===active.id&&<p className="subtle" role="status">{chatSync.text}</p>}{picked.length>0&&<div className="actions">
 {selectedPdfs.length>0&&<><Button className="secondary" onClick={()=>openPrintFiles(selectedPdfs,true)}>Add to order</Button></>}
 {selectedPhotos.length>0&&<Button onClick={()=>openPrintFiles(selectedPhotos)}>Print photos ({selectedPhotos.length})</Button>}
 <Button className="quiet" onClick={()=>setSelectedFiles([])}>Clear selection</Button>
 </div>}
 <div className="chat-document-list">{customerFiles.map(file=><div key={file.id} className="stack chat-document">
  <label className="check"><input type="checkbox" aria-label={'Select '+file.name} disabled={file.status!=='Ready'} checked={selectedFiles.includes(file.id)} onChange={e=>toggleFile(file.id,e.target.checked)}/><span>{file.name}</span></label>
  <small>{file.status}{file.bytes?' / '+Math.ceil(file.bytes/1024)+' KB':''}</small>
  <div className="actions">
   <Button className="quiet" onClick={()=>showFile(file)}>{file.status==='Ready'?'Preview':file.status==='Failed'?'Retry download':file.status==='Available to download'?'Download':'Open file'}</Button>
   {file.status==='Ready'&&<Button className="quiet" onClick={()=>void run('saveAttachment',{id:file.id},'File saved')}>Download</Button>}
   {file.status==='Ready'&&(file.mime==='application/pdf'||file.mime.startsWith('image/'))&&<Button className="quiet" onClick={()=>openPrintFiles([file])}>Print</Button>}
  </div>
 </div>)}</div>
 <h3>Previous orders</h3>{data.jobs.filter(j=>j.customer_id===active.id).map(j=><button className="file-link" key={j.id} onClick={()=>state.set({job:j.id,view:'Orders'})}>{j.id} · {orderStatusLabels[j.status]}</button>)}{data.jobs.some(j=>j.customer_id===active.id)&&<Button className="secondary" onClick={()=>state.set({view:'Print Studio',job:data.jobs.find(j=>j.customer_id===active.id)!.id})}>Quick print</Button>}<h3>Recent payments</h3>{data.payments.filter(payment=>data.jobs.some(job=>job.id===payment.job_id&&job.customer_id===active.id)).slice(0,4).map(payment=><small key={payment.id}>{money(payment.amount)} · {payment.method}</small>)}</div></DetailDrawer>}
 {filePreview&&<DetailDrawer title={filePreview.name} presentation="wide" onClose={()=>setFilePreview(undefined)}>
  <div className="stack"><DocumentPreview id={filePreview.id}/>
   <div className="actions">
    {(filePreview.mime==='application/pdf'||filePreview.mime.startsWith('image/'))&&<Button onClick={()=>{setFilePreview(undefined);openPrintFiles([filePreview])}}>Print</Button>}
    <Button className="secondary" onClick={()=>void run('saveAttachment',{id:filePreview.id},'File saved')}>Download</Button>
   </div>
  </div>
 </DetailDrawer>}
 </div>
}
export function Customers(){
 const {data,run}=useData(),state=useWorkspace(),[edit,setEdit]=useState(false),[profile,setProfile]=useState(!!state.customer),[tag,setTag]=useState(''),[form,setForm]=useState({name:'',phone:'',notes:'',tag:''});
 const [query,setQuery]=useState('');
 const active=data.customers.find(c=>c.id===state.customer);
 const jobs=data.jobs.filter(j=>j.customer_id===active?.id);
 function start(c?:Customer){setProfile(true);state.set({customer:c?.id??''});setForm({name:c?.name??'',phone:c?.phone??'',tag:c?.tag??'',notes:c?.notes??''});setEdit(true)}
 const customers=data.customers.filter(c=>match(state.search,c.name,c.phone,c.tag)&&match(query,c.name,c.phone)&&(!tag||c.tag===tag));
 return <div className="stack"><div className="summary-grid"><StatCard label="Customers" value={data.customers.length} icon={Users}/><StatCard label="Customer orders" value={data.jobs.filter(order=>!!order.customer_id).length} icon={ShoppingBag} tone="cyan"/><StatCard label="Outstanding balances" value={money(data.jobs.filter(order=>order.customer_id&&order.status!=="Cancelled").reduce((sum,order)=>sum+order.total-order.paid,0))} icon={Wallet} tone="amber"/></div><Panel><div className="panel-head"><h2>Customer directory</h2><Button onClick={()=>start()}><Plus size={16}/> Add customer</Button></div><div className="filter-bar"><input aria-label="Find customer" placeholder="Search name or phone" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Customer tag" value={tag} onChange={e=>setTag(e.target.value)}><option value="">All tags</option>{[...new Set(data.customers.map(c=>c.tag).filter(Boolean))].map(value=><option key={value}>{value}</option>)}</select></div><Table headers={['Name','Phone','Orders','Outstanding','Last contact']}>{customers.map(c=><tr key={c.id}><td><button className="text-button" onClick={()=>{setEdit(false);setProfile(true);state.set({customer:c.id})}}><span className="avatar">{c.name[0]}</span>{c.name}</button></td><td>{c.phone||'—'}</td><td>{data.jobs.filter(j=>j.customer_id===c.id).length}</td><td>{money(data.jobs.filter(j=>j.customer_id===c.id&&j.status!=='Cancelled').reduce((sum,j)=>sum+j.total-j.paid,0))}</td><td>{stamp(c.last)}</td></tr>)}</Table>{!customers.length&&<Empty title="No matching customers"/>}</Panel>
 {profile&&<DetailDrawer title={edit?(active?"Edit customer":"New customer"):"Customer profile"} onClose={()=>{setEdit(false);setProfile(false)}}>{edit?<form className="stack" onSubmit={async e=>{e.preventDefault();if(await run('customer',{id:active?.id,...form},'Customer saved'))setEdit(false)}}><h2>{active?'Edit customer':'New customer'}</h2>{(['name','phone','tag','notes'] as const).map(k=><label key={k}>{k[0].toUpperCase()+k.slice(1)}{k==='notes'?<textarea value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})}/>:<input required={k==='name'} value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})}/>}</label>)}<div className="actions"><Button type="submit">Save customer</Button><Button className="secondary" onClick={()=>setEdit(false)}>Cancel</Button></div></form>:active?<div className="stack"><h2>{active.name}</h2><p>{active.phone||'Phone unavailable'}</p><p>First contact {stamp(active.created)}</p>{active.tag&&<Badge>{active.tag}</Badge>}<p>{money(jobs.reduce((n,j)=>n+j.paid,0))} paid · {money(jobs.filter(j=>j.status!=='Cancelled').reduce((n,j)=>n+j.total-j.paid,0))} outstanding</p>{active.notes&&<p>{active.notes}</p>}<div className="actions"><Button onClick={()=>start(active)}>Edit profile</Button><Button className="secondary" onClick={()=>state.set({view:'WhatsApp'})}>Conversation</Button></div><h3>Documents</h3>{data.attachments.filter(a=>a.customer_id===active.id).map(a=><button key={a.id} className="file-link" onClick={()=>state.set({view:'Documents',attachment:a.id})}>{a.name}</button>)}<h3>Print order history</h3>{jobs.map(j=><button className="file-link" key={j.id} onClick={()=>state.set({job:j.id,view:'Print Studio'})}>{j.id} · {j.status}</button>)}</div>:<Empty title="Select a customer"/>}</DetailDrawer>}</div>
}
export function Documents(){
 const {data,run,error,refresh}=useData(),state=useWorkspace(),[customer,setCustomer]=useState(''),[type,setType]=useState(''),[date,setDate]=useState(''),[selected,setSelected]=useState<string[]>([]),[creating,setCreating]=useState(false),[mode,setMode]=useState('Grid'),[byCustomer,setByCustomer]=useState(''),[page,setPage]=useState(0);
 const active=data.attachments.find(a=>a.id===state.attachment);
 const activeCustomer=data.customers.find(c=>c.id===active?.customer_id);
 const scope=active?active.customer_id??'walk-in':byCustomer;
 const owner=scope==='walk-in'?null:scope;
 const [scannerIds,setScannerIds]=useState<string[]>([]);
 function openScanner(ids:string[]){
  const images=ids.map(id=>data.attachments.find(file=>file.id===id));
  if(!images.length||images.length>40||images.some(file=>!file||file.status!=='Ready'||!file.mime.startsWith('image/')||file.customer_id!==images[0]?.customer_id)){
   error(new Error('Select up to 40 ready photos belonging to one customer.'));return;
  }
  setScannerIds(ids);
 }
 useEffect(()=>{
  if(state.scannerAttachment){
   openScanner([state.scannerAttachment]);
   state.set({scannerAttachment:''});
  }
 },[state.scannerAttachment]);

 const [conversionMode,setConversionMode]=useState<'pages'|'notes'|'outline'>('pages');
 const [includeHidden,setIncludeHidden]=useState(false),[converting,setConverting]=useState(false);
 const presentation=!!active&&/\.pptx?$/i.test(active.name);
 async function convert(print=false){
  if(!active||converting)return;
  setConverting(true);
  try{
   const id=await window.bloom.call('convertDocument',{id:active.id,mode:presentation?conversionMode:'pages',includeHidden:presentation&&includeHidden});
   await refresh();state.set({attachment:id,...(print?{pdfPrintAttachment:id,pdfBatchDraft:[]}:{})});
  }catch(e){error(e)}finally{setConverting(false)}
 }

 const files=data.attachments.filter(a=>match(state.search,a.name,name(data,a.customer_id))&&(!scope||a.customer_id===owner)&&(!type||a.mime.startsWith(type))&&(!date||new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Colombo'}).format(new Date(a.created))===date));
 const activeIndex=files.findIndex(file=>file.id===active?.id);
 useEffect(()=>{
  if(scope)setSelected(ids=>ids.filter(id=>data.attachments.some(file=>file.id===id&&file.customer_id===owner)));
 },[scope]);
 useEffect(()=>{
  if(activeIndex>=0)setPage(Math.floor(activeIndex/12));
 },[activeIndex]);
 function filterCustomer(value:string){
  setByCustomer(value);
  setPage(0);
  if(value!==scope)setSelected([]);
  if(active&&(!value||(active.customer_id??'walk-in')!==value))state.set({attachment:''});
 }
 const selectedArePhotos=selected.length>0&&selected.every(id=>data.attachments.find(file=>file.id===id)?.mime.startsWith('image/'));
 const selectPhotos=()=>{
  const first=data.attachments.find(file=>file.id===selected[0])??active;
  const ready=files.filter(file=>file.status==='Ready'&&file.mime.startsWith('image/'));
  const matching=first?ready.filter(file=>file.customer_id===first.customer_id):ready;
  if(matching.some(file=>file.customer_id!==matching[0]?.customer_id)){error(new Error('Filter by customer or select a photo first.'));return}
  if(matching.length>40){error(new Error('Select at most 40 photos in one order.'));return}
  setSelected(matching.map(file=>file.id));
 };
 const lastPage=Math.max(0,Math.ceil(files.length/12)-1), currentPage=Math.min(page,lastPage);
 const toggle=(id:string)=>{
  const item=data.attachments.find(item=>item.id===id),first=data.attachments.find(item=>selected.includes(item.id));
  if(!item)return;
  if(!selected.includes(id)&&first&&first.customer_id!==item.customer_id){error(new Error('Select files belonging to one customer. Clear the selection to change customers.'));return}
  if(!scope&&!selected.includes(id))filterCustomer(item.customer_id??'walk-in');
  setSelected(items=>items.includes(id)?items.filter(value=>value!==id):[...items,id]);
 };
 const selectAll=()=>{
  const ready=files.filter(item=>item.status==='Ready');
  if(ready.some(item=>item.customer_id!==ready[0]?.customer_id)){error(new Error('Filter the library to one customer before selecting all files.'));return}
  if(ready.length>40){error(new Error('Select at most 40 files in one order.'));return}
  setSelected(ready.map(item=>item.id));
 };
 async function create(ids:string[]){
  if(creating)return;
  setCreating(true);
  try{
    const entries=ids.map(id=>data.attachments.find(a=>a.id===id));
    if(!entries.length||entries.some(item=>!item||item.status!=='Ready'||item.customer_id!==entries[0]!.customer_id))throw new Error('Select ready files belonging to the same customer.');
    if(entries.every(item=>item!.mime.startsWith('image/'))){
      if(ids.length>40)throw new Error('Select at most 40 photos in one order.');
      setSelected([]);
      state.set({view:'Print Studio',job:'',customer:entries[0]!.customer_id??'walk-in',photoStudio:true,photoDraft:ids});
      return;
    }
    const calculations=[];
    for(const item of entries){
      const image=item!.mime.startsWith('image/');
      const documentPages=await documentPageCount(item!.id);
      calculations.push({id:item!.id,settings:{documentPages,copies:1 as const,paper:'A4' as const,pricing:{basis:image?'sheet' as const:'page' as const,mono:image?data.settings!.photo:data.settings!.mono,colour:data.settings!.colour}}});
    }
    const job=await window.bloom.call('order',{customer:entries[0]!.customer_id,files:ids,copies:1,paper:'A4',colour:false,price:0,discount:0,charge:0,calculations});
    await refresh();setSelected([]);state.set({view:'Print Studio',job});
  }catch(e){error(e)}finally{setCreating(false)}
 }
 return <div className="split"><Panel><div className="panel-head"><div><h2>Document library</h2><p>{files.length} matching files</p></div><Button onClick={()=>void run('import',{customer:customer||null})}><Plus size={16}/> Import files</Button></div><Tabs label="Document view" values={["Grid","List"]} value={mode} onChange={setMode}/><div className="actions filters"><select aria-label="Filter by customer" value={scope} onChange={e=>filterCustomer(e.target.value)}><option value="">All customers</option><option value="walk-in">Walk-in</option>{data.customers.map(c=><option value={c.id} key={c.id}>{c.name}{c.phone?' · '+c.phone:""}</option>)}</select><select aria-label="Import for customer" value={customer} onChange={e=>setCustomer(e.target.value)}><option value="">Import for walk-in</option>{data.customers.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select><select aria-label="Type filter" value={type} onChange={e=>setType(e.target.value)}><option value="">All file types</option><option value="application/pdf">PDF</option><option value="image/">Images</option></select><input aria-label="Date filter" type="date" value={date} onChange={e=>setDate(e.target.value)}/><Button className="secondary" onClick={selectAll}>Select all ready</Button><Button className="secondary" onClick={selectPhotos}>Select matching photos</Button>{selected.length>0&&<Button className="quiet" onClick={()=>setSelected([])}>Clear selection</Button>}{selected.length>0&&<Button disabled={creating} onClick={()=>void create(selected)}>{selectedArePhotos?'Print selected photos':'Batch order'} ({selected.length})</Button>}{selectedArePhotos&&<Button className="secondary" onClick={()=>openScanner(selected)}><ScanLine size={15}/> Scan selected photos</Button>}</div>
  {mode==='Grid'?<div className="document-grid">{files.slice(currentPage*12,currentPage*12+12).map(file=><article className="document-card" key={file.id} data-selected={file.id===active?.id}>
 <button type="button" className="file-art" aria-label={'Preview '+file.name} onClick={()=>state.set({attachment:file.id})}><FileText size={24}/>{file.status==='Ready'&&<DocumentThumbnail id={file.id}/>}</button><button className="text-button" onClick={()=>state.set({attachment:file.id})}>{file.name}</button>
 <small>{name(data,file.customer_id)} · {stamp(file.created)}</small><div className="actions"><Badge>{file.status}</Badge><label className="check"><input type="checkbox" aria-label={'Select '+file.name} checked={selected.includes(file.id)} disabled={file.status!=='Ready'} onChange={()=>toggle(file.id)}/></label></div></article>)}</div>:<Table headers={['','File','Customer','Status']}>{files.map(a=><tr key={a.id}><td><input type="checkbox" aria-label={'Select '+a.name} checked={selected.includes(a.id)} disabled={a.status!=='Ready'} onChange={()=>toggle(a.id)}/></td><td><button className="text-button" onClick={()=>state.set({attachment:a.id})}>{a.name}</button><small>{stamp(a.created)}</small></td><td>{name(data,a.customer_id)}</td><td><Badge>{a.status}</Badge></td></tr>)}</Table>}{mode==="Grid"&&lastPage>0&&<div className="actions library-pager"><Button className="secondary" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>Previous</Button><small>{currentPage+1} / {lastPage+1}</small><Button className="secondary" disabled={currentPage===lastPage} onClick={()=>setPage(currentPage+1)}>Next</Button></div>}{!files.length&&<Empty title="No matching files"><p>Import a document or image, or receive one through WhatsApp.</p></Empty>}</Panel>
 <Panel>{active?<div className="stack"><h2>{active.name}</h2><p>{name(data,active.customer_id)} · {active.bytes?Math.ceil(active.bytes/1024)+' KB':active.status}</p>{files.length>0&&<div className="stack">
 <label>Document in this customer library<select value={activeIndex<0?'':active.id} onChange={e=>state.set({attachment:e.target.value})}>
 {activeIndex<0&&<option value="" disabled>Choose a matching document</option>}
 {files.map((file,index)=><option key={file.id} value={file.id}>{index+1}. {file.name} ({stamp(file.created)})</option>)}
 </select></label>
 <div className="actions">
  <Button className="secondary" disabled={activeIndex<=0} onClick={()=>state.set({attachment:files[activeIndex-1].id})}>Previous document</Button>
  <Button className="secondary" disabled={activeIndex<0||activeIndex>=files.length-1} onClick={()=>state.set({attachment:files[activeIndex+1].id})}>Next document</Button>
 </div>
 </div>}{active.status==='Ready'?<><DocumentPreview key={active.id} id={active.id} onCount={noCount}/><div className="actions">{active.mime==='application/pdf'?<Button onClick={()=>state.set({pdfPrintAttachment:active.id})}><Printer size={16}/> Print PDF</Button>:<Button disabled={creating} onClick={()=>void create([active.id])}>Create print order</Button>}{active.mime.startsWith('image/')&&<>
 <Button className="secondary" onClick={()=>state.set({view:'Print Studio',job:'',customer:active.customer_id??'walk-in',photoStudio:true,photoDraft:[active.id],lightenPhotoDraft:true})}>Lighten &amp; print</Button>
 <Button className="secondary" onClick={()=>openScanner([active.id])}><ScanLine size={16}/> Auto Scan &amp; Clean</Button>
 </>}</div></>:active.status==='Needs conversion'?<>
 {presentation&&<><label>PowerPoint output<select value={conversionMode} onChange={e=>setConversionMode(e.target.value as typeof conversionMode)}><option value="pages">Full-page slides (use for handouts)</option><option value="notes">Speaker notes pages</option><option value="outline">Outline</option></select></label><label className="check"><input type="checkbox" checked={includeHidden} onChange={e=>setIncludeHidden(e.target.checked)}/> Include hidden slides</label></>}
 <p>{active.mime.startsWith('image/')?'Conversion creates a separate PNG.':'Conversion creates a separate PDF using installed Office or LibreOffice for supported files. Check the preview before printing.'}</p><Button disabled={converting} onClick={()=>void convert()}>{converting?'Converting...':active.mime.startsWith('image/')?'Convert to PNG':'Convert to PDF'}</Button>{!active.mime.startsWith('image/')&&<Button className="secondary" disabled={converting} onClick={()=>void convert(true)}><Printer size={16}/> Convert &amp; print</Button>}
 </>:['Failed','Available to download'].includes(active.status)&&active.message_id?<Button onClick={()=>void run('retryMedia',{id:active.id})}>{active.status==='Failed'?'Retry download':'Download and preview'}</Button>:null}</div>:<Empty title="Select a file to preview"/>}</Panel>{scannerIds.length>0&&<ScannerDialog ids={scannerIds} onClose={()=>setScannerIds([])}/>}</div>
}
