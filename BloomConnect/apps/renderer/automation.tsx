import {notificationTemplates} from '../../packages/shared/notification-templates';
import {useEffect,useState} from 'react';
import {ReactFlow,ReactFlowProvider,Background,Controls,MiniMap,addEdge,useNodesState,useEdgesState,useReactFlow,type Node,type Edge} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {ActivityList,Tabs} from './design';
import {triggers,actions,type Input,type Rule,type Results} from '../../packages/shared/contracts';
import {Panel,Button,Badge,Empty,useData,name} from './context';
const triggerText=['Customer message','Message contains keyword','PDF imported','Image imported','Document imported','Print confirmed','Order fully paid','Ready for pickup','Files successfully imported (PDF/photo)','Order created','Operator marked printing started','Order collected','Ready to print','Submitted to print queue','Price confirmed'];
const actionText={order:'Create print order',notify:'Notify operator',label:'Set customer label',reply:'Reply within 24 hours'};
const initial:Input<'rule'>={name:'',trigger:'pdf',keyword:'',actions:['order'],text:'',enabled:false,graph:''};
type Kind='Trigger'|'Condition'|'Action'|'Delay'|'Notification';
const kinds:Kind[]=['Trigger','Condition','Action','Delay','Notification'];
function Graph({rule,save}:{rule:Input<'rule'>;save:(r:Input<'rule'>)=>void}){
 const {error}=useData(), flow=useReactFlow();
 const existing=rule.graph?JSON.parse(rule.graph) as {nodes:Node[];edges:Edge[]}:null;
 const [nodes,setNodes,onNodesChange]=useNodesState<Node>(existing?.nodes??[{id:'trigger',position:{x:10,y:25},data:{label:'Trigger',kind:'Trigger'},type:'input'}]);
 const [edges,setEdges,onEdgesChange]=useEdgesState(existing?.edges??[]);
 const [active,select]=useState('');const node=nodes.find(n=>n.id===active);
 function add(kind:Kind,position={x:50+nodes.length*36,y:90+nodes.length*20}){setNodes(n=>[...n,{id:crypto.randomUUID(),position,data:{kind,value:kind==='Action'?'order':'',label:kind},type:kind==='Trigger'?'input':'default'}])}
 function persist(){
  try{
   const starts=nodes.filter(n=>n.data.kind==='Trigger');
   if(starts.length!==1)throw new Error('Add exactly one trigger.');
   const visited=new Set<string>();const list:Input<'rule'>['actions']=[];
   let current:Node|undefined=starts[0];
   let trigger=rule.trigger;
   while(current){
    if(visited.has(current.id))throw new Error('Workflow contains a loop.');
    visited.add(current.id);
    if(current.data.kind==='Condition'){if(trigger!=='message'||!rule.keyword.trim())throw new Error('Keyword conditions require a message trigger and a keyword.');trigger='keyword'}
    if(current.data.kind==='Delay')throw new Error('Delay nodes cannot be enabled in this version. Remove the node to save.');
    if(current.data.kind==='Action')list.push((current.data.value||'order') as typeof actions[number]);
    if(current.data.kind==='Notification')list.push('notify');
    const outgoing=edges.filter(e=>e.source===current!.id);
    if(outgoing.length>1)throw new Error('Connect nodes in a single sequence.');
    current=nodes.find(n=>n.id===outgoing[0]?.target);
   }
   if(visited.size!==nodes.length||!list.length)throw new Error('Connect every node and add at least one action.');
   save({...rule,trigger,actions:list,graph:JSON.stringify({nodes,edges})});
  }catch(e){error(e)}
 }
 return <div className="stack"><div className="actions">{kinds.map(k=><Button key={k} className="secondary" draggable onDragStart={e=>e.dataTransfer.setData('text/plain',k)} onClick={()=>add(k)}>{k}</Button>)}</div>
 <div className="flow" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const kind=e.dataTransfer.getData('text/plain') as Kind;if(kinds.includes(kind))add(kind,flow.screenToFlowPosition({x:e.clientX,y:e.clientY}))}}><ReactFlow nodes={nodes.map(node=>({...node,className:'workflow-node node-'+String(node.data.kind).toLowerCase()}))} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={c=>setEdges(e=>addEdge(c,e))} onNodeClick={(_,n)=>select(n.id)} fitView fitViewOptions={{maxZoom:1.1,padding:.2}}><Background/><Controls/><MiniMap pannable zoomable nodeColor={node=>({Trigger:"#087f5b",Condition:"#3b82f6",Action:"#10b981",Delay:"#f59e0b",Notification:"#06b6d4"} as Record<string,string>)[String(node.data.kind)]??"#64748b"}/></ReactFlow></div>
 {node?.data.kind==='Action'&&<label>Action<select value={String(node.data.value||'order')} onChange={e=>{const value=e.target.value as typeof actions[number];setNodes(n=>n.map(item=>item.id===active?{...item,data:{...item.data,value,label:actionText[value]}}:item))}}>{actions.map(a=><option value={a} key={a}>{actionText[a]}</option>)}</select></label>}
 <Button onClick={persist}>Validate and save workflow</Button></div>
}
export function Automation(){
 const {data,run}=useData();
 const [form,setForm]=useState<Input<'rule'>>(initial),[advanced,setAdvanced]=useState(false),[saving,setSaving]=useState(false),[step,setStep]=useState('Trigger');
 const select=(r?:Rule)=>{setForm(r??initial);setAdvanced(!!r?.graph);setStep('Trigger')};
 const save=async(r:Input<'rule'>)=>{if(saving)return;setSaving(true);try{if(await run('rule',r,'Rule saved'))select()}finally{setSaving(false)}};
 const trigger=<div className="form-grid"><label>Rule name<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>When<select value={form.trigger} onChange={e=>setForm({...form,trigger:e.target.value as Input<'rule'>['trigger']})}>{triggers.map((t,i)=><option key={t} value={t}>{triggerText[i]}</option>)}</select></label></div>;
 const keyword=<label>Keyword<input value={form.keyword} onChange={e=>setForm({...form,keyword:e.target.value})}/></label>;
 const message=<label>Notification, label or reply text<textarea value={form.text} onChange={e=>setForm({...form,text:e.target.value})}/></label>;
 const enabled=<label className="check"><input type="checkbox" role="switch" checked={form.enabled} onChange={e=>setForm({...form,enabled:e.target.checked})}/>Enable on save</label>;
 return <div className="split workflow-page"><Panel><div className="panel-head"><h2>Saved rules</h2><Button className="secondary" onClick={()=>select()}>New rule</Button></div>{data.rules.map(r=><div className="rule-row" key={r.id}><button className="text-button" onClick={()=>select(r)}>{r.name}</button><Badge>{r.enabled?'Enabled':'Paused'}</Badge><Button className="quiet" onClick={()=>void run('rule',{...r,enabled:!r.enabled})}>{r.enabled?'Pause':'Enable'}</Button><Button className="quiet" onClick={()=>void run('testRule',{id:r.id},'Dry run recorded in Reports')}>Test</Button></div>)}{!data.rules.length&&<Empty title="No rules yet"/>}</Panel>
 <Panel><div className="stack"><div className="panel-head"><h2>{form.id?'Edit rule':'Create rule'}</h2><Button className="secondary" onClick={()=>setAdvanced(!advanced)}>{advanced?'Simple mode':'Visual mode'}</Button></div>
 {advanced?<>{trigger}<details className="workflow-options"><summary>Rule text, keyword and activation</summary><div className="stack">{keyword}{message}{enabled}</div></details>
 <ReactFlowProvider key={form.id??'new'}><Graph rule={form} save={r=>void save(r)}/></ReactFlowProvider></>:<>
 <Tabs values={['Trigger','Actions','Review']} value={step} onChange={setStep} label="Workflow steps"/>
 {step==='Trigger'&&<>{trigger}{form.trigger==='keyword'&&keyword}<div className="actions"><Button onClick={()=>setStep('Actions')}>Next: Actions</Button></div></>}
 {step==='Actions'&&<><fieldset><legend>Then</legend>{actions.map(a=><label className="check" key={a}><input type="checkbox" checked={form.actions.includes(a)} onChange={()=>setForm({...form,actions:form.actions.includes(a)?form.actions.filter(x=>x!==a):[...form.actions,a]})}/>{actionText[a]}</label>)}</fieldset>{message}<div className="actions"><Button className="secondary" onClick={()=>setStep('Trigger')}>Back</Button><Button onClick={()=>setStep('Review')}>Next: Review</Button></div></>}
 {step==='Review'&&<><dl className="detail-list"><div><dt>Rule name</dt><dd>{form.name||'Untitled'}</dd></div><div><dt>Trigger</dt><dd>{triggerText[triggers.indexOf(form.trigger)]}</dd></div><div><dt>Actions</dt><dd>{form.actions.map(action=>actionText[action]).join(', ')||'Choose an action'}</dd></div></dl>{enabled}<div className="actions"><Button className="secondary" onClick={()=>setStep('Actions')}>Back</Button><Button disabled={saving||!form.name.trim()||!form.actions.length} onClick={()=>void save({...form,graph:''})}>Save rule</Button></div></>}
 </>}
 <p className="subtle">Local tests check matching and list actions. They never send WhatsApp messages.</p></div></Panel></div>;
}
export function EngineLogs(){
 const {data}=useData(),[filter,setFilter]=useState('');
 const entries=data.activity.filter(item=>/automation|rule|workflow|webhook|whatsapp|attachment/i.test(item.kind)&&[item.kind,item.detail].some(value=>value.toLowerCase().includes(filter.toLowerCase().trim())));
 return <Panel><div className="panel-head"><div><h2>Engine activity</h2><p>{entries.length} recorded events</p></div><input className="field-search" aria-label="Search engine logs" placeholder="Search events" value={filter} onChange={event=>setFilter(event.target.value)}/></div>{entries.length?<ActivityList entries={entries}/>:<Empty title="No matching engine events"/>}</Panel>;
}
type ReplyDraft={en:string;si:string};
export function AutoReplies(){
 const {data,run}=useData(),[query,setQuery]=useState(''),[category,setCategory]=useState(''),[selected,select]=useState('');
 const [language,setLanguage]=useState<'en'|'si'>('en'),[draft,setDraft]=useState<ReplyDraft>({en:'',si:''});
 const [creating,setCreating]=useState(false),[newName,setNewName]=useState('Automatic customer reply'),[newTrigger,setNewTrigger]=useState<Input<'rule'>['trigger']>('message'),[keyword,setKeyword]=useState(''),[text,setText]=useState(''),[saving,setSaving]=useState(false),[debounce,setDebounce]=useState(10);
 const [notificationLog,setNotificationLog]=useState<Results['notificationLog']>([]);
 useEffect(()=>{void window.bloom.call('notificationLog',null).then(setNotificationLog).catch(()=>{})},[data.activity]);
 const replies=data.rules.filter(rule=>rule.actions.includes('reply'));
 const rule=replies.find(item=>item.id===selected);
 const list=replies.filter(item=>(!category||item.trigger===category)&&item.name.toLowerCase().includes(query.toLowerCase().trim()));
 function open(item:Rule){
  setCreating(false);select(item.id);
  const saved=localStorage.getItem('reply-draft-'+item.id);
  let copy:ReplyDraft={en:'',si:''};
  if(saved){try{copy=JSON.parse(saved) as ReplyDraft}catch{/* Start with the active text. */}}
  const locale=/[\u0d80-\u0dff]/u.test(item.text)?'si':'en';
  setLanguage(locale);setDraft({...copy,[locale]:item.text});
 }
 return <div className="split replies-page"><Panel><div className="panel-head"><h2>Reply rules</h2><Button onClick={()=>setCreating(true)}>New auto reply</Button></div><div className="filter-bar"><input aria-label="Search reply templates" placeholder="Search templates" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Reply trigger" value={category} onChange={e=>setCategory(e.target.value)}><option value="">All triggers</option>{triggers.map((trigger,i)=><option key={trigger} value={trigger}>{triggerText[i]}</option>)}</select></div>
 {list.map(item=><div className="rule-row" key={item.id}><button className="text-button" onClick={()=>open(item)}>{item.name}</button><Badge>{item.enabled?'Enabled':'Paused'}</Badge><label className="check"><input type="checkbox" role="switch" aria-label={'Enable '+item.name} checked={item.enabled} onChange={()=>void run('rule',{...item,enabled:!item.enabled},'Reply rule updated')}/></label></div>)}
 {!list.length&&<Empty title="No matching reply rules"><p>Choose New auto reply to create an enabled reply rule.</p></Empty>}</Panel>
 <Panel className="stack">{creating?<form className="stack" onSubmit={async e=>{e.preventDefault();if(saving)return;setSaving(true);try{if(await run('rule',{name:newName,trigger:newTrigger,keyword,actions:['reply'],text,debounceSeconds:debounce,enabled:true,graph:''},'Auto reply enabled for new matching events')){setCreating(false);setText('')}}finally{setSaving(false)}}}><h2>New automatic reply</h2><label>Start from a notification template<select value="" onChange={e=>{const [index,locale]=e.target.value.split(':');const template=notificationTemplates[Number(index)];if(template){setNewName(template.name);setNewTrigger(template.event);setText(template[locale as 'en'|'si']);setDebounce(template.event==='files-received'?10:0)}}}><option value="">Choose an editable starter</option>{notificationTemplates.flatMap((t,i)=>['en','si'].map(locale=><option key={i+locale} value={i+':'+locale}>{t.name} - {locale==='si'?'Sinhala':'English'}</option>))}</select></label><label>Rule name<input required maxLength={160} value={newName} onChange={e=>setNewName(e.target.value)}/></label><label>When to send<select value={newTrigger} onChange={e=>setNewTrigger(e.target.value as typeof newTrigger)}>{triggers.map((trigger,i)=><option key={trigger} value={trigger}>{triggerText[i]}</option>)}</select></label>{newTrigger==='keyword'&&<label>Matching keyword<input required value={keyword} maxLength={160} onChange={e=>setKeyword(e.target.value)}/></label>}<label>Batch quiet period - seconds<input type="number" min="0" max="300" value={debounce} onChange={e=>setDebounce(Number(e.target.value))}/></label><p className="subtle">Use Files successfully imported with a quiet period to send one acknowledgement for sequential PDFs/photos. Zero sends each matching event immediately. Order events support {'{job_id}'} and {'{total_amount}'}.</p><label>Reply message (Sinhala or English)<textarea required maxLength={4096} value={text} onChange={e=>setText(e.target.value)}/></label><p className="subtle">Sends automatically for new matching events while WhatsApp is connected. Automatic replies require a customer message within the last 24 hours. History sync does not send replies. Avoid overlapping enabled rules if you want one reply per event.</p><div className="actions"><Button type="submit" disabled={saving||!text.trim()||!newName.trim()}>{saving?'Saving...':'Save and enable auto reply'}</Button><Button className="secondary" onClick={()=>setCreating(false)}>Cancel</Button></div></form>:rule?<><div className="panel-head"><h2>{rule.name}</h2><Badge>{rule.trigger}</Badge></div>
 <label>English draft<textarea value={draft.en} maxLength={4096} onChange={e=>setDraft({...draft,en:e.target.value})}/></label><label>Sinhala draft<textarea lang="si" value={draft.si} maxLength={4096} onChange={e=>setDraft({...draft,si:e.target.value})}/></label>
 <label>Active reply language<select value={language} onChange={e=>setLanguage(e.target.value as 'en'|'si')}><option value="en">English</option><option value="si">සිංහල</option></select></label>
 <label>Batch quiet period - seconds<input type="number" min="0" max="300" value={rule.debounceSeconds??0} onChange={e=>void run('rule',{...rule,debounceSeconds:Number(e.target.value)})}/></label><h3>Preview</h3><div className="reply-preview">{draft[language]||'Enter reply text'}</div><div className="actions"><Button disabled={!draft[language].trim()} onClick={async()=>{if(await run('rule',{...rule,text:draft[language]},'Reply saved'))localStorage.setItem('reply-draft-'+rule.id,JSON.stringify(draft))}}>Save active reply</Button></div>
 </>:<Empty title="Select a reply rule"/>}<details><summary>Notification batch log</summary>{notificationLog.map(n=><div key={n.id}><p>{n.created} - {name(data,n.customer_id)} - {n.event_key} - {n.status} ({n.delivery_status??'delivery unknown'}) - {n.attempts} attempts {n.error}</p><details><summary>Send attempts</summary>{n.sendAttempts.map((a,index)=><p key={index}>{a.attempted} - {a.result} {a.error}</p>)}</details></div>)}<p className="subtle">Accepted means the integration accepted the message; it does not prove delivery. Unconfirmed sends require verification before retrying.</p></details></Panel></div>;
}
