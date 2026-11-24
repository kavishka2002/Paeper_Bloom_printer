import {compressStudioPdf,exportStudioPages,packageStudioBatch,packageStudioImages,studioImagesToPdf} from '../../packages/printing/studio-pages';
import {removeStudioBackground,studioBackdropPixelLimit} from '../../packages/printing/studio-background';
import {enhancePixels,sharpenPixels} from '../../packages/printing/image-processing';

type BackdropSettings={background:[number,number,number];tolerance:number;clarity:number;remove:boolean;floorShadow:boolean;replacement?:[number,number,number]};
async function backdrop(bytes:Uint8Array,{background,tolerance,clarity,remove,floorShadow,replacement}:BackdropSettings){
 const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)]));
 try{
  const scale=Math.min(1,Math.sqrt(studioBackdropPixelLimit/(bitmap.width*bitmap.height)));
  const width=Math.max(1,Math.floor(bitmap.width*scale)),height=Math.max(1,Math.floor(bitmap.height*scale));
  const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d')!;
  ctx.drawImage(bitmap,0,0,width,height);
  const pixels=ctx.getImageData(0,0,width,height);
  if(clarity){
   enhancePixels(pixels.data,width,height,{denoise:clarity*.18});
   sharpenPixels(pixels.data,width,height,clarity);
  }
  if(remove&&!removeStudioBackground(pixels.data,width,height,background,tolerance,replacement,floorShadow))throw new Error('No matching backdrop touches the image edge. Try a different colour or tolerance.');
  ctx.putImageData(pixels,0,0);
  const blob=await canvas.convertToBlob({type:'image/png'});
  return {name:remove?'photo-background':'photo-enhanced',format:'png' as const,bytes:new Uint8Array(await blob.arrayBuffer())};
 }finally{bitmap.close()}
}

export type StudioRequest=
 |{operation:'pages';args:Parameters<typeof exportStudioPages>}
 |{operation:'compress';args:Parameters<typeof compressStudioPdf>}
 |{operation:'image-to-pdf';args:Parameters<typeof studioImagesToPdf>}
 |{operation:'pdf-to-images';args:Parameters<typeof packageStudioImages>}
 |{operation:'batch';args:Parameters<typeof packageStudioBatch>}
 |{operation:'backdrop';args:Parameters<typeof backdrop>};

self.onmessage=async({data}:{data:StudioRequest})=>{
  try{
    const result=data.operation==='compress'?await compressStudioPdf(...data.args):
      data.operation==='image-to-pdf'?await studioImagesToPdf(...data.args):
      data.operation==='pdf-to-images'?packageStudioImages(...data.args):
      data.operation==='batch'?packageStudioBatch(...data.args):
      data.operation==='backdrop'?await backdrop(...data.args):await exportStudioPages(...data.args);
    self.postMessage({result},{transfer:[result.bytes.buffer as ArrayBuffer]});
  }catch(error){
    self.postMessage({error:error instanceof Error?error.message:String(error)});
  }
};
