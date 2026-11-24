import {useState} from 'react';
import {Activity,Archive,BookOpen,ChevronDown,ChevronRight,FilePenLine,FileText,History,Inbox,LayoutDashboard,MessageSquare,PanelLeftClose,PanelLeftOpen,Printer,Settings,ShoppingBag,Users,Wallet,Workflow,Zap} from 'lucide-react';
import {Brand} from './setup';
import {Badge} from './context';
import {useWorkspace} from './state';
export const groups=[
 {label:'Workspace',si:'වැඩ අවකාශය',items:[['Dashboard',LayoutDashboard,'මුල් පිටුව'],['WhatsApp',Inbox,'WhatsApp'],['PDF Studio',FilePenLine,'PDF Studio']]},
 {label:'Print management',si:'මුද්‍රණය',items:[['Print Studio',Printer,'මුද්‍රණ සැකසුම්'],['Print Queue',BookOpen,'මුද්‍රණ පෝලිම'],['Orders',ShoppingBag,'ඇණවුම්'],['Print History',History,'මුද්‍රණ ඉතිහාසය']]},
 {label:'Customers & files',si:'පාරිභෝගිකයින් සහ ලේඛන',items:[['Customers',Users,'පාරිභෝගිකයින්'],['Documents',FileText,'ලේඛන']]},
 {label:'Business',si:'ව්‍යාපාරය',items:[['Payments',Wallet,'ගෙවීම්'],['Reports',Activity,'වාර්තා']]},
 {label:'System',si:'පද්ධතිය',items:[['Settings',Settings,'සැකසුම්'],['Backup',Archive,'උපස්ථය']]},
 {label:'Automation',si:'ස්වයංක්‍රීයකරණය',items:[['Automation Engine',Zap,'සම්බන්ධතාව'],['Automation',Workflow,'කාර්ය ප්‍රවාහ'],['Auto Replies',MessageSquare,'ස්වයං පිළිතුරු'],['Engine Logs',Activity,'ක්‍රියාකාරකම්']]}
] as const;
const titles:Record<string,string>={WhatsApp:'WhatsApp Inbox',Automation:'Workflow Builder'};
export const pageTitle=(page:string,sinhala:boolean)=>sinhala?groups.flatMap(group=>[...group.items]).find(item=>item[0]===page)?.[2]??page:titles[page]??page;
export function Sidebar({shop,status,unreadCount,sinhala,collapsed,toggle,go}:{shop:string;status:string;unreadCount:number;sinhala:boolean;collapsed:boolean;toggle:()=>void;go:(page:string)=>void}){
 const page=useWorkspace(s=>s.view),[closed,setClosed]=useState<string[]>([]);
 return <aside className="sidebar" data-collapsed={collapsed}>
  <div className="sidebar-brand"><Brand/><button className="side-toggle" type="button" onClick={toggle} title={collapsed?'Expand sidebar':'Collapse sidebar'} aria-label={collapsed?'Expand sidebar':'Collapse sidebar'}>{collapsed?<PanelLeftOpen size={16}/>:<PanelLeftClose size={16}/>}</button></div>
  <nav aria-label="Workspace">{groups.map(group=><div className="nav-group" key={group.label}>
    {!collapsed&&<button type="button" className="nav-label" onClick={()=>setClosed(closed.includes(group.label)?closed.filter(value=>value!==group.label):[...closed,group.label])} aria-expanded={!closed.includes(group.label)}>{sinhala?group.si:group.label}{closed.includes(group.label)?<ChevronRight size={12}/>:<ChevronDown size={12}/>}</button>}
    {(collapsed||!closed.includes(group.label))&&group.items.map(([key,Icon])=><button type="button" key={key} className={'nav-item '+(page===key?'current':'')} aria-current={page===key?'page':undefined} aria-label={pageTitle(key,sinhala)} title={pageTitle(key,sinhala)+(key==='WhatsApp'&&unreadCount?' ('+unreadCount+' unread)':'')} aria-description={key==='WhatsApp'&&unreadCount?unreadCount+' unread messages':undefined} onClick={()=>go(key)}><Icon size={16}/><span>{pageTitle(key,sinhala)}</span>{key==='WhatsApp'&&unreadCount>0&&<small className="nav-unread-badge" aria-hidden="true">{unreadCount>99?'99+':unreadCount}</small>}</button>)}
  </div>)}</nav>
  <div className="sidebar-footer"><button type="button" title="WhatsApp connection" className="side-connection" aria-label={'WhatsApp '+status} onClick={()=>go('Automation Engine')}><i className={['Connected','API reachable'].includes(status)?'online':''}/><span><Badge>{status}</Badge></span></button>
  <button type="button" className="shop-card" title="Shop settings" onClick={()=>go('Settings')}><span className="avatar">{shop[0]}</span><span className="shop-name"><strong>{shop}</strong><small>Shop settings</small></span></button></div>
 </aside>;
}
