import type {ButtonHTMLAttributes,ReactNode} from 'react';
export function Button({className='',...props}:ButtonHTMLAttributes<HTMLButtonElement>){return <button type="button" {...props} className={'button '+className}/>}
export function Panel({children,className=''}:{children:ReactNode;className?:string}){return <section className={'panel '+className}>{children}</section>}
export function Badge({children}:{children:ReactNode}){
 const label=typeof children==='string'?children:'';
 const tone=/^(connected|api reachable|available|ready|completed|paid|enabled|delivered)$/i.test(label)?'success':/^(failed|error|offline|disconnected|cancelled)$/i.test(label)?'danger':/^(pending|unconfirmed|unpaid|partially paid|paused|printing|awaiting confirmation|select printer|scan qr)$/i.test(label)?'warn':'neutral';
 return <span className="badge" data-tone={tone}>{children}</span>;
}
