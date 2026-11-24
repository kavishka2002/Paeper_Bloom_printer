import {Activity,CheckCircle2,FileText,Images,Inbox,Plus,Printer,ShoppingBag,Users,Wallet} from 'lucide-react';
import {useData,Button,Panel,Badge,Empty,money,name,stamp,orderStatusLabels} from './context';
import {ActivityList,colomboDay,RevenueChart,StatCard} from './design';
import {useWorkspace} from './state';
import {unreadInboxMessage,visibleInboxMessage} from './inbox-messages';
export function Dashboard(){
 const {data,printers}=useData(),set=useWorkspace(s=>s.set);
 const currentDay=colomboDay(new Date());
 const today=(date:string)=>colomboDay(date)===currentDay;
 const pending=data.queue.filter(q=>q.status==='Printing'||q.status==='Submitted').length;
 const confirmed=data.queue.filter(q=>q.status==='Completed').length;
 const orders=data.jobs.filter(job=>job.status!=='Cancelled');
 const todayPayments=data.payments.filter(p=>today(p.created));
 const revenue=todayPayments.reduce((sum,p)=>sum+p.amount,0);
 const orderValueToday=orders.filter(job=>today(job.created)).reduce((sum,job)=>sum+job.total,0);
 const outstanding=orders.reduce((sum,job)=>sum+Math.max(0,job.total-job.paid),0);
 const messages=data.messages.filter(visibleInboxMessage);
 const incoming=new Set(messages.filter(m=>m.direction==='incoming').map(m=>m.id));
 const unread=messages.filter(unreadInboxMessage);
 const lastUnread=unread.at(-1);
 const recentMessages=messages.slice(-4).reverse();
 const recentPrints=data.queue.slice(0,4);
 const recentRules=data.activity.filter(a=>/rule|workflow|automation/i.test(a.kind)).slice(0,4);
 const printer=printers.find(item=>item.name===data.settings?.printer);
 const metrics=[
  ['Messages today',messages.filter(m=>m.direction==='incoming'&&today(m.created)).length,Inbox,'WhatsApp','violet'],
  ['Files received today',data.attachments.filter(a=>a.message_id&&incoming.has(a.message_id)&&today(a.created)).length,FileText,'Documents','cyan'],
  ['Pending print submissions',pending,Printer,'Print Queue','amber'],
  ['Confirmed print submissions',confirmed,CheckCircle2,'Print History','emerald'],
  ['Payments received today',money(revenue),Wallet,'Payments','violet'],
  ['Order value today',money(orderValueToday),FileText,'Orders','cyan'],
  ['Outstanding balance',money(outstanding),Wallet,'Payments','amber'],
  ['Active customers today',data.customers.filter(c=>today(c.last)).length,Users,'Customers','cyan']
 ] as const;
 return <div className="stack dashboard-page">
  <section className="hero"><div className="hero-brand"><img src={import.meta.env.BASE_URL+'bloomconnect-logo.png'} width={106} height={106} alt="BloomConnect Print and Order Hub"/><div className="hero-copy"><p className="hero-date">{new Intl.DateTimeFormat('en-LK',{timeZone:'Asia/Colombo',dateStyle:'full'}).format(new Date())}</p><h2>Welcome to {data.settings?.shop}.</h2><div className="hero-status"><Badge>{data.connection.status}</Badge><span>{printer?.displayName||printer?.name||'Printer setup required'}</span></div></div></div>
  </section>
  <Panel className="stack">
   <h2>Start a task</h2>
   <div className="dashboard-quick-actions">
    <Button className="secondary" onClick={()=>set({view:'PDF Studio'})}>PDF Studio</Button>
    <Button className="secondary" onClick={()=>set({view:'Print Studio',job:'',photoStudio:false})}><Printer size={17}/> Print document</Button>
    <Button className="secondary" onClick={()=>set({view:'Print Studio',job:'',photoStudio:true})}><Images size={17}/> Print photos</Button>
    <Button className="secondary" onClick={()=>set({view:'WhatsApp'})}><Inbox size={17}/> WhatsApp inbox</Button>
    <Button className="secondary" onClick={()=>set({view:'Print Studio',job:'',photoStudio:false})}><Plus size={17}/> New order</Button>
    <Button className="secondary" onClick={()=>set({view:'Orders',job:'',orderScope:'open'})}><ShoppingBag size={17}/> Pending orders</Button>
    <Button className="secondary" onClick={()=>set({view:'Customers',customer:''})}><Users size={17}/> Find a customer</Button>
    <Button className="secondary" onClick={()=>set({view:'Payments',job:''})}><Wallet size={17}/> Billing and payments</Button>
    <Button className="secondary" onClick={()=>set({view:'Reports'})}><Activity size={17}/> Reports</Button>
   </div>
  </Panel>
  <button type="button" className="panel dashboard-inbox-card" data-unread={unread.length>0} onClick={()=>set({view:'WhatsApp',...(lastUnread?{customer:lastUnread.customer_id}:{})})}>
   <span className="dashboard-message-icon"><Inbox size={22}/></span>
   <span className="dashboard-message-copy"><strong>{unread.length?'New WhatsApp messages':'WhatsApp Inbox'}</strong><small>{lastUnread?name(data,lastUnread.customer_id):'Open conversations'}</small></span>
   <span className="dashboard-message-count" aria-label={unread.length+' unread messages'}>{unread.length}</span>
  </button>
  <div className="metric-grid">{metrics.map(([label,value,icon,view,tone])=><StatCard key={label} label={label} value={value} icon={icon} tone={tone} action={()=>set({view})}/>)}</div>
  <div className="dashboard-grid">
   <Panel><div className="panel-head"><h2>Recent WhatsApp activity</h2><Button className="quiet" onClick={()=>set({view:'WhatsApp'})}>Inbox</Button></div>{recentMessages.length?<ul className="activity">{recentMessages.map(m=><li key={m.id}><Inbox size={15}/><div><button className="text-button" onClick={()=>set({view:'WhatsApp',customer:m.customer_id})}>{name(data,m.customer_id)}</button><p>{m.body||m.kind}</p></div><small>{stamp(m.created)}</small></li>)}</ul>:<Empty title="No messages yet"/>}</Panel>
   <Panel><div className="panel-head"><h2>Print queue</h2><Button className="quiet" onClick={()=>set({view:'Print Queue'})}>View queue</Button></div>{recentPrints.length?<ul className="activity">{recentPrints.map(q=><li key={q.id}><Printer size={15}/><div><strong>{q.job_id}</strong><p>{q.printer}</p></div><Badge>{q.status}</Badge></li>)}</ul>:<Empty title="No print submissions yet"/>}</Panel>
   <RevenueChart payments={data.payments} orders={orders.map(job=>({created:job.created,amount:job.total}))}/>
   <Panel><div className="panel-head"><h2>Recent orders</h2><Button className="quiet" onClick={()=>set({view:'Orders'})}>Orders</Button></div>{data.jobs.length?<ul className="activity">{data.jobs.slice(0,4).map(job=><li key={job.id}><FileText size={15}/><div><button className="text-button" onClick={()=>set({view:'Orders',job:job.id})}>{job.id}</button><p>{name(data,job.customer_id)}</p></div><Badge>{orderStatusLabels[job.status]}</Badge></li>)}</ul>:<Empty title="No orders yet"/>}</Panel>
  </div>
  <Panel><div className="panel-head"><h2><Activity size={16}/> Automation activity</h2><Button className="quiet" onClick={()=>set({view:'Engine Logs'})}>View logs</Button></div>{recentRules.length?<ActivityList entries={recentRules}/>:<Empty title="No automation activity yet"/>}</Panel>
 </div>;
}
