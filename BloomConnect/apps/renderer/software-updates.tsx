import {useEffect,useState} from 'react';
import type {AppUpdates,UpdateStatus} from '../../packages/shared/app-updates';
import {Button,Panel} from './context';

declare global{interface Window{bloomUpdates?:AppUpdates}}

export function SoftwareUpdates(){
 const [status,setStatus]=useState<UpdateStatus>();
 const [error,setError]=useState('');
 const api=window.bloomUpdates;
 useEffect(()=>{
  if(!api)return;
  let active=true;
  const unsubscribe=api.subscribe(setStatus);
  void api.call('status').then(value=>{if(active)setStatus(previous=>previous??value)}).catch(()=>{if(active)setError('Update status could not be loaded.')});
  return()=>{active=false;unsubscribe()};
 },[api]);
 async function run(action:'check'|'install'){
  setError('');
  try{await api?.call(action)}catch(error){
   setError(String(error).replace(/^Error invoking remote method 'bloom:updates':\s*(?:Error:\s*)?/, ''));
  }
 }
 const message=status?.message??(status?.state==='ready'?'Version '+status.availableVersion+' will install when you close BloomConnect. Save your open work before restarting.':
  status?.state==='downloading'?'Downloading '+status.availableVersion+' · '+(status.percent??0)+'%':
  status?.state==='current'?'You have the latest version.':status?.state==='checking'?'Checking for updates…':
  status?.state==='installing'?'Restarting to install the update…':
  !api?'Updates are available in the Windows desktop app.':'BloomConnect checks for updates automatically.');
 return <Panel className="stack"><h2>Software updates</h2>
  {status&&<small>Installed version {status.version}</small>}
  <p role="status">{message}</p>
  {status?.state==='downloading'&&<progress aria-label="Update download" max={100} value={status.percent??0}/>}
  {error&&<p role="alert">{error}</p>}
  {status&&status.state!=='unavailable'&&<div className="actions">
   {status.state==='ready'?<Button onClick={()=>void run('install')}>Restart and install</Button>:
    <Button disabled={['checking','downloading','installing'].includes(status.state)} onClick={()=>void run('check')}>Check for updates</Button>}
  </div>}
 </Panel>;
}
