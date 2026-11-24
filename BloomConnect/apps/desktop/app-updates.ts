import {app,BrowserWindow,ipcMain} from 'electron';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import type {UpdateStatus} from '../../packages/shared/app-updates';

export function startAppUpdates(window:BrowserWindow,trusted:(event:Electron.IpcMainInvokeEvent)=>unknown,isPrinting:()=>boolean){
 const version=app.getVersion();
 const configured=process.platform==='win32'&&app.isPackaged&&!process.env.BLOOMCONNECT_SMOKE_DIR&&
  existsSync(join(process.resourcesPath,'app-update.yml'));
 const updater=configured?(require('electron-updater') as typeof import('electron-updater')).autoUpdater:undefined;
 let status:UpdateStatus=updater?{state:'idle',version}:{state:'unavailable',version,message:'This installation has no automatic update channel.'};
 function update(next:Omit<UpdateStatus,'version'>){
  status={version,...next};
  if(!window.isDestroyed())window.webContents.send('bloom:update-status',status);
 }
 const fail=()=>update({state:'error',message:'Could not check or download the update. Check your internet connection and try again.'});
 async function check(){
  if(!updater||['checking','downloading','ready','installing'].includes(status.state))return;
  update({state:'checking'});
  try{await updater.checkForUpdates()}catch{fail()}
 }
 if(updater){
  updater.autoDownload=true;
  updater.autoInstallOnAppQuit=true;
  app.on('before-quit',()=>{updater.autoInstallOnAppQuit=!isPrinting()});
  updater.on('update-available',info=>update({state:'downloading',availableVersion:info.version,percent:0}));
  updater.on('download-progress',progress=>update({state:'downloading',availableVersion:status.availableVersion,percent:Math.round(progress.percent)}));
  updater.on('update-not-available',()=>update({state:'current'}));
  updater.on('update-downloaded',info=>update({state:'ready',availableVersion:info.version}));
  updater.on('error',fail);
  setTimeout(()=>void check(),20000).unref();
  setInterval(()=>void check(),4*60*60*1000).unref();
 }
 ipcMain.handle('bloom:updates',async(event,action:unknown)=>{
  if(!trusted(event))throw new Error('Unauthorized update request.');
  if(action==='check')void check();
  else if(action==='install'){
   if(!updater||status.state!=='ready')throw new Error('No update is ready to install.');
   if(isPrinting())throw new Error('Wait for the current print job to finish before restarting.');
   update({state:'installing',availableVersion:status.availableVersion});
   setImmediate(()=>{
    try{updater.quitAndInstall(false,true)}catch{fail()}
   });
  }else if(action!=='status')throw new Error('Unknown update action.');
  return status;
 });
}
