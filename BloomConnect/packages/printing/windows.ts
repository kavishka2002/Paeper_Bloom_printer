import {execFile,spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {z} from 'zod';
import type {PrintSettings} from './settings';
import {paperDimensions} from './paper';
export const capabilitiesSchema=z.object({name:z.string(),driver:z.string(),model:z.string(),port:z.string(),offline:z.boolean(),status:z.number(),error:z.number(),duplex:z.boolean(),colour:z.boolean(),maximumCopies:z.number(),papers:z.array(z.object({id:z.number(),name:z.string(),widthMm:z.number(),heightMm:z.number()})),trays:z.array(z.object({id:z.number(),name:z.string()})),resolutions:z.array(z.object({x:z.number(),y:z.number()})),printable:z.object({left:z.number(),right:z.number(),top:z.number(),bottom:z.number()}),borderless:z.boolean(),source:z.string(),queriedAt:z.string()});
export type PrinterCapabilities=z.infer<typeof capabilitiesSchema>;
export async function windowsBridge(script:string,action:'capabilities'|'submit',request:unknown){
  if(process.platform!=='win32')throw new Error('Windows printer APIs are only available on Windows.');
  const folder=await mkdtemp(join(tmpdir(),'bloom-driver-'));
  try{
    const input=join(folder,'request.json');await writeFile(input,JSON.stringify(request),'utf8');
    const output=await new Promise<string>((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Action',action,'-InputFile',input],{windowsHide:true,timeout:action==='submit'?120000:30000,maxBuffer:4*1024*1024,encoding:'utf8'},(error,stdout,stderr)=>error?reject(new Error((stderr||error.message).slice(0,1500))):resolve(stdout)));
    return JSON.parse(output.replace(/^\uFEFF/,''));
  }finally{await rm(folder,{recursive:true,force:true})}
}
export async function queryCapabilities(script:string,printer:string,s?:PrintSettings){
  const dimensions=s?paperDimensions(s.paper,s.customPaper):undefined;
  return capabilitiesSchema.parse(await windowsBridge(script,'capabilities',{printer,widthMm:dimensions?.[0],heightMm:dimensions?.[1],landscape:s?.landscape??false,allowCustom:false}));
}
export {validatePrinter} from './capabilities';
export function openPrinterDialog(printer:string,kind:'preferences'|'properties'){
  if(process.platform!=='win32')throw new Error('Native printer dialogs require Windows.');
  // No shell interpolation: the printer name is a single process argument.
  return new Promise<void>((resolve,reject)=>{const child=spawn('rundll32.exe',['printui.dll,PrintUIEntry',kind==='preferences'?'/e':'/p','/n',printer],{windowsHide:false,stdio:'ignore'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('Windows could not open this printer dialog.')))});
}
