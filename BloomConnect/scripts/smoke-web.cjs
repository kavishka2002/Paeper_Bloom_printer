const {fork}=require('node:child_process');
const {mkdtemp,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');

async function main(){
  const root=await mkdtemp(join(tmpdir(),'bloom-web-smoke-'));
  const packaged=process.argv.includes('--packaged');
  const engine=packaged?'release/win-unpacked/resources/app.asar/dist/engine.cjs':'dist/engine.cjs';
  const execPath=packaged?resolve('release/win-unpacked/BloomConnect.exe'):process.execPath;
  const child=fork(resolve(engine),[root],{execPath,env:{...process.env,ELECTRON_RUN_AS_NODE:packaged?'1':'',BLOOMCONNECT_WEB_SMOKE:'1',BLOOMCONNECT_TEST_WEBHOOK:'1'},stdio:['ignore','ignore','inherit','ipc'],serialization:'advanced'});
  let sequence=0;
  const calls=new Map();
  child.on('message',message=>{
    const call=calls.get(message.id);
    if(!call)return;
    calls.delete(message.id);
    clearTimeout(call.timer);
    if(message.error)call.reject(new Error(message.error));else call.resolve(message.result);
  });
  const exit=new Promise(resolve=>child.once('exit',resolve));
  function invoke(operation,input){
    return new Promise((resolve,reject)=>{
      const id=++sequence;
      const timer=setTimeout(()=>{calls.delete(id);reject(new Error('Engine request timed out: '+operation))},20000);
      calls.set(id,{resolve,reject,timer});
      child.send({id,operation,input});
    });
  }
  try{
    await invoke('webConnect',null);
    for(let n=0;n<90;n++){
      const {connection}=await invoke('snapshot',null);
      if(connection.status==='Scan QR'&&/^data:image\/png;base64,/.test(connection.qr)){
        console.log('WhatsApp Web returned a QR code and the engine encoded it. No account was linked.');
        return;
      }
      if(connection.status==='Offline')throw new Error(connection.detail);
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    throw new Error('WhatsApp Web did not produce a QR code before the smoke-test timeout.');
  }finally{
    if(child.connected)child.disconnect();
    const fallback=setTimeout(()=>child.kill(),12000);
    await exit;
    clearTimeout(fallback);
    await rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:300});
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
