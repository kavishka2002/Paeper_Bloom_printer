import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {FileText,Plus,Printer,ScanLine,ShoppingBag,Users,Wallet} from 'lucide-react';
import {DetailDrawer,StatCard,Tabs} from './design';
import type {Customer} from '../../packages/shared/contracts';
import {useData,Panel,Button,Badge,Table,Empty,match,money,name,stamp} from './context';
import {useWorkspace} from './state';
import {DocumentPreview,DocumentThumbnail,documentPageCount} from './pdf';
import {ScannerDialog} from './scanner';
import {unreadInboxMessage,visibleInboxMessage} from './inbox-messages';
const noCount=()=>{};
export function InboxView(){
 const {data,run,refresh,error}=useData(),state=useWorkspace(),[unread,setUnread]=useState(false),[query,setQuery]=useState(''),[draft,setDraft]=useState('');
 const active=data.customers.find(c=>c.id===state.customer);
 const [syncingChat,setSyncingChat]=useState('');
 const [chatSync,setChatSync]=useState<{id:string;text:string}>();
 const webConnected=data.connection.mode==='web'&&data.connection.status==='Connected';
 const visibleMessages=data.messages.filter(visibleInboxMessage);
 async function loadChatDocuments(id:string){
  if(syncingChat)return;
  setSyncingChat(id);setChatSync(undefined);
  try{
   const result=await window.bloom.call('webChatSync',{id});
   await refresh();
   const text=result.documents?`${result.documents} PDF or image attachment(s) found. Select a file to open it.`:'No PDF or image attachments found in the history WhatsApp returned for this chat.';
   setChatSync({id,text:text+(result.partial?' WhatsApp could only return history already loaded in this session.':'')});
  }catch(e){error(e)}finally{setSyncingChat('')}
 }
 const conversations=data.customers.map(c=>({c,list:visibleMessages.filter(m=>m.customer_id===c.id)})).filter(({c,list})=>(list.length||webConnected&&query.trim())&&match(query,c.name,c.phone)&&(!unread||list.some(unreadInboxMessage))).sort((a,b)=>(b.list.at(-1)?.created??b.c.last).localeCompare(a.list.at(-1)?.created??a.c.last));
 const messages=visibleMessages.filter(m=>m.customer_id===active?.id);
 const history=useRef<HTMLDivElement>(null), followNewest=useRef(true), openedCustomer=useRef<string|undefined>(undefined);
 const newest=messages.at(-1)?.id;
 const unreadInChat=messages.filter(unreadInboxMessage);
 const unreadKey=unreadInChat.map(message=>message.id).join('|');
 useEffect(()=>{if(active?.id&&unreadKey)void run('read',{id:active.id})},[active?.id,unreadKey]);
 useLayoutEffect(()=>{
  if(openedCustomer.current!==active?.id){openedCustomer.current=active?.id;followNewest.current=true}
  if(history.current&&followNewest.current)history.current.scrollTop=history.current.scrollHeight;
 },[active?.id,newest]);
 return <div className="stack">
 <div className="connection" data-connected={webConnected||data.connection.status==="API reachable"}><div><strong>WhatsApp · {data.connection.status}</strong>{data.connection.detail&&<p>{data.connection.detail}</p>}{!webConnected&&!data.connection.detail&&data.connection.status!=='API reachable'&&<p>Connect WhatsApp to load chats and documents.</p>}</div>
 {!webConnected&&data.connection.status!=='API reachable'&&<Button className="secondary" onClick={()=>state.set({view:'Automation Engine'})}>Open connection settings</Button>}</div>
 <div className="inbox-layout panel">
 <aside className="conversation-list"><div className="padded stack"><h2>Conversations</h2>{data.connection.mode==="web"&&data.connection.status==="Connected"&&<><Button className="secondary" disabled={data.connection.sync?.startsWith("Syncing")} onClick={()=>void run("webSync",null)}>Sync recent chats</Button>{data.connection.sync&&<p className="subtle" role="status">{data.connection.sync}</p>}</>}<input aria-label="Find a conversation" placeholder="Find a conversation" value={query} onChange={e=>setQuery(e.target.value)}/><label className="check"><input type="checkbox" checked={unread} onChange={e=>setUnread(e.target.checked)}/> Unread only</label></div>
 {conversations.map(({c,list})=><button key={c.id} className={'conversation '+(active?.id===c.id?'selected':'')} onClick={()=>{state.set({customer:c.id});setDraft('')}}><span className="avatar">{c.name[0]}</span><span><strong>{c.name}</strong><small>{c.phone}</small><small>{list.at(-1)?.body||list.at(-1)?.kind}</small><small>{stamp(list.at(-1)?.created??c.last)}</small></span>{list.some(unreadInboxMessage)&&<i className="unread unread-count" aria-label={list.filter(unreadInboxMessage).length+" unread"}>{list.filter(unreadInboxMessage).length}</i>}</button>)}
 {!conversations.length&&<Empty title="No conversations found"><p>Search for a customer by name or number, or sync recent chats after connecting.</p></Empty>}</aside>
 <section className="chat"><label className="check quick-pdf-toggle"><input type="checkbox" checked={state.autoPdfPrint} onChange={event=>{const enabled=event.target.checked;localStorage.setItem('autoPdfPrint',enabled?'on':'off');state.set({autoPdfPrint:enabled})}}/> Open print preview for new PDFs</label>{active?<><div className="chat-title"><span className="avatar">{active.name[0]}</span><div><strong>{active.name}</strong><p>{active.phone}</p></div><Badge>{data.connection.status}</Badge></div><div ref={history} className="chat-history" onScroll={e=>{const area=e.currentTarget;followNewest.current=area.scrollHeight-area.scrollTop-area.clientHeight<60}}>{messages.map(m=>{const a=data.attachments.find(a=>a.message_id===m.id);return <div className={'bubble '+m.direction} key={m.id}><div>{m.body||(!a?m.kind:'')}</div>{a&&<button className="file-link" onClick={()=>{state.set({attachment:a.id,view:'Documents'});if(a.status==='Available to download')void run('retryMedia',{id:a.id})}}><FileText size={16}/>{a.name} · {a.status}</button>}{a?.status==='Ready'&&a.mime==='application/pdf'&&<Button className="quiet" onClick={()=>state.set({pdfPrintAttachment:a.id})}><Printer size={14}/> Print PDF</Button>}{a?.status==='Ready'&&a.mime.startsWith('image/')&&<Button className="quiet" onClick={()=>state.set({view:'Documents',attachment:a.id,scannerAttachment:a.id})}><ScanLine size={14}/> Auto Scan &amp; Clean</Button>}<small>{stamp(m.created)} · {m.status}</small></div>})}</div>
 <form className="composer" onSubmit={async e=>{e.preventDefault();if(await run('reply',{id:active.id,text:draft},'Reply submitted to WhatsApp'))setDraft('')}}><input aria-label="Reply" placeholder="Write a reply" value={draft} maxLength={4096} onChange={e=>setDraft(e.target.value)}/><Button type="submit" disabled={!draft.trim()||!['API reachable','Connected'].includes(data.connection.status)}>Send</Button></form></>:<Empty title="Select a conversation"/>}</section>
 <aside className="padded stack customer-rail"><h2>Customer details</h2>{active?<><strong>{active.name}</strong><p>{active.phone||'Phone unavailable'}</p>{active.tag&&<Badge>{active.tag}</Badge>}<p>{money(data.jobs.filter(j=>j.customer_id===active.id&&j.status!=='Cancelled').reduce((n,j)=>n+j.total-j.paid,0))} outstanding</p><Button className="secondary" onClick={()=>state.set({view:'Customers'})}>Open profile</Button><Button onClick={()=>state.set({view:'Print Studio',job:'',customer:active.id,photoStudio:true})}>Photos ? bulk print</Button><h3>Chat documents</h3>{webConnected&&<Button className="secondary" disabled={!!syncingChat} onClick={()=>void loadChatDocuments(active.id)}>{syncingChat===active.id?"Loading documents…":"Load chat documents"}</Button>}{chatSync?.id===active.id&&<p className="subtle" role="status">{chatSync.text}</p>}{data.attachments.filter(a=>a.customer_id===active.id).map(a=><button className="file-link" key={a.id} onClick={()=>state.set({attachment:a.id,view:'Documents'})}>{a.name}</button>)}<h3>Previous orders</h3>{data.jobs.filter(j=>j.customer_id===active.id).map(j=><button className="file-link" key={j.id} onClick={()=>state.set({job:j.id,view:'Orders'})}>{j.id} · {j.status}</button>)}{data.jobs.some(j=>j.customer_id===active.id)&&<Button className="secondary" onClick={()=>state.set({view:'Print Studio',job:data.jobs.find(j=>j.customer_id===active.id)!.id})}>Quick print</Button>}<h3>Recent payments</h3>{data.payments.filter(payment=>data.jobs.some(job=>job.id===payment.job_id&&job.customer_id===active.id)).slice(0,4).map(payment=><small key={payment.id}>{money(payment.amount)} · {payment.method}</small>)}</>:<p className="subtle">Open a conversation to view its customer record.</p>}</aside></div></div>
}
export function Customers(){
 const {data,run}=useData(),state=useWorkspace(),[edit,setEdit]=useState(false),[profile,setProfile]=useState(!!state.customer),[tag,setTag]=useState(''),[form,setForm]=useState({name:'',phone:'',notes:'',tag:''});
 const active=data.customers.find(c=>c.id===state.customer);
 const jobs=data.jobs.filter(j=>j.customer_id===active?.id);
 function start(c?:Customer){setProfile(true);state.set({customer:c?.id??''});setForm({name:c?.name??'',phone:c?.phone??'',tag:c?.tag??'',notes:c?.notes??''});setEdit(true)}
 const customers=data.customers.filter(c=>match(state.search,c.name,c.phone,c.tag)&&(!tag||c.tag===tag));
 return <div className="stack"><div className="summary-grid"><StatCard label="Customers" value={data.customers.length} icon={Users}/><StatCard label="Customer orders" value={data.jobs.filter(order=>!!order.customer_id).length} icon={ShoppingBag} tone="cyan"/><StatCard label="Outstanding balances" value={money(data.jobs.filter(order=>order.customer_id&&order.status!=="Cancelled").reduce((sum,order)=>sum+order.total-order.paid,0))} icon={Wallet} tone="amber"/></div><Panel><div className="panel-head"><h2>Customer directory</h2><Button onClick={()=>start()}><Plus size={16}/> Add customer</Button></div><div className="filter-bar"><select aria-label="Customer tag" value={tag} onChange={e=>setTag(e.target.value)}><option value="">All tags</option>{[...new Set(data.customers.map(c=>c.tag).filter(Boolean))].map(value=><option key={value}>{value}</option>)}</select></div><Table headers={['Name','Phone','Orders','Outstanding','Last contact']}>{customers.map(c=><tr key={c.id}><td><button className="text-button" onClick={()=>{setEdit(false);setProfile(true);state.set({customer:c.id})}}><span className="avatar">{c.name[0]}</span>{c.name}</button></td><td>{c.phone||'—'}</td><td>{data.jobs.filter(j=>j.customer_id===c.id).length}</td><td>{money(data.jobs.filter(j=>j.customer_id===c.id&&j.status!=='Cancelled').reduce((sum,j)=>sum+j.total-j.paid,0))}</td><td>{stamp(c.last)}</td></tr>)}</Table>{!customers.length&&<Empty title="No matching customers"/>}</Panel>
 {profile&&<DetailDrawer title={edit?(active?"Edit customer":"New customer"):"Customer profile"} onClose={()=>{setEdit(false);setProfile(false)}}>{edit?<form className="stack" onSubmit={async e=>{e.preventDefault();if(await run('customer',{id:active?.id,...form},'Customer saved'))setEdit(false)}}><h2>{active?'Edit customer':'New customer'}</h2>{(['name','phone','tag','notes'] as const).map(k=><label key={k}>{k[0].toUpperCase()+k.slice(1)}{k==='notes'?<textarea value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})}/>:<input required={k==='name'} value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})}/>}</label>)}<div className="actions"><Button type="submit">Save customer</Button><Button className="secondary" onClick={()=>setEdit(false)}>Cancel</Button></div></form>:active?<div className="stack"><h2>{active.name}</h2><p>{active.phone||'Phone unavailable'}</p><p>First contact {stamp(active.created)}</p>{active.tag&&<Badge>{active.tag}</Badge>}<p>{money(jobs.reduce((n,j)=>n+j.paid,0))} paid · {money(jobs.filter(j=>j.status!=='Cancelled').reduce((n,j)=>n+j.total-j.paid,0))} outstanding</p>{active.notes&&<p>{active.notes}</p>}<div className="actions"><Button onClick={()=>start(active)}>Edit profile</Button><Button className="secondary" onClick={()=>state.set({view:'WhatsApp'})}>Conversation</Button></div><h3>Documents</h3>{data.attachments.filter(a=>a.customer_id===active.id).map(a=><button key={a.id} className="file-link" onClick={()=>state.set({view:'Documents',attachment:a.id})}>{a.name}</button>)}<h3>Print order history</h3>{jobs.map(j=><button className="file-link" key={j.id} onClick={()=>state.set({job:j.id,view:'Print Studio'})}>{j.id} · {j.status}</button>)}</div>:<Empty title="Select a customer"/>}</DetailDrawer>}</div>
}
export function Documents(){
 const {data,run,error,refresh}=useData(),state=useWorkspace(),[customer,setCustomer]=useState(''),[type,setType]=useState(''),[date,setDate]=useState(''),[selected,setSelected]=useState<string[]>([]),[creating,setCreating]=useState(false),[mode,setMode]=useState('Grid'),[byCustomer,setByCustomer]=useState(''),[page,setPage]=useState(0);
 const active=data.attachments.find(a=>a.id===state.attachment);
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
 async function convert(){
  if(!active||converting)return;
  setConverting(true);
  try{
   const id=await window.bloom.call('convertDocument',{id:active.id,mode:presentation?conversionMode:'pages',includeHidden:presentation&&includeHidden});
   await refresh();state.set({attachment:id});
  }catch(e){error(e)}finally{setConverting(false)}
 }

 const files=data.attachments.filter(a=>match(state.search,a.name,name(data,a.customer_id))&&(!byCustomer||a.customer_id===byCustomer)&&(!type||a.mime.startsWith(type))&&(!date||new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Colombo'}).format(new Date(a.created))===date));
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
  if(!selected.includes(id)&&first&&first.customer_id!==item?.customer_id){error(new Error('Select files belonging to one customer. Clear the selection to change customers.'));return}
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
 return <div className="split"><Panel><div className="panel-head"><div><h2>Document library</h2><p>{files.length} matching files</p></div><Button onClick={()=>void run('import',{customer:customer||null})}><Plus size={16}/> Import files</Button></div><Tabs label="Document view" values={["Grid","List"]} value={mode} onChange={setMode}/><div className="actions filters"><select aria-label="Filter by customer" value={byCustomer} onChange={e=>{setByCustomer(e.target.value);setPage(0)}}><option value="">All customers</option>{data.customers.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select><select aria-label="Import for customer" value={customer} onChange={e=>setCustomer(e.target.value)}><option value="">Import for walk-in</option>{data.customers.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select><select aria-label="Type filter" value={type} onChange={e=>setType(e.target.value)}><option value="">All file types</option><option value="application/pdf">PDF</option><option value="image/">Images</option></select><input aria-label="Date filter" type="date" value={date} onChange={e=>setDate(e.target.value)}/><Button className="secondary" onClick={selectAll}>Select all ready</Button><Button className="secondary" onClick={selectPhotos}>Select matching photos</Button>{selected.length>0&&<Button className="quiet" onClick={()=>setSelected([])}>Clear selection</Button>}{selected.length>0&&<Button disabled={creating} onClick={()=>void create(selected)}>{selectedArePhotos?'Print selected photos':'Batch order'} ({selected.length})</Button>}{selectedArePhotos&&<Button className="secondary" onClick={()=>openScanner(selected)}><ScanLine size={15}/> Scan selected photos</Button>}</div>
  {mode==='Grid'?<div className="document-grid">{files.slice(currentPage*12,currentPage*12+12).map(file=><article className="document-card" key={file.id} data-selected={file.id===active?.id}>
 <button type="button" className="file-art" aria-label={'Preview '+file.name} onClick={()=>state.set({attachment:file.id})}><FileText size={24}/>{file.status==='Ready'&&<DocumentThumbnail id={file.id}/>}</button><button className="text-button" onClick={()=>state.set({attachment:file.id})}>{file.name}</button>
 <small>{name(data,file.customer_id)} · {stamp(file.created)}</small><div className="actions"><Badge>{file.status}</Badge><label className="check"><input type="checkbox" aria-label={'Select '+file.name} checked={selected.includes(file.id)} disabled={file.status!=='Ready'} onChange={()=>toggle(file.id)}/></label></div></article>)}</div>:<Table headers={['','File','Customer','Status']}>{files.map(a=><tr key={a.id}><td><input type="checkbox" aria-label={'Select '+a.name} checked={selected.includes(a.id)} disabled={a.status!=='Ready'} onChange={()=>toggle(a.id)}/></td><td><button className="text-button" onClick={()=>state.set({attachment:a.id})}>{a.name}</button><small>{stamp(a.created)}</small></td><td>{name(data,a.customer_id)}</td><td><Badge>{a.status}</Badge></td></tr>)}</Table>}{mode==="Grid"&&lastPage>0&&<div className="actions library-pager"><Button className="secondary" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>Previous</Button><small>{currentPage+1} / {lastPage+1}</small><Button className="secondary" disabled={currentPage===lastPage} onClick={()=>setPage(currentPage+1)}>Next</Button></div>}{!files.length&&<Empty title="No matching files"><p>Import a document or image, or receive one through WhatsApp.</p></Empty>}</Panel>
 <Panel>{active?<div className="stack"><h2>{active.name}</h2><p>{name(data,active.customer_id)} · {active.bytes?Math.ceil(active.bytes/1024)+' KB':active.status}</p>{active.status==='Ready'?<><DocumentPreview key={active.id} id={active.id} onCount={noCount}/><div className="actions">{active.mime==='application/pdf'?<Button onClick={()=>state.set({pdfPrintAttachment:active.id})}><Printer size={16}/> Print PDF</Button>:<Button disabled={creating} onClick={()=>void create([active.id])}>Create print order</Button>}{active.mime.startsWith('image/')&&<Button className="secondary" onClick={()=>openScanner([active.id])}><ScanLine size={16}/> Auto Scan &amp; Clean</Button>}</div></>:active.status==='Needs conversion'?<>
 {presentation&&<><label>PowerPoint output<select value={conversionMode} onChange={e=>setConversionMode(e.target.value as typeof conversionMode)}><option value="pages">Full-page slides (use for handouts)</option><option value="notes">Speaker notes pages</option><option value="outline">Outline</option></select></label><label className="check"><input type="checkbox" checked={includeHidden} onChange={e=>setIncludeHidden(e.target.checked)}/> Include hidden slides</label></>}
 <p>{active.mime.startsWith('image/')?'Conversion creates a separate PNG.':'Conversion creates a separate PDF using installed Microsoft Office. Check the PDF for font substitutions and layout differences before printing.'}</p><Button disabled={converting} onClick={()=>void convert()}>{converting?'Converting...':active.mime.startsWith('image/')?'Convert to PNG':'Convert to PDF'}</Button>
 </>:['Failed','Available to download'].includes(active.status)&&active.message_id?<Button onClick={()=>void run('retryMedia',{id:active.id})}>{active.status==='Failed'?'Retry download':'Download and preview'}</Button>:null}</div>:<Empty title="Select a file to preview"/>}</Panel>{scannerIds.length>0&&<ScannerDialog ids={scannerIds} onClose={()=>setScannerIds([])}/>}</div>
}
