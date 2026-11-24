import {contextBridge,ipcRenderer,webUtils} from 'electron';
import type {Bridge} from '../../packages/shared/contracts';
import type {AppUpdates,UpdateStatus} from '../../packages/shared/app-updates';
const api:Bridge={importDropped:(files,customer)=>ipcRenderer.invoke('bloom:drop-files',files.map(file=>webUtils.getPathForFile(file)),customer),call:(operation,input)=>ipcRenderer.invoke('bloom:call',operation,input),subscribe:listener=>{
  const handler=()=>listener();ipcRenderer.on('bloom:changed',handler);return ()=>ipcRenderer.removeListener('bloom:changed',handler);
}};
contextBridge.exposeInMainWorld('bloom',api);
const updates:AppUpdates={
 call:action=>ipcRenderer.invoke('bloom:updates',action),
 subscribe:listener=>{
  const receive=(_event:Electron.IpcRendererEvent,status:UpdateStatus)=>listener(status);
  ipcRenderer.on('bloom:update-status',receive);
  return ()=>ipcRenderer.removeListener('bloom:update-status',receive);
 }
};
contextBridge.exposeInMainWorld('bloomUpdates',updates);
contextBridge.exposeInMainWorld('startupReady',()=>ipcRenderer.invoke('bloom:startup-ready'));
contextBridge.exposeInMainWorld('offlineLicense',{
  status:()=>ipcRenderer.invoke('bloom:license','status'),
  paste:()=>ipcRenderer.invoke('bloom:license','paste'),
  copy:()=>ipcRenderer.invoke('bloom:license','copy'),
  support:()=>ipcRenderer.invoke('bloom:license','support'),
  buy:(shopName:string)=>ipcRenderer.invoke('bloom:license','buy',shopName),
  activate:(code:string)=>ipcRenderer.invoke('bloom:license','activate',code),
  importFile:()=>ipcRenderer.invoke('bloom:license','import'),
});
contextBridge.exposeInMainWorld('printView',{load:()=>ipcRenderer.invoke('bloom:print-data'),done:(error:string)=>ipcRenderer.send('bloom:print-ready',error)});
