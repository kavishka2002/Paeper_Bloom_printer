const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,readdir,rm,open}=require('node:fs/promises');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const {buildSync}=require('esbuild');
const {createHash}=require('node:crypto');
const code=buildSync({stdin:{contents:`
  export {storeDownload,identifyLargeMedia,mediaLimit} from './packages/automation-engine/media-storage';
  export {issueReference,serveReference,documentRange} from './apps/desktop/document-protocol';
`,resolveDir:process.cwd()},bundle:true,external:['sharp'],write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
const mod={exports:{}};
new Function('module','exports','require',code)(mod,mod.exports,require);
const {storeDownload,identifyLargeMedia,mediaLimit,issueReference,serveReference,documentRange}=mod.exports;

test('streams small and 34 MiB documents and serves authenticated byte ranges',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bloom-media-'));
 try{
  for(const size of [200,34*1024**2]){
   const chunk=Buffer.alloc(Math.min(size,1024**2),10);
   chunk.write('%PDF-1.7');
   async function* chunks(){for(let i=0;i<size;i+=chunk.length)yield chunk}
   let downloaded=0;
   const saved=await storeDownload(dir,{stream:chunks(),size},new AbortController().signal,(bytes,total)=>{
    assert.equal(total,size);downloaded=bytes;
   },identifyLargeMedia);
   assert.equal(downloaded,size);
   assert.equal(saved.bytes,size);
   const reference=await issueReference(dir,saved.path);
   assert.equal(reference.mime,'application/pdf');
   assert.equal(reference.bytes,size);
   const response=await serveReference(dir,new Request(reference.url,{headers:{Range:'bytes=0-7'}}));
   assert.equal(response.status,206);
   assert.equal(response.headers.get('content-range'),`bytes 0-7/${size}`);
   assert.equal(await response.text(),'%PDF-1.7');
   const badUrl=reference.url.replace(/.$/,char=>char==='0'?'1':'0');
   assert.equal((await serveReference(dir,new Request(badUrl))).status,404);
   assert.equal((await serveReference(dir,new Request(reference.url,{headers:{Range:`bytes=${size}-`}}))).status,416);
   assert.equal((await storeDownload(dir,{stream:chunks(),size},new AbortController().signal,()=>{},identifyLargeMedia)).path,saved.path);
  }
  assert.equal((await readdir(dir)).length,2);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('validates range offsets at the 2 GiB boundary',()=>{
 assert.deepEqual(documentRange(`bytes=${mediaLimit-5}-`,mediaLimit),
  {start:mediaLimit-5,end:mediaLimit-1,partial:true});
 assert.equal(documentRange(`bytes=${mediaLimit}-`,mediaLimit),undefined);
});

test('cleans up interrupted, truncated and cancelled downloads and accepts a retry',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bloom-media-retry-'));
 const chunk=Buffer.from('%PDF-1.7\n');
 try{
  async function* interrupted(){yield chunk;throw new Error('connection lost')}
  const controller=new AbortController();
  const save=(stream,size,signal=controller.signal,progress=()=>{})=>storeDownload(dir,{stream,size},signal,progress,identifyLargeMedia);
  await assert.rejects(save(interrupted()),/connection lost/);
  await assert.rejects(save([chunk],chunk.length+1),/incomplete/);
  await assert.rejects(save([chunk,chunk],undefined,controller.signal,()=>controller.abort()),{name:'AbortError'});
  assert.deepEqual(await readdir(dir),[]);
  assert.equal((await save([chunk],chunk.length,new AbortController().signal)).bytes,chunk.length);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('PDF.js reads a large local file by range and lays selected pages out as a booklet',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bloom-pdf-range-'));
 try{
  globalThis.DOMMatrix??=class {};
  const {getDocument,PDFDataRangeTransport}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const name=createHash('sha256').update('printable sparse fixture').digest('hex')+'.pdf';
  const file=await open(join(dir,name),'wx');
  try{
   const header='%PDF-1.7\n';
   const padding=34*1024**2;
   const prefix='1 0 obj\n<< /Length '+padding+' >>\nstream\n';
   await file.write(header+prefix,0,'ascii');
   let offset=header.length+prefix.length+padding;
   const endStream='\nendstream\nendobj\n';
   await file.write(endStream,offset,'ascii');
   offset+=endStream.length;
   const objects=['<< /Type /Catalog /Pages 3 0 R >>','<< /Type /Pages /Count 4 /Kids [4 0 R 5 0 R 6 0 R 7 0 R] >>',
    ...Array(4).fill('<< /Type /Page /Parent 3 0 R /MediaBox [0 0 595 842] /Resources << >> >>')];
   const offsets=[header.length];
   let tail='';
   for(const [index,value] of objects.entries()){
    offsets.push(offset+tail.length);
    tail+=(index+2)+' 0 obj\n'+value+'\nendobj\n';
   }
   const xref=offset+tail.length;
   tail+='xref\n0 8\n0000000000 65535 f \n'+offsets.map(value=>String(value).padStart(10,'0')+' 00000 n \n').join('')+
    'trailer\n<< /Size 8 /Root 2 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
   await file.write(tail,offset,'ascii');
  }finally{await file.close()}
  const {url,bytes}=await issueReference(dir,name);
  let transferred=0;
  class LocalRanges extends PDFDataRangeTransport{
   requestDataRange(begin,end){
    void serveReference(dir,new Request(url,{headers:{Range:`bytes=${begin}-${end-1}`}})).then(async response=>{
     const data=new Uint8Array(await response.arrayBuffer());
     transferred+=data.length;
     this.onDataRange(begin,data);
    });
   }
  }
  const task=getDocument({range:new LocalRanges(bytes,new Uint8Array(),true),disableAutoFetch:true,disableStream:true,stopAtErrors:true});
  try{
   const pdf=await task.promise;
   assert.equal(pdf.numPages,4);
   const page=await pdf.getPage(3);
   const {width,height}=page.getViewport({scale:1});
   assert.equal(width,595);
   await page.getOperatorList();
   const printCode=buildSync({stdin:{contents:"export {planDocument} from './packages/printing/plan';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
   const printModule={exports:{}};
   new Function('module','exports','require',printCode)(printModule,printModule.exports,require);
   const plan=printModule.exports.planDocument({printer:'Test',paper:'A4',range:'2-4',booklet:true,nup:2,landscape:true,duplex:'shortEdge',copies:1,colour:false,rotation:0,fit:'contain',layout:'single'},
    {id:'large',mime:'application/pdf',pages:Array(4).fill({widthMm:width*25.4/72,heightMm:height*25.4/72,blank:false,ink:'mono',coverage:0})});
   assert.equal(plan.sides.length,2);
   assert.deepEqual(plan.selected,[2,3,4]);
   assert.ok(transferred<2*1024**2,'Only the needed PDF ranges should be loaded');
  }finally{await task.destroy()}
 }finally{await rm(dir,{recursive:true,force:true})}
});
