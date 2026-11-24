import {useRef,useState,type PointerEvent} from 'react';
import {Button} from './context';

export function StudioSignature({add}:{add:(bytes:Uint8Array)=>void}){
 const canvas=useRef<HTMLCanvasElement>(null);
 const pointer=useRef<number>(undefined);
 const [typed,setTyped]=useState(''),[drawn,setDrawn]=useState(false),[failure,setFailure]=useState('');
 function position(event:PointerEvent<HTMLCanvasElement>){
  const box=event.currentTarget.getBoundingClientRect();
  return [(event.clientX-box.left)*event.currentTarget.width/box.width,(event.clientY-box.top)*event.currentTarget.height/box.height] as const;
 }
 async function useCanvas(source:HTMLCanvasElement){
  const blob=await new Promise<Blob|null>(resolve=>source.toBlob(resolve,'image/png'));
  if(blob)add(new Uint8Array(await blob.arrayBuffer()));
 }
 return <div className="stack">
  <canvas className="studio-sign-pad" aria-label="Draw signature" width={480} height={150} ref={canvas}
   onPointerDown={event=>{
    if(pointer.current!==undefined)return;
    pointer.current=event.pointerId;event.currentTarget.setPointerCapture(event.pointerId);
    const ctx=event.currentTarget.getContext('2d')!;
    ctx.strokeStyle='#172644';ctx.lineCap='round';ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(...position(event));
   }} onPointerMove={event=>{
    if(pointer.current!==event.pointerId)return;
    const ctx=event.currentTarget.getContext('2d')!;
    ctx.lineTo(...position(event));ctx.stroke();setDrawn(true);
   }} onLostPointerCapture={()=>{pointer.current=undefined}}/>
  <div className="actions">
   <Button className="quiet" disabled={!drawn} onClick={()=>{canvas.current?.getContext('2d')?.clearRect(0,0,480,150);setDrawn(false)}}>Clear drawing</Button>
   <Button className="secondary" disabled={!drawn} onClick={()=>void useCanvas(canvas.current!)}>Place drawing</Button>
  </div>
  <label>Typed signature<input value={typed} maxLength={75} onChange={e=>setTyped(e.target.value)}/></label>
  <Button className="secondary" disabled={!typed.trim()} onClick={()=>{
   const output=document.createElement('canvas');output.width=480;output.height=110;
   const ctx=output.getContext('2d')!;ctx.font='italic 48px cursive';ctx.fillStyle='#172644';ctx.fillText(typed,8,78,464);void useCanvas(output);
  }}>Place typed signature</Button>
  <label>Signature image<input type="file" accept="image/png,image/jpeg" onChange={e=>{
   const file=e.target.files?.[0];if(!file)return;setFailure('');
   void (async()=>{
    if(file.size>10*1024*1024)throw new Error('Choose a signature image under 10 MB.');
    const image=await createImageBitmap(file);
    try{
     const output=document.createElement('canvas'),scale=Math.min(1,900/Math.max(image.width,image.height));
     output.width=Math.max(1,Math.round(image.width*scale));output.height=Math.max(1,Math.round(image.height*scale));
     output.getContext('2d')!.drawImage(image,0,0,output.width,output.height);await useCanvas(output);
    }finally{image.close()}
   })().catch(error=>setFailure(error instanceof Error?error.message:String(error)));
  }}/></label>
  {failure&&<small role="alert">{failure}</small>}
 </div>;
}
