const {spawn}=require('node:child_process');
const env={...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const launched=spawn(require('electron'),['.'],{env,stdio:'inherit'});
launched.on('error',error=>{console.error(error.message);process.exitCode=1});
launched.on('exit',code=>{process.exitCode=code??1});
