const assert=require('node:assert/strict');
const {test}=require('node:test');
const {buildSync}=require('esbuild');
const {PDFDocument,degrees}=require('pdf-lib');
const {unzipSync}=require('fflate');
const {mkdtemp,readFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');

const {exports:studio}=(()=>{
 const module={exports:{}};
 const code=buildSync({entryPoints:['packages/printing/studio-pages.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external'}).outputFiles[0].text;
 new Function('module','exports','require',code)(module,module.exports,require);
 return module;
})();
async function fixture(dimensions){
 const document=await PDFDocument.create();
 dimensions.forEach(([width,height,rotation])=>document.addPage([width,height]).setRotation(degrees(rotation)));
 return document.save();
}

test('PDF Studio merges, reorders, duplicates and rotates pages without editing the originals',async()=>{
 const sources=[await fixture([[200,300,0],[300,400,90]]),await fixture([[500,600,0]])];
 const snapshots=sources.map(bytes=>bytes.slice());
 const result=await studio.exportStudioPages(sources,[[{source:1,page:0,turn:0},{source:0,page:1,turn:90},{source:0,page:1,turn:0}]],'merged');
 const document=await PDFDocument.load(result.bytes);
 assert.equal(result.format,'pdf');
 assert.deepEqual(document.getPages().map(page=>[page.getWidth(),page.getHeight(),page.getRotation().angle]),[[500,600,0],[300,400,180],[300,400,90]]);
 assert.deepEqual(sources,snapshots);
});

test('PDF Studio splits using all supported methods and exports numbered PDFs',async()=>{
 assert.deepEqual(studio.splitStudioPages(5,'every',''),[[0],[1],[2],[3],[4]]);
 assert.deepEqual(studio.splitStudioPages(5,'groups','2'),[[0,1],[2,3],[4]]);
 assert.deepEqual(studio.splitStudioPages(5,'after','2, 4'),[[0,1],[2,3],[4]]);
 assert.deepEqual(studio.splitStudioPages(5,'ranges','2-3; 5'),[[1,2],[4]]);
 assert.deepEqual(studio.splitStudioPages(5,'extract','1, 3-4'),[[0,2,3]]);
 const source=await fixture([[200,300,0],[400,500,0]]);
 const result=await studio.exportStudioPages([source],[[{source:0,page:0,turn:0}],[{source:0,page:1,turn:0}]],'split');
 assert.equal(result.format,'zip');
 const files=unzipSync(result.bytes);
 assert.deepEqual(Object.keys(files),['part-1.pdf','part-2.pdf']);
 assert.equal((await PDFDocument.load(files['part-2.pdf'])).getPage(0).getWidth(),400);
});

test('PDF Studio rejects corrupt files and invalid page selections',async()=>{
 const group=[[{source:0,page:2,turn:0}]];
 await assert.rejects(studio.exportStudioPages([new Uint8Array([0,1,2])],group,'invalid'),/PDF header/);
 await assert.rejects(studio.exportStudioPages([await fixture([[200,300,0]])],group,'invalid'),/outside/);
 assert.throws(()=>studio.splitStudioPages(4,'ranges','1-2;'));
 assert.throws(()=>studio.splitStudioPages(4,'groups','0'));
});

test('PDF Studio creates text overlays and preserves page geometry',async()=>{
 const input=await fixture([[200,300,0]]);
 const mark={kind:'text',text:'BloomConnect',x:20,y:30,size:18,angle:20,opacity:.4};
 const edited=await studio.exportStudioPages([input],[[{source:0,page:0,turn:0,marks:[mark]}]],'marked');
 assert.equal((await PDFDocument.load(edited.bytes)).getPage(0).getHeight(),300);
 assert.ok(edited.bytes.length>input.length);
 await assert.rejects(studio.exportStudioPages([input],[[{source:0,page:0,turn:0,marks:[{...mark,text:'සිංහල'}]}]],'marked'),/cannot encode/);
});

test('PDF Studio keeps the original size when compression cannot help',async()=>{
 const input=await fixture([[200,300,0]]);
 const result=await studio.compressStudioPdf(input,'optimized');
 assert.ok(result.bytes.length<=input.length);
 assert.equal((await PDFDocument.load(result.bytes)).getPageCount(),1);
});

test('PDF Studio places images on sheets and numbers multi-image exports',async()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR1sAAAAASUVORK5CYII=','base64');
 const images=[{name:'page-1.png',bytes:png},{name:'page-2.png',bytes:png}];
 const output=await studio.studioImagesToPdf(images,{width:200,height:300,margin:20,fill:true},'images');
 const doc=await PDFDocument.load(output.bytes);
 assert.deepEqual(doc.getPages().map(page=>page.getCropBox()),[{x:0,y:0,width:200,height:300},{x:0,y:0,width:200,height:300}]);
 const archive=studio.packageStudioImages(images,'png','images');
 assert.deepEqual(Object.keys(unzipSync(archive.bytes)),['page-1.png','page-2.png']);
});

test('PDF Studio changes crop boxes while preserving the original media box',async()=>{
 const input=await fixture([[200,300,0]]);
 const output=await studio.exportStudioPages([input],[[{source:0,page:0,turn:0,crop:{left:10,top:20,right:10,bottom:10}}]],'crop');
 const page=(await PDFDocument.load(output.bytes)).getPage(0);
 assert.deepEqual(page.getMediaBox(),{x:0,y:0,width:200,height:300});
 assert.deepEqual(page.getCropBox(),{x:20,y:30,width:160,height:210});
});

test('PDF Studio exports Sinhala and English as editable DOCX text',()=>{
 const module={exports:{}};
 const code=buildSync({entryPoints:['packages/printing/studio-docx.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external'}).outputFiles[0].text;
 new Function('module','exports','require',code)(module,module.exports,require);
 const bytes=module.exports.studioDocx([['සිංහල & English'],['Second page']]);
 const xml=new TextDecoder().decode(unzipSync(bytes)['word/document.xml']);
 assert.match(xml,/සිංහල &amp; English/);
 assert.match(xml,/w:type="page"/);
});

test('PDF Studio embeds a visible image signature',async()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR1sAAAAASUVORK5CYII=','base64');
 const source=await fixture([[200,300,0]]);
 const mark={kind:'image',image:png,text:'',size:40,x:20,y:30,angle:0,opacity:1};
 const output=await studio.exportStudioPages([source],[[{source:0,page:0,turn:0,marks:[mark]}]],'signed');
 const document=await PDFDocument.load(output.bytes);
 assert.equal(document.getPage(0).getWidth(),200);
 assert.ok(document.context.enumerateIndirectObjects().some(([,object])=>object.dict?.get(require('pdf-lib').PDFName.of('Subtype'))?.toString()==='/Image'));
});

test('PDF Studio removes an edge-connected backdrop and keeps the subject',()=>{
 const module={exports:{}};
 const code=buildSync({entryPoints:['packages/printing/studio-background.ts'],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
 new Function('module','exports',code)(module,module.exports);
 const pixels=new Uint8ClampedArray(9*4).fill(255);
 pixels.set([30,60,70,255],4*4);
 assert.equal(module.exports.removeStudioBackground(pixels,3,3,[255,255,255],5),8);
 assert.equal(pixels[3],0);
 assert.deepEqual([...pixels.slice(16,20)],[30,60,70,255]);
 const photo=new Uint8ClampedArray(10*10*4).fill(255);
 photo.set([130,135,146,255],(9*10+4)*4);
 photo.set([220,120,20,255],(9*10+5)*4);
 const originalShadow=photo.slice();
 module.exports.removeStudioBackground(originalShadow,10,10,[255,255,255],5);
 assert.equal(originalShadow[(9*10+4)*4+3],255);
 module.exports.removeStudioBackground(photo,10,10,[255,255,255],5,undefined,true);
 assert.equal(photo[(9*10+4)*4+3],0);
 assert.equal(photo[(9*10+5)*4+3],255);
});

test('PDF Studio packages distinct batch filenames and preserves their PDF data',async()=>{
 const input=await fixture([[200,300,0]]);
 const {bytes}=studio.packageStudioBatch([{name:'same.pdf',bytes:input},{name:'same.pdf',bytes:input}]);
 const files=unzipSync(bytes);
 assert.deepEqual(Object.keys(files),['1-same.pdf','2-same.pdf']);
 assert.deepEqual(files['1-same.pdf'],input);
});

test('PDF Studio Save As rejects existing files and invalid extensions',async()=>{
 const module={exports:{}};
 const code=buildSync({entryPoints:['apps/desktop/studio-local.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external'}).outputFiles[0].text;
 new Function('module','exports','require','__dirname',code)(module,module.exports,require,resolve('dist'));
 const directory=await mkdtemp(join(tmpdir(),'studio-test-'));
 try{
  const target=join(directory,'copy.pdf'),input=await fixture([[200,300,0]]);
  await module.exports.writeStudioExport(target,'pdf',input);
  await assert.rejects(module.exports.writeStudioExport(target,'pdf',new Uint8Array([1,2,3])),/existing files/);
  await assert.rejects(module.exports.writeStudioExport(join(directory,'wrong.png'),'pdf',input),/extension/);
  assert.deepEqual(new Uint8Array(await readFile(target)),input);
 }finally{await rm(directory,{recursive:true,force:true})}
});

test('PDF Studio scan worker returns both original and cleaned previews',async()=>{
 const module={exports:{}};
 const code=buildSync({entryPoints:['apps/desktop/studio-local.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external'}).outputFiles[0].text;
 new Function('module','exports','require','__dirname',code)(module,module.exports,require,resolve('dist'));
 const original=await require('sharp')({create:{width:160,height:210,channels:3,background:'#aab1ca'}}).png().toBuffer();
 const settings={mode:'gray',brightness:0,contrast:12,white:88,shadow:90,sharpness:16,denoise:12,threshold:50,rotation:0,skew:0,autoStraighten:true};
 const output=await module.exports.cleanStudioScan(original,settings);
 assert.ok(output.original.length>0&&output.image.length>0);
 assert.notDeepEqual(output.image,output.original);
});

test('PDF Studio processes a 500-page document in stable order',async()=>{
 const input=await fixture(Array.from({length:500},(_,index)=>[200+index,400,0]));
 const pages=Array.from({length:500},(_,index)=>({source:0,page:499-index,turn:0}));
 const output=await studio.exportStudioPages([input],[pages],'large');
 const document=await PDFDocument.load(output.bytes);
 assert.equal(document.getPageCount(),500);
 assert.equal(document.getPage(0).getWidth(),699);
 assert.equal(document.getPage(499).getWidth(),200);
});
