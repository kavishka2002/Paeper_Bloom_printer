import {isVirtualPrinter} from '../../packages/printing/capabilities';
import {useEffect,useState,type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal} from 'react-dom';
import {QueryClient,QueryClientProvider,useQuery} from '@tanstack/react-query';
import {AlertCircle,Bell,Check,ChevronRight,MessageCircle,Moon,Printer,Search,Sun,X} from 'lucide-react';
import {ctx,Button,Panel,match} from './context';
import {Setup,Settings,ConnectionPage,BackupPage} from './setup';
import {InboxView,Customers,Documents} from './records';
import {PdfPrintPopup,Studio,Queue,Orders,Payments,Reports} from './jobs';
import {Automation,AutoReplies,EngineLogs} from './automation';
import {Dashboard} from './dashboard';
import {AppFooter} from './about';
import {unreadInboxMessage} from './inbox-messages';
import {groups,pageTitle,Sidebar} from './navigation';
import {MotionConfig,PageHeader,PageSurface} from './design';
import {preparePrint} from './pdf';
import {useWorkspace} from './state';
import '@fontsource-variable/inter';
import '@fontsource/noto-sans-sinhala/400.css';
import '@fontsource/noto-sans-sinhala/600.css';
import './style.css';
import './theme.css';
const client=new QueryClient({defaultOptions:{queries:{retry:1,staleTime:2000}}});
declare global{interface Window{startupReady?:()=>Promise<void>}}
function App(){
 const s=useWorkspace(),[notice,setNotice]=useState<{text:string;error:boolean}>(),[menu,setMenu]=useState(''),[busy,setBusy]=useState(0);
 const [collapsed,setCollapsed]=useState(()=>localStorage.getItem('sidebar')==='collapsed');
 const snapshot=useQuery({queryKey:['data'],queryFn:()=>window.bloom.call('snapshot',null),refetchInterval:30000});
 const printer=useQuery({queryKey:['printers'],queryFn:()=>window.bloom.call('printers',null),refetchInterval:25000});
 const startupSettled=!!snapshot.data||snapshot.isError;
 useEffect(()=>{if(startupSettled)void window.startupReady?.().catch(()=>{})},[startupSettled]);
 const refresh=()=>client.invalidateQueries({queryKey:['data']});
 useEffect(()=>window.bloom.subscribe(()=>void refresh()),[]);
 useEffect(()=>{document.documentElement.dataset.theme=s.dark?'dark':'light';localStorage.setItem('theme',s.dark?'dark':'light')},[s.dark]);
 useEffect(()=>{localStorage.setItem('sidebar',collapsed?'collapsed':'expanded')},[collapsed]);
 useEffect(()=>{
  const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setMenu('')};
  window.addEventListener('keydown',close);return ()=>window.removeEventListener('keydown',close);
 },[]);
 const error=(e:unknown)=>{
  const text=(e instanceof Error?e.message:String(e)).replace(/^Error invoking remote method 'bloom:call':\s*(?:Error:\s*)?/,'');
  setNotice({text,error:true});
 };
 const run:React.ContextType<typeof ctx>['run']=async(op,input,message)=>{
  setBusy(n=>n+1);setNotice(undefined);
  try{const result=await window.bloom.call(op,input);await refresh();const text=message||(result===true&&op==='backup'?'Backup saved':result===true&&op==='receipt'?'Receipt PDF saved':'');if(text)setNotice({text,error:false});return true}
  catch(e){error(e);return false}finally{setBusy(n=>n-1)}
 };
 const toast=notice&&<div className={'toast '+(notice.error?'error':'')} role={notice.error?'alert':'status'}>{notice.error?<AlertCircle size={18}/>:<Check size={18}/>}<span>{notice.text}</span><button type="button" aria-label="Dismiss" onClick={()=>setNotice(undefined)}><X size={16}/></button></div>;
 const activeDialog=notice?.error?document.querySelector('dialog[open] .drawer-content'):null;
 const status=toast&&activeDialog?createPortal(toast,activeDialog):toast;
 const data=snapshot.data;
 if(!data)return <div className="setup"><Panel><h1>BloomConnect</h1>{snapshot.isError?<><p role="alert">{snapshot.error.message}</p><Button onClick={()=>void snapshot.refetch()}>Retry</Button></>:<div role="status" aria-label="Loading workspace" className="loading-stack"><i className="skeleton"/><i className="skeleton"/><i className="skeleton"/></div>}</Panel></div>;
 const providers={data,run,printers:printer.data??[],refresh,error};
 if(!data.settings)return <ctx.Provider value={providers}><Setup/>{status}</ctx.Provider>;
 const settings=data.settings,isSi=settings.language==='si';
 const title=pageTitle(s.view,isSi);
 const group=groups.find(section=>section.items.some(item=>item[0]===s.view));
 const pages:Record<string,ReactNode>={Dashboard:<Dashboard/>,WhatsApp:<InboxView/>,Customers:<Customers/>,Documents:<Documents/>,Automation:<Automation/>, 'Automation Engine':<ConnectionPage/>,'Auto Replies':<AutoReplies/>,'Engine Logs':<EngineLogs/>, 'Print Studio':<Studio/>,'Print Queue':<Queue/>,'Print History':<Queue history/>,Orders:<Orders/>,Payments:<Payments/>,Reports:<Reports/>,Settings:<Settings/>,Backup:<BackupPage/>};
 const hits=s.search.trim()?[
 ...data.customers.filter(c=>match(s.search,c.name,c.phone)).slice(0,4).map(c=>({text:c.name,view:'Customers',go:()=>s.set({customer:c.id})})),
 ...data.attachments.filter(a=>match(s.search,a.name)).slice(0,4).map(a=>({text:a.name,view:'Documents',go:()=>s.set({attachment:a.id})})),
 ...data.jobs.filter(j=>match(s.search,j.id)).slice(0,4).map(j=>({text:j.id,view:'Orders',go:()=>s.set({job:j.id})}))
 ]:[];
 const go=(view:string)=>{s.set({view,search:''});setMenu('')};
 const connected=['API reachable','Connected'].includes(data.connection.status),printerReady=providers.printers.some(p=>p.name===settings.printer&&!isVirtualPrinter(p.name));
 const notifications=data.activity.filter(a=>a.kind==='Operator notification').slice(0,6);
 return <ctx.Provider value={providers}><div className="app-shell" data-collapsed={collapsed}>
 <Sidebar shop={settings.shop} status={data.connection.status} unreadCount={data.messages.filter(unreadInboxMessage).length} sinhala={isSi} collapsed={collapsed} toggle={()=>setCollapsed(!collapsed)} go={go}/>
 <div className="workspace"><header className="topbar">
 <div className="breadcrumbs" aria-label="Breadcrumb"><span>{isSi?group?.si:group?.label}</span><ChevronRight size={13}/><strong>{title}</strong></div>
 <div className="global-search"><Search size={16}/><input placeholder="Search customers, files, orders…" aria-label="Global search" value={s.search} onFocus={()=>setMenu('search')} onChange={e=>{s.set({search:e.target.value});setMenu('search')}}/>{menu==='search'&&s.search&&<div className="dropdown search-results">{hits.length?hits.map((h,i)=><button key={i} type="button" onClick={()=>{h.go();go(h.view)}}>{h.text}<small>{pageTitle(h.view,isSi)}</small></button>):<p>No matches</p>}</div>}</div>
 <div className="top-actions"><button type="button" className="top-status" onClick={()=>go('Automation Engine')} title={'WhatsApp · '+data.connection.status}><MessageCircle size={14}/><i className={connected?'online':''}/><span>{data.connection.status}</span></button>
 <button type="button" className="top-status printer-status" onClick={()=>go('Settings')} title={printerReady?'Printer ready':'Printer setup'}><Printer size={15}/><span>{printerReady?'Printer ready':'Printer setup'}</span></button>
 <select aria-label="Language" value={settings.language} onChange={e=>void run('setup',{...settings,language:e.target.value as 'en'|'si'})}><option value="en">EN</option><option value="si">සිං</option></select>
 <button className="icon-button" type="button" aria-label="Toggle theme" aria-pressed={s.dark} onClick={()=>s.set({dark:!s.dark})}>{s.dark?<Sun size={16}/>:<Moon size={16}/>}</button>
 <div className="menu-anchor"><button className="icon-button" type="button" aria-label="Notifications" aria-expanded={menu==='notifications'} onClick={()=>setMenu(menu==='notifications'?'':'notifications')}><Bell size={16}/>{notifications.length>0&&<i className="notification-dot"/>}</button>{menu==='notifications'&&<div className="dropdown notifications"><h3>Notifications</h3>{notifications.length?notifications.map(a=><p key={a.id}>{a.detail}</p>):<p>No operator notifications</p>}</div>}</div>
 <button type="button" aria-label="Shop profile" className="avatar" onClick={()=>go('Settings')}>{settings.shop[0]}</button></div></header>
 {busy>0&&<div className="busy" role="status" aria-label="Processing"/>}
 <main data-page={s.view}><PageHeader title={title}/><PageSurface page={s.view}>{pages[s.view]}</PageSurface></main><AppFooter/></div>{status}<PdfPrintPopup/></div></ctx.Provider>;
}
if(new URLSearchParams(location.search).has('print'))void preparePrint();else createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><MotionConfig reducedMotion="user"><App/></MotionConfig></QueryClientProvider>);
