const {test}=require('node:test');const assert=require('node:assert/strict');const {buildSync}=require('esbuild');
const code=buildSync({stdin:{contents:"export * from './packages/printing/plan';export * from './packages/printing/duplex';export * from './packages/printing/image-processing';export * from './packages/printing/photo-pricing';export * from './packages/printing/settings';export * from './packages/printing/raster-budget';export {canPrintWithoutCapabilities,submissionDuplex,validateSubmissionPrinter} from './packages/printing/capabilities';export {validatePrinter} from './packages/printing/windows';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
const mod={exports:{}};new Function('module','exports','require',code)(mod,mod.exports,require);
const {sharpenPixels,enhancePixels,effectiveDpi,effectivePhotoPricing,quotePhotos,photoSizeKey,planPhotos,reorderPhotoFrames,tightPhotoFrame,constrainPhotoFrame,planDocument,plannedOutput,placementGeometry,analysePixels,normalizedSettings,validatePrinter}=mod.exports;
const base={printer:'Test',paper:'A4',copies:1,colour:false,landscape:false,duplex:'simplex',range:'',rotation:0,fit:'contain',layout:'single'};
const doc={id:'file',mime:'application/pdf',pages:Array.from({length:10},()=>({widthMm:210,heightMm:297,blank:false,ink:'mono',coverage:0}))};
test('new document jobs prefer 300 DPI when a single sheet fits the raster limit',()=>{
 assert.equal(mod.exports.defaultDocumentDpi('A4'),300);
 assert.equal(mod.exports.defaultDocumentDpi('A3'),300);
 assert.equal(mod.exports.defaultDocumentDpi('A2'),150);
 assert.equal(mod.exports.defaultDocumentDpi('Custom',{widthMm:210,heightMm:297}),300);
 assert.equal(mod.exports.defaultDocumentDpi('Custom'),150);
});
test('six image copies fit one six-up sheet and odd duplex sides are padded',()=>{
 const photo={...doc,mime:'image/jpeg',pages:[doc.pages[0]]};
 const one=planDocument({...base,nup:6,copies:6},photo);
 assert.equal(one.photoCount,6);
 assert.equal(plannedOutput(one).length,1);
 assert.equal(one.sides[0].placements.length,6);
 assert.equal(new Set(one.sides[0].placements.map(({box})=>box.x+','+box.y)).size,6);
 const two=planDocument({...base,nup:6,copies:13,duplex:'longEdge'},photo);
 assert.deepEqual(plannedOutput(two).map(side=>side.placements.length),[6,6,1,0]);
 assert.equal(plannedOutput(planDocument({...base,copies:6},photo)).length,6);
});
test('111 A4 sides fit the raster budget without dropping pages',()=>{
 const sides=Array.from({length:111},()=>[210,297]);
 const dpi=mod.exports.fitRasterDpi(sides,150);
 const pixels=value=>111*Math.round(210*value/25.4)*Math.round(297*value/25.4);
 assert.ok(dpi>=72&&dpi<150&&pixels(dpi)<=120_000_000&&pixels(dpi+1)>120_000_000);
 assert.equal(mod.exports.fitRasterDpi([[210,297]],300),300);
 assert.throws(()=>mod.exports.fitRasterDpi(Array.from({length:200},()=>[420,594]),150),/smaller page ranges/);
});
test('three-slide handouts reserve a writable notes column and duplex pad the batch',()=>{
 const plan=planDocument({...base,nup:3,handoutNotes:true,duplex:'longEdge',range:'1-7',marginMm:5,gapMm:4},doc);
 assert.deepEqual(plan.sides.map(side=>[side.placements.length,side.notes?.length??0,side.back]),[[3,3,false],[3,3,true],[1,1,false],[0,0,true]]);
 assert.ok(plan.sides[0].notes[0].x>plan.sides[0].placements[0].box.x+plan.sides[0].placements[0].box.width);
});
test('selection uses current page, odd reverse and conservative blank filtering',()=>{
 assert.deepEqual(planDocument({...base,pageMode:'current',currentPage:4},doc).selected,[4]);
 assert.deepEqual(planDocument({...base,pageFilter:'odd',reverse:true},doc).selected,[9,7,5,3,1]);
 const modified={...doc,pages:doc.pages.map((p,i)=>({...p,blank:i===0}))};
 assert.equal(planDocument({...base,skipBlank:true},modified).selected.length,9);
});
test('custom grid ordering is physical geometry',()=>{
 const plan=planDocument({...base,nup:6,grid:{columns:3,rows:2},order:'vertical'},doc);
 assert.equal(plan.sides.length,2);assert.equal(plan.sides[0].placements[1].box.x,plan.sides[0].placements[0].box.x);
 assert.ok(plan.sides[0].placements[1].box.y>plan.sides[0].placements[0].box.y);
 assert.throws(()=>planDocument({...base,nup:4,grid:{columns:3,rows:2}},doc));
});
test('scaling actual, percent, fill and explicit stretch preserve intended dimensions',()=>{
 const box={x:0,y:0,width:100,height:100};
 assert.equal(placementGeometry(50,80,box,normalizedSettings({...base,scaling:'actual'})).box.width,50);
 assert.equal(placementGeometry(50,80,box,normalizedSettings({...base,scaling:'percent',scalePercent:200})).box.width,100);
 assert.equal(placementGeometry(50,80,box,normalizedSettings({...base,scaling:'stretch'})).box.height,100);
 assert.throws(()=>planDocument({...base,margins:{left:150,right:150,top:0,bottom:0}},doc));
 assert.throws(()=>normalizedSettings({...base,scaling:'printable',orientation:'auto'}),/fixed page orientation/);
});
test('duplex uncollated copies preserve fronts and backs',()=>{
 const plan=planDocument({...base,duplex:'longEdge',copies:2,collate:false},doc),sides=plannedOutput(plan);
 assert.deepEqual(sides.slice(0,4).map(s=>s.placements[0].page),[1,2,1,2]);
});
test('manual duplex prepares matching front and back passes with odd-page padding',()=>{
 const settings={...base,range:'1-3',copies:2,collate:false,duplex:'manualLongEdge'};
 const pages=sideSelection=>plannedOutput(planDocument({...settings,sideSelection},doc)).map(s=>s.placements[0]?.page??null);
 assert.deepEqual(pages('front'),[1,1,3,3]);
 assert.deepEqual(pages('back'),[2,2,null,null]);
});
test('auto binding follows imposed portrait or landscape while explicit edges stay fixed',()=>{
 const {driverDuplex,resolveDuplex}=mod.exports;
 assert.equal(driverDuplex('auto',false),'longEdge');
 assert.equal(driverDuplex('auto',true),'shortEdge');
 assert.equal(driverDuplex('longEdge',true),'longEdge');
 assert.equal(driverDuplex('shortEdge',false),'shortEdge');
 assert.equal(driverDuplex('manualAuto',true),'simplex');
 assert.equal(resolveDuplex('manualAuto',true),'manualShortEdge');
 assert.equal(resolveDuplex('manualAuto',false),'manualLongEdge');
 const mixed={...doc,pages:doc.pages.map((page,index)=>index===0?{...page,widthMm:297,heightMm:210}:page)};
 const ordinary=planDocument({...base,orientation:'auto',duplex:'auto',nup:2,range:'1-5'},mixed);
 const [first,back]=ordinary.sides;
 assert.equal(driverDuplex(ordinary.settings.duplex,first.width>first.height),'shortEdge');
 assert.equal(back.turn,false);
 assert.deepEqual(back.placements.map(item=>item.page),[3,4]);
 const booklet=planDocument({...base,duplex:'auto',nup:2,booklet:true},doc);
 assert.equal(booklet.sides[1].turn,false);
 assert.equal(booklet.sides[1].width,297);
 const manualSettings={...base,duplex:'manualAuto',landscape:true,range:'1-3'};
 const pages=sideSelection=>plannedOutput(planDocument({...manualSettings,sideSelection},doc)).map(side=>side.placements[0]?.page??null);
 assert.deepEqual(pages('front'),[1,3]);
 assert.deepEqual(pages('back'),[2,null]);
});
test('automatic duplex respects selected printer capability while manual passes remain available',()=>{
 const cap={name:'Test',driver:'TOSHIBA Universal PS3 Driver',status:3,error:2,duplex:true,colour:true,papers:[{widthMm:210,heightMm:297}],trays:[],resolutions:[]};
 assert.doesNotThrow(()=>validatePrinter(normalizedSettings({...base,duplex:'auto'}),cap));
 const next={...cap,name:'Other',duplex:false};
 assert.throws(()=>validatePrinter(normalizedSettings({...base,printer:'Other',duplex:'auto'}),next),/Automatic duplex/);
 assert.doesNotThrow(()=>validatePrinter(normalizedSettings({...base,printer:'Other',duplex:'manualAuto'}),next));
});
test('submission preserves booklet sides for virtual devices and uses manual duplex on simplex-only printers',()=>{
 const virtual={name:'OneNote (Desktop)',driver:'Send to Microsoft OneNote 16 Driver',status:3,error:2,duplex:false,colour:true,papers:[{widthMm:210,heightMm:297}],trays:[],resolutions:[]};
 const settings=normalizedSettings({...base,printer:virtual.name,booklet:true,nup:2,landscape:true,duplex:'shortEdge'});
 assert.doesNotThrow(()=>mod.exports.validateSubmissionPrinter(settings,virtual));
 assert.equal(mod.exports.submissionDuplex(settings.duplex,true,false),'simplex');
 assert.deepEqual(planDocument(settings,doc).sides.slice(0,2).map(side=>side.back),[false,true]);
 assert.equal(settings.duplex,'shortEdge');
 assert.equal(mod.exports.submissionDuplex('auto',false,false),'manualAuto');
 assert.equal(mod.exports.submissionDuplex('longEdge',false,false),'manualLongEdge');
 assert.equal(mod.exports.submissionDuplex('shortEdge',false,true),'shortEdge');
 assert.throws(()=>mod.exports.validateSubmissionPrinter({...settings,paper:'A3'},virtual),/paper size/);
});
test('booklet padding and long-edge backside turn are explicit',()=>{
 const plan=planDocument({...base,booklet:true,nup:2,duplex:'longEdge'},doc);
 assert.equal(plan.sides.length,6);assert.equal(plan.sides[1].turn,true);assert.equal(plan.sides[0].width,297);
});
test('poster output counts tiles using overlap and actual dimensions',()=>{
 const plan=planDocument({...base,range:'1',poster:{enabled:true,scale:200,overlapMm:5,marks:true,labels:true}},doc);
 assert.equal(plan.sides.length,9);assert.ok(plan.sides[0].label);assert.ok(plan.sides[1].placements[0].poster.x>0);
});
test('photo copies use dimension packing and physical cut boundaries',()=>{
 const photo={...doc,mime:'image/png',pages:doc.pages.slice(0,1)};
 const plan=planDocument({...base,photo:{widthMm:50.8,heightMm:50.8,quantity:21,whiteBorderMm:2,cutGuides:true}},photo);
 assert.equal(plan.sides.length,2);assert.equal(plan.photoCount,21);assert.equal(plan.sides[0].placements[0].cutBox.width,50.8);
});
test('pixel analysis finds white, grayscale and meaningful colour',()=>{
 const pixels=new Uint8ClampedArray(400*4).fill(255);assert.equal(analysePixels(pixels).blank,true);
 for(let i=0;i<400;i++){pixels[i*4]=200;pixels[i*4+1]=200;pixels[i*4+2]=200}assert.equal(analysePixels(pixels).ink,'grayscale');
 for(let i=0;i<40;i++)pixels[i*4+1]=0;assert.equal(analysePixels(pixels).ink,'colour');
});
test('capability gates reject unsupported colour, paper, duplex, tray and offline status',()=>{
 const caps={name:'Test',offline:false,status:3,error:0,colour:false,duplex:false,papers:[{widthMm:210,heightMm:297}],trays:[],resolutions:[]};
 assert.doesNotThrow(()=>validatePrinter(normalizedSettings(base),caps));
 for(const change of [{colour:true},{duplex:'longEdge'},{paper:'A3'},{tray:1}])assert.throws(()=>validatePrinter(normalizedSettings({...base,...change}),caps));
 assert.throws(()=>validatePrinter(normalizedSettings(base),{...caps,offline:true}));
 for(const error of [3,5])assert.doesNotThrow(()=>validatePrinter(normalizedSettings(base),{...caps,error}));
 for(const error of [4,6,7,8,9])assert.throws(()=>validatePrinter(normalizedSettings(base),{...caps,error}),/reports an error/);
 assert.doesNotThrow(()=>validatePrinter(normalizedSettings(base),{...caps,papers:[]}));
 assert.throws(()=>validatePrinter(normalizedSettings({...base,paper:'Custom',customPaper:{widthMm:210,heightMm:297}}),{...caps,papers:[]}),/paper size/);
});
test('Toshiba 257 low-toner warning permits supported jobs while paper and offline checks still apply',()=>{
 const printer='TOSHIBA e-STUDIO257';
 const supported={name:printer,driver:'TOSHIBA Universal Printer 2',offline:false,status:3,error:5,colour:false,duplex:true,papers:[{widthMm:210,heightMm:297}],trays:[],resolutions:[]};
 assert.doesNotThrow(()=>validatePrinter(normalizedSettings({...base,printer,duplex:'longEdge'}),supported));
 assert.throws(()=>validatePrinter(normalizedSettings({...base,printer,paper:'A3'}),supported),/paper size/);
 assert.throws(()=>validatePrinter(normalizedSettings({...base,printer,colour:true}),supported),/colour output/);
 assert.throws(()=>validatePrinter(normalizedSettings({...base,printer}),{...supported,offline:true}),/offline/);
});

test('missing driver paper metadata permits standard paper for manual duplex',()=>{
 const caps={name:'Test',offline:false,status:3,error:0,colour:true,duplex:false,papers:[],trays:[],resolutions:[]};
 const settings=normalizedSettings({...base,colour:true,duplex:'manualLongEdge'});
 assert.doesNotThrow(()=>mod.exports.validateSubmissionPrinter(settings,caps));
 assert.throws(()=>mod.exports.validateSubmissionPrinter({...settings,scaling:'printable'},caps),/paper size/);
});

test('document printing can fall back when a copier does not return driver capabilities',()=>{
 const {canPrintWithoutCapabilities,submissionDuplex}=mod.exports;
 const settings=normalizedSettings({...base,duplex:'auto'});
 assert.equal(canPrintWithoutCapabilities(settings),true);
 assert.equal(submissionDuplex(settings.duplex,false,false),'manualAuto');
 assert.equal(submissionDuplex('simplex',false,false),'simplex');
 for(const change of [{paper:'Custom'},{tray:1},{driverDpi:{x:600,y:600}},{scaling:'printable'},{photoBatch:true}]){
  assert.equal(canPrintWithoutCapabilities({...settings,...change}),false);
 }
});

const photoDoc=id=>({id,mime:'image/jpeg',pages:[{widthMm:100,heightMm:150,blank:false,ink:'colour',coverage:1}]});
test('resize stops at neighboring photos and printable edges without changing the locked ratio',()=>{
 const area={x:5,y:5,width:200,height:287},start={x:25,y:25,width:40,height:60};
 const neighbor={x:95,y:25,width:50,height:70};
 const resized=constrainPhotoFrame(start,{...start,width:80,height:120},area,[neighbor],2);
 assert.ok(Math.abs(resized.width-68)<.001);
 assert.ok(Math.abs(resized.height/resized.width-1.5)<1e-8);
 const fromTopLeft=constrainPhotoFrame(start,{x:-15,y:-35,width:80,height:120},area,[],0);
 assert.ok(Math.abs(fromTopLeft.y-5)<.001);
 assert.ok(Math.abs(fromTopLeft.y+fromTopLeft.height-85)<1e-8);
});
test('fitting editor frames removes unused fit space and keeps explicit borders and crop frames',()=>{
 const source=photoDoc('a').pages[0],settings=normalizedSettings(base);
 const placement={page:1,rotation:0,colour:true,fit:'contain',box:{x:10,y:10,width:150,height:150},cutBox:{x:8,y:8,width:154,height:154}};
 assert.deepEqual(tightPhotoFrame(source,placement,settings),{x:33,y:8,width:104,height:154,rotation:0});
 assert.deepEqual(tightPhotoFrame(source,{...placement,fit:'cover'},settings),{...placement.cutBox,rotation:0});
});
test('reordering prints assigns all photo copies to the existing positions across sides',()=>{
 const slots=[{file:'b',copy:0,sheet:1,x:5,y:5},{file:'a',copy:1,sheet:0,x:55,y:5},{file:'a',copy:0,sheet:0,x:5,y:5}];
 const next=reorderPhotoFrames(slots,[{file:'b',copy:0},{file:'a',copy:0},{file:'a',copy:1}]);
 assert.deepEqual(next.map(({file,copy,sheet,x})=>[file,copy,sheet,x]),[['b',0,0,5],['a',0,0,55],['a',1,1,5]]);
 assert.throws(()=>reorderPhotoFrames(slots,[{file:'b',copy:0}]),/every photo copy/);
});
test('manual canvas frames resize individual copies without changing their print order',()=>{
 const positions=[
  {file:'a',copy:0,sheet:0,x:5,y:5,frame:{width:60,height:80,rotation:90}},
  {file:'a',copy:1,sheet:0,x:75,y:5,frame:{width:110,height:120,rotation:0}}
 ];
 const settings={...base,photoArrangement:'manual',photoPositions:positions,gapMm:2,photoItems:{a:{widthMm:50,heightMm:50,quantity:2}}};
 const plan=planPhotos(settings,[photoDoc('a')]);
 assert.deepEqual(plan.sides[0].placements.map(p=>[p.copy,p.cutBox.width,p.cutBox.height,p.rotation]),[[0,60,80,90],[1,110,120,0]]);
 assert.throws(()=>planPhotos({...settings,photoPositions:[positions[0],{...positions[1],x:50}]},[photoDoc('a')]),/overlap/);
});
test('A4 fractions, A3 full page and passport repeats preserve requested frames',()=>{
 for(const [rows,columns] of [[1,1],[2,1],[2,2],[3,2],[4,2]]){
  const photos=Array.from({length:rows*columns},(_,index)=>photoDoc(String(index)));
  const plan=planPhotos({...base,photoGrid:{rows,columns}},photos);
  assert.equal(plan.sides.length,1);
  assert.deepEqual(plan.sides[0].placements.map(p=>[p.box.width,p.box.height]),photos.map(()=>[210/columns,297/rows]));
 }
 const passport=planPhotos({...base,photoItems:{passport:{widthMm:35,heightMm:45,quantity:12}}},[photoDoc('passport')]);
 assert.equal(passport.photoCount,12);
 assert.equal(passport.sides.length,1);
 assert.ok(passport.sides[0].placements.every(p=>p.box.width===35&&p.box.height===45));
 const a3=planPhotos({...base,paper:'A3',photoGrid:{rows:1,columns:1}},[photoDoc('a')]);
 assert.deepEqual(a3.sides[0].placements[0].box,{x:0,y:0,width:297,height:420});
});
test('effective DPI reflects printed dimensions and enhancement keeps alpha',()=>{
 assert.equal(effectiveDpi(600,600,50.8,50.8),300);
 assert.equal(effectiveDpi(600,600,152.4,152.4),100);
 const raster=new Uint8ClampedArray([50,50,50,255,200,200,200,255]);
 enhancePixels(raster,2,1,{autoContrast:true});
 assert.deepEqual([...raster],[0,0,0,255,255,255,255,255]);
 enhancePixels(raster,2,1,{warmth:25});
 assert.equal(raster[0],10);
 assert.equal(raster[3],255);
});
test('custom PDF frame keeps half-A4 dimensions and rejects impossible placement',()=>{
 const frame={widthMm:148,heightMm:210};
 const plan=planDocument({...base,documentFrame:frame},doc);
 assert.deepEqual(plan.sides[0].placements[0].box,{x:31,y:43.5,width:148,height:210});
 assert.throws(()=>planDocument({...base,documentFrame:{widthMm:211,heightMm:210}},doc),/available paper area/);
 assert.throws(()=>planDocument({...base,documentFrame:frame,nup:2},doc),/one-up/);
});
test('photo ink overrides apply to sides and pricing',()=>{
 const photoItems={a:{widthMm:50,heightMm:50,quantity:1,ink:'auto',detectedColour:false},b:{widthMm:50,heightMm:50,quantity:1,ink:'sepia'}};
 const plan=planPhotos({...base,photoGrid:{rows:1,columns:1},photoItems},[photoDoc('a'),photoDoc('b')]);
 assert.deepEqual(plan.sides.map(side=>side.ink),['mono','colour']);
 assert.equal(quotePhotos(plan,{basis:'side',mono:100,colour:500}).total,600);
});
test('an empty photo rate falls back to configured physical-sheet rates',()=>{
 const shop={photo:0,mono:1000,colour:3000,duplexColour:4500};
 const empty={basis:'sheet',mono:0,colour:0};
 const plan=planPhotos({...base,colour:true,duplex:'shortEdge',photoGrid:{rows:1,columns:1}},[photoDoc('a'),photoDoc('b')]);
 const {policy,source}=effectivePhotoPricing(empty,shop,'shortEdge');
 assert.equal(source,'shop print rates');
 assert.equal(quotePhotos(plan,policy).total,4500);
 assert.equal(effectivePhotoPricing({...empty,colour:7000},shop,'shortEdge').policy.colour,7000);
});
test('bulk photos: 1, 10, 20 inputs retain every requested copy without overlap',()=>{
 for(const count of [1,10,20]){
  const docs=Array.from({length:count},(_,i)=>photoDoc('photo-'+i));
  const plan=planPhotos({...base,marginMm:5,gapMm:2,autoRotate:true,photoItems:Object.fromEntries(docs.map(d=>[d.id,{widthMm:50.8,heightMm:50.8,quantity:3}]))},docs);
  const placements=plan.sides.flatMap(s=>s.placements);assert.equal(placements.length,count*3);assert.equal(plan.photoCount,count*3);
  for(const doc of docs)assert.equal(placements.filter(p=>p.file===doc.id).length,3);
  for(const side of plan.sides)for(let i=0;i<side.placements.length;i++){
   const a=side.placements[i].cutBox;assert.ok(a.x>=5&&a.y>=5&&a.x+a.width<=205.00001&&a.y+a.height<=292.00001);
   for(const other of side.placements.slice(i+1)){const b=other.cutBox;assert.ok(a.x+a.width<=b.x+.00001||b.x+b.width<=a.x+.00001||a.y+a.height<=b.y+.00001||b.y+b.height<=a.y+.00001)}
  }
 }
});
test('mixed photo sizes and individual quantities pack on real sheets',()=>{
 const plan=planPhotos({...base,marginMm:5,gapMm:2,autoRotate:true,photoItems:{a:{widthMm:101.6,heightMm:152.4,quantity:2},b:{widthMm:50.8,heightMm:50.8,quantity:6},c:{widthMm:76.2,heightMm:101.6,quantity:4}}},['a','b','c'].map(photoDoc));
 assert.equal(plan.photoCount,12);assert.ok(plan.sides.length>1);
 for(const [id,n] of [['a',2],['b',6],['c',4]])assert.equal(plan.sides.flatMap(s=>s.placements).filter(p=>p.file===id).length,n);
 assert.equal(plan.settings.photoItems.a.widthMm,101.6);
});
test('A4 landscape fits eight photos in two ordered 2×2 sides',()=>{
 const photos=Array.from({length:8},(_,index)=>photoDoc(String(index+1)));
 const layout=planPhotos({...base,landscape:true,photoGrid:{rows:2,columns:2},marginMm:5,gapMm:2},photos);
 assert.deepEqual(layout.sides.map(side=>[side.width,side.height]),[[297,210],[297,210]]);
 assert.deepEqual(layout.sides.map(side=>side.placements.map(photo=>photo.file)),[['1','2','3','4'],['5','6','7','8']]);
 assert.deepEqual(layout.sides[0].placements[3].box,{x:149.5,y:106,width:142.5,height:99});
});
test('A4 photo grid honors a requested count below its available cells',()=>{
 const photos=Array.from({length:8},(_,index)=>photoDoc(String(index+1)));
 const layout=planPhotos({...base,photoGrid:{rows:3,columns:2,capacity:5},marginMm:0,gapMm:0},photos);
 assert.equal(layout.settings.photoGrid.capacity,5);
 assert.deepEqual(layout.sides.map(side=>side.placements.map(photo=>photo.file)),[['1','2','3','4','5'],['6','7','8']]);
 assert.deepEqual(layout.sides[0].placements[0].cutBox,layout.sides[1].placements[0].cutBox);
});
test('full-page photo duplex preserves front and back order and charges per physical sheet',()=>{
 const photos=['b','a','c'].map(photoDoc);
 const settings={...base,colour:true,duplex:'manualLongEdge',photoGrid:{rows:1,columns:1},marginMm:5};
 const layout=planPhotos(settings,photos);
 assert.deepEqual(layout.sides.map(side=>side.placements[0]?.file),['b','a','c',undefined]);
 assert.deepEqual(layout.sides.map(side=>side.back),[false,true,false,true]);
 assert.deepEqual(layout.sides[0].placements[0].box,{x:5,y:5,width:200,height:287});
 const sheet=quotePhotos(layout,{basis:'sheet',mono:300,colour:900});
 assert.deepEqual([sheet.physicalSheets,sheet.printedSides,sheet.units,sheet.total],[2,3,2,1800]);
 const paper=quotePhotos(layout,{basis:'photo',mono:300,colour:500,paperPerSheet:100,finishing:40});
 assert.deepEqual([paper.physicalSheets,paper.units,paper.paperCost,paper.printing,paper.total],[2,3,200,1500,1740]);
 assert.equal(quotePhotos(layout,{basis:'side',mono:200,colour:500}).total,1500);
 assert.deepEqual(plannedOutput(planPhotos({...settings,sideSelection:'back'},photos)).map(side=>side.placements[0]?.file),['a',undefined]);
});
test('photo packing rejects oversized and invalid requests',()=>{
 assert.throws(()=>planPhotos({...base,photoItems:{a:{widthMm:500,heightMm:500,quantity:1}}},[photoDoc('a')]),/does not fit/);
 assert.throws(()=>planPhotos({...base,photoItems:{a:{widthMm:50,heightMm:50,quantity:0}}},[photoDoc('a')]));
});

test('photo edits are validated and retained without changing source metadata',()=>{
 const doc=photoDoc('edited'),original=JSON.stringify(doc);
 const plan=planPhotos({...base,colour:true,photoMaxPerSheet:1,photoItems:{edited:{widthMm:50,heightMm:70,quantity:3,flipX:true,brightness:110,contrast:90,saturation:0,zoom:1.5,ink:'grayscale',crop:{x:.1,y:.2,width:.8,height:.6}}}},[doc]);
 assert.equal(plan.sides.length,3);assert.equal(plan.sides[0].placements[0].edit.flipX,true);assert.equal(plan.sides[0].ink,'mono');assert.equal(JSON.stringify(doc),original);
 assert.throws(()=>planPhotos({...base,photoItems:{edited:{widthMm:50,heightMm:70,quantity:1,crop:{x:.5,y:0,width:.8,height:1}}}},[doc]));
});

test('photo pricing separates sheet consumption, per-photo units, sizes and service fees',()=>{
 const plan=planPhotos({...base,colour:true,photoItems:{p:{widthMm:50.8,heightMm:50.8,quantity:16}}},[photoDoc('p')]);
 const sheet=quotePhotos(plan,{basis:'sheet',mono:1234,colour:1234});assert.equal(sheet.total,plan.sides.length*1234);
 const perPhoto=quotePhotos(plan,{basis:'photo',mono:100,colour:250,setup:75});assert.equal(perPhoto.units,16);assert.equal(perPhoto.total,4075);assert.equal(perPhoto.physicalSheets,plan.sides.length);
 const sizes=quotePhotos(plan,{basis:'photo',mono:100,colour:250,photoSizes:{[photoSizeKey(50.8,50.8)]:333},discount:28});assert.equal(sizes.total,5300);
 const tiers=quotePhotos(plan,{basis:'photo',mono:100,colour:250,tiers:[{from:10,mono:90,colour:200}],minimum:4000});assert.equal(tiers.total,4000);
 assert.throws(()=>quotePhotos(plan,{basis:'booklet',mono:100,colour:250}));
});

test('manual photo placement validates spacing, bounds, copy identity and physical sheets',()=>{
 const options={...base,marginMm:5,gapMm:2,photoItems:{p:{widthMm:50,heightMm:70,quantity:2}}},docs=[photoDoc('p')];
 const auto=planPhotos(options,docs),positions=auto.sides.flatMap((side,sheet)=>side.placements.map(p=>({file:p.file,copy:p.copy,sheet,x:p.cutBox.x,y:p.cutBox.y})));
 const manual=planPhotos({...options,photoArrangement:'manual',photoPositions:positions.map((p,i)=>({...p,sheet:i,x:10,y:10}))},docs);assert.equal(manual.sides.length,2);assert.equal(manual.sides[0].placements[0].cutBox.x,10);
 assert.throws(()=>planPhotos({...options,photoArrangement:'manual',photoPositions:positions.map(p=>({...p,x:5,y:5}))},docs),/overlap/);
 assert.throws(()=>planPhotos({...options,photoArrangement:'manual',photoPositions:positions.map(p=>({...p,x:200}))},docs),/printable area/);
 assert.throws(()=>planPhotos({...options,photoArrangement:'manual',photoPositions:positions.slice(0,1)},docs),/one position/);
 for(const mode of ['grid','rows','columns'])assert.equal(planPhotos({...options,photoArrangement:mode},docs).photoCount,2);
});

test('sharpening changes only the disposable raster with bounded settings',()=>{
 const pixels=new Uint8ClampedArray(3*3*4).fill(100);for(let i=3;i<pixels.length;i+=4)pixels[i]=255;pixels[16]=pixels[17]=pixels[18]=150;
 const original=new Uint8ClampedArray(pixels);sharpenPixels(pixels,3,3,0);assert.deepEqual(pixels,original);sharpenPixels(pixels,3,3,100);assert.equal(pixels[16],200);assert.equal(pixels[19],255);assert.equal(pixels[0],100);
 assert.throws(()=>sharpenPixels(pixels,3,3,101));
});
