const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const bundle=buildSync({stdin:{contents:"export * from './packages/printing/scan-image';export * from './packages/printing/scan-pdf';export * from './packages/shared/scan';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
const mod={exports:{}};
new Function('module','require',bundle)(mod,require);
const {cleanDocument,detectDocument,rectifyDocument,scannedPdf,fullScanCorners,scanPresets}=mod.exports;
const preset=scanPresets[0].settings;

function raster(width,height,rgb){
 const data=new Uint8Array(width*height*3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set(rgb(x,y),(y*width+x)*3);
 return {data,width,height};
}
const pixel=(image,x,y)=>[...image.data.slice((y*image.width+x)*3,(y*image.width+x)*3+3)];

test('scanner detects a tilted quadrilateral against a desk and straightens the page',()=>{
 const corners=[{x:70,y:34},{x:288,y:67},{x:265,y:342},{x:50,y:307}];
 const photo=raster(350,380,(x,y)=>{
  const paper=corners.every((p,index)=>{const q=corners[(index+1)%4];return (q.x-p.x)*(y-p.y)-(q.y-p.y)*(x-p.x)>=0});
  if(!paper)return [30,28,25];
  if(x>100&&x<240&&y>110&&y<265&&y%24<5)return [29,32,30];
  return [232-Math.floor(x/20),215-Math.floor(x/20),174-Math.floor(x/20)];
 });
 const detection=detectDocument(photo);
 assert.equal(detection.detected,true);
 assert.ok(detection.corners.every((corner,i)=>Math.hypot(corner.x-corners[i].x/349,corner.y-corners[i].y/379)<.04));
 const page=rectifyDocument(photo,detection.corners,1400,1960000);
 assert.ok(page.height>page.width);
 assert.ok(pixel(page,15,15)[0]>165);
 assert.throws(()=>rectifyDocument(photo,[fullScanCorners[0],fullScanCorners[2],fullScanCorners[1],fullScanCorners[3]],1400,1960000),/four corners clockwise/);
});
test('an ambiguous background retains all edges of the source',()=>{
 const awkward=raster(100,80,(x,y)=>x>20&&x<80&&y>20&&y<60?[199,195,189]:[190,187,182]);
 assert.deepEqual(detectDocument(awkward),{detected:false,corners:fullScanCorners});
});
test('shadow normalization brightens paper while retaining dark strokes and coloured ink',()=>{
 for(const [paperR,paperG,paperB] of [[229,211,167],[211,211,211]]){
  const photo=raster(440,300,(x,y)=>{
   const light=.55+x/440*.42;
   if(x>160&&x<220&&y>115&&y<126)return [30,31,32];
   if(x>270&&x<330&&y>180&&y<199)return [145,34,47];
   return [paperR*light,paperG*light,paperB*light];
  });
  const cleaned=cleanDocument(photo,preset);
  assert.ok(pixel(cleaned,45,70).every(channel=>channel>227));
  assert.ok(pixel(cleaned,395,100).every(channel=>channel>227));
  assert.ok(pixel(cleaned,190,121).every(channel=>channel<85));
  const [red,green,blue]=pixel(cleaned,290,190);
  assert.ok(red>green+45&&red>blue+35);
  const gray=cleanDocument(photo,{...preset,mode:'gray'});
  assert.equal(new Set(pixel(gray,290,190)).size,1);
  const bw=cleanDocument(photo,{...preset,mode:'bw'});
  assert.deepEqual(pixel(bw,45,70),[255,255,255]);
  assert.deepEqual(pixel(bw,190,121),[0,0,0]);
 }
});
test('combined scan PDF preserves page order and A4 orientation',async()=>{
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const portrait=raster(80,120,()=>[210,230,250]),landscape=raster(120,80,()=>[255,245,220]);
 const task=getDocument({data:new Uint8Array(scannedPdf([portrait,landscape],'a4',8))});
 try{
  const doc=await task.promise;
  assert.equal(doc.numPages,2);
  const first=(await doc.getPage(1)).view,second=(await doc.getPage(2)).view;
  assert.deepEqual(first,[0,0,595.28,841.89]);
  assert.deepEqual(second,[0,0,841.89,595.28]);
 }finally{await task.destroy()}
});
