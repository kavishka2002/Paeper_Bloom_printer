import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {LucideIcon} from 'lucide-react';
import {X} from 'lucide-react';
import {motion,MotionConfig,useReducedMotion} from 'motion/react';
import {Button,Panel,money,stamp} from './context';
export {MotionConfig};
export function PageHeader({title,children}:{title:string;children?:ReactNode}){
 return <div className="page-heading"><h1>{title}</h1>{children&&<div className="actions">{children}</div>}</div>;
}
export function StatCard({label,value,icon:Icon,tone='violet',action}:{label:string;value:ReactNode;icon:LucideIcon;tone?:string;action?:()=>void}){
 const content=<><span className="stat-icon"><Icon size={17}/></span><span className="stat-content"><span>{label}</span><strong>{value}</strong></span></>;
 return action?<button type="button" className={'stat-card panel tone-'+tone} onClick={action}>{content}</button>:<div className={'stat-card panel tone-'+tone}>{content}</div>;
}
export function Tabs({values,value,onChange,label}:{values:readonly string[];value:string;onChange:(value:string)=>void;label:string}){
 return <div className="tabs" role="group" aria-label={label}>{values.map(item=><button type="button" key={item} aria-pressed={item===value} onClick={()=>onChange(item)}>{item}</button>)}</div>;
}
export function DetailDrawer({title,onClose,children,presentation='drawer'}:{title:string;onClose:()=>void;children:ReactNode;presentation?:'drawer'|'center'|'wide'}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const panel=dialog.current;if(!panel)return;panel.showModal();return ()=>{if(panel.open)panel.close()}},[]);
 return <dialog ref={dialog} aria-label={title} className="detail-drawer" data-presentation={presentation} onCancel={e=>{e.preventDefault();onClose()}} onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
  <div className="drawer-content"><div className="panel-head"><h2>{title}</h2><Button className="secondary" aria-label="Close details" onClick={onClose}><X size={16}/></Button></div>{children}</div>
 </dialog>;
}
export function PageSurface({children,page}:{children:ReactNode;page:string}){
 const reduced=useReducedMotion();
 return <motion.div className="page-surface" key={page} initial={reduced?false:{opacity:.82,y:4}} animate={{opacity:1,y:0}} transition={{duration:reduced?0:.2,ease:'easeOut'}}>{children}</motion.div>;
}
const colomboDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Colombo',year:'numeric',month:'2-digit',day:'2-digit'});
const chartDate=new Intl.DateTimeFormat('en-LK',{day:'numeric',month:'short',timeZone:'Asia/Colombo'});
const compactAmount=new Intl.NumberFormat('en-LK',{notation:'compact',maximumFractionDigits:1});
export const colomboDay=(date:string|Date)=>colomboDate.format(new Date(date));
type DailyAmount={created:string;amount:number};
export function RevenueChart({payments,orders,days=7}:{payments:DailyAmount[];orders?:DailyAmount[];days?:number}){
 const [selectedDay,setSelectedDay]=useState<string>();
 const now=Date.now();
 const totals=(entries:DailyAmount[])=>{
  const byDay=new Map<string,number>();
  for(const entry of entries){const key=colomboDay(entry.created);byDay.set(key,(byDay.get(key)??0)+entry.amount)}
  return byDay;
 };
 const paid=totals(payments),ordered=totals(orders??[]);
 const periods=Array.from({length:days},(_,index)=>{
  const date=new Date(now-(days-index-1)*86400000),key=colomboDay(date);
  return {key,text:chartDate.format(date),payments:paid.get(key)??0,orders:ordered.get(key)??0};
 });
 const today=periods[periods.length-1];
 const selected=periods.find(period=>period.key===selectedDay)??today;
 const max=Math.max(0,...periods.flatMap(period=>[period.payments,period.orders]));
 const scale=max===0?0:Math.ceil(max/10**Math.floor(Math.log10(max)))*10**Math.floor(Math.log10(max));
 return <Panel className="revenue-panel">
 <div className="panel-head"><div><h2>{orders?'Sales activity':'Payments received'}</h2><p>Last {days} days</p></div>
 <div className="chart-legend"><span><i className="chart-payment"/>Payments</span>{orders&&<span><i className="chart-order"/>Order value</span>}</div></div>
 <div className="chart-day-detail" aria-live="polite"><strong>{selected.key===today.key?'Today':selected.text} <small>{selected.key===today.key?selected.text:''}</small></strong><span>Payments <b>{money(selected.payments)}</b></span>{orders&&<span>Order value <b>{money(selected.orders)}</b></span>}</div>
 <div className="chart-layout">
 <div className="chart-axis" aria-hidden="true"><span>{scale?compactAmount.format(scale/100):''}</span><span>{scale?compactAmount.format(scale/200):''}</span><span>0</span></div>
 <div className="revenue-chart" role="group" aria-label="Daily amounts in Sri Lankan rupees">
 {periods.map((day,i)=>{
  const isToday=day.key===today.key;
  return <button type="button" key={day.key} className="chart-column" data-today={isToday} aria-pressed={day.key===selected.key}
    aria-label={(isToday?'Today, ':'')+day.text+', payments '+money(day.payments)+(orders?', order value '+money(day.orders):'')}
    onClick={()=>setSelectedDay(isToday?undefined:day.key)}>
   <div className="chart-track" aria-hidden="true">
    {orders&&<i className="chart-order" style={{height:(scale?day.orders/scale*100:0)+'%'}}/>}
    <i className="chart-payment" style={{height:(scale?day.payments/scale*100:0)+'%'}}/>
   </div>
   <small>{isToday?'Today':days<=7||i===0||i%5===0?day.text:''}</small>
  </button>;
 })}
 </div></div>
 <div className="chart-period-totals"><span>{days}-day payments <b>{money(periods.reduce((sum,day)=>sum+day.payments,0))}</b></span>{orders&&<span>{days}-day order value <b>{money(periods.reduce((sum,day)=>sum+day.orders,0))}</b></span>}</div>
 </Panel>;
}
export function ActivityList({entries}:{entries:{kind:string;detail:string;created:string;id:number}[]}){
 return <ol className="timeline">{entries.map(item=><li key={item.id}><span className="timeline-dot"/><div><strong>{item.kind}</strong><p>{item.detail}</p></div><small>{stamp(item.created)}</small></li>)}</ol>;
}
