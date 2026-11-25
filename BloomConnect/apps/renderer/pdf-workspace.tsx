import {ArrowDown,ArrowLeft,ArrowUp,Crop,FilePenLine,Files,FileText,FolderOpen,Images,Layers,LockKeyhole,Merge,Minimize2,Printer,RotateCcw,RotateCw,Save,ScanLine,Scissors,Signature,Sparkles,Stamp,Upload} from 'lucide-react';
import {useEffect,useRef,useState} from 'react';
import {selectPages} from '../../packages/printing/layout';
import {splitStudioPages,type StudioImage,type StudioMark,type StudioOutput,type StudioPage} from '../../packages/printing/studio-pages';
import {paperDimensions} from '../../packages/printing/paper';
import {scanPresets,type ScanPreview} from '../../packages/shared/scan';
import {studioDocx} from '../../packages/printing/studio-docx';
import type {StudioRequest} from './pdf-workspace-worker';
import {Button,Panel,useData} from './context';
import {openPdf} from './pdf';
import {StudioSignature} from './studio-signature';
import {StudioWhatsAppPicker,chatLabel,useStudioWhatsAppChats} from './studio-whatsapp-picker';
import {useWorkspace} from './state';
import type {Attachment} from '../../packages/shared/contracts';

type Source={name:string;bytes:Uint8Array;task:ReturnType<typeof openPdf>;count:number;protected?:boolean};
const tools=[
 {id:'organize',name:'Organize Pages',icon:Layers,description:'Reorder, insert, duplicate, rotate, or remove pages.'},
 {id:'merge',name:'Merge PDF',icon:Merge,description:'Combine page ranges from multiple PDFs.'},
 {id:'split',name:'Split PDF',icon:Scissors,description:'Extract pages or save smaller PDFs in a ZIP archive.'},
 {id:'edit',name:'Edit PDF',icon:FilePenLine,description:'Place text, highlights, rectangles, and whiteout.'},
 {id:'watermark',name:'Add Watermark',icon:Stamp,description:'Add a translucent text watermark to selected pages.'},
 {id:'compress',name:'Compress PDF',icon:Minimize2,description:'Optimize PDF structure while retaining searchable text.'},
 {id:'image-to-pdf',name:'Image to PDF',icon:Images,description:'Arrange images on printable PDF pages.'},
 {id:'pdf-to-images',name:'PDF to Images',icon:Images,description:'Render PDF pages as PNG or JPG.'},
 {id:'cleanup',name:'Remove Background / Clean Document',icon:Sparkles,description:'Clean photographed paper and compare it with the original.'},
 {id:'background',name:'Photo Background Removal',icon:Images,description:'Remove a solid photo backdrop or replace it with a colour.'},
 {id:'ocr',name:'OCR Scanner',icon:ScanLine,description:'Recognize the current page or a scanned image with local Tesseract.'},
 {id:'crop',name:'Crop & Deskew',icon:Crop,description:'Set page margins and rotate pages. Use document cleanup to straighten scans.'},
 {id:'pdf-to-word',name:'PDF to Word',icon:FileText,description:'Extract selectable PDF text into an editable DOCX.'},
 {id:'word-to-pdf',name:'Word to PDF',icon:FileText,description:'Convert DOCX locally with LibreOffice.'},
 {id:'sign',name:'Sign PDF',icon:Signature,description:'Place a visible drawn, typed, or uploaded signature.'},
 {id:'protect',name:'Protect PDF',icon:LockKeyhole,description:'Open protected PDFs and manage passwords with qpdf.'},
 {id:'batch',name:'Batch PDF Tools',icon:Files,description:'Compress, rotate, or watermark multiple PDFs.'},
] as const;
type Tool=typeof tools[number]['id'];

function ImagePreview({bytes,label,transparent=false}:{bytes:Uint8Array;label:string;transparent?:boolean}){
 const [url,setUrl]=useState('');
 useEffect(()=>{
  const source=URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
  setUrl(source);return ()=>URL.revokeObjectURL(source);
 },[bytes]);
 return url&&<figure className={'studio-scan-image'+(transparent?' studio-photo-result':'')}><figcaption>{label}</figcaption><img src={url} alt={label}/></figure>;
}

function PagePreview({source,page,turn,zoom=1,thumbnail=false,onPosition}:{source:Source;page:number;turn:number;zoom?:number;thumbnail?:boolean;onPosition?:(x:number,y:number)=>void}){
 const ref=useRef<HTMLCanvasElement>(null);
 const rotationRef=useRef(0);
 const [visible,setVisible]=useState(!thumbnail),[failure,setFailure]=useState('');
 useEffect(()=>{
  if(!thumbnail||visible)return;
  const observer=new IntersectionObserver(([entry])=>{if(entry.isIntersecting)setVisible(true)});
  observer.observe(ref.current!);
  return ()=>observer.disconnect();
 },[thumbnail,visible]);
 useEffect(()=>{
  if(!visible)return;
  const canvas=ref.current!;
  let live=true,render:ReturnType<Awaited<ReturnType<Awaited<Source['task']['promise']>['getPage']>>['render']>|undefined;
  setFailure('');
  void (async()=>{
   const doc=await source.task.promise;
   const current=await doc.getPage(page+1);
   if(!live)return;
   const rotation=(current.rotate+turn+360)%360;
   rotationRef.current=rotation;
   const natural=current.getViewport({scale:1,rotation});
   const viewport=current.getViewport({scale:(thumbnail?105:850*zoom)/Math.max(natural.width,natural.height),rotation});
   canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
   render=current.render({canvas,viewport});
   await render.promise;
  })().catch(error=>{if(live)setFailure(error instanceof Error?error.message:String(error))});
  return ()=>{live=false;render?.cancel()};
 },[source,page,turn,zoom,visible,thumbnail]);
 return <><canvas ref={ref} aria-label={'PDF page '+(page+1)} hidden={!!failure} className={onPosition?'studio-place-mark':undefined}
  onClick={onPosition?event=>{
   const box=event.currentTarget.getBoundingClientRect(),x=(event.clientX-box.left)/box.width*100,y=(event.clientY-box.top)/box.height*100;
   const rotation=rotationRef.current;
   if(rotation===90)onPosition(y,100-x);
   else if(rotation===180)onPosition(100-x,100-y);
   else if(rotation===270)onPosition(100-y,x);
   else onPosition(x,y);
  }:undefined}/>{failure&&<small role="alert">{failure}</small>}</>;
}

export function PdfWorkspace(){
 const {refresh}=useData(),setWorkspace=useWorkspace(state=>state.set);
 const whatsAppChats=useStudioWhatsAppChats();
 const [tool,setTool]=useState<Tool>(),[sources,setSources]=useState<Source[]>([]);
 const [pages,setPages]=useState<StudioPage[]>([]),[past,setPast]=useState<StudioPage[][]>([]),[future,setFuture]=useState<StudioPage[][]>([]);
 const [current,setCurrent]=useState(0),[zoom,setZoom]=useState(1),[grid,setGrid]=useState(false);
 const [splitMode,setSplitMode]=useState('extract'),[range,setRange]=useState(''),[inputRange,setInputRange]=useState('');
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[failure,setFailure]=useState('');
 const [result,setResult]=useState<StudioOutput>();
 const [whatsAppOpen,setWhatsAppOpen]=useState(false);
 const [whatsAppChat,setWhatsAppChat]=useState('');
 const [scanChatType,setScanChatType]=useState<'pdf'|'photo'>('photo');
 const [saved,setSaved]=useState(false);
 const [outputPreview,setOutputPreview]=useState<Source>();
 const [images,setImages]=useState<StudioImage[]>([]);
 const [paper,setPaper]=useState<'A4'|'A3'|'Letter'>('A4'),[landscape,setLandscape]=useState(false),[margin,setMargin]=useState(8),[fill,setFill]=useState(false);
 const [format,setFormat]=useState<'png'|'jpg'>('png'),[dpi,setDpi]=useState(150),[quality,setQuality]=useState(.85);
 const [compression,setCompression]=useState<'low'|'balanced'|'high'|'custom'>('low');
 const [mark,setMark]=useState<StudioMark>({kind:'text',text:'',x:20,y:35,size:20,angle:0,opacity:1});
 const [advanced,setAdvanced]=useState(false);
 const [preset,setPreset]=useState(1),[skew,setSkew]=useState(0),[cleaned,setCleaned]=useState<ScanPreview>();
 const [scanIndex,setScanIndex]=useState(0),[language,setLanguage]=useState<'eng'|'sin'|'eng+sin'>('eng');
 const [ocrText,setOcrText]=useState(''),[ocrPdf,setOcrPdf]=useState<Uint8Array>();
 const [crop,setCrop]=useState({left:0,top:0,right:0,bottom:0});
 const [word,setWord]=useState<{name:string;bytes:Uint8Array}>();
 const [viewPassword,setViewPassword]=useState(''),[password,setPassword]=useState(''),[owner,setOwner]=useState('');
 const [securityMode,setSecurityMode]=useState<'protect'|'unlock'>('protect'),[printing,setPrinting]=useState<'full'|'low'|'none'>('full');
 const [batchOperation,setBatchOperation]=useState<'compress'|'rotate'|'watermark'>('compress');
 const [batchEntries,setBatchEntries]=useState<Record<number,{status:'Queued'|'Processing'|'Completed'|'Failed'|'Cancelled';error?:string}>>({});
 const [background,setBackground]=useState('#ffffff'),[replacement,setReplacement]=useState('#ffffff'),[replaceBackground,setReplaceBackground]=useState(false),[tolerance,setTolerance]=useState(35);
 const [backdropClarity,setBackdropClarity]=useState(0);
 const [removeBackdrop,setRemoveBackdrop]=useState(true),[removeFloorShadow,setRemoveFloorShadow]=useState(false);
 const wordTool=tool==='word-to-pdf';
 const imageTool=tool==='image-to-pdf';
 const scanTool=tool==='cleanup'||tool==='ocr';
 const photoBackground=tool==='background';
 const canPrepare=wordTool?!!word:imageTool||photoBackground?images.length:scanTool?images.length||pages.length:pages.length;
 const open=useRef<HTMLInputElement>(null),dragged=useRef<number>(undefined),locked=useRef(false);
 const tasks=useRef<Source['task'][]>([]),worker=useRef<Worker>(undefined),live=useRef(true);
 const cancellation=useRef<()=>void>(undefined),batchCancelled=useRef(false);
 useEffect(()=>{live.current=true;return ()=>{
  live.current=false;batchCancelled.current=true;cancellation.current?.();
  for(const task of tasks.current)void task.destroy();
 }},[]);
 useEffect(()=>{setSaved(false)},[result]);
 useEffect(()=>{
  setOutputPreview(undefined);
  if(result?.format!=='pdf'||tool==='protect'&&securityMode==='protect')return;
  let active=true;
  const task=openPdf(result.bytes.slice());
  void task.promise.then(doc=>{if(active)setOutputPreview({task,name:result.name,bytes:result.bytes,count:doc.numPages})}).catch(()=>{});
  return ()=>{active=false;void task.destroy()};
 },[result,tool,securityMode]);

 function commit(next:StudioPage[],index=current){
  setPast(history=>[...history.slice(-29),pages]);setFuture([]);setPages(next);
  setCurrent(Math.max(0,Math.min(index,next.length-1)));setResult(undefined);
 }
 function undo(){
  const previous=past.at(-1);if(!previous)return;
  setPast(past.slice(0,-1));setFuture([pages,...future]);setPages(previous);
  setCurrent(Math.min(current,Math.max(0,previous.length-1)));setResult(undefined);
 }
 function redo(){
  const next=future[0];if(!next)return;
  setPast([...past,pages]);setFuture(future.slice(1));setPages(next);
  setCurrent(Math.min(current,Math.max(0,next.length-1)));setResult(undefined);
 }
 async function addFiles(input:File[]|(()=>Promise<File[]>),chatWord=false){
  if(locked.current)return false;
  locked.current=true;setBusy(true);setFailure('');setNotice('');
  const added:Source[]=[];
  const firstTask=tasks.current.length;
  try{
   const files=typeof input==='function'?await input():input;
   if(!live.current||!files.length)return false;
   if(chatWord){
    const bytes=new Uint8Array(await files[0].arrayBuffer());
    if(!live.current)return false;
    setWord(undefined);setResult({name:files[0].name.replace(/\.pdf$/i,'').slice(0,180),format:'pdf',bytes});
    setNotice('WhatsApp document converted. Review the PDF before saving or printing.');
    return true;
   }
   if(wordTool){
    if(files.length!==1||!/\.docx$/i.test(files[0].name)||files[0].size>100*1024*1024)throw new Error('Choose one DOCX file under 100 MB.');
    const bytes=new Uint8Array(await files[0].arrayBuffer());
    if(live.current){setWord({name:files[0].name,bytes});setResult(undefined)}
    return true;
   }
   const size=[...sources,...images].reduce((total,source)=>total+source.bytes.length,0)+files.reduce((total,file)=>total+file.size,0);
   if(size>150*1024*1024)throw new Error('Open up to 150 MB of PDFs in one workspace.');
   if(imageTool||photoBackground||scanTool&&files.every(file=>!/\.pdf$/i.test(file.name))){
    const imported:StudioImage[]=[];
    for(const file of files){
     if(!/\.(png|jpe?g|webp)$/i.test(file.name))throw new Error('Choose PNG, JPG, or WebP images.');
     const image=await createImageBitmap(file);
     try{
      if(image.width*image.height>40_000_000)throw new Error('An image exceeds the 40 megapixel limit.');
      const canvas=new OffscreenCanvas(image.width,image.height);
      canvas.getContext('2d')!.drawImage(image,0,0);
      imported.push({name:file.name,bytes:new Uint8Array(await (await canvas.convertToBlob({type:/\.jpe?g$/i.test(file.name)?'image/jpeg':'image/png',quality:.95})).arrayBuffer())});
     }finally{image.close()}
    }
    if(live.current){setScanIndex(images.length);setImages([...images,...imported]);setCleaned(undefined);setResult(undefined);setNotice(imported.length+' images added.')}
    return true;
   }
   for(const file of files){
    if(!/\.pdf$/i.test(file.name))throw new Error('Choose PDF files.');
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(!live.current)return false;
    const task=openPdf(bytes.slice(),viewPassword||undefined);
    tasks.current.push(task);
    const doc=await task.promise;
    added.push({name:file.name,bytes,task,count:doc.numPages,protected:!!await doc.getPermissions()});
   }
   if(!live.current)return false;
   const selection=added.flatMap((source,index)=>Array.from({length:source.count},(_,page)=>({source:sources.length+index,page,turn:0})));
   setSources([...sources,...added]);
   if(scanTool)setScanIndex(-1);
   commit([...pages,...selection],pages.length);
   if(!tool)setTool(files.length>1?'merge':'organize');
   setNotice(added.length===1?added[0].name+' opened.':added.length+' PDFs opened.');
   return true;
  }catch(error){
   for(const task of tasks.current.splice(firstTask))void task.destroy();
   if(live.current)setFailure(error instanceof Error&&error.name==='PasswordException'?'Enter the correct password in Protect PDF, then open the file again.':error instanceof Error?error.message:String(error));
   return false;
  }finally{locked.current=false;if(live.current)setBusy(false)}
 }
 const wordFile=(file:Attachment)=>file.status==='Needs conversion'&&/\.docx?$/i.test(file.name);
 const photoExtensions:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
 const photoFile=(file:Attachment)=>file.status==='Ready'&&!!photoExtensions[file.mime];
 const chatFileType=wordTool?'word':imageTool||photoBackground?'photo':scanTool?scanChatType:'pdf';
 const acceptsChatFile=(file:Attachment)=>chatFileType==='word'?wordFile(file):
  chatFileType==='photo'?photoFile(file):file.status==='Ready'&&file.mime==='application/pdf';
 function openChatFiles(selection:Attachment[]){
  return addFiles(async()=>{
   const files:File[]=[];
   let bytesAdded=0;
   for(const item of selection){
    const convert=wordFile(item);
    const id=convert?await window.bloom.call('convertDocument',{id:item.id,mode:'pages',includeHidden:false}):item.id;
    if(!live.current)return [];
    const payload=await window.bloom.call('fileReference',{id});
    bytesAdded+=payload.bytes;
    if(bytesAdded>150*1024*1024)throw new Error('Select up to 150 MB of WhatsApp documents at a time.');
    const extension=payload.mime==='application/pdf'?'pdf':photoExtensions[payload.mime];
    const name=extension?item.name.replace(/\.(pdf|docx?|png|jpe?g|webp)$/i,'')+'.'+extension:item.name;
    const response=await fetch(payload.url);
    if(!response.ok)throw new Error('Could not open the saved WhatsApp attachment.');
    files.push(new File([await response.blob()],name,{type:payload.mime}));
   }
   return files;
  },wordTool);
 }
 function move(from:number,to:number){
  if(from===to||to<0||to>=pages.length)return;
  const next=[...pages], [page]=next.splice(from,1);
  next.splice(to,0,page);commit(next,to);
 }
 async function rasterize(frame:StudioPage,resolution:number,mime:'image/jpeg'|'image/png'='image/png',jpegQuality=quality){
  const page=await (await sources[frame.source].task.promise).getPage(frame.page+1);
  const viewport=page.getViewport({scale:resolution/72,rotation:(page.rotate+frame.turn)%360});
  if(viewport.width*viewport.height>24_000_000)throw new Error('Use a lower DPI for this page size.');
  const canvas=document.createElement('canvas');
  canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  await page.render({canvas,viewport}).promise;
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Image encoding failed.')),mime,jpegQuality));
  canvas.width=0;canvas.height=0;
  return new Uint8Array(await blob.arrayBuffer());
 }
 async function processWorker(request:StudioRequest){
  const task=new Worker(new URL('./pdf-workspace-worker.ts',import.meta.url),{type:'module'});
  worker.current=task;
  try{
   return await new Promise<StudioOutput>((resolve,reject)=>{
    cancellation.current=()=>reject(new Error('Processing cancelled.'));
    task.onmessage=({data})=>data.error?reject(new Error(data.error)):resolve(data.result);
    task.onerror=()=>reject(new Error('The PDF processing worker could not finish.'));
    task.postMessage(request);
   });
  }finally{task.terminate();worker.current=undefined;cancellation.current=undefined}
 }
 async function processBatch(){
  if(batchOperation==='watermark'&&!mark.text.trim())throw new Error('Enter watermark text for this batch.');
  batchCancelled.current=false;
  setBatchEntries(Object.fromEntries(sources.map((_,index)=>[index,{status:'Queued'}])));
  const completed:StudioImage[]=[];
  for(const [index,source] of sources.entries()){
   if(batchCancelled.current){
    if(live.current)setBatchEntries(entries=>({...entries,[index]:{status:'Cancelled'}}));
    continue;
   }
   setBatchEntries(entries=>({...entries,[index]:{status:'Processing'}}));
   try{
    if(source.protected)throw new Error('Unlock an authorized copy before batch processing.');
    const name=source.name.replace(/\.pdf$/i,'');
    const frames=Array.from({length:source.count},(_,page):StudioPage=>({
     source:0,page,turn:batchOperation==='rotate'?90:0,
     marks:batchOperation==='watermark'?[{...mark,kind:'text',angle:30,opacity:.3}]:undefined
    }));
    const result=await processWorker(batchOperation==='compress'?{operation:'compress',args:[source.bytes,name]}:{operation:'pages',args:[[source.bytes],[frames],name]});
    completed.push({name:result.name+'.pdf',bytes:result.bytes});
    if(live.current)setBatchEntries(entries=>({...entries,[index]:{status:'Completed'}}));
   }catch(error){
    if(live.current)setBatchEntries(entries=>({...entries,[index]:batchCancelled.current?{status:'Cancelled'}:{status:'Failed',error:error instanceof Error?error.message:String(error)}}));
   }
  }
  if(!live.current)return;
  if(completed.length)setResult(await processWorker({operation:'batch',args:[completed]}));
  setNotice((batchCancelled.current?'Batch cancelled. ':'Batch finished. ')+completed.length+' of '+sources.length+' files ready to save.');
 }
 async function prepare(){
  if(locked.current||!canPrepare)return;
  locked.current=true;setBusy(true);setResult(undefined);setFailure('');setNotice('Preparing output...');
  try{
   const name=((sources[0]?.name.replace(/\.pdf$/i,'')||'document')+'-'+(tool??'edited')).slice(0,180);
   if(photoBackground){
    const rgb=(hex:string)=>[1,3,5].map(index=>Number.parseInt(hex.slice(index,index+2),16)) as [number,number,number];
    const output=await processWorker({operation:'backdrop',args:[images[scanIndex]?.bytes??images[0].bytes,{
     background:rgb(background),tolerance,clarity:backdropClarity,remove:removeBackdrop,floorShadow:removeFloorShadow,replacement:replaceBackground?rgb(replacement):undefined
    }]});
    if(live.current){setResult(output);setNotice('Compare the edges around the subject before saving.')}
    return;
   }
   if(tool==='batch'){await processBatch();return}
   if(wordTool&&word){
    const bytes=await window.bloom.call('convertStudioWord',{bytes:new Uint8Array(word.bytes)});
    if(live.current){setResult({name:word.name.replace(/\.docx$/i,'').slice(0,180),format:'pdf',bytes});setNotice('Word conversion ready. Check that fonts and layout match the source.')}
    return;
   }
   if(tool==='protect'){
    const source=sources[pages[current].source];
    const bytes=await window.bloom.call('secureStudioPdf',{bytes:new Uint8Array(source.bytes),mode:securityMode,password,owner,printing});
    if(live.current){setResult({name,format:'pdf',bytes});setNotice('Security change ready to save.')}
    return;
   }
   if(!imageTool&&pages.some(page=>sources[page.source].protected))throw new Error('A page is password protected. Unlock an authorized copy in Protect PDF before exporting it.');
   if(tool==='pdf-to-word'){
    const extracted:string[][]=[];
    for(const number of selectPages(range,pages.length)){
     const page=pages[number-1],source=await (await sources[page.source].task.promise).getPage(page.page+1);
     const content=await source.getTextContent();
     let line='',lastY:number|undefined;
     const lines:string[]=[];
     for(const item of content.items){
      if(!('str' in item))continue;
      const y=item.transform[5];
      if(line&&lastY!==undefined&&Math.abs(lastY-y)>3){lines.push(line.trim());line=''}
      line+=item.str+(item.hasEOL?'':' ');
      if(item.hasEOL){lines.push(line.trim());line=''}
      lastY=y;
     }
     if(line.trim())lines.push(line.trim());
     extracted.push(lines);
    }
    if(!extracted.some(lines=>lines.some(Boolean)))throw new Error('These pages have no selectable text. Use OCR Scanner first.');
    setResult({name,format:'docx',bytes:studioDocx(extracted)});
    setNotice('Editable text prepared. Check reading order. Images and table layout are excluded.');
    return;
   }
   if(scanTool){
    const bytes=images[scanIndex]?new Uint8Array(images[scanIndex].bytes):await rasterize(pages[current],200);
    if(tool==='cleanup'){
     const scan=await window.bloom.call('cleanStudioScan',{bytes,settings:{...scanPresets[preset].settings,skew}});
     if(live.current){setCleaned(scan);setResult({name,format:'png',bytes:scan.image});setNotice('Compare the cleaned scan with the original before saving.')}
    }else{
     const recognized=await window.bloom.call('recognizeStudioScan',{bytes,language});
     if(live.current){setOcrText(recognized.text);setOcrPdf(recognized.pdf);setResult({name,format:'pdf',bytes:recognized.pdf});setNotice(recognized.text.trim()?'OCR complete. Review the recognized text for errors.':'OCR could not recognize text in this image.')}
    }
    return;
   }
   let request:StudioRequest;
   let originalCompression:Uint8Array|undefined;
   if(tool==='compress'){
    const sourceIndex=pages[current].source,source=sources[sourceIndex];
    originalCompression=source.bytes;
    if(compression==='low'){
     request={operation:'compress',args:[source.bytes,name]};
    }else{
     const doc=await source.task.promise,rendered:StudioImage[]=[];
     const resolution=compression==='balanced'?150:compression==='high'?110:dpi;
     const jpegQuality=compression==='balanced'?.78:compression==='high'?.60:quality;
     let imageBytes=0;
     for(let page=0;page<source.count;page++){
      const originalPage=await doc.getPage(page+1),viewport=originalPage.getViewport({scale:1});
      const bytes=await rasterize({source:sourceIndex,page,turn:0},resolution,'image/jpeg',jpegQuality);
      imageBytes+=bytes.length;
      if(imageBytes>140*1024*1024)throw new Error('The rasterized output exceeds the memory limit. Use lower DPI or structural optimization.');
      rendered.push({name:'page-'+(page+1)+'.jpg',bytes,pageSize:[viewport.width,viewport.height]});
      if(!live.current)return;
     }
     request={operation:'image-to-pdf',args:[rendered,{width:1,height:1,margin:0,fill:false},name]};
    }
   }else if(tool==='image-to-pdf'){
    const [w,h]=paperDimensions(paper).map(mm=>mm*72/25.4);
    request={operation:'image-to-pdf',args:[images,{width:landscape?h:w,height:landscape?w:h,margin:margin*72/25.4,fill},name]};
   }else if(tool==='pdf-to-images'){
    const exported:StudioImage[]=[];
    for(const number of selectPages(range,pages.length)){
     const bytes=await rasterize(pages[number-1],dpi,format==='jpg'?'image/jpeg':'image/png');
     exported.push({name:'page-'+number+'.'+format,bytes});
     if(exported.reduce((sum,image)=>sum+image.bytes.length,0)>140*1024*1024)throw new Error('Export fewer pages or use a lower DPI.');
     if(!live.current)return;
    }
    request={operation:'pdf-to-images',args:[exported,format,name]};
   }else{
    const chosen=tool==='watermark'?new Set(selectPages(range,pages.length)):undefined;
    if(chosen&&!mark.image&&!mark.text.trim())throw new Error('Enter watermark text or add an image.');
    const marked=chosen?pages.map((frame,index)=>chosen.has(index+1)?{...frame,marks:[...frame.marks??[],{...mark,kind:mark.image?'image' as const:'text' as const}]}:frame):pages;
    const groups=tool==='split'?splitStudioPages(marked.length,splitMode,range).map(group=>group.map(i=>marked[i])):[marked];
    request={operation:'pages',args:[sources.map(source=>source.bytes),groups,name]};
   }
   let output=await processWorker(request);
   if(originalCompression&&output.bytes.length>=originalCompression.length)output={...output,bytes:originalCompression};
   if(live.current){
    setResult(output);
    if(originalCompression){
     const original=originalCompression.length;
     const reduction=((original-output.bytes.length)*100/original).toFixed(1);
     setNotice(original.toLocaleString()+' bytes to '+output.bytes.length.toLocaleString()+' bytes ('+reduction+'% reduction).'+(original===output.bytes.length?' The original size was retained.':''));
    }else setNotice('Output ready to save.');
   }
  }catch(error){if(live.current){setFailure(error instanceof Error?error.message:String(error));setNotice('')}}
  finally{worker.current?.terminate();worker.current=undefined;locked.current=false;if(live.current)setBusy(false)}
 }
 async function save(){
  if(!result||locked.current)return;
  locked.current=true;setBusy(true);setFailure('');
  try{if(await window.bloom.call('saveStudioDocument',{...result,bytes:new Uint8Array(result.bytes)})){setSaved(true);setNotice('PDF Studio output saved.')}}
  catch(error){setFailure(error instanceof Error?error.message:String(error))}
  finally{locked.current=false;if(live.current)setBusy(false)}
 }
 async function print(){
  if(result?.format!=='pdf'||locked.current||tool==='protect'&&securityMode==='protect')return;
  locked.current=true;setBusy(true);setFailure('');
  try{
   const attachment=await window.bloom.call('importStudioPrint',{name:result.name,bytes:new Uint8Array(result.bytes)});
   await refresh();
   if(live.current)setWorkspace({pdfPrintAttachment:attachment,pdfBatchDraft:[]});
  }catch(error){if(live.current)setFailure(error instanceof Error?error.message:String(error))}
  finally{locked.current=false;if(live.current)setBusy(false)}
 }
 useEffect(()=>{
  const keydown=(event:KeyboardEvent)=>{
   if(!(event.ctrlKey||event.metaKey)||event.shiftKey||event.altKey||event.repeat)return;
   if(event.key.toLowerCase()==='o'){event.preventDefault();if(!locked.current)open.current?.click()}
   if(event.key.toLowerCase()==='s'&&result){event.preventDefault();void save()}
  };
  window.addEventListener('keydown',keydown);
  return ()=>window.removeEventListener('keydown',keydown);
 },[result]);
 function showTool(next:Tool|undefined){
  setTool(next);setResult(undefined);setRange('');setCleaned(undefined);setOcrPdf(undefined);setOcrText('');
  setViewPassword('');setPassword('');setOwner('');setFailure('');setNotice('');
  setMark(previous=>({...previous,kind:'text',image:undefined,opacity:next==='watermark'?.3:1,angle:next==='watermark'?30:0}));
 }
 async function loadMarkImage(file:File){
  try{
   if(file.size>10*1024*1024)throw new Error('Choose an overlay image under 10 MB.');
   const bitmap=await createImageBitmap(file);
   try{
    const scale=Math.min(1,1000/Math.max(bitmap.width,bitmap.height));
    const canvas=new OffscreenCanvas(Math.max(1,Math.round(bitmap.width*scale)),Math.max(1,Math.round(bitmap.height*scale)));
    canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const bytes=new Uint8Array(await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer());
    if(live.current){setMark(previous=>({...previous,image:bytes}));setResult(undefined);setFailure('')}
   }finally{bitmap.close()}
  }catch(error){if(live.current)setFailure(error instanceof Error?error.message:String(error))}
 }
 const frame=pages[current];
 const activeTool=tools.find(option=>option.id===tool);
 return <section className="pdf-workspace stack" onDragOver={e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault()}}
  onDrop={e=>{if(e.dataTransfer.files.length){e.preventDefault();void addFiles([...e.dataTransfer.files])}}}>
  <input type="file" accept={wordTool?'.docx':imageTool||photoBackground?'.png,.jpg,.jpeg,.webp':scanTool?'.png,.jpg,.jpeg,.webp,.pdf':'.pdf,application/pdf'} multiple={!wordTool} hidden ref={open} onChange={e=>{void addFiles(Array.from(e.target.files??[]));e.target.value=''}}/>
  {whatsAppOpen&&<StudioWhatsAppPicker accept={acceptsChatFile} onOpen={openChatFiles} onClose={()=>setWhatsAppOpen(false)} busy={busy} failure={failure}
   chat={whatsAppChat} setChat={setWhatsAppChat} single={wordTool} fileType={chatFileType} setScanType={scanTool?setScanChatType:undefined}/>}
  {activeTool?<Panel className="studio-pdf-toolbar">
   <div className="actions">
    <Button className="quiet" disabled={busy} onClick={()=>showTool(undefined)}><ArrowLeft size={16}/> Tools</Button>
    <h2>{activeTool.name}</h2>
   </div>
   <div className="actions">
    <Button className="secondary" disabled={busy} onClick={()=>open.current?.click()}><FolderOpen size={16}/> {wordTool?'Open DOCX':imageTool||photoBackground?'Add images':scanTool?'Add scan':'Add PDFs'}</Button>
    <select className="studio-whatsapp-quick" aria-label="WhatsApp number" value="" disabled={busy||!whatsAppChats.length} onChange={e=>{
     if(e.target.value){setWhatsAppChat(e.target.value);setFailure('');setWhatsAppOpen(true)}
    }}>
     <option value="">Select WhatsApp number</option>{whatsAppChats.map(chat=><option value={chat.id} key={chat.id}>{chatLabel(chat)}</option>)}
    </select>
    <Button className="secondary" disabled={busy} onClick={()=>{setFailure('');setWhatsAppOpen(true)}}>Open from WhatsApp</Button>
    <Button className="quiet" aria-pressed={advanced} disabled={busy} onClick={()=>setAdvanced(!advanced)}>{advanced?'Simple mode':'Advanced mode'}</Button>
    <Button className="secondary" disabled={busy||!past.length} onClick={undo}>Undo</Button>
    <Button className="secondary" disabled={busy||!future.length} onClick={redo}>Redo</Button>
    <Button className="secondary" disabled={busy||!canPrepare} onClick={()=>void prepare()}>{busy?'Working...':'Prepare output'}</Button>
    <Button disabled={busy||!result} onClick={()=>void save()}><Save size={16}/> Save As</Button>
    {result?.format==='pdf'&&!(tool==='protect'&&securityMode==='protect')&&<Button className="secondary" disabled={busy} onClick={()=>void print()}><Printer size={16}/> Print</Button>}
    {saved&&<Button className="quiet" onClick={()=>void window.bloom.call('revealStudioOutput',null).catch(error=>setFailure(String(error)))}>Open output folder</Button>}
   </div>
  </Panel>:<>
   <div className="actions"><Button disabled={busy} onClick={()=>{setFailure('');setWhatsAppOpen(true)}}>Open from WhatsApp</Button></div>
   <div className="studio-pdf-cards">{tools.map(option=><button type="button" key={option.id} className="panel studio-pdf-card" disabled={busy} onClick={()=>showTool(option.id)}>
    <option.icon size={22}/><strong>{option.name}</strong><span>{option.description}</span>
   </button>)}</div>
   {pages.length>0&&<Button className="secondary" onClick={()=>showTool('organize')}><FilePenLine size={16}/> Return to {pages.length}-page workspace</Button>}
  </>}
  {(!tool||!canPrepare)&&<Panel className="studio-pdf-drop">
   <Upload size={26}/><strong>{wordTool?'Drop a DOCX here':imageTool||photoBackground?'Drop images here':scanTool?'Drop a scanned PDF or image here':'Drop PDFs here'}</strong><Button className="secondary" disabled={busy} onClick={()=>open.current?.click()}>Browse files</Button>
  </Panel>}
  {wordTool&&<Panel className="stack">{word&&<strong>{word.name}</strong>}<small>Requires LibreOffice and the fonts used in the Word document.</small></Panel>}
  {photoBackground&&images.length>0&&<Panel className="stack">
   <fieldset className="form-grid studio-pdf-options" disabled={busy}>
    <label>Photo<select value={Math.max(0,scanIndex)} onChange={e=>{setScanIndex(Number(e.target.value));setResult(undefined)}}>{images.map((image,index)=><option value={index} key={index}>{image.name}</option>)}</select></label>
    <label className="check"><input type="checkbox" checked={removeBackdrop} onChange={e=>{setRemoveBackdrop(e.target.checked);if(!e.target.checked&&!backdropClarity)setBackdropClarity(55);setResult(undefined)}}/> Remove background</label>
    {removeBackdrop&&<><label>Backdrop colour<input type="color" value={background} onChange={e=>{setBackground(e.target.value);setResult(undefined)}}/></label>
    <label>Colour tolerance<input type="range" min="0" max="120" value={tolerance} onChange={e=>{setTolerance(Number(e.target.value));setResult(undefined)}}/></label>
    <label className="check"><input type="checkbox" checked={removeFloorShadow} onChange={e=>{setRemoveFloorShadow(e.target.checked);setResult(undefined)}}/> Remove floor shadow on white backgrounds</label>
    <label className="check"><input type="checkbox" checked={replaceBackground} onChange={e=>{setReplaceBackground(e.target.checked);setResult(undefined)}}/> Replace with a colour</label>
    {replaceBackground&&<label>Replacement<input type="color" value={replacement} onChange={e=>{setReplacement(e.target.value);setResult(undefined)}}/></label>}</>}
    <label>Photo clarity ({backdropClarity}%)<input type="range" min="0" max="100" value={backdropClarity} onChange={e=>{setBackdropClarity(Number(e.target.value));setResult(undefined)}}/></label>
   </fieldset>
   <div className="studio-scan-comparison"><ImagePreview bytes={(images[scanIndex]??images[0]).bytes} label="Original photo"/>{result?.format==='png'&&<ImagePreview bytes={result.bytes} label={removeBackdrop&&!replaceBackground?'Transparent PNG':'Edited photo'} transparent={removeBackdrop&&!replaceBackground}/>}</div>
   <small>Works best with an even backdrop that touches the image edges.</small>
  </Panel>}
  {tool==='batch'&&sources.length>0&&<Panel className="stack">
   <label>Batch operation<select value={batchOperation} disabled={busy} onChange={e=>{setBatchOperation(e.target.value as typeof batchOperation);setBatchEntries({});setResult(undefined)}}><option value="compress">Optimize file size</option><option value="rotate">Rotate 90° clockwise</option><option value="watermark">Add text watermark</option></select></label>
   {batchOperation==='watermark'&&<label>Watermark text<input value={mark.text} maxLength={500} disabled={busy} onChange={e=>{setMark({...mark,text:e.target.value});setResult(undefined)}}/></label>}
   <progress value={Object.values(batchEntries).filter(entry=>['Completed','Failed','Cancelled'].includes(entry.status)).length} max={sources.length}/>
   <ul className="stack">{sources.map((source,index)=><li key={index}>{source.name} <strong>{batchEntries[index]?.status??'Queued'}</strong>{batchEntries[index]?.error&&<small>{batchEntries[index].error}</small>}</li>)}</ul>
   {busy&&<Button className="secondary" onClick={()=>{batchCancelled.current=true;cancellation.current?.()}}>Cancel batch</Button>}
   {!busy&&Object.values(batchEntries).some(entry=>entry.status==='Failed'||entry.status==='Cancelled')&&<Button className="secondary" onClick={()=>void prepare()}>Retry batch</Button>}
  </Panel>}
  {tool==='protect'&&<Panel className="stack">
   <label>Password to open a protected source<input type="password" value={viewPassword} maxLength={120} autoComplete="off" onChange={e=>setViewPassword(e.target.value)}/></label>
   <fieldset className="form-grid studio-pdf-options" disabled={busy}>
    <label>Action<select value={securityMode} onChange={e=>{setSecurityMode(e.target.value as typeof securityMode);setResult(undefined)}}><option value="protect">Add password</option><option value="unlock">Remove password with owner authorization</option></select></label>
    {securityMode==='protect'&&<label>New open password<input type="password" value={password} maxLength={120} autoComplete="off" onChange={e=>{setPassword(e.target.value);setResult(undefined)}}/></label>}
    <label>Owner password<input type="password" value={owner} maxLength={120} autoComplete="off" onChange={e=>{setOwner(e.target.value);setResult(undefined)}}/></label>
    {securityMode==='protect'&&<label>Allowed printing<select value={printing} onChange={e=>{setPrinting(e.target.value as typeof printing);setResult(undefined)}}><option value="full">Full resolution</option><option value="low">Low resolution</option><option value="none">Disabled</option></select></label>}
   </fieldset>
  </Panel>}
  {scanTool&&!!canPrepare&&<Panel className="stack">
   <h3>{tool==='cleanup'?'Document cleanup':'OCR settings'}</h3>
   <fieldset className="form-grid studio-pdf-options" disabled={busy}>
    {images.length>0&&<label>Source image<select value={scanIndex} onChange={e=>{setScanIndex(Number(e.target.value));setResult(undefined);setCleaned(undefined);setOcrPdf(undefined)}}>{images.map((image,index)=><option key={index} value={index}>{image.name}</option>)}{pages.length>0&&<option value={-1}>Current PDF page</option>}</select></label>}
    {tool==='cleanup'?<>
     <label>Cleanup preset<select value={preset} onChange={e=>{setPreset(Number(e.target.value));setResult(undefined);setCleaned(undefined)}}>
      {scanPresets.slice(0,5).map((option,index)=><option key={option.name} value={index}>{option.name}</option>)}
     </select></label>
     {advanced&&<label>Straighten by degrees<input type="number" min="-15" max="15" step=".25" value={skew} onChange={e=>{setSkew(Math.min(15,Math.max(-15,Number(e.target.value))));setResult(undefined);setCleaned(undefined)}}/></label>}
    </>:<label>Language<select value={language} onChange={e=>{setLanguage(e.target.value as typeof language);setOcrPdf(undefined);setResult(undefined)}}><option value="eng">English</option><option value="sin">Sinhala</option><option value="eng+sin">English + Sinhala</option></select></label>}
   </fieldset>
   {tool==='cleanup'&&cleaned&&<><div className="studio-scan-comparison"><ImagePreview bytes={cleaned.original} label="Original"/><ImagePreview bytes={cleaned.image} label="Cleaned document"/></div>{cleaned.warnings.map(warning=><small key={warning}>{warning}</small>)}</>}
   {!cleaned&&images[scanIndex]&&<ImagePreview bytes={images[scanIndex].bytes} label="Source image"/>}
   {tool==='ocr'&&ocrPdf&&<>
    <label>Recognized text<textarea value={ocrText} onChange={e=>setOcrText(e.target.value)}/></label>
    <div className="actions">
     <Button className="secondary" onClick={()=>void navigator.clipboard.writeText(ocrText).catch(error=>setFailure(String(error)))}>Copy text</Button>
     <Button className="secondary" onClick={()=>setResult({name:'recognized-text',format:'txt',bytes:new TextEncoder().encode(ocrText)})}>Prepare TXT</Button>
     <Button className="secondary" onClick={()=>setResult({name:'recognized-text',format:'docx',bytes:studioDocx([ocrText.split(/\r?\n/)])})}>Prepare DOCX</Button>
     <Button className="secondary" onClick={()=>setResult({name:'searchable-scan',format:'pdf',bytes:ocrPdf})}>Prepare searchable PDF</Button>
    </div>
   </>}
  </Panel>}
  {tool==='image-to-pdf'&&images.length>0&&<Panel className="stack">
   <h3>Image order</h3>
   {images.map((image,index)=><div className="actions" key={index}><span>{image.name}</span>
    <Button className="quiet" disabled={busy||index===0} onClick={()=>{
     const next=[...images];[next[index-1],next[index]]=[next[index],next[index-1]];setImages(next);setResult(undefined);
    }}>Move earlier</Button>
    <Button className="quiet" disabled={busy} onClick={()=>{setImages(images.filter((_,i)=>i!==index));setResult(undefined)}}>Remove</Button>
   </div>)}
   <fieldset className="form-grid studio-pdf-options" disabled={busy}>
    <label>Paper<select value={paper} onChange={e=>{setPaper(e.target.value as typeof paper);setResult(undefined)}}>{['A4','A3','Letter'].map(name=><option key={name}>{name}</option>)}</select></label>
    <label>Orientation<select value={landscape?'landscape':'portrait'} onChange={e=>{setLandscape(e.target.value==='landscape');setResult(undefined)}}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
    <label>Image fit<select value={fill?'fill':'fit'} onChange={e=>{setFill(e.target.value==='fill');setResult(undefined)}}><option value="fit">Fit whole image</option><option value="fill">Fill and crop</option></select></label>
    {advanced&&<label>Margin (mm)<input type="number" min="0" max="90" value={margin} onChange={e=>{setMargin(Math.max(0,Number(e.target.value)));setResult(undefined)}}/></label>}
   </fieldset>
  </Panel>}
  {tool&&!imageTool&&!wordTool&&!photoBackground&&frame&&<div className="studio-pdf-layout">
   <Panel className="stack">
    <div className="panel-head"><h3>Pages</h3><Button className="quiet" aria-pressed={grid} onClick={()=>setGrid(!grid)}>{grid?'List':'Grid'}</Button></div>
    <div className={grid?'studio-pdf-pages is-grid':'studio-pdf-pages'}>{pages.map((page,index)=><button type="button"
     className="studio-pdf-page" aria-current={index===current?'page':undefined} key={index}
     draggable={!busy} onDragStart={e=>{dragged.current=index;e.dataTransfer.setData('text/plain',String(index))}}
     onDragEnd={()=>{dragged.current=undefined}} onDragOver={e=>{if(dragged.current!==undefined)e.preventDefault()}}
     onDrop={e=>{if(dragged.current!==undefined){e.preventDefault();move(dragged.current,index);dragged.current=undefined}}}
     onClick={()=>setCurrent(index)}>
     <PagePreview source={sources[page.source]} page={page.page} turn={page.turn} thumbnail/>
     <small>{index+1}</small>
    </button>)}</div>
   </Panel>
   <Panel className="studio-pdf-preview stack">
    <div className="actions">
     <Button className="secondary" disabled={current===0} onClick={()=>setCurrent(current-1)}>Previous</Button>
     <span>Page {current+1} of {pages.length}</span>
     <Button className="secondary" disabled={current===pages.length-1} onClick={()=>setCurrent(current+1)}>Next</Button>
     <select aria-label="Zoom" value={zoom} onChange={e=>setZoom(Number(e.target.value))}>{[.5,.75,1,1.25,1.5,2].map(n=><option key={n} value={n}>{n*100}%</option>)}</select>
    </div>
    <div className="studio-pdf-canvas"><PagePreview source={sources[frame.source]} page={frame.page} turn={frame.turn} zoom={zoom}
     onPosition={!busy&&(tool==='edit'||tool==='sign'||tool==='watermark')?(x,y)=>{setMark(previous=>({...previous,x:Math.round(x),y:Math.round(y)}));if(tool==='watermark')setResult(undefined)}:undefined}/></div>
   </Panel>
   <Panel className="stack">
    <h3>Page options</h3>
    <small>{sources[frame.source].name} · Page {frame.page+1}</small>
    <fieldset className="stack studio-pdf-options" disabled={busy}>
     <div className="actions">
      <Button className="secondary" disabled={current===0} onClick={()=>move(current,current-1)}><ArrowUp size={15}/> Earlier</Button>
      <Button className="secondary" disabled={current===pages.length-1} onClick={()=>move(current,current+1)}><ArrowDown size={15}/> Later</Button>
      {[-90,90].map(turn=><Button key={turn} className="secondary" aria-label={turn<0?'Rotate left':'Rotate right'} onClick={()=>commit(pages.map((page,index)=>index===current?{...page,turn:(page.turn+turn+360)%360}:page))}>{turn<0?<RotateCcw size={15}/>:<RotateCw size={15}/>}</Button>)}
     </div>
     <div className="actions">
      <Button className="secondary" onClick={()=>commit([...pages.slice(0,current+1),frame,...pages.slice(current+1)],current+1)}>Duplicate</Button>
      <Button className="secondary" disabled={pages.length===1} onClick={()=>commit(pages.filter((_,index)=>current!==index))}>Remove</Button>
     </div>
     {tool==='merge'&&<><label>Pages from current source<input value={inputRange} onChange={e=>setInputRange(e.target.value)} placeholder="All pages, or 1-3, 5"/></label>
      <Button className="secondary" onClick={()=>{
       try{
        const chosen=selectPages(inputRange,sources[frame.source].count).map(page=>({source:frame.source,page:page-1,turn:0}));
        const index=pages.findIndex(page=>page.source===frame.source);
        const retained=pages.filter(page=>page.source!==frame.source);
        setFailure('');commit([...retained.slice(0,index),...chosen,...retained.slice(index)],index);
       }catch(error){setFailure(error instanceof Error?error.message:String(error))}
      }}>Apply source range</Button></>}
     {tool==='split'&&<><label>Split method<select value={splitMode} onChange={e=>{setSplitMode(e.target.value);setRange('');setResult(undefined)}}>
      <option value="extract">Extract pages</option><option value="every">Every page</option><option value="ranges">Separate page ranges</option>
      <option value="after">Split after pages</option><option value="groups">Groups of N pages</option>
     </select></label>{splitMode!=='every'&&<label>{splitMode==='groups'?'Pages per group':'Pages or ranges'}<input value={range} onChange={e=>{setRange(e.target.value);setResult(undefined)}} placeholder={splitMode==='ranges'?'1-3; 4-6':splitMode==='groups'?'5':'1-3, 5'}/></label>}</>}
     {tool==='compress'&&<>
      <label>Compression<select value={compression} onChange={e=>{setCompression(e.target.value as typeof compression);setResult(undefined)}}><option value="low">Low (structural optimization)</option><option value="balanced">Balanced (150 DPI)</option><option value="high">High (110 DPI)</option><option value="custom">Custom raster settings</option></select></label>
      {compression==='custom'&&<>
       <label>Resolution<select value={dpi} onChange={e=>{setDpi(Number(e.target.value));setResult(undefined)}}>{[72,110,150,200,300].map(value=><option key={value}>{value}</option>)}</select></label>
       <label>JPEG quality<input type="range" min=".3" max="1" step=".05" value={quality} onChange={e=>{setQuality(Number(e.target.value));setResult(undefined)}}/></label>
      </>}
      <small>{compression==='low'?'Structural optimization keeps text searchable and preserves embedded images.':'Raster compression turns pages into images. Searchable text, interactive forms and links are lost. Review readability before saving.'}</small>
     </>}
     {tool==='pdf-to-word'&&<><label>Pages<input value={range} onChange={e=>{setRange(e.target.value);setResult(undefined)}} placeholder="All pages"/></label><Button className="quiet" onClick={()=>showTool('ocr')}>Open OCR Scanner</Button></>}
     {tool==='sign'&&<>
      {(['x','y','size'] as const).map(key=><label key={key}>{key==='x'?'From left (%)':key==='y'?'From top (%)':'Signature width (pt)'}<input type="range" min={key==='size'?20:0} max={key==='size'?400:100} value={mark[key]} onChange={e=>setMark({...mark,[key]:Number(e.target.value)})}/></label>)}
      <StudioSignature add={image=>commit(pages.map((page,index)=>index===current?{...page,marks:[...page.marks??[],{...mark,kind:'image',image}]}:page))}/>
      <small>Visible signature only. Prepare output to preview its position.</small>
     </>}
     {tool==='crop'&&<>
      {(['left','top','right','bottom'] as const).map(side=><label key={side}>{side} crop (%)<input type="number" min="0" max="95" value={crop[side]} onChange={e=>setCrop({...crop,[side]:Math.min(95,Math.max(0,Number(e.target.value)))})}/></label>)}
      <Button className="secondary" disabled={crop.left+crop.right>=100||crop.top+crop.bottom>=100} onClick={()=>commit(pages.map((page,index)=>index===current?{...page,crop}:page))}>Apply to this page</Button>
      {advanced&&<Button className="secondary" disabled={crop.left+crop.right>=100||crop.top+crop.bottom>=100} onClick={()=>commit(pages.map(page=>({...page,crop})))}>Apply to all</Button>}
     </>}
     {tool==='pdf-to-images'&&<>
      <label>Pages<input value={range} onChange={e=>{setRange(e.target.value);setResult(undefined)}} placeholder="All pages, or 1-3"/></label>
      <label>Image format<select value={format} onChange={e=>{setFormat(e.target.value as typeof format);setResult(undefined)}}><option value="png">PNG</option><option value="jpg">JPG</option></select></label>
      <label>Resolution<select value={dpi} onChange={e=>{setDpi(Number(e.target.value));setResult(undefined)}}>{[72,150,300].map(value=><option key={value}>{value}</option>)}</select></label>
      {advanced&&format==='jpg'&&<label>JPG quality<input type="range" min=".3" max="1" step=".05" value={quality} onChange={e=>{setQuality(Number(e.target.value));setResult(undefined)}}/></label>}
     </>}
     {(tool==='edit'||tool==='watermark')&&<>
      {tool==='edit'&&<label>Overlay<select value={mark.kind} onChange={e=>setMark({...mark,kind:e.target.value as StudioMark['kind']})}>
       <option value="text">Text</option><option value="image">Image</option><option value="rectangle">Rectangle</option><option value="highlight">Highlight</option><option value="whiteout">Whiteout</option>
      </select></label>}
      {(tool==='watermark'||mark.kind==='text')&&<label>Text<input value={mark.text} maxLength={500} disabled={tool==='watermark'&&!!mark.image} onChange={e=>{setMark({...mark,text:e.target.value});setResult(undefined)}}/></label>}
      {(tool==='watermark'||mark.kind==='image')&&<label>{tool==='watermark'?'Image watermark':'Overlay image'}<input type="file" accept="image/png,image/jpeg" onChange={e=>{const file=e.target.files?.[0];if(file)void loadMarkImage(file)}}/></label>}
      {tool==='watermark'&&mark.image&&<Button className="quiet" onClick={()=>{setMark({...mark,image:undefined});setResult(undefined)}}>Use text watermark</Button>}
      {tool==='watermark'&&<label>Pages<input value={range} onChange={e=>{setRange(e.target.value);setResult(undefined)}} placeholder="All pages"/></label>}
      <label>Size (pt)<input type="number" min="5" max="400" value={mark.size} onChange={e=>{setMark({...mark,size:Math.max(5,Math.min(400,Number(e.target.value)))});setResult(undefined)}}/></label>
      {(['x','y'] as const).map(key=><label key={key}>{key==='x'?'From left (%)':'From top (%)'}<input type="range" min="0" max="100" value={mark[key]} onChange={e=>{setMark({...mark,[key]:Number(e.target.value)});setResult(undefined)}}/></label>)}
      {tool==='watermark'&&advanced&&<>
       <label>Rotation<input type="range" min="-180" max="180" value={mark.angle} onChange={e=>{setMark({...mark,angle:Number(e.target.value)});setResult(undefined)}}/></label>
       <label>Opacity<input type="range" min=".05" max="1" step=".05" value={mark.opacity} onChange={e=>{setMark({...mark,opacity:Number(e.target.value)});setResult(undefined)}}/></label>
      </>}
      {tool==='edit'&&<Button className="secondary" disabled={mark.kind==='text'&&!mark.text.trim()||mark.kind==='image'&&!mark.image} onClick={()=>commit(pages.map((page,index)=>index===current?{...page,marks:[...page.marks??[],{...mark,opacity:mark.kind==='highlight'?.35:1}]}:page))}>Add overlay to page</Button>}
      {tool==='edit'&&<small>Prepare output to preview overlays. Original PDF text remains. Whiteout is a visual cover and must never be used to redact sensitive content.</small>}
     </>}
    </fieldset>
    <small>Page exports preserve visible page content. Bookmarks, interactive forms and digital signatures may be lost.</small>
   </Panel>
  </div>}
  {outputPreview&&<Panel className="stack"><h3>Output preview</h3><div className="studio-pdf-canvas"><PagePreview source={outputPreview} page={Math.min(current,outputPreview.count-1)} turn={0}/></div></Panel>}
  {notice&&<p role="status">{notice}</p>}{failure&&<p role="alert">{failure}</p>}
 </section>;
}
