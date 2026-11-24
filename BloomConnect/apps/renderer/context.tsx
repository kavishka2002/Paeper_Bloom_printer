import {isVirtualPrinter} from '../../packages/printing/capabilities';
import {createContext,useContext,useState,type ReactNode} from 'react';
import {Inbox} from 'lucide-react';
import type {Bridge,Snapshot,Printer,Operation,Input,Job} from '../../packages/shared/contracts';
declare global{interface Window{bloom:Bridge}}
import {Button} from '../../packages/ui';
export {Button};
export {Panel,Badge} from '../../packages/ui';
export const ctx=createContext<{
 data:Snapshot; printers:Printer[];run:<K extends Operation>(op:K,input:Input<K>,message?:string)=>Promise<boolean>; refresh:()=>Promise<void>; error:(e:unknown)=>void
}>(null!);
export const useData=()=>useContext(ctx);
export const money=(n:number)=>'LKR '+(n/100).toLocaleString('en-LK',{minimumFractionDigits:2,maximumFractionDigits:2});
export const stamp=(s:string)=>new Date(s).toLocaleString('en-LK',{timeZone:'Asia/Colombo',dateStyle:'medium',timeStyle:'short'});
export const match=(needle:string,...values:(string|null|undefined)[])=>values.some(v=>v?.toLowerCase().includes(needle.toLowerCase().trim()));
export const name=(s:Snapshot,id:string|null)=>s.customers.find(c=>c.id===id)?.name??'Walk-in';
export const orderStatusLabels:Record<Job['status'],string>={
 New:'Received','Awaiting Confirmation':'Awaiting confirmation',Processing:'In progress',
 'Ready to Print':'Ready to print',Printing:'Printing','Ready for Pickup':'Ready',
 Completed:'Completed',Cancelled:'Cancelled',Failed:'Needs attention'
};
export function Empty({title,children}:{title:string;children?:ReactNode}){return <div className="empty"><span><Inbox size={22}/></span><strong>{title}</strong>{children}</div>}
export function Table({headers,children}:{headers:string[];children:ReactNode}){return <div className="table-wrap"><table><thead><tr>{headers.map((h,i)=><th key={i}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>}
export function PrinterSelect({value,change,labelOutput=false}:{value:string;change:(value:string)=>void;labelOutput?:boolean}){
 const {printers}=useData();
 return <select aria-label="Printer" value={value} onChange={e=>change(e.target.value)}>
  <option value="">Select a printer</option>
  {value&&!printers.some(p=>p.name===value)&&<option value={value} disabled>{value} (unavailable)</option>}
  {printers.map(p=><option key={p.name} value={p.name}>{p.displayName||p.name}{p.isDefault?' (default)':''}{labelOutput&&isVirtualPrinter(p.name)?' (virtual)':''}</option>)}
 </select>;
}
export function PrinterPropertiesButton({printer,disabled=false,onClose}:{printer:string;disabled?:boolean;onClose?:()=>void}){
 const {printers,error}=useData();
 const [opening,setOpening]=useState(false);
 return <Button className="secondary" disabled={disabled||opening||!printers.some(device=>device.name===printer)} aria-busy={opening}
  onClick={async()=>{
   setOpening(true);
   try{await window.bloom.call('printerDialog',{printer,kind:'properties'});onClose?.()}
   catch(e){error(e)}finally{setOpening(false)}
  }}>Printer properties</Button>;
}
