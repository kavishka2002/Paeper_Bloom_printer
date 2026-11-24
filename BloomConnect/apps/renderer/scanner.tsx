import {useEffect,useRef,useState,type PointerEvent,type ReactNode} from 'react';
import {ScanLine,RotateCw,Maximize,Printer,Save} from 'lucide-react';
import {fullScanCorners,scanPresets,type ScanPoint,type ScanPreview,type ScanSettings} from '../../packages/shared/scan';
import {documentPricing} from '../../packages/printing/calculation';
import {DetailDrawer} from './design';
import {Button,useData} from './context';
import {useWorkspace} from './state';

type Review={settings:ScanSettings;warnings:string[];saved?:string;error?:string};
const defaults=scanPresets[0].settings;
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
const adjustments=[['brightness','Brightness',-40,40],['contrast','Contrast',-40,60],['white','White background',0,100],
 ['shadow','Shadow removal',0,100],['sharpness','Sharpness',0,60],['denoise','Noise reduction',0,50],
 ['threshold','B/W threshold sensitivity',0,100],['skew','Fine straightening (degrees)',-15,15]] as const;
const errorText=(e:unknown)=>String(e instanceof Error?e.message:e).replace(/^Error invoking remote method 'bloom:call':\s*(?:Error:\s*)?/,'');

function usePng(bytes?:Uint8Array){
 const [url,setUrl]=useState('');
 useEffect(()=>{
  if(!bytes){setUrl('');return}
  const next=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
  setUrl(next);return()=>URL.revokeObjectURL(next);
 },[bytes]);
 return url;
}
function ScanViewport({pan,children}:{pan:boolean;children:ReactNode}){
 const drag=useRef<{x:number;y:number;left:number;top:number}|undefined>(undefined);
 return <div className="scan-scroll" data-pan={pan}
  onPointerDown={event=>{
   if(!pan||event.button!==0)return;
   const view=event.currentTarget;
   drag.current={x:event.clientX,y:event.clientY,left:view.scrollLeft,top:view.scrollTop};
   view.setPointerCapture(event.pointerId);
  }}
  onPointerMove={event=>{
   const start=drag.current;if(!start)return;
   event.currentTarget.scrollLeft=start.left+start.x-event.clientX;
   event.currentTarget.scrollTop=start.top+start.y-event.clientY;
  }}
  onPointerUp={()=>{drag.current=undefined}}
  onPointerCancel={()=>{drag.current=undefined}}>{children}</div>;
}

export function ScannerDialog({ids,onClose}:{ids:string[];onClose:()=>void}){
 const {data,refresh}=useData();
 const setWorkspace=useWorkspace(s=>s.set);
 const [pages,setPages]=useState(ids),[active,setActive]=useState(ids[0]);
 const [settings,setSettings]=useState<Record<string,ScanSettings>>({});
 const [reviews,setReviews]=useState<Record<string,Review>>({});
 const [preview,setPreview]=useState<{id:string;result:ScanPreview}>();
 const [phase,setPhase]=useState(''),[message,setMessage]=useState(''),[previewBusy,setPreviewBusy]=useState(false);
 const [originalOnly,setOriginalOnly]=useState(false),[crop,setCrop]=useState<'corners'|'rectangle'>();
 const [drawing,setDrawing]=useState<ScanPoint[]>(),[compare,setCompare]=useState(100),[zoom,setZoom]=useState(100);
 const [expanded,setExpanded]=useState(false),[layout,setLayout]=useState<'a4'|'original'>('a4'),[margin,setMargin]=useState(8);
 const [revision,setRevision]=useState(0);
 const activeRef=useRef(active),tokenRef=useRef<string|undefined>(undefined),sequence=useRef(0),bulk=useRef(false);
 const fullscreenTarget=useRef<HTMLDivElement>(null);
 const gesture=useRef<{index?:number;start:ScanPoint;original:ScanPoint[]}|undefined>(undefined);
 activeRef.current=active;
 const draft=settings[active]??defaults;
 const result=preview?.id===active?preview.result:undefined;
 const originalUrl=usePng(result?.original),cleanedUrl=usePng(result?.image);
 const corners=drawing??draft.corners??result?.corners??fullScanCorners;
 const allReviewed=pages.every(id=>reviews[id]&&!reviews[id].error&&reviews[id].settings===(settings[id]??defaults));
 const fileName=(id:string)=>data.attachments.find(file=>file.id===id)?.name??'Photo';

 async function stopWorker(){
  const old=tokenRef.current;tokenRef.current=undefined;
  if(old)await window.bloom.call('cancelScan',{token:old}).catch(()=>{});
 }
 async function processPhoto(id:string,values:ScanSettings,expected:number){
  if(expected!==sequence.current)throw new Error('Scan cancelled.');
  await stopWorker();
  if(expected!==sequence.current)throw new Error('Scan cancelled.');
  const token=crypto.randomUUID();tokenRef.current=token;
  try{return await window.bloom.call('scanPreview',{id,token,settings:values})}
  finally{if(tokenRef.current===token)tokenRef.current=undefined}
 }
 useEffect(()=>{
  if(bulk.current||originalOnly)return;
  const current=++sequence.current;
  const timer=setTimeout(()=>{
   if(current!==sequence.current)return;
   setPreviewBusy(true);setMessage('');
   void processPhoto(active,draft,current).then(scan=>{
    if(current!==sequence.current)return;
    setPreview({id:active,result:scan});
    setReviews(old=>({...old,[active]:{settings:draft,warnings:scan.warnings,saved:old[active]?.settings===draft?old[active].saved:undefined}}));
   }).catch(e=>{if(current===sequence.current)setMessage(errorText(e))})
    .finally(()=>{if(current===sequence.current)setPreviewBusy(false)});
  },240);
  return()=>clearTimeout(timer);
 },[active,draft,originalOnly,revision]);
 useEffect(()=>()=>{sequence.current++;void stopWorker()},[]);
 useEffect(()=>{
  const update=()=>setExpanded(document.fullscreenElement===fullscreenTarget.current);
  document.addEventListener('fullscreenchange',update);
  return()=>document.removeEventListener('fullscreenchange',update);
 },[]);
 async function toggleFullscreen(){
  if(document.fullscreenElement){await document.exitFullscreen().catch(()=>{});return}
  try{await fullscreenTarget.current?.requestFullscreen()}
  catch{setExpanded(value=>!value)}
 }

 function change(values:Partial<ScanSettings>){
  setOriginalOnly(false);setSettings(old=>({...old,[active]:{...draft,...values}}));
  setReviews(old=>{const next={...old};delete next[active];return next});
 }
 function applyPreset(index:number,all=false){
  setOriginalOnly(false);setDrawing(undefined);setCrop(undefined);
  const values=scanPresets[index].settings,targets=all?pages:[active];
  setSettings(old=>({...old,...Object.fromEntries(targets.map(id=>[id,values]))}));
  setReviews(old=>Object.fromEntries(Object.entries(old).filter(([id])=>!targets.includes(id))));
  setRevision(prev=>prev+1);
 }
 function cancel(){
  sequence.current++;bulk.current=false;void stopWorker();setPhase('');setPreviewBusy(false);setMessage('Processing cancelled. Completed pages are available for review.');
 }
 async function scanAll(){
  if(bulk.current)return;
  bulk.current=true;const current=++sequence.current;setOriginalOnly(false);setPreviewBusy(false);setMessage('');
  let failures=0;
  try{
   for(const [index,id] of pages.entries()){
    if(current!==sequence.current)break;
    setPhase('Processing '+(index+1)+' of '+pages.length+' documents');
    const values=settings[id]??defaults;
    try{
     const scan=await processPhoto(id,values,current);
     if(current!==sequence.current)break;
     if(activeRef.current===id)setPreview({id,result:scan});
     setReviews(old=>({...old,[id]:{settings:values,warnings:scan.warnings,saved:old[id]?.settings===values?old[id].saved:undefined}}));
    }catch(e){
     if(current!==sequence.current)break;
     failures++;setReviews(old=>({...old,[id]:{settings:values,warnings:[],error:errorText(e)}}));
    }
   }
  }finally{
   if(current===sequence.current){bulk.current=false;setPhase('');if(failures)setMessage(failures+' pages could not be processed. Select a page to see its error.')}
  }
 }
 async function savePage(id:string,current:number){
  const review=reviews[id],values=settings[id]??defaults;
  if(!review||review.error||review.settings!==values)throw new Error('Review the current cleanup preview before saving.');
  if(review.saved)return review.saved;
  if(current!==sequence.current)throw new Error('Scan cancelled.');
  const token=crypto.randomUUID();tokenRef.current=token;
  try{
   const saved=await window.bloom.call('saveScan',{id,token,settings:values});
   setReviews(old=>old[id]?.settings===values?{...old,[id]:{...old[id],saved}}:old);
   return saved;
  }finally{if(tokenRef.current===token)tokenRef.current=undefined}
 }
 async function finish(action:'image'|'export'|'print'){
  if(bulk.current)return;
  bulk.current=true;const current=++sequence.current;setPhase('Preparing scanned output');setPreviewBusy(false);setMessage('');
  try{
   await stopWorker();
   if(current!==sequence.current)return;
   if(action==='image'){
    setPhase('Saving processed copy');await savePage(active,current);await refresh();
    if(current===sequence.current)setMessage('Processed PNG saved in Documents.');
    return;
   }
   const ordered=[];
   for(const [index,id] of pages.entries()){
    if(current!==sequence.current)return;
    setPhase('Saving '+(index+1)+' of '+pages.length+' pages');
    ordered.push({id:await savePage(id,current),rotation:0 as const});
   }
   if(current!==sequence.current)return;
   setPhase('Preparing scanned PDF');
   const token=crypto.randomUUID();tokenRef.current=token;
   const pdf=await window.bloom.call('combineScans',{token,pages:ordered,layout,marginMm:margin});
   if(tokenRef.current===token)tokenRef.current=undefined;
   if(current!==sequence.current)return;
   await refresh();
   if(action==='export'){
    setPhase('Choose where to save the PDF');
    const saved=await window.bloom.call('exportScannedPdf',{id:pdf});
    setMessage(saved?'Scanned PDF exported.':'Scanned PDF is available in Documents.');
   }else{
    setPhase('Opening Print Studio');
    const customer=data.attachments.find(file=>file.id===pages[0])?.customer_id??null;
    const colour=pages.some(id=>(settings[id]??defaults).mode==='color');
    const rates=await window.bloom.call('pricingRules',null);
    const pricing=rates.find(rule=>rule.paper==='A4'&&rule.method==='ordinary'&&!rule.duplex&&(!rule.media||rule.media==='Default'))?.policy??documentPricing(data.settings!,'simplex','sheet','A4');
    const job=await window.bloom.call('order',{customer,files:[pdf],copies:1,paper:'A4',colour,price:0,discount:0,charge:0,
     calculations:[{id:pdf,settings:{documentPages:pages.length,copies:1,paper:'A4',mode:colour?'colour':'mono',pricing}}]});
    await refresh();setWorkspace({view:'Print Studio',job,photoStudio:false});onClose();
   }
  }catch(e){if(current===sequence.current)setMessage(errorText(e))}
  finally{if(current===sequence.current){bulk.current=false;setPhase('');tokenRef.current=undefined}}
 }
 function point(event:PointerEvent<HTMLElement>){
  const rect=event.currentTarget.getBoundingClientRect();
  return {x:clamp((event.clientX-rect.left)/rect.width),y:clamp((event.clientY-rect.top)/rect.height)};
 }
 function draw(p:ScanPoint){
  const g=gesture.current;if(!g)return;
  if(g.index!==undefined)return g.original.map((value,index)=>index===g.index?p:value);
  const x=Math.min(g.start.x,p.x),y=Math.min(g.start.y,p.y),right=Math.max(g.start.x,p.x),bottom=Math.max(g.start.y,p.y);
  return [{x,y},{x:right,y},{x:right,y:bottom},{x,y:bottom}];
 }
 function movePage(index:number,delta:number){
  const target=index+delta;if(target<0||target>=pages.length)return;
  setPages(old=>{const next=[...old];[next[index],next[target]]=[next[target],next[index]];return next});
 }
 return <DetailDrawer title="Document Scanner" presentation="wide" onClose={()=>{sequence.current++;void stopWorker();onClose()}}>
 <div className={'scan-workspace'+(expanded?' scan-expanded':'')} ref={fullscreenTarget}>
  <aside className="stack scan-settings">
   <Button disabled={!!phase} onClick={()=>{setOriginalOnly(false);setRevision(value=>value+1)}}><ScanLine size={16}/> Auto Scan &amp; Clean</Button>
   <label>Scan preset<select value="" disabled={!!phase} onChange={e=>{if(e.target.value!=='')applyPreset(Number(e.target.value))}}><option value="">Choose a preset</option>{scanPresets.map((preset,i)=><option key={preset.name} value={i}>{preset.name}</option>)}</select></label>
   <div className="actions">{(['bw','gray','color'] as const).map(mode=><Button className="secondary" key={mode} disabled={!!phase} aria-pressed={draft.mode===mode} onClick={()=>change({mode})}>{mode==='bw'?'B/W':mode==='gray'?'Grayscale':'Color'}</Button>)}</div>
   <div className="actions"><Button className="secondary" disabled={!originalUrl||!!phase} aria-pressed={crop==='corners'} onClick={()=>setCrop(value=>value==='corners'?undefined:'corners')}>Four corners</Button>
   <Button className="secondary" disabled={!originalUrl||!!phase} aria-pressed={crop==='rectangle'} onClick={()=>setCrop(value=>value==='rectangle'?undefined:'rectangle')}>Manual crop</Button>
   <Button className="secondary" disabled={!!phase} onClick={()=>change({rotation:((draft.rotation+90)%360) as ScanSettings['rotation']})}><RotateCw size={14}/> Rotate</Button></div>
   {crop&&<small>{crop==='corners'?'Drag each corner on the original.':'Drag a rectangle on the original.'}</small>}
   <details><summary>Adjust scan</summary><div className="stack">
    <label className="check"><input type="checkbox" checked={draft.autoStraighten} disabled={!!phase} onChange={e=>change({autoStraighten:e.target.checked})}/> Automatically straighten text</label>
    {adjustments.map(([key,label,min,max])=><label key={key}>{label} <output>{draft[key]}</output><input type="range" min={min} max={max} step={key==='skew'?.5:1} value={draft[key]} disabled={!!phase||(key==='threshold'?draft.mode!=='bw':draft.mode==='bw'&&['white','contrast','sharpness','denoise'].includes(key))} onChange={e=>change({[key]:Number(e.target.value)})}/></label>)}
   </div></details>
   <div className="actions"><Button className="quiet" disabled={!!phase} onClick={()=>applyPreset(0)}>Reset to Auto</Button><Button className="quiet" disabled={!!phase||!originalUrl} onClick={()=>{sequence.current++;void stopWorker();setPreviewBusy(false);setCrop(undefined);setOriginalOnly(true)}}>Reset to Original</Button></div>
   {pages.length>1&&<><Button className="secondary" disabled={!!phase} onClick={()=>scanAll()}>Auto Scan Selected</Button>
    <Button className="quiet" disabled={!!phase} onClick={()=>{setSettings(Object.fromEntries(pages.map(id=>[id,{...draft,corners:undefined}])));setReviews({});setOriginalOnly(false)}}>Apply adjustments to all pages</Button></>}
   <div className="scan-pages">{pages.map((id,index)=><div className="scan-page-row" key={id}>
    <button type="button" className="text-button" aria-current={active===id?'true':undefined} disabled={!!phase} onClick={()=>{setActive(id);setCrop(undefined);setOriginalOnly(false);setDrawing(undefined)}}>
     {index+1}. {fileName(id)}<small>{reviews[id]?.error?'Needs retry':reviews[id]?.saved?'Saved':reviews[id]?'Ready to review':'Waiting'}</small>
    </button>{pages.length>1&&<div className="actions"><Button className="quiet" disabled={!!phase||index===0} aria-label={'Move page '+(index+1)+' earlier'} onClick={()=>movePage(index,-1)}>↑</Button><Button className="quiet" disabled={!!phase||index===pages.length-1} aria-label={'Move page '+(index+1)+' later'} onClick={()=>movePage(index,1)}>↓</Button></div>}
   </div>)}</div>
   {phase?<div className="actions"><span role="status">{phase}</span><Button className="secondary" onClick={cancel}>Cancel</Button></div>:previewBusy?<p role="status">Updating preview…</p>:null}
   <label>PDF page size<select value={layout} disabled={!!phase} onChange={e=>setLayout(e.target.value as typeof layout)}><option value="a4">Fit to A4</option><option value="original">Original proportions</option></select></label>
   <label>PDF margin (mm)<input type="number" min="0" max="30" value={margin} disabled={!!phase} onChange={e=>setMargin(Math.max(0,Math.min(30,Number(e.target.value))))}/></label>
   <div className="actions"><Button className="secondary" disabled={!!phase||previewBusy||originalOnly||!reviews[active]||!!reviews[active]?.error} onClick={()=>void finish('image')}><Save size={14}/> Save processed PNG</Button>
    <Button className="secondary" disabled={!!phase||previewBusy||originalOnly||!allReviewed} onClick={()=>void finish('export')}>Export {pages.length>1?'Combined ':''}PDF</Button>
    <Button disabled={!!phase||previewBusy||originalOnly||!allReviewed} onClick={()=>void finish('print')}><Printer size={14}/> {pages.length>1?'Print All':'Open in Print Studio'}</Button>
   </div>
   {message&&<p role="status">{message}</p>}
  </aside>
  <section className="stack scan-viewer">
   <div className="actions scan-viewer-controls"><label>Zoom<select value={zoom} onChange={e=>setZoom(Number(e.target.value))}>{[100,125,150,200,300].map(value=><option key={value} value={value}>{value===100?'Fit to page':value+'%'}</option>)}</select></label>
   <Button className="secondary" onClick={()=>void toggleFullscreen()}><Maximize size={15}/> {expanded?'Fit window':'Full-screen preview'}</Button>
   <label>Before / After<input type="range" aria-label="Before and after comparison" min="0" max="100" value={compare} disabled={!result||originalOnly} onChange={e=>setCompare(Number(e.target.value))}/></label></div>
   <div className="scan-images">
    <div><h3>Original photo</h3><ScanViewport pan={zoom>100&&!crop}>{originalUrl?<div className={'scan-photo'+(crop&&!phase?' scan-crop':'')} style={{width:zoom+'%'}}
     onPointerDown={e=>{
      if(!crop||phase||e.button!==0)return;
      const p=point(e),index=crop==='corners'?corners.findIndex(c=>Math.hypot(c.x-p.x,c.y-p.y)<.075):undefined;
      if(index===-1)return;
      gesture.current={index,start:p,original:corners};e.currentTarget.setPointerCapture(e.pointerId);
     }}
     onPointerMove={e=>{const next=draw(point(e));if(next)setDrawing(next)}}
     onPointerUp={e=>{const next=draw(point(e));gesture.current=undefined;setDrawing(undefined);if(next)change({corners:next})}}
     onPointerCancel={()=>{gesture.current=undefined;setDrawing(undefined)}}>
     <img src={originalUrl} alt="Original document photo" draggable={false}/>
     {!originalOnly&&(crop||result?.detected||draft.corners)&&<svg className="scan-corners" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points={corners.map(p=>p.x*100+','+p.y*100).join(' ')}/>{crop&&corners.map((p,i)=><circle key={i} cx={p.x*100} cy={p.y*100} r="1.5"/>)}</svg>}
    </div>:<p>Preparing photo preview…</p>}</ScanViewport></div>
    <div><h3>{originalOnly?'Original view':'Processed preview'}</h3><ScanViewport pan={zoom>100}>{result&&originalUrl?<div className="scan-photo scan-comparison" style={{width:zoom+'%'}}>
     <img src={originalOnly?originalUrl:cleanedUrl} alt={originalOnly?'Original document photo':'Cleaned document preview'} draggable={false}/>
     {!originalOnly&&compare<100&&<img className="scan-before-layer" src={originalUrl} alt="" style={{clipPath:'inset(0 '+compare+'% 0 0)'}} draggable={false}/>}
    </div>:<p>Run Auto Scan &amp; Clean to see the result.</p>}</ScanViewport></div>
   </div>
   {!originalOnly&&result?.warnings.map(warning=><p key={warning} className="scan-warning" role="status">{warning}</p>)}
   {reviews[active]?.error&&<p role="alert">{reviews[active].error}</p>}
  </section>
 </div></DetailDrawer>;
}
