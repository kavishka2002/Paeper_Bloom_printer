import {useEffect,useRef,useState,type PointerEvent} from 'react';
import type {Input} from '../../packages/shared/contracts';
import {Button} from './context';
import {DetailDrawer} from './design';

export type PhotoCrop=Input<'createPhotoCrops'>['crops'][number];
type Point={x:number;y:number};
const full:PhotoCrop={x:0,y:0,width:1,height:1};
const bounds=(start:Point,end:Point):PhotoCrop=>({
 x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),
 width:Math.abs(start.x-end.x),height:Math.abs(start.y-end.y)
});
const valid=(crop:PhotoCrop|undefined):crop is PhotoCrop=>!!crop&&crop.width>=.01&&crop.height>=.01;

export function PhotoCropEditor({id,initial,limit,onClose,onApply}:{id:string;initial?:PhotoCrop;limit:number;onClose:()=>void;onApply:(crops:PhotoCrop[])=>Promise<void>}){
 const [url,setUrl]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 const [crop,setCrop]=useState(initial),[queued,setQueued]=useState<PhotoCrop[]>([]);
 const drag=useRef<{pointer:number;start:Point}|undefined>(undefined);
 const pending=useRef(false);
 useEffect(()=>{
  let alive=true,objectUrl='';
  void window.bloom.call('preview',{id,imageMaxSide:1800}).then(image=>{
   if(!alive)return;
   objectUrl=URL.createObjectURL(new Blob([new Uint8Array(image.bytes).buffer],{type:image.mime}));
   setUrl(objectUrl);
  }).catch(error=>{if(alive)setError(error.message)});
  return()=>{alive=false;if(objectUrl)URL.revokeObjectURL(objectUrl)};
 },[id]);
 const point=(event:PointerEvent<HTMLDivElement>)=>{
  const rect=event.currentTarget.getBoundingClientRect();
  const clamp=(value:number)=>Math.max(0,Math.min(1,value));
  return {x:clamp((event.clientX-rect.left)/rect.width),y:clamp((event.clientY-rect.top)/rect.height)};
 };
 const count=queued.length+Number(valid(crop));
 const outline=(region:PhotoCrop)=>({left:region.x*100+'%',top:region.y*100+'%',width:region.width*100+'%',height:region.height*100+'%'});
 return <DetailDrawer title="Edit photo crop" presentation="wide" onClose={()=>{if(!pending.current)onClose()}}>
  <div className="stack">
   <p>Drag around the part you want to print. To split this image, add each area as a separate crop.</p>
   {!url&&!error&&<p role="status">Loading photo…</p>}
   {url&&<div className="photo-crop-surface"
    onPointerDown={event=>{
     if(pending.current||event.button!==0||drag.current)return;
     event.currentTarget.setPointerCapture(event.pointerId);
     const start=point(event);
     drag.current={pointer:event.pointerId,start};
     setCrop(bounds(start,start));
    }}
    onPointerMove={event=>{if(drag.current?.pointer===event.pointerId)setCrop(bounds(drag.current.start,point(event)))}}
    onPointerUp={event=>{
     if(drag.current?.pointer!==event.pointerId)return;
     const chosen=bounds(drag.current.start,point(event));
     drag.current=undefined;setCrop(valid(chosen)?chosen:undefined);
    }}
    onPointerCancel={event=>{if(drag.current?.pointer===event.pointerId){drag.current=undefined;setCrop(undefined)}}}>
    <img src={url} alt="Original photo" draggable={false} onError={()=>setError('Could not display this photo.')}/>
    {queued.map((region,index)=><span key={index} className="photo-crop-region" style={outline(region)} aria-hidden="true">{index+1}</span>)}
    {crop&&<span className="photo-crop-region current" style={outline(crop)} aria-hidden="true"/>}
   </div>}
   {url&&<div className="form-grid photo-crop-fields">
    {(['x','y','width','height'] as const).map((key,index)=>{
     const region=valid(crop)?crop:full;
     const max=[1-region.width,1-region.height,1-region.x,1-region.y][index];
     return <label key={key}>{['Left (%)','Top (%)','Width (%)','Height (%)'][index]}
      <input type="number" disabled={saving} min={index<2?0:1} max={Math.floor(max*100+1e-8)} step={1}
       value={Math.round(region[key]*100)} onChange={event=>{
        const value=event.target.valueAsNumber/100;
        if(Number.isFinite(value))setCrop({...region,[key]:Math.max(index<2?0:.01,Math.min(max,value))});
       }}/>
     </label>;
    })}
   </div>}
   {!!queued.length&&<div className="actions" aria-label="Saved crop selections">{queued.map((_,index)=>
    <Button key={index} className="quiet" disabled={saving} onClick={()=>setQueued(list=>list.filter((_,i)=>i!==index))}>Remove crop {index+1}</Button>)}</div>}
   <div className="actions">
    <Button className="secondary" disabled={saving||!valid(crop)||queued.length>=limit-1} onClick={()=>{
     if(valid(crop)){setQueued(list=>[...list,crop]);setCrop(undefined)}
    }}>Add crop</Button>
    <Button className="quiet" disabled={saving||!crop&&!queued.length} onClick={()=>{setCrop(undefined);setQueued([])}}>Clear selection</Button>
    <Button disabled={!url||saving||count>limit} onClick={async()=>{
     if(pending.current)return;
     pending.current=true;setSaving(true);setError('');
     try{const crops=valid(crop)?[...queued,crop]:queued;await onApply(crops.length?crops:[full]);onClose()}
     catch(error){setError(error instanceof Error?error.message:String(error))}
     finally{pending.current=false;setSaving(false)}
    }}>{saving?'Preparing crops…':count>1?'Use '+count+' crops':count?'Apply crop':'Use whole photo'}</Button>
   </div>
   {count>limit&&<p role="status">This order has room for {limit} crop selections.</p>}
   {error&&<p role="alert">{error}</p>}
  </div>
 </DetailDrawer>;
}
