import {execFile} from 'node:child_process';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {extname,join} from 'node:path';
import {TextDecoder} from 'node:util';

export const officeExtensions=['doc','docx','xls','xlsx','ppt','pptx','txt'] as const;
export function officeDocument(name:string,bytes:Buffer){
 const extension=extname(name).slice(1).toLowerCase();
 if(!officeExtensions.some(value=>value===extension))return;
 if(extension==='txt'){
  const encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';
  try{if(!bytes.length||new TextDecoder(encoding,{fatal:true}).decode(bytes).includes('\0'))return}catch{return}
 }else if(extension.endsWith('x')){
  if(!bytes.subarray(0,4).equals(Buffer.from([80,75,3,4])))return;
 }else if(!bytes.subarray(0,8).equals(Buffer.from([208,207,17,224,161,177,26,225])))return;
 return {extension,mime:extension==='txt'?'text/plain':'application/x-bloom-office-'+extension};
}

export async function convertOfficeDocument(script:string,input:string,mode:'pages'|'notes'|'outline',includeHidden:boolean){
 if(process.platform!=='win32')throw new Error('Office conversion requires Microsoft Office on Windows.');
 const folder=await mkdtemp(join(tmpdir(),'bloom-office-'));
 try{
  const output=join(folder,'converted.pdf'),request=join(folder,'request.json');
  await writeFile(request,JSON.stringify({input,output,mode,includeHidden}),'utf8');
  await new Promise<void>((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',script,'-InputFile',request],
   {windowsHide:true,timeout:90000,maxBuffer:1024*1024,encoding:'utf8'},(error,_,stderr)=>error
    ?reject(new Error(error.killed?'Office conversion timed out. Check for an Office dialog or save a PDF from Office.':
      stderr.split(/\r?\n/).find(line=>line.trim())?.trim().slice(0,400)||'Office could not convert the document. Open it in Office and export it to PDF.'))
    :resolve()));
  if((await stat(output)).size>32*1024*1024)throw new Error('The converted PDF exceeds 32 MB. Split the source document.');
  const bytes=await readFile(output);
  if(bytes.subarray(0,5).toString()!=='%PDF-')throw new Error('Office did not generate a valid PDF.');
  return bytes;
 }finally{await rm(folder,{recursive:true,force:true})}
}
