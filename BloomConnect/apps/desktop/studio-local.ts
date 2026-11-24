import {execFile} from 'node:child_process';
import {access,mkdtemp,open,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {extname,join} from 'node:path';
import {promisify} from 'node:util';
import {Worker} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
import type {ScanPreview,ScanSettings} from '../../packages/shared/scan';

const execute=promisify(execFile);

export async function writeStudioExport(path:string,format:string,bytes:Uint8Array){
 if(extname(path).toLowerCase()!=='.'+format)throw new Error('Use the .'+format+' extension for this export.');
 let file:Awaited<ReturnType<typeof open>>;
 try{file=await open(path,'wx')}
 catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new Error('Choose a new filename. PDF Studio protects existing files.');throw error}
 try{await file.writeFile(bytes);await file.close()}
 catch(error){await file.close().catch(()=>{});await rm(path,{force:true}).catch(()=>{});throw error}
}

async function temporary<T>(work:(folder:string)=>Promise<T>){
 const folder=await mkdtemp(join(tmpdir(),'bloom-pdf-studio-'));
 try{return await work(folder)}finally{await rm(folder,{recursive:true,force:true}).catch(()=>{})}
}

export function cleanStudioScan(bytes:Uint8Array,settings:ScanSettings){
 return temporary(async folder=>{
  const path=join(folder,'input.png');
  await writeFile(path,bytes);
  return new Promise<ScanPreview>((resolve,reject)=>{
   const worker=new Worker(join(__dirname,'scan-worker.cjs'),{workerData:{kind:'preview',path,settings}});
   const timeout=setTimeout(()=>{void worker.terminate();reject(new Error('Document cleanup timed out.'))},90_000);
   worker.once('message',result=>result.error?reject(new Error(result.error)):resolve(result.value));
   worker.once('error',reject);
   worker.once('exit',()=>{clearTimeout(timeout);reject(new Error('Document cleanup stopped.'))});
  });
 });
}

async function installed(program:string,relative:string){
 const roots=[process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.LOCALAPPDATA].filter((path):path is string=>!!path);
 for(const root of roots){
  const path=join(root,relative,program);
  try{await access(path);return path}catch{/* Try the next standard install directory. */}
 }
}

export async function recognizeStudioScan(bytes:Uint8Array,language:string){
 const binary=await installed('tesseract.exe','Tesseract-OCR');
 if(!binary)throw new Error('Install Tesseract OCR for Windows in Program Files. Include the English (eng) and Sinhala (sin) language packs you need.');
 try{
  const {stdout}=await execute(binary,['--list-langs'],{windowsHide:true,timeout:10_000});
  const languages=stdout.split(/\r?\n/).map(value=>value.trim());
  if(language.split('+').some(value=>!languages.includes(value)))throw new Error('The selected OCR language pack is missing. Install it in the Tesseract tessdata folder.');
 }catch(error){throw new Error(error instanceof Error?error.message:'Tesseract language detection failed.')}
 return temporary(async folder=>{
  const input=join(folder,'input.png'),output=join(folder,'recognized');
  await writeFile(input,bytes);
  await execute(binary,[input,output,'-l',language,'txt','pdf'],{windowsHide:true,timeout:120_000,maxBuffer:1024*1024});
  const [text,pdf]=await Promise.all([readFile(output+'.txt','utf8'),readFile(output+'.pdf')]);
  return {text,pdf:new Uint8Array(pdf)};
 });
}

export async function convertStudioWord(bytes:Uint8Array){
 if(bytes[0]!==0x50||bytes[1]!==0x4b)throw new Error('Choose a valid DOCX document.');
 const binary=await installed('soffice.com',join('LibreOffice','program'));
 if(!binary)throw new Error('Install LibreOffice for Windows in Program Files to convert DOCX to PDF.');
 return temporary(async folder=>{
  const input=join(folder,'document.docx');
  await writeFile(input,bytes);
  try{
   const {stdout}=await execute(binary,['-env:UserInstallation='+pathToFileURL(join(folder,'profile')).href,'--headless','--convert-to','pdf:writer_pdf_Export','--outdir',folder,input],{windowsHide:true,timeout:120_000});
   if(!stdout.trim())throw new Error('No conversion output.');
   return new Uint8Array(await readFile(join(folder,'document.pdf')));
  }catch{throw new Error('LibreOffice could not convert this Word document. Check that the DOCX opens in Writer and that its fonts are installed.')}
 });
}

export async function secureStudioPdf(input:{bytes:Uint8Array;mode:'protect'|'unlock';password:string;owner:string;printing:'full'|'low'|'none'}){
 const binary=await installed('qpdf.exe',join('qpdf','bin'));
 if(!binary)throw new Error('Install qpdf for Windows with qpdf.exe in Program Files\\qpdf\\bin to change PDF security.');
 return temporary(async folder=>{
  const source=join(folder,'input.pdf'),destination=join(folder,'output.pdf'),options=join(folder,'options.txt');
  await writeFile(source,input.bytes);
  if(input.mode==='unlock'){
   const passwordFile=join(folder,'password.txt');
   await writeFile(passwordFile,input.owner+'\n');
   let owner=false;
   try{
    const {stdout}=await execute(binary,['--password-file='+passwordFile,'--show-encryption',source],{windowsHide:true,timeout:20_000});
    owner=stdout.includes('Supplied password is owner password');
   }catch{/* Report a generic authentication error. */}
   if(!owner)throw new Error('Enter the authorized owner password to remove PDF encryption.');
   await writeFile(options,[source,'--password-file='+passwordFile,'--decrypt',destination].join('\n'));
  }else{
   if(!input.password||!input.owner||input.password===input.owner)throw new Error('Set different open and owner passwords.');
   if([input.password,input.owner].some(password=>password.startsWith('@')||password==='--'))throw new Error('Choose a password that does not begin with @ or equal --.');
   await writeFile(options,[source,'--encrypt',input.password,input.owner,'256','--print='+input.printing,'--',destination].join('\n'));
  }
  try{
   await execute(binary,['@'+options],{windowsHide:true,timeout:120_000});
   return new Uint8Array(await readFile(destination));
  }catch{throw new Error('qpdf could not change this PDF. Check that the input and passwords are valid.')}
 });
}
