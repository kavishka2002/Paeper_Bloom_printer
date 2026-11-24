import {useState} from 'react';
import {useForm} from 'react-hook-form';
import {Archive,Cloud} from 'lucide-react';
import {useWorkspace} from './state';
import {ActivityList} from './design';
import {AboutPage,SupportCard} from './about';
import {SoftwareUpdates} from './software-updates';
import {AutoReplies} from './automation';
import {paperSizes} from '../../packages/printing/paper';
import {paperRateSizes} from '../../packages/printing/calculation';
import type {Input} from '../../packages/shared/contracts';
import {Badge,Button,Empty,Panel,PrinterSelect,PrinterPropertiesButton,useData} from './context';
export function Brand(){return <div className="brand"><img src={import.meta.env.BASE_URL+'bloomconnect-logo.png'} width={33} height={33} alt="BloomConnect logo"/><div>BloomConnect<small>SHOP WORKSPACE</small></div></div>}
function CloudSetup(){
 const {data,run}=useData(),[open,setOpen]=useState(false);
 const form=useForm<Input<'connect'>>({defaultValues:{version:'v25.0'}});
 return <div className="stack"><div className="connection"><Cloud/><div><strong>{data.connection.mode==="web"?"Cloud API disconnected":data.connection.status}</strong><p>{(!data.connection.mode&&data.connection.phone)||'Meta WhatsApp Cloud API'} · {data.connection.webhook?'Webhook verified this session':'Webhook awaiting verification'}</p></div></div>
 <p>Connect a WhatsApp Business Platform number. Incoming messages require a public HTTPS address forwarding to this computer.</p>
 <div className="actions"><Button onClick={()=>setOpen(!open)}>{open?'Hide connection settings':'Configure connection'}</Button>{!data.connection.mode&&data.connection.status!=='Disconnected'&&<Button className="secondary" onClick={()=>void run('logout',null,'Logged out locally')}>Log out</Button>}</div>
 {open&&<form className="stack" onSubmit={form.handleSubmit(async values=>{if(await run('connect',values,'Meta API credentials verified')){form.reset();setOpen(false)}})}>
 <label>Business phone number ID<input required {...form.register('phoneId')}/></label><label>Graph API version<input required {...form.register('version')}/></label>
 {(['token','appSecret','verifyToken'] as const).map((key,i)=><label key={key}>{['Access token','Meta app secret','Webhook verification token'][i]}<input type="password" required autoComplete="off" {...form.register(key)}/></label>)}
 <p className="subtle">Forward webhooks to <code>http://127.0.0.1:47832/whatsapp/webhook</code></p><Button type="submit" disabled={form.formState.isSubmitting||data.connection.mode==='web'}>Verify and connect</Button></form>}</div>
}
function WhatsAppSetup(){
 const {data,run}=useData();
 const {mode,status,qr,phone,detail,qrGeneratedAt}=data.connection;
 const cloudActive=!mode&&status!=='Disconnected';
 const webActive=mode==='web';
 const loggingOut=status==='Logging Out';
 const connected=status==='Connected';
 const starting=['Starting Engine','Browser Started','WhatsApp Web Loaded','Checking Authentication','Waiting for Fresh QR','Authenticating'].includes(status);
 const actionLabel=connected?'Device linked':loggingOut?'Logging out…':status==='Disconnected'?'Connect New WhatsApp':status==='Connection Failed'?'Retry Connection':status==='QR Ready'||status==='QR Expired'?'Refresh QR / Restart Engine':webActive?'Restart WhatsApp Engine':'Connect New WhatsApp';
 return <div className="stack">
   <div className="connection"><Cloud/><div><strong>WhatsApp Web · {webActive?status:'Unlinked'}</strong>{phone&&webActive&&<p>{phone}</p>}</div></div>
   <p>To connect a WhatsApp account:</p>
   <ol><li>Open WhatsApp on your phone.</li><li>Go to Linked devices and select Link a device.</li><li>Scan the fresh QR code shown here.</li></ol>
   <p className="subtle">WhatsApp Web automation uses an unofficial library. WhatsApp updates can interrupt it, and automated use can lead to account restrictions. Use it only if you accept those risks.</p>
   {status==='QR Expired'&&<p role="alert">This QR code has expired. Restart WhatsApp Engine to request a fresh code.</p>}
   {status==='Connection Failed'&&<p role="alert">WhatsApp could not provide a fresh connection. Retry the connection or restart the engine.</p>}
   {webActive&&detail&&<details open={status==='Connection Failed'||status==='QR Expired'}><summary>View Connection Error</summary><p role="status">{detail}</p></details>}
   {cloudActive&&<p className="subtle">Log out of the Cloud API connection below to switch to WhatsApp Web.</p>}
   {webActive&&qr&&<div className="preview"><img className="whatsapp-qr" src={qr} alt="WhatsApp Web linking QR code" width={400} height={400}/>{qrGeneratedAt&&<small>QR generated <time dateTime={qrGeneratedAt}>{new Date(qrGeneratedAt).toLocaleTimeString()}</time></small>}</div>}
   <div className="actions">
       <Button disabled={cloudActive||connected||loggingOut||starting} onClick={()=>void run('webConnect',null)}>{actionLabel}</Button>
     {webActive&&status!=='Disconnected'&&<Button className="secondary" disabled={loggingOut} onClick={()=>{if(window.confirm('Log out of this WhatsApp account and clear only its WhatsApp Web session?'))void run('logout',null,'WhatsApp account logged out')}}>Logout / Change Account</Button>}
   </div>
   <details open={cloudActive||undefined}><summary>Meta Cloud API connection</summary><div className="stack" style={{marginTop:12}}><CloudSetup/></div></details>
 </div>
}
function Prices({draft,update}:{draft:Input<'setup'>;update:(v:Partial<Input<'setup'>>)=>void}){return <div className="form-grid">{(['mono','colour','photo'] as const).map((k,i)=><label key={k}>{['Black & white','Colour','Photo'][i]} · LKR<input type="number" min="0" max="1000000" step=".01" value={draft[k]/100} onChange={e=>update({[k]:Math.round(Number(e.target.value)*100)})}/></label>)}{(['duplexMono','duplexColour'] as const).map((key,index)=><label key={key}>{index===0?'Two-sided black & white':'Two-sided colour'} per physical sheet (LKR)<input type="number" min="0" max="1000000" step=".01" placeholder={String((index===0?draft.mono:draft.colour)/100)} value={draft[key]===undefined?'':draft[key]/100} onChange={e=>update({[key]:e.target.value===''?undefined:Math.round(Number(e.target.value)*100)})}/></label>)}</div>}
function Language({draft,update}:{draft:Input<'setup'>;update:(v:Partial<Input<'setup'>>)=>void}){return <label>Navigation language<select value={draft.language} onChange={e=>update({language:e.target.value as 'en'|'si'})}><option value="en">English</option><option value="si">සිංහල</option></select></label>}
export function Setup(){
 const {run,printers}=useData();const [step,set]=useState(0),[draft,setDraft]=useState<Input<'setup'>>({shop:'',language:'en',printer:printers.find(p=>p.isDefault)?.name??'',mono:0,colour:0,photo:0});
 const update=(v:Partial<typeof draft>)=>setDraft({...draft,...v});
 const labels=['Welcome to BloomConnect','Your shop','Choose a language','Connect WhatsApp','Choose a printer','Set print prices','Ready to start'];
 return <div className="setup onboarding"><div className="onboarding-card"><aside className="onboarding-rail"><Brand/><ol>{labels.map((label,index)=><li key={label} aria-current={index===step?"step":undefined} data-complete={index<step}><span>{index+1}</span>{label}</li>)}</ol></aside><Panel><div className="steps">{labels.map((l,i)=><i key={l} className={i<=step?'done':''}/>)}</div><p className="eyebrow">GET STARTED · {step+1} / 7</p><h1>{labels[step]}</h1>
 {step===0&&<p>Set up your stationery shop to organize WhatsApp messages, prepare print orders and record payments.</p>}
 {step===1&&<label>Shop name<input autoFocus maxLength={160} value={draft.shop} onChange={e=>update({shop:e.target.value})}/></label>}
 {step===2&&<Language draft={draft} update={update}/>}
 {step===3&&<><WhatsAppSetup/><p className="subtle">You can connect later in Settings.</p></>}
 {step===4&&<PrinterSelect value={draft.printer} change={printer=>update({printer})}/>}
 {step===5&&<Prices draft={draft} update={update}/>}
 {step===6&&<p>Save the workspace for {draft.shop}. You can change these details in Settings.</p>}
 <div className="actions wizard-actions">{step>0&&<Button className="secondary" onClick={()=>set(step-1)}>Back</Button>}{step<6?<Button onClick={()=>set(step+1)} disabled={step===1&&!draft.shop.trim()}>Continue</Button>:<Button onClick={()=>void run('setup',draft,'Workspace created')}>Finish setup</Button>}</div></Panel></div></div>
}
export function ConnectionPage(){
 const {data}=useData();
 const connected=['Connected','API reachable'].includes(data.connection.status);
 const entries=data.activity.filter(item=>/whatsapp|webhook|attachment/i.test(item.kind)).slice(0,12);
 return <div className="split engine-page">
 <Panel className="stack"><div className="panel-head"><h2>WhatsApp connection</h2><Badge>{data.connection.status}</Badge></div>
 <div className="connection" data-connected={connected}><Cloud size={20}/><div><strong>{data.connection.mode==='web'?'WhatsApp Web':'WhatsApp Cloud API'}</strong><p>{data.connection.phone||'No account number available'}</p></div></div><WhatsAppSetup/></Panel>
 <Panel><div className="panel-head"><h2>Connection activity</h2></div>{entries.length?<ActivityList entries={entries}/>:<Empty title="No connection activity recorded"/>}</Panel></div>;
}
export function BackupPage(){
 const {run}=useData();
 return <Panel className="stack backup-panel"><div className="section-icon"><Archive size={21}/></div><h2>Back up this workspace</h2><p>Save a copy of your SQLite database and document files to a folder you choose.</p><div className="actions"><Button onClick={()=>void run('backup',null)}>Save backup</Button></div></Panel>;
}
const settingsSections=['General','Printers & Printing','Paper Sizes & Print Presets','Print Pricing','WhatsApp Connection','Automatic Replies','Customer & Order Settings','Notifications','Data & Backup','Appearance','Help & Support','About BloomConnect'];
function PaperPrices({draft,update}:{draft:Input<'setup'>;update:(value:Partial<Input<'setup'>>)=>void}){
 const fields=[['mono','One-sided black & white'],['colour','One-sided colour'],['duplexMono','Double-sided black & white'],['duplexColour','Double-sided colour']] as const;
 return <section className="stack">
  <h3>Document rates by paper size</h3>
  <small>Enter LKR per sheet of paper. A double-sided sheet uses the double-sided rate once, covering both faces. Blank fields use the rates shown.</small>
  {paperRateSizes.map(paper=>{
   const rates=draft.paperRates?.[paper];
   return <fieldset key={paper} className="form-grid paper-rate-group"><legend>{paper}</legend>
    <label className="check paper-rate-same"><input type="checkbox" checked={rates?.samePrice??false} onChange={e=>update({paperRates:{...draft.paperRates,[paper]:{...rates,samePrice:e.target.checked}}})}/> Same price per sheet for one-sided and double-sided</label>
    {paper==='A4'&&<small className="paper-rate-same">For LKR 10 either way, enter 10 under one-sided and select Same price. For LKR 8 one-sided and LKR 15 double-sided, clear Same price and enter both rates.</small>}
    {fields.map(([key,label])=>{
     const duplex=key==='duplexMono'||key==='duplexColour';
     const same=duplex&&rates?.samePrice;
     const fallback=key==='duplexMono'?rates?.mono??(same?draft.mono:draft.duplexMono??draft.mono):key==='duplexColour'?rates?.colour??(same?draft.colour:draft.duplexColour??draft.colour):draft[key];
     return <label key={key}>{label} (LKR)<input type="number" min="0" max="1000000" step=".01" disabled={same} value={same?fallback/100:rates?.[key]===undefined?'':rates[key]/100}
      placeholder={(fallback/100).toFixed(2)} onChange={e=>update({paperRates:{...draft.paperRates,[paper]:{
       ...rates,[key]:e.target.value===''?undefined:Math.round(e.target.valueAsNumber*100)
      }}})}/></label>;
    })}
   </fieldset>;
  })}
 </section>;
}
export function Settings(){
 const {data,run,printers,refresh,error}=useData(),[draft,setDraft]=useState(data.settings!),[section,select]=useState('General');
 const {dark,set}=useWorkspace();
 const update=(v:Partial<typeof draft>)=>setDraft({...draft,...v});
 const go=(view:string)=>set({view,search:'',...(view==='Print Studio'?{job:''}:{})});
 const notifications=data.activity.filter(item=>item.kind==='Operator notification').slice(0,8);
 const editable=['General','Printers & Printing','Print Pricing'].includes(section);
 let content;
 if(section==='WhatsApp Connection')content=<div className="stack"><ConnectionPage/><Panel><p>To remove a linked WhatsApp session, open WhatsApp on your phone, go to Linked devices and unlink this device.</p></Panel></div>;
 else if(section==='Automatic Replies')content=<AutoReplies/>;
 else if(section==='Help & Support')content=<SupportCard/>;
 else if(section==='About BloomConnect')content=<div className="stack"><SoftwareUpdates/><AboutPage/></div>;
 else if(section==='Data & Backup')content=<div className="stack"><BackupPage/><Panel className="stack"><h2>Workspace storage</h2><dl className="detail-list"><div><dt>Documents</dt><dd>{data.attachments.length}</dd></div><div><dt>Ready to open</dt><dd>{data.attachments.filter(file=>file.status==='Ready').length}</dd></div><div><dt>Imported data</dt><dd>{(data.attachments.reduce((sum,file)=>sum+file.bytes,0)/1048576).toFixed(1)} MB</dd></div></dl></Panel></div>;
 else if(section==='Paper Sizes & Print Presets')content=<Panel className="stack"><h2>{section}</h2><p>Choose a printer, check its available paper forms, and manage saved presets under Advanced in Print Studio.</p><div className="actions"><Button onClick={()=>go('Print Studio')}>Open Print Studio</Button></div><details><summary>Standard paper sizes</summary><dl className="detail-list">{Object.entries(paperSizes).map(([name,[width,height]])=><div key={name}><dt>{name}</dt><dd>{width} ? {height} mm</dd></div>)}</dl></details></Panel>;
 else if(section==='Customer & Order Settings')content=<Panel className="stack"><h2>{section}</h2><p>Manage customer records, print orders and payment information from their existing pages.</p><div className="actions">{['Customers','Orders','Payments'].map(view=><Button key={view} className="secondary" onClick={()=>go(view)}>{view}</Button>)}</div></Panel>;
 else content=<Panel><form className="stack settings-form" onSubmit={e=>{e.preventDefault();if(editable)void run('setup',draft,'Settings saved')}}><h2>{section}</h2>
 {section==='General'&&<><label>Shop name<input required maxLength={160} value={draft.shop} onChange={e=>update({shop:e.target.value})}/></label><Language draft={draft} update={update}/></>}
 {section==='Appearance'&&<label className="check"><input type="checkbox" role="switch" checked={dark} onChange={e=>set({dark:e.target.checked})}/> Dark theme</label>}
 {section==='Printers & Printing'&&<>
  <label>Default printer<PrinterSelect value={draft.printer} change={printer=>update({printer})}/></label>
  {(!printers.length||draft.printer&&!printers.some(printer=>printer.name===draft.printer))&&
   <small role="status">Connect or install your printer in Windows, then refresh the list.</small>}
  <div className="actions">
   <Button className="secondary" onClick={()=>go('Print Studio')}>Open advanced print settings</Button>
   <PrinterPropertiesButton printer={draft.printer}/>
   <Button className="secondary" onClick={()=>void refresh().catch(error)}>Refresh printers</Button>
   <Button className="secondary" onClick={()=>void window.bloom.call('openPrinterSettings',null).catch(error)}>Windows printer settings</Button>
  </div>
 </>}
 {section==='Print Pricing'&&<><Prices draft={draft} update={update}/><PaperPrices draft={draft} update={update}/></>}
 {section==='Notifications'&&(notifications.length?<ActivityList entries={notifications}/>:<Empty title="No operator notifications"/>)}
 {editable&&<div className="actions"><Button type="submit">Save preferences</Button></div>}
 </form></Panel>;
 return <div className="settings-layout"><SettingsNav value={section} change={select}/><div className="settings-content">{content}</div></div>;
}
function SettingsNav({value,change}:{value:string;change:(value:string)=>void}){
 return <nav aria-label="Settings sections" className="panel settings-nav">{settingsSections.map(section=><button key={section} type="button" aria-current={section===value?'page':undefined} onClick={()=>change(section)}>{section}</button>)}</nav>;
}
