const {build,Platform}=require('electron-builder');
const feed=process.env.BLOOMCONNECT_UPDATE_URL?.trim();
const config={};
if(feed){
 const url=new URL(feed);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('The update channel must be an HTTPS directory URL.');
 config.publish={provider:'generic',url:url.href.replace(/\/?$/,'/')};
}
if(process.env.WIN_CSC_LINK||process.env.CSC_LINK)config.win={signExecutable:true};
build({targets:Platform.WINDOWS.createTarget(['nsis']),config,publish:'never'}).catch(error=>{
 console.error(error);
 process.exitCode=1;
});
