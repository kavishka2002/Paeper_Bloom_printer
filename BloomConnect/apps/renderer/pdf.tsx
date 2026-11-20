import {enhancePixels,sharpenPixels} from '../../packages/printing/image-processing';
import {useEffect,useRef,useState} from 'react';
import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {planPhotos,planDocument,plannedOutput,placementGeometry,photoPlacementGeometry,analysePixels,type DocumentInfo,type PlannedSide,type DocumentPlan} from '../../packages/printing/plan';
import {normalizedSettings,type PrintSettings} from '../../packages/printing/settings';

import type {Input} from '../../packages/shared/contracts';
GlobalWorkerOptions.workerSrc=worker;

type PrintData={input:Input<'print'>;files:{id:string}[]};
declare global{interface Window{printView:{load:()=>Promise<PrintData>;done:(error:string)=>void}}}
function pdf(bytes:Uint8Array){
  const assets=new URL('./assets/pdfjs/',document.baseURI);
  return getDocument({
    data:bytes,enableXfa:false,stopAtErrors:true,
    cMapUrl:new URL('cmaps/',assets).href,
    standardFontDataUrl:new URL('standard_fonts/',assets).href,
    wasmUrl:new URL('wasm/',assets).href,
    iccUrl:new URL('iccs/',assets).href
  });
}
async function image(bytes:Uint8Array,mime:string){const url=URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer],{type:mime}));try{const img=new Image();img.src=url;await img.decode();return img}finally{URL.revokeObjectURL(url)}}
async function canvasPage(doc:Awaited<ReturnType<typeof pdf>['promise']>,page:number,target:HTMLCanvasElement,scale:number){
  const source=await doc.getPage(page);
  const natural=source.getViewport({scale:1});
  const viewport=source.getViewport({scale:Math.min(scale,1800/Math.max(natural.width,natural.height))});
  target.width=viewport.width;target.height=viewport.height;
  await source.render({canvas:target,viewport}).promise;
}
export async function documentPageCount(id:string){
  const file=await window.bloom.call('preview',{id});
  if(file.mime!=='application/pdf')return 1;
  const task=pdf(file.bytes);
  try{return (await task.promise).numPages}finally{await task.destroy()}
}
const infoCache=new Map<string,Promise<DocumentInfo>>();
export function inspectDocument(id:string):Promise<DocumentInfo>{
  const existing=infoCache.get(id);if(existing)return existing;
  const pending=(async()=>{
    const file=await window.bloom.call('preview',{id});
    if(file.mime!=='application/pdf'){
      const img=await image(file.bytes,file.mime),canvas=document.createElement('canvas');
      const thumbnailScale=192/Math.max(img.width,img.height);canvas.width=Math.max(1,Math.round(img.width*thumbnailScale));canvas.height=Math.max(1,Math.round(img.height*thumbnailScale));
      canvas.getContext('2d')!.drawImage(img,0,0,canvas.width,canvas.height);
      return {id,mime:file.mime,pages:[{widthMm:img.width/96*25.4,heightMm:img.height/96*25.4,...analysePixels(canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data)}]};
    }
    const task=pdf(file.bytes);
    try{
      const doc=await task.promise;if(doc.numPages>1000)throw new Error('Inspect at most 1000 pages in one document. Split a larger document first.');
      const pages:DocumentInfo['pages']=[];
      for(let number=1;number<=doc.numPages;number++){
        const page=await doc.getPage(number),natural=page.getViewport({scale:1}),viewport=page.getViewport({scale:192/Math.max(natural.width,natural.height)}),canvas=document.createElement('canvas');
        canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
        await page.render({canvas,viewport}).promise;
        pages.push({widthMm:natural.width*25.4/72,heightMm:natural.height*25.4/72,...analysePixels(canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data)});
        canvas.width=0;canvas.height=0;page.cleanup();
      }
      return {id,mime:file.mime,pages};
    }finally{await task.destroy()}
  })();
  infoCache.set(id,pending);void pending.catch(()=>infoCache.delete(id));
  if(infoCache.size>40)infoCache.delete(infoCache.keys().next().value!);
  return pending;
}
type Source={doc?:Awaited<ReturnType<typeof pdf>['promise']>;img?:HTMLImageElement;close:()=>Promise<void>};
async function openSource(id:string):Promise<Source>{
  const file=await window.bloom.call('preview',{id});
  if(file.mime==='application/pdf'){const task=pdf(file.bytes);try{return {doc:await task.promise,close:()=>task.destroy()}}catch(e){await task.destroy();throw e}}
  return {img:await image(file.bytes,file.mime),close:async()=>{}};
}
/** The same compositor is used for preview, Save as PDF, native GDI and Electron printing. */
export async function renderPlannedSide(source:Source,info:DocumentInfo,plan:DocumentPlan,side:PlannedSide,target:HTMLCanvasElement,overlay=false){
  const s=plan.settings,ppm=s.renderDpi/25.4;
  if(!overlay){target.width=Math.round(side.width*ppm);target.height=Math.round(side.height*ppm)}
  const ctx=target.getContext('2d')!;if(!overlay){ctx.fillStyle='white';ctx.fillRect(0,0,target.width,target.height)}
  if(side.turn){ctx.translate(target.width,target.height);ctx.rotate(Math.PI)}
  ctx.imageSmoothingEnabled=s.smoothing;ctx.imageSmoothingQuality='high';
  for(const placement of side.placements){
    const pageInfo=info.pages[placement.page-1],edit=placement.edit,crop=edit?.crop;
    const local={...s,rotation:placement.rotation,...(s.documentFrame?{scaling:s.documentFrame.fit}:{})};
    const geometry=side.photo?photoPlacementGeometry(pageInfo,{...placement,fit:placement.fit??s.fit},s):placementGeometry(pageInfo.widthMm,pageInfo.heightMm,placement.box,local);
    const scratch=document.createElement('canvas');
    let draw=geometry.box;
    if(source.doc){
      const page=await source.doc.getPage(placement.page);
      if(placement.poster){
        const viewport=page.getViewport({scale:ppm*25.4/72*placement.poster.scale,rotation:page.rotate+placement.rotation});
        scratch.width=Math.ceil(placement.box.width*ppm);scratch.height=Math.ceil(placement.box.height*ppm);
        await page.render({canvas:scratch,viewport,transform:[1,0,0,1,-placement.poster.x*ppm,-placement.poster.y*ppm]}).promise;
        draw=placement.box;
      }else{
        const natural=page.getViewport({scale:1,rotation:page.rotate+geometry.rotation});
        const scale=Math.min(draw.width*ppm/natural.width,draw.height*ppm/natural.height);
        const viewport=page.getViewport({scale,rotation:page.rotate+geometry.rotation});
        if(viewport.width*viewport.height>20000000)throw new Error('Scaled source exceeds the safe raster limit. Reduce scale or DPI.');
        scratch.width=Math.max(1,Math.ceil(viewport.width));scratch.height=Math.max(1,Math.ceil(viewport.height));
        await page.render({canvas:scratch,viewport}).promise;
      }
    }else{
      const img=source.img!,quarter=geometry.rotation%180!==0;
      const cropWidth=Math.max(1,Math.round(img.width*(crop?.width??1))),cropHeight=Math.max(1,Math.round(img.height*(crop?.height??1)));
      const sampling=Math.min(1,Math.max(draw.width*ppm/(quarter?cropHeight:cropWidth),draw.height*ppm/(quarter?cropWidth:cropHeight))),destWidth=Math.max(1,Math.round(cropWidth*sampling)),destHeight=Math.max(1,Math.round(cropHeight*sampling));
      if(destWidth*destHeight>20000000)throw new Error('The scaled photo exceeds the safe raster limit. Reduce zoom or rendering DPI.');
      scratch.width=quarter?destHeight:destWidth;scratch.height=quarter?destWidth:destHeight;
      const buffer=scratch.getContext('2d')!;buffer.imageSmoothingEnabled=s.smoothing;buffer.translate(scratch.width/2,scratch.height/2);buffer.rotate(geometry.rotation*Math.PI/180);buffer.scale(edit?.flipX?-1:1,edit?.flipY?-1:1);buffer.drawImage(img,(crop?.x??0)*img.width,(crop?.y??0)*img.height,cropWidth,cropHeight,-destWidth/2,-destHeight/2,destWidth,destHeight);
    }
    const sharpening=edit?.sharpness??(source.doc?s.scanSharpen:0);
    const tones=edit??(source.doc&&s.scanDenoise?{denoise:s.scanDenoise}:undefined);
    const enhance=tones&&(tones.denoise||edit?.autoContrast||edit?.exposure||edit?.warmth||edit?.shadows||edit?.highlights);
    if(sharpening||enhance){
      const buffer=scratch.getContext('2d')!,pixels=buffer.getImageData(0,0,scratch.width,scratch.height);
      if(enhance)enhancePixels(pixels.data,pixels.width,pixels.height,tones);
      if(sharpening)sharpenPixels(pixels.data,pixels.width,pixels.height,sharpening);
      buffer.putImageData(pixels,0,0);
    }
    if((s.ink==='mono'||edit?.ink==='mono')&&!placement.colour){
      const pixels=scratch.getContext('2d')!.getImageData(0,0,scratch.width,scratch.height);
      for(let i=0;i<pixels.data.length;i+=4){const v=.2126*pixels.data[i]+.7152*pixels.data[i+1]+.0722*pixels.data[i+2]>=180?255:0;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=v}
      scratch.getContext('2d')!.putImageData(pixels,0,0);
    }
    ctx.save();ctx.beginPath();ctx.rect(placement.box.x*ppm,placement.box.y*ppm,placement.box.width*ppm,placement.box.height*ppm);ctx.clip();
    if(edit?.background){ctx.fillStyle=edit.background;ctx.fillRect(placement.box.x*ppm,placement.box.y*ppm,placement.box.width*ppm,placement.box.height*ppm)}
    if(source.doc&&s.scanDeskew){
      const x=(draw.x+draw.width/2)*ppm,y=(draw.y+draw.height/2)*ppm;
      ctx.translate(x,y);ctx.rotate(s.scanDeskew*Math.PI/180);ctx.translate(-x,-y);
    }
    ctx.filter=`brightness(${edit?.brightness??s.brightness}%) contrast(${edit?.contrast??s.contrast}%) saturate(${edit?.saturation??100}%)${edit?.ink==='sepia'?' sepia(1)':placement.colour?'':' grayscale(1)'}`;
    ctx.drawImage(scratch,draw.x*ppm,draw.y*ppm,draw.width*ppm,draw.height*ppm);ctx.restore();
    scratch.width=0;scratch.height=0;
    const box=placement.cutBox??placement.box;
    if(s.borders||side.marks){ctx.strokeStyle='#000';ctx.lineWidth=.15*ppm;ctx.setLineDash(side.marks?[1*ppm,1*ppm]:[]);ctx.strokeRect(box.x*ppm,box.y*ppm,box.width*ppm,box.height*ppm);ctx.setLineDash([])}
    if(s.trimMarks){
      const x=box.x*ppm,y=box.y*ppm,w=box.width*ppm,h=box.height*ppm,length=2*ppm;
      ctx.beginPath();ctx.strokeStyle='#000';ctx.lineWidth=.15*ppm;
      for(const [left,top,dx,dy] of [[x,y,-1,-1],[x+w,y,1,-1],[x,y+h,-1,1],[x+w,y+h,1,1]]){
        ctx.moveTo(left+dx*length,top);ctx.lineTo(left,top);ctx.lineTo(left,top+dy*length);
      }
      ctx.stroke();
    }
  }
  if(side.notes?.length){
    ctx.save();ctx.strokeStyle='#555';ctx.lineWidth=.18*ppm;ctx.beginPath();
    for(const box of side.notes)for(let line=1;line<=5;line++){
      const y=(box.y+box.height*line/6)*ppm,inset=Math.min(2,box.width*.15);
      ctx.moveTo((box.x+inset)*ppm,y);ctx.lineTo((box.x+box.width-inset)*ppm,y);
    }
    ctx.stroke();ctx.restore();
  }
  if(side.label){ctx.fillStyle='#000';ctx.font=`${Math.max(10,2.5*ppm)}px sans-serif`;ctx.fillText(side.label,3*ppm,target.height-2*ppm)}
  if(!overlay&&s.watermark&&side.placements.length){
    ctx.save();ctx.translate(target.width/2,target.height/2);ctx.rotate(-Math.PI/5);
    ctx.globalAlpha=.18;ctx.fillStyle='#000';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.font=`bold ${Math.min(target.width,target.height)/10}px sans-serif`;
    ctx.fillText(s.watermark,0,0,target.width*.8);ctx.restore();
  }
  if(!overlay&&s.sheetLabels&&side.placements.length){
    ctx.font=`${2.5*ppm}px sans-serif`;ctx.textAlign='right';ctx.fillStyle='#333';
    ctx.fillText(side.placements.map(p=>p.page).join(' / '),target.width-3*ppm,target.height-2*ppm,target.width*.5);
  }
}
export async function renderPhotoSheet(plan:DocumentPlan,side:PlannedSide,target:HTMLCanvasElement){
 target.width=Math.round(side.width*plan.settings.renderDpi/25.4);target.height=Math.round(side.height*plan.settings.renderDpi/25.4);
 const ctx=target.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,target.width,target.height);
 for(const id of new Set(side.placements.map(p=>p.file!))){const source=await openSource(id);try{await renderPlannedSide(source,await inspectDocument(id),plan,{...side,placements:side.placements.filter(p=>p.file===id)},target,true)}finally{await source.close()}}
}
type PhotoFrame={file:string;copy:number;sheet:number;x:number;y:number;width:number;height:number;rotation:number;resizing:boolean};
export function ImposedPreview({id,input,photoIds,lockPhotoAspect,onPhotoMove}:{id:string;input:Input<'print'>;photoIds?:string[];lockPhotoAspect?:boolean;onPhotoMove?:(move:PhotoFrame)=>void}){
  const ref=useRef<HTMLCanvasElement>(null),[side,setSide]=useState(0),[total,setTotal]=useState(0),[error,setError]=useState(''),[loading,setLoading]=useState(true),[zoom,setZoom]=useState(100);
  const visibleSide=useRef<{side:PlannedSide;index:number}|undefined>(undefined);
  const drag=useRef<{frame:PhotoFrame;clientX:number;clientY:number;corner?:{x:number;y:number}}|undefined>(undefined);
  const [selection,setSelection]=useState<PhotoFrame>();
  const [ghost,setGhost]=useState<PhotoFrame>();
  const settings=JSON.stringify(input),photoKey=JSON.stringify(photoIds??[]);
  const previewIdentity=photoIds?.length?JSON.stringify([...photoIds].sort()):id;
  useEffect(()=>{setSide(0);setSelection(undefined)},[previewIdentity]);
  useEffect(()=>{
    let active=true;let source:Source|undefined;
    setLoading(true);setError('');
    void (async()=>{
      const info=await inspectDocument(id),options=JSON.parse(settings),plan=photoIds?.length?planPhotos(options,await Promise.all(photoIds.map(inspectDocument))):planDocument({...options,copies:options.fileCopies?.[id]??options.copies},info),sides=plannedOutput(plan);
      if(!sides.length)throw new Error('No sides in this selection.');
      source=await openSource(id);if(!active)return;
      const index=Math.min(side,sides.length-1),canvas=document.createElement('canvas');if(photoIds?.length)await renderPhotoSheet(plan,sides[index],canvas);else await renderPlannedSide(source,info,plan,sides[index],canvas);
      if(active){const target=ref.current!;target.width=canvas.width;target.height=canvas.height;target.getContext('2d')!.drawImage(canvas,0,0);setTotal(sides.length);if(index!==side)setSide(index);visibleSide.current={side:sides[index],index}}
    })().catch(e=>{if(active)setError(e.message??String(e))}).finally(()=>{void source?.close();if(active)setLoading(false)});
    return()=>{active=false};
  },[id,settings,side,photoKey]);
  const sheet=visibleSide.current?.side;
  function dragFrame(clientX:number,clientY:number){
    const start=drag.current,canvas=ref.current;
    if(!start||!canvas||!sheet)return;
    const rect=canvas.getBoundingClientRect(),dx=(clientX-start.clientX)*sheet.width/rect.width,dy=(clientY-start.clientY)*sheet.height/rect.height;
    const frame=start.frame;
    if(!frame.resizing)return {...frame,x:Math.max(0,frame.x+dx),y:Math.max(0,frame.y+dy)};
    const corner=start.corner!;
    const horizontal=dx*corner.x,vertical=dy*corner.y;
    const scale=Math.max(1/Math.min(frame.width,frame.height),1+(horizontal*frame.width+vertical*frame.height)/(frame.width**2+frame.height**2));
    const width=lockPhotoAspect?frame.width*scale:Math.max(1,frame.width+horizontal);
    const height=lockPhotoAspect?frame.height*scale:Math.max(1,frame.height+vertical);
    return {...frame,x:corner.x<0?frame.x+frame.width-width:frame.x,y:corner.y<0?frame.y+frame.height-height:frame.y,width,height};
  }
  const selectedPlacement=sheet?.placements.find(p=>p.file===selection?.file&&p.copy===selection?.copy);
  const outline=ghost??selectedPlacement?.cutBox;
  const target=ref.current;
  const outlineStyle=outline&&sheet&&target?{
    left:target.offsetLeft+outline.x*target.offsetWidth/sheet.width,
    top:target.offsetTop+outline.y*target.offsetHeight/sheet.height,
    width:outline.width*target.offsetWidth/sheet.width,
    height:outline.height*target.offsetHeight/sheet.height
  }:undefined;
  return <div className="preview">{!loading&&!error&&sheet&&<small>{input.paper} / {Math.round(sheet.width*10)/10} x {Math.round(sheet.height*10)/10} mm / {sheet.width>sheet.height?'Landscape':'Portrait'}{sheet.ink==='blank'?' / Blank side':''}</small>}
  {onPhotoMove&&<small>Drag a photo to move it. Drag any corner to resize it.</small>}
  {loading&&<p role="status">Rendering final sheet...</p>}{error&&<p role="alert">{error}</p>}
  <div className="preview-stage photo-frame-stage"><canvas ref={ref} data-editable={!!onPhotoMove}
   onPointerDown={e=>{
    const visible=visibleSide.current;
    if(!onPhotoMove||!visible||e.button!==0)return;
    const rect=e.currentTarget.getBoundingClientRect(),x=(e.clientX-rect.left)*visible.side.width/rect.width,y=(e.clientY-rect.top)*visible.side.height/rect.height;
    const sizeX=11*visible.side.width/rect.width,sizeY=11*visible.side.height/rect.height;
    const chosen=selectedPlacement?.cutBox;
    const corner=chosen?[{x:-1,y:-1},{x:1,y:-1},{x:-1,y:1},{x:1,y:1}].find(c=>Math.abs(x-(chosen.x+(c.x>0?chosen.width:0)))<=sizeX&&Math.abs(y-(chosen.y+(c.y>0?chosen.height:0)))<=sizeY):undefined;
    const resizing=!!corner;
    const placement=resizing?selectedPlacement:visible.side.placements.find(p=>p.cutBox&&x>=p.cutBox.x&&x<=p.cutBox.x+p.cutBox.width&&y>=p.cutBox.y&&y<=p.cutBox.y+p.cutBox.height);
    if(!placement?.file||!placement.cutBox){setSelection(undefined);return}
    const frame={file:placement.file,copy:placement.copy??0,sheet:visible.index,...placement.cutBox,rotation:placement.rotation,resizing};
    e.currentTarget.setPointerCapture(e.pointerId);setSelection(frame);drag.current={frame,clientX:e.clientX,clientY:e.clientY,corner};
   }}
   onPointerMove={e=>{const next=dragFrame(e.clientX,e.clientY);if(next)setGhost(next)}}
   onPointerUp={e=>{const next=dragFrame(e.clientX,e.clientY),start=drag.current;drag.current=undefined;setGhost(undefined);if(next&&start&&(Math.abs(e.clientX-start.clientX)>1||Math.abs(e.clientY-start.clientY)>1))onPhotoMove?.(next)}}
   onPointerCancel={()=>{drag.current=undefined;setGhost(undefined)}}
   hidden={loading||!!error} style={zoom===100?undefined:{width:zoom+'%',maxWidth:'none',maxHeight:'none',height:'auto'}}/>
   {onPhotoMove&&outlineStyle&&!loading&&!error&&<div className="photo-frame-outline" style={outlineStyle} aria-hidden="true">{['nw','ne','sw','se'].map(corner=><i key={corner} data-corner={corner}/>)}</div>}
  </div><div className="preview-controls"><button disabled={side===0||loading} onClick={()=>{setSelection(undefined);setSide(side-1)}}>Previous</button><span>{!input.duplex||input.duplex==='simplex'||!total?<>Side {side+1} / {total}</>:<>Sheet {Math.floor(side/2)+1} / {Math.ceil(total/2)} ({side%2===0?'Front':'Back'})</>}</span><button disabled={side+1>=total||loading} onClick={()=>{setSelection(undefined);setSide(side+1)}}>Next</button><select aria-label="Final preview zoom" value={zoom} onChange={e=>{setSelection(undefined);setZoom(Number(e.target.value))}}>{[75,100,125,150,200].map(value=><option key={value} value={value}>{value===100?'Fit':value+'%'}</option>)}</select></div></div>;
}
export function DocumentThumbnail({id}:{id:string}){
  const ref=useRef<HTMLCanvasElement>(null),[visible,setVisible]=useState(false),[loaded,setLoaded]=useState(false);
  useEffect(()=>{
    const canvas=ref.current;if(!canvas)return;
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect()}});
    observer.observe(canvas);return ()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    if(!visible)return;
    let active=true;
    const canvas=ref.current!;
    void window.bloom.call('preview',{id}).then(async file=>{
      if(!active)return;
      if(file.mime==='application/pdf'){
        const task=pdf(file.bytes);
        try{const doc=await task.promise;if(active)await canvasPage(doc,1,canvas,.38)}finally{await task.destroy()}
      }else{
        const source=await image(file.bytes,file.mime);if(!active)return;
        const scale=Math.min(1,200/Math.max(source.width,source.height));
        canvas.width=Math.max(1,source.width*scale);canvas.height=Math.max(1,source.height*scale);
        canvas.getContext('2d')?.drawImage(source,0,0,canvas.width,canvas.height);
      }
      if(active)setLoaded(true);
    }).catch(()=>{});
    return ()=>{active=false};
  },[id,visible]);
  return <canvas ref={ref} className="file-thumbnail" aria-hidden="true" data-loaded={loaded}/>;
}
export function DocumentPreview({id,onCount}:{id:string;onCount?:(count:number)=>void}){
  const canvas=useRef<HTMLCanvasElement>(null);
  const [zoom,setZoom]=useState(100);
  const [page,setPage]=useState(1),[count,setCount]=useState(1),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  useEffect(()=>{let active=true;const target=canvas.current!;void (async()=>{
    setLoading(true);setError('');
    const file=await window.bloom.call('preview',{id});
    if(!active)return;
    if(file.mime==='application/pdf'){
      const task=pdf(file.bytes);try{const doc=await task.promise;if(!active)return;setCount(doc.numPages);onCount?.(doc.numPages);await canvasPage(doc,Math.min(page,doc.numPages),target,1.35)}finally{await task.destroy()}
    }else{
      const img=await image(file.bytes,file.mime);if(!active)return;
      const scale=Math.min(1,1100/Math.max(img.width,img.height));target.width=img.width*scale;target.height=img.height*scale;
      target.getContext('2d')!.drawImage(img,0,0,target.width,target.height);setCount(1);onCount?.(1);
    }
  })().catch(e=>{if(active)setError(String(e.message??e))}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[id,page,onCount]);
  return <div className="preview">{loading&&<div className="skeleton" role="status" aria-label="Rendering preview"/>}{error&&<p role="alert">{error}</p>}
   <div className="preview-stage"><canvas ref={canvas} hidden={!!error||loading} style={zoom===100?undefined:{width:zoom+'%',maxWidth:'none',maxHeight:'none',height:'auto'}}/></div>
   <div className="preview-controls">{count>1&&<><button disabled={page===1} onClick={()=>setPage(page-1)}>Previous</button><span>{page} / {count}</span><button disabled={page>=count} onClick={()=>setPage(page+1)}>Next</button></>}
   <select aria-label="Preview zoom" value={zoom} onChange={e=>setZoom(Number(e.target.value))}><option value={75}>75%</option><option value={100}>Fit</option><option value={125}>125%</option><option value={150}>150%</option><option value={200}>200%</option></select></div></div>;
}
export async function preparePrint(){
  try{
    const {input,files}=await window.printView.load();
    const options=normalizedSettings(input),root=document.getElementById('root')!;
    const all=[] as {file:{id:string};info:DocumentInfo;plan:DocumentPlan;sides:PlannedSide[]}[];
    const photoFiles=files.filter(file=>!!options.photoItems[file.id]);
    if(photoFiles.length){const infos=await Promise.all(photoFiles.map(f=>inspectDocument(f.id))),plan=planPhotos(options,infos);all.push({file:photoFiles[0],info:infos[0],plan,sides:plannedOutput(plan)})}
    for(const file of files.filter(f=>!options.photoBatch&&!options.photoItems[f.id])){
      const info=await inspectDocument(file.id),plan=planDocument({...options,copies:options.fileCopies[file.id]??options.copies},info);
      if(plan.needsConfirmation)throw new Error('Confirm uncertain colour analysis before printing.');
      all.push({file,info,plan,sides:plannedOutput(plan)});
    }
    if(!all.length)throw new Error('No printable files.');
    const dimensions=all.flatMap(item=>item.sides).map(side=>[side.width,side.height]);
    if(!dimensions.length)throw new Error('No sides to print.');
    const [width,height]=dimensions[0];if(dimensions.some(([w,h])=>w!==width||h!==height))throw new Error('Mixed paper orientation requires separate submissions.');
    if(dimensions.length>200)throw new Error('A submission can contain at most 200 imposed sides including copies.');
    if(dimensions.reduce((n,[w,h])=>n+w*h*(options.renderDpi/25.4)**2,0)>120000000)throw new Error('This submission exceeds the safe raster memory limit. Use fewer copies/pages or lower DPI.');
    const style=document.createElement('style');style.textContent=`@page{size:${width}mm ${height}mm;margin:0}html,body,#root{margin:0;background:white!important}.sheet{width:${width}mm;height:${height}mm;break-after:page;overflow:hidden}.sheet:last-child{break-after:auto}.sheet canvas{display:block;width:100%;height:100%}`;document.head.append(style);
    const faces:boolean[]=[];let hasColour=false;
    for(const item of all){
      const source=await openSource(item.file.id);
      try{for(const side of item.sides){const sheet=document.createElement('div');sheet.className='sheet';const canvas=document.createElement('canvas');if(side.placements.some(p=>p.file))await renderPhotoSheet(item.plan,side,canvas);else await renderPlannedSide(source,item.info,item.plan,side,canvas);sheet.append(canvas);root.append(sheet);faces.push(side.back);hasColour||=side.ink==='colour'}}finally{await source.close()}
    }
    Object.assign(window,{__printManifest:{widthMm:width,heightMm:height,faces,hasColour,sides:dimensions.length}});
    window.printView.done('');
  }catch(error){window.printView.done(error instanceof Error?error.message:'Could not prepare print layout.')}
}
