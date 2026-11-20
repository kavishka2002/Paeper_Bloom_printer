import sharp from 'sharp';
import {parentPort,workerData} from 'node:worker_threads';
import {cleanDocument,detectDocument,estimateTextSkew,rectifyDocument,scanDetailScore,type Raster} from './scan-image';
import {scannedPdf} from './scan-pdf';
import type {ScanSettings} from '../shared/scan';

export type ScanWork={kind:'preview'|'save';path:string;settings:ScanSettings}
 |{kind:'pdf';pages:{path:string;rotation:number}[];layout:'a4'|'original';marginMm:number};

const rasterImage=(raster:Raster)=>sharp(raster.data,{raw:{width:raster.width,height:raster.height,channels:3}});
async function readRaster(path:string){
 const {data,info}=await sharp(path,{limitInputPixels:40_000_000}).rotate().flatten({background:'#fff'}).toColourspace('srgb').removeAlpha().raw().toBuffer({resolveWithObject:true});
 if(info.width<2||info.height<2||info.channels!==3)throw new Error('The image is too small or has an unsupported colour format.');
 return {data,width:info.width,height:info.height};
}
async function work(input:ScanWork){
 if(input.kind==='pdf'){
  const pages=[];
  let uniquePixels=0;
  for(const page of input.pages){
   const source=await readRaster(page.path);
   const {data,info}=await rasterImage(source).rotate(page.rotation).raw().toBuffer({resolveWithObject:true});
   uniquePixels+=info.width*info.height;
   if(uniquePixels>65_000_000)throw new Error('This batch exceeds the scan PDF memory limit. Export fewer pages at a time.');
   pages.push({data,width:info.width,height:info.height});
  }
  return {image:scannedPdf(pages,input.layout,input.marginMm)};
 }
 const source=await readRaster(input.path);
 const {data,info}=await rasterImage(source).resize({width:560,height:560,fit:'inside',withoutEnlargement:true}).raw().toBuffer({resolveWithObject:true});
 const detection=detectDocument({data,width:info.width,height:info.height});
 const corners=input.settings.corners??detection.corners;
 const warnings:string[]=[];
 if(!input.settings.corners&&!detection.detected)warnings.push('Page edges could not be confirmed. The entire image was kept. Set corners or crop manually.');
 if(!input.settings.corners&&detection.detected)warnings.push('Review the detected page border on the original before saving.');
 const final=input.kind==='save';
 const rectified=rectifyDocument(source,corners,final?5600:1400,final?18_000_000:1_960_000);
 const detail=scanDetailScore({data,width:info.width,height:info.height});
 if(detail<170||Math.min(source.width,source.height)<500)warnings.push('Text may be blurry or too small. Zoom in and check readability before printing.');
 if(input.settings.mode==='bw')warnings.push('Black & white can hide faint writing or coloured marks. Compare with the original.');
 if(final&&rectified.limited)warnings.push('Output resolution was limited for safe processing.');
 const cleaned=cleanDocument(rectified,{...input.settings,sharpness:detail<170?Math.min(8,input.settings.sharpness):input.settings.sharpness});
 let pipeline=rasterImage(cleaned);
 const skew=input.settings.skew||(!detection.detected&&!input.settings.corners&&input.settings.autoStraighten?estimateTextSkew({data,width:info.width,height:info.height}):0);
 if(skew){
  const straightened=await pipeline.rotate(skew,{background:'#fff'}).png().toBuffer();
  pipeline=sharp(straightened,{limitInputPixels:40_000_000});
 }
 const result=await pipeline.rotate(input.settings.rotation).png().toBuffer({resolveWithObject:true});
 const original=final?undefined:await rasterImage(source).resize({width:1400,height:1400,fit:'inside',withoutEnlargement:true}).png().toBuffer();
 return {image:result.data,original,corners,detected:detection.detected,warnings,width:result.info.width,height:result.info.height};
}
void work(workerData as ScanWork).then(
 value=>parentPort!.postMessage({value}),
 error=>parentPort!.postMessage({error:error instanceof Error?error.message:'Document scan failed.'})
);
