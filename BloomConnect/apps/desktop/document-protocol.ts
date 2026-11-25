import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {open,realpath} from 'node:fs/promises';
import {basename,dirname,join} from 'node:path';
import {Readable} from 'node:stream';

const key=randomBytes(32);
const types:Record<string,string>={pdf:'application/pdf',jpg:'image/jpeg',png:'image/png',webp:'image/webp'};
const namePattern=/^[a-f0-9]{64}\.(pdf|jpg|png|webp)$/;
const signature=(name:string)=>createHmac('sha256',key).update(name).digest();

async function localFile(directory:string,name:string){
  if(!namePattern.test(name))throw new Error('Invalid document reference.');
  const root=await realpath(directory);
  const path=await realpath(join(root,name));
  if(dirname(path)!==root||basename(path)!==name)throw new Error('Invalid document location.');
  return open(path,'r');
}

export async function issueReference(directory:string,name:string){
  const file=await localFile(directory,name);
  try{
    const stat=await file.stat();
    if(!stat.isFile()||!stat.size)throw new Error('The saved attachment is unavailable.');
    return {url:'bloom://workspace/document/'+name+'/'+signature(name).toString('hex'),
      mime:types[name.split('.')[1]],bytes:stat.size};
  }finally{await file.close()}
}

export async function serveReference(directory:string,request:Request){
  const url=new URL(request.url);
  const match=/^\/document\/([^/]+)\/([a-f0-9]{64})$/.exec(url.pathname);
  if(request.method!=='GET'||url.host!=='workspace'||!match||!namePattern.test(match[1])||
    !timingSafeEqual(signature(match[1]),Buffer.from(match[2],'hex')))return new Response(null,{status:404});
  const [,name]=match;
  const file=await localFile(directory,name);
  let streaming=false;
  try{
    const stat=await file.stat();
    if(!stat.isFile()||!stat.size)return new Response(null,{status:404});
    const size=stat.size;
    const headers=new Headers({'Content-Type':types[name.split('.')[1]],'Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes'});
    const range=request.headers.get('range');
    const requested=range===null?null:/^bytes=(\d+)-(\d*)$/.exec(range);
    const start=requested?Number(requested[1]):0;
    const end=requested&&requested[2]?Math.min(Number(requested[2]),size-1):size-1;
    if(range!==null&&(!requested||start>=size||end<start)){
      headers.set('Content-Range','bytes */'+size);
      return new Response(null,{status:416,headers});
    }
    if(requested)headers.set('Content-Range',`bytes ${start}-${end}/${size}`);
    headers.set('Content-Length',String(end-start+1));
    const stream=file.createReadStream({start,end,signal:request.signal});
    const response=new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>,{status:requested?206:200,headers});
    streaming=true;
    return response;
  }finally{if(!streaming)await file.close()}
}
