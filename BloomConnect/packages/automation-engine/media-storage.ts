import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,open,readdir,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import sharp from 'sharp';

export const mediaLimit=2*1024**3;
export const storedMediaName=/^[a-f0-9]{64}\.(pdf|jpg|png|webp|tiff|heic|docx?|xlsx?|pptx?|txt)$/;

export async function removePartialDownloads(directory:string){
  const files=await readdir(directory).catch(()=>[]);
  for(const file of files){
    if(/^\.download-[a-f0-9-]{36}\.tmp$/.test(file))await unlink(join(directory,file)).catch(()=>{});
  }
}

export async function storeDownload<T extends {extension:string;mime:string;needsConversion?:boolean}>(directory:string,
  source:{stream:AsyncIterable<Uint8Array>;size?:number},signal:AbortSignal,
  progress:(bytes:number,total?:number)=>void,
  identify:(path:string,bytes:number)=>Promise<T>){
  await mkdir(directory,{recursive:true});
  const temp=join(directory,'.download-'+randomUUID()+'.tmp');
  const hash=createHash('sha256');
  let bytes=0;
  try{
    await pipeline(Readable.from(source.stream),new Transform({
      transform(chunk:Buffer,_encoding,done){
        bytes+=chunk.length;
        if(bytes>mediaLimit){done(new Error('The attachment exceeds 2 GB.'));return}
        hash.update(chunk);progress(bytes,source.size);done(null,chunk);
      }
    }),createWriteStream(temp,{flags:'wx',mode:0o600,flush:true}),{signal});
    if(!bytes||source.size!==undefined&&bytes!==source.size)throw new Error('WhatsApp returned an incomplete attachment. Retry the download.');
    const type=await identify(temp,bytes);
    const digest=hash.digest('hex'),name=digest+'.'+type.extension;
    if(!storedMediaName.test(name))throw new Error('Unsupported attachment format.');
    signal.throwIfAborted();
    const destination=join(directory,name);
    try{
      await rename(temp,destination);
    }catch(error){
      // Windows can reject replacement while another download or preview has this file open.
      const existing=createHash('sha256');
      try{
        for await(const chunk of createReadStream(destination,{signal}))existing.update(chunk);
      }catch{throw error}
      if(existing.digest('hex')!==digest)throw error;
    }
    return {...type,path:name,hash:digest,bytes};
  }finally{await unlink(temp).catch(()=>{})}
}

export async function identifyLargeMedia(path:string):Promise<{extension:string;mime:string;needsConversion?:boolean}>{
  const handle=await open(path,'r');
  try{
    const header=Buffer.alloc(5);
    await handle.read(header,0,header.length,0);
    if(header.toString()==='%PDF-')return {extension:'pdf',mime:'application/pdf'};
  }finally{await handle.close()}
  const image=sharp(path,{limitInputPixels:40_000_000});
  const {format,pages}=await image.metadata();
  if(format==='jpeg'||format==='png'||format==='webp'){
    await image.resize(64,64,{fit:'inside'}).png().toBuffer();
    return {extension:format==='jpeg'?'jpg':format,mime:'image/'+format};
  }
  if(format==='tiff'||format==='heif'){
    if((pages??1)>1)throw new Error('Multi-page images must be exported to PDF before importing.');
    try{await image.resize(64,64,{fit:'inside'}).png().toBuffer()}
    catch{throw new Error('The installed image decoder cannot read this TIFF or HEIC image. Export it to PNG or PDF.')}
    return {extension:format==='tiff'?'tiff':'heic',mime:'image/'+format,needsConversion:true};
  }
  throw new Error('Large attachments must be valid PDFs or supported images.');
}
