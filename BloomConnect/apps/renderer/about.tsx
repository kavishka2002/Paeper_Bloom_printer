import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {CheckCircle2,Code2,Copy,LifeBuoy,MessageCircle,Phone} from 'lucide-react';
import {developerName,supportPhone,type SupportAction} from '../../packages/shared/support';
import {Button,Panel} from './context';

const features=[
 'WhatsApp Customer & Order Management','PDF, Photo & Document Printing','Advanced Print Settings',
 'Bulk Printing & Booklet Printing','Automatic Print Price Calculation','Print Queue & Order Tracking',
 'Customer Notifications','Smart Photo Layout & Print Preview'
];
const copyright=()=>'© '+new Intl.DateTimeFormat('en-LK',{year:'numeric',timeZone:'Asia/Colombo'}).format(new Date())+' BloomConnect. All rights reserved.';
function useAppInfo(){
 return useQuery({queryKey:['app-info'],queryFn:()=>window.bloom.call('appInfo',null),staleTime:Infinity});
}
function useSupport(){
 const [message,setMessage]=useState('');
 const [pending,setPending]=useState<SupportAction>();
 async function contact(action:SupportAction){
  if(pending)return;
  setPending(action);setMessage('');
  try{
   await window.bloom.call('supportAction',{action});
   if(action==='copy')setMessage('Support number copied.');
  }catch(e){
   setMessage((e instanceof Error?e.message:String(e)).replace(/^Error invoking remote method 'bloom:call':\s*(?:Error:\s*)?/,''));
  }finally{setPending(undefined)}
 }
 return {contact,message,pending};
}
export function SupportCard(){
 const {contact,message,pending}=useSupport();
 return <Panel className="stack about-support">
  <h2><LifeBuoy size={18}/> Need Help or Technical Support?</h2>
  <p>If you experience any issues while using BloomConnect, need assistance with installation, printing, or software settings, please contact our support team. We are happy to help.</p>
  <dl className="detail-list"><div><dt>Support phone</dt><dd>{supportPhone}</dd></div><div><dt>WhatsApp support</dt><dd>{supportPhone}</dd></div></dl>
  <div className="actions">
   <Button disabled={!!pending} onClick={()=>void contact('whatsapp')}><MessageCircle size={15}/> Chat on WhatsApp</Button>
   <Button className="secondary" disabled={!!pending} onClick={()=>void contact('call')}><Phone size={15}/> Call Support</Button>
   <Button className="secondary" disabled={!!pending} onClick={()=>void contact('copy')}><Copy size={15}/> Copy Phone Number</Button>
  </div>
  {message&&<p role="status">{message}</p>}
 </Panel>;
}
export function AboutPage(){
 const {data,error}=useAppInfo();
 return <div className="stack about-page">
  <section className="hero about-hero"><img src={import.meta.env.BASE_URL+'bloomconnect-logo.png'} width={136} height={136} alt="BloomConnect logo"/>
   <div><h2>BloomConnect</h2><p>WhatsApp Print &amp; Order Management System</p>{data?.version?<small className="about-version">Version {data.version}</small>:error?<small>Version unavailable</small>:null}</div>
  </section>
  <Panel className="stack"><h2>About the Software</h2>
   <p>BloomConnect is a modern desktop print and order management solution designed to simplify daily printing operations. It brings together customer file management, WhatsApp-based order handling, PDF and photo printing, print job tracking, and smart printing tools in one convenient workspace.</p>
   <h3>Feature Overview</h3><ul className="about-features">{features.map(feature=><li key={feature}><CheckCircle2 size={15} aria-hidden="true"/>{feature}</li>)}</ul>
  </Panel>
  <div className="about-cards">
   <Panel className="stack"><h2><Code2 size={18}/> Developer Information</h2>
    <dl className="detail-list"><div><dt>Software</dt><dd>BloomConnect</dd></div><div><dt>Product Type</dt><dd>Desktop Print &amp; Order Management System</dd></div><div><dt>Developer</dt><dd>{developerName}</dd></div><div><dt>Support</dt><dd>{supportPhone}</dd></div></dl>
   </Panel><SupportCard/>
  </div>
  <small>{copyright()}</small>
 </div>;
}
export function AppFooter(){
 const {data}=useAppInfo();
 const {contact,message,pending}=useSupport();
 return <footer className="app-footer">
  <span>{copyright()}</span><span>Developed by {developerName}</span>
  <div className="footer-contact">Support: <button type="button" disabled={!!pending} onClick={()=>void contact('call')}>{supportPhone}</button><span aria-hidden="true">|</span><button type="button" disabled={!!pending} onClick={()=>void contact('whatsapp')}>WhatsApp</button>{data?.version&&<><span aria-hidden="true">|</span><span>Version {data.version}</span></>}</div>
  {message&&<span className="footer-feedback" role="status">{message}</span>}
 </footer>;
}
