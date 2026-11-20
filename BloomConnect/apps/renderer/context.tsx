import {createContext,useContext,type ReactNode} from 'react';
import {Inbox} from 'lucide-react';
import type {Bridge,Snapshot,Printer,Operation,Input} from '../../packages/shared/contracts';
declare global{interface Window{bloom:Bridge}}
export {Button,Panel,Badge} from '../../packages/ui';
export const ctx=createContext<{
 data:Snapshot; printers:Printer[];run:<K extends Operation>(op:K,input:Input<K>,message?:string)=>Promise<boolean>; refresh:()=>Promise<void>; error:(e:unknown)=>void
}>(null!);
export const useData=()=>useContext(ctx);
export const money=(n:number)=>'LKR '+(n/100).toLocaleString('en-LK',{minimumFractionDigits:2,maximumFractionDigits:2});
export const stamp=(s:string)=>new Date(s).toLocaleString('en-LK',{timeZone:'Asia/Colombo',dateStyle:'medium',timeStyle:'short'});
export const match=(needle:string,...values:(string|null|undefined)[])=>values.some(v=>v?.toLowerCase().includes(needle.toLowerCase().trim()));
export const name=(s:Snapshot,id:string|null)=>s.customers.find(c=>c.id===id)?.name??'Walk-in';
export function Empty({title,children}:{title:string;children?:ReactNode}){return <div className="empty"><span><Inbox size={22}/></span><strong>{title}</strong>{children}</div>}
export function Table({headers,children}:{headers:string[];children:ReactNode}){return <div className="table-wrap"><table><thead><tr>{headers.map((h,i)=><th key={i}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>}
export function PrinterSelect({value,change}:{value:string;change:(value:string)=>void}){const {printers}=useData();return <select aria-label="Printer" value={value} onChange={e=>change(e.target.value)}><option value="">Select a printer</option>{printers.map(p=><option key={p.name} value={p.name}>{p.displayName||p.name}{p.isDefault?' (default)':''}</option>)}</select>}
