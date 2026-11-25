import {createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import type {Input} from '../shared/contracts';
const media=z.object({id:z.string().regex(/^\d+$/),filename:z.string().optional(),caption:z.string().optional()});
export const webhook=z.object({object:z.literal('whatsapp_business_account'),entry:z.array(z.object({changes:z.array(z.object({field:z.string(),value:z.object({
  metadata:z.object({phone_number_id:z.string()}).optional(),
  contacts:z.array(z.object({wa_id:z.string(),profile:z.object({name:z.string()}).optional()})).optional(),
  messages:z.array(z.object({id:z.string().min(1).max(256),from:z.string().regex(/^[1-9]\d{6,14}$/),timestamp:z.string().regex(/^\d{1,10}$/),type:z.string(),text:z.object({body:z.string()}).optional(),image:media.optional(),document:media.optional()})).optional(),
  statuses:z.array(z.object({id:z.string(),status:z.enum(['sent','delivered','read','failed'])})).optional()
})}))}))});
export function signed(body:Buffer,secret:string,signature:unknown){
  if(typeof signature!=='string'||!/^sha256=[a-f0-9]{64}$/i.test(signature))return false;
  return timingSafeEqual(Buffer.from(signature.slice(7),'hex'),createHmac('sha256',secret).update(body).digest());
}
export async function collect(stream:AsyncIterable<Uint8Array>,limit:number){
  const chunks:Buffer[]=[];let length=0;
  for await(const chunk of stream){length+=chunk.length;if(length>limit)throw new Error('File or request exceeds the size limit.');chunks.push(Buffer.from(chunk))}
  return Buffer.concat(chunks,length);
}
export class CloudAdapter {
  constructor(readonly config:Input<'connect'>){}
  async graph(path:string,payload?:object,signal?:AbortSignal){
    const response=await fetch(`https://graph.facebook.com/${this.config.version}/${path}`,{method:payload?'POST':'GET',headers:{Authorization:`Bearer ${this.config.token}`,'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error(`Meta rejected the request (HTTP ${response.status}). Check permissions, connectivity, or messaging limits.`);
    return await response.json() as unknown;
  }
  async verify(){return z.object({id:z.string(),display_phone_number:z.string()}).parse(await this.graph(`${this.config.phoneId}?fields=id,display_phone_number`)).display_phone_number}
  async download(id:string,signal:AbortSignal){
    if(!/^\d+$/.test(id))throw new Error('Invalid WhatsApp media identifier.');
    const meta=z.object({url:z.url()}).parse(await this.graph(id,undefined,signal));
    const url=new URL(meta.url);
    if(url.protocol!=='https:'||url.username||url.password||url.port||!(url.hostname==='lookaside.fbsbx.com'||url.hostname.endsWith('.fbcdn.net')))throw new Error('Unexpected media download host.');
    const idle=new AbortController();
    const transfer=AbortSignal.any([signal,idle.signal]);
    const arm=()=>setTimeout(()=>idle.abort(new Error('WhatsApp stopped sending attachment data.')),60000).unref();
    let timeout=arm();
    try{
      const response=await fetch(url,{headers:{Authorization:`Bearer ${this.config.token}`},redirect:'error',signal:transfer});
      if(!response.ok||!response.body){
        await response.body?.cancel().catch(()=>{});
        throw new Error(`WhatsApp media could not be downloaded (HTTP ${response.status}). Retry to request a fresh download link.`);
      }
      const length=Number(response.headers.get('content-length'));
      async function* chunks(body:AsyncIterable<Uint8Array>){
        try{for await(const chunk of body){clearTimeout(timeout);timeout=arm();yield chunk}}
        finally{clearTimeout(timeout)}
      }
      return {stream:chunks(response.body as unknown as AsyncIterable<Uint8Array>),
        size:!response.headers.get('content-encoding')&&Number.isSafeInteger(length)&&length>0?length:undefined};
    }catch(error){clearTimeout(timeout);throw error}
  }
  async send(phone:string,text:string){
    return z.object({messages:z.array(z.object({id:z.string()})).min(1)}).parse(await this.graph(`${this.config.phoneId}/messages`,{messaging_product:'whatsapp',to:phone,type:'text',text:{body:text}})).messages[0].id;
  }
}
