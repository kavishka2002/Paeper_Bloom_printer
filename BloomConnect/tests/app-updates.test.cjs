const assert=require('node:assert/strict');
const {test}=require('node:test');
const {EventEmitter}=require('node:events');
const {buildSync}=require('esbuild');

const code=buildSync({entryPoints:['apps/desktop/app-updates.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external'}).outputFiles[0].text;

function fixture(configured){
 const module={exports:{}},events=[],updater=new EventEmitter();
 let apply,printing=false,checks=0,installs=0;
 updater.checkForUpdates=async()=>{checks++;updater.emit('update-available',{version:'0.4.3'})};
 updater.quitAndInstall=()=>{installs++};
 const app=Object.assign(new EventEmitter(),{getVersion:()=> '0.4.2',isPackaged:true});
 const electron={app,ipcMain:{handle:(_channel,handler)=>{apply=handler}}};
 const fakeRequire=name=>name==='electron'?electron:name==='electron-updater'?{autoUpdater:updater}:name==='node:fs'?{existsSync:()=>configured}:require(name);
 const timer=()=>({unref(){}});
 new Function('module','exports','require','process','setTimeout','setInterval',code)(
  module,module.exports,fakeRequire,{platform:'win32',resourcesPath:'resources',env:{}},timer,timer
 );
 const window={isDestroyed:()=>false,webContents:{send:(_channel,status)=>events.push(status)}};
 module.exports.startAppUpdates(window,event=>event.trusted,()=>printing);
 return {call:(action,trusted=true)=>apply({trusted},action),updater,events,printing:value=>{printing=value},checks:()=>checks,installs:()=>installs,beforeQuit:()=>app.emit('before-quit')};
}

test('updates auto-download, report progress and guard restart while printing',async()=>{
 const job=fixture(true);
 assert.equal(job.updater.autoDownload,true);
 assert.equal(job.updater.autoInstallOnAppQuit,true);
 assert.equal((await job.call('status')).state,'idle');
 await assert.rejects(job.call('check',false),/Unauthorized/);
 await job.call('check');
 await job.call('check');
 assert.equal(job.checks(),1);
 job.updater.emit('download-progress',{percent:54.7});
 assert.equal((await job.call('status')).percent,55);
 job.updater.emit('update-downloaded',{version:'0.4.3'});
 job.printing(true);
 job.beforeQuit();
 assert.equal(job.updater.autoInstallOnAppQuit,false);
 await assert.rejects(job.call('install'),/print job/);
 job.printing(false);
 job.beforeQuit();
 assert.equal(job.updater.autoInstallOnAppQuit,true);
 assert.equal((await job.call('install')).state,'installing');
 await assert.rejects(job.call('install'),/No update/);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(job.installs(),1);
 assert.deepEqual(job.events.map(event=>event.state),['checking','downloading','downloading','ready','installing']);
});

test('installations without an update channel remain usable offline',async()=>{
 const job=fixture(false);
 assert.equal((await job.call('check')).state,'unavailable');
 assert.equal(job.checks(),0);
});
