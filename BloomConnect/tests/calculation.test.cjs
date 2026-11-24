const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const built=buildSync({entryPoints:['packages/printing/calculation.ts'],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
const mod={exports:{}};new Function('module','exports','require',built)(mod,mod.exports,require);
const {calculatePrint:calculate,calculateBulk,documentPricing}=mod.exports;
const rate={basis:'sheet',mono:1000,colour:5000};
const base={documentPages:10,pricing:rate};
test('A3 and Legal rates price each file and duplex sheet independently',()=>{
 const rates={mono:1000,colour:5000,duplexMono:1600,paperRates:{A3:{mono:2000,duplexMono:2600},Legal:{mono:1500,colour:0}}};
 const price=(paper,duplex)=>documentPricing(rates,duplex,'sheet',paper);
 assert.equal(price('A4','simplex').mono,1000);
 assert.equal(price('A4','auto').mono,1600);
 assert.equal(price('A3','auto').mono,2600);
 assert.equal(price('Legal','auto').mono,1500);
 assert.equal(price('Legal','simplex').colour,0);
 assert.equal(price('A3','simplex').colour,5000);
 const batch=calculateBulk([
  {id:'a3',customer:null,settings:{documentPages:3,paper:'A3',duplex:'auto',pricing:price('A3','auto')}},
  {id:'legal',customer:null,settings:{documentPages:2,paper:'Legal',pricing:price('Legal','simplex')}}
 ]);
 assert.equal(batch.totalPhysicalSheets,4);
 assert.equal(batch.finalTotal,8200);
});
test('A4 supports separate and shared rates per physical sheet',()=>{
 const rates={mono:1000,colour:5000,duplexMono:1600,duplexColour:8000};
 const a4={mono:1200,colour:4000,duplexMono:1900,duplexColour:6500};
 const total=(duplex,mode,samePrice)=>calculate({
  documentPages:5,paper:'A4',duplex,mode,
  pricing:documentPricing({...rates,paperRates:{A4:{...a4,samePrice}}},duplex,'sheet','A4')
 }).finalTotal;
 assert.equal(total('simplex','mono',false),6000);
 assert.equal(total('simplex','colour',false),20000);
 assert.equal(total('auto','mono',false),5700);
 assert.equal(total('auto','colour',false),19500);
 assert.equal(total('auto','mono',true),3600);
 assert.equal(total('auto','colour',true),12000);
 assert.equal(documentPricing({...rates,paperRates:{A4:{samePrice:true}}},'auto','sheet','A4').mono,1000);
 for(const [a4,oneSide,bothSides] of [
  [{mono:1000,samePrice:true},1000,1000],
  [{mono:800,duplexMono:1500},800,1500]
 ]){
  const shop={...rates,paperRates:{A4:a4}};
  const price=(documentPages,duplex)=>calculate({documentPages,paper:'A4',duplex,pricing:documentPricing(shop,duplex,'sheet','A4')});
  assert.equal(price(1,'simplex').finalTotal,oneSide);
  assert.equal(price(2,'simplex').finalTotal,oneSide*2);
  assert.equal(price(2,'auto').totalPhysicalSheets,1);
  assert.equal(price(2,'auto').finalTotal,bothSides);
 }
});
test('presentation handouts use independent physical-sheet counts for six-up and eight-up duplex',()=>{
 assert.equal(calculate({documentPages:48,pagesPerSide:6,duplex:'shortEdge'}).totalPhysicalSheets,4);
 assert.equal(calculate({documentPages:48,pagesPerSide:8,duplex:'longEdge'}).totalPhysicalSheets,3);
});
test('booklet signatures impose and pad independently',()=>{
 const result=calculate({documentPages:14,signaturePages:8,pagesPerSide:2,duplex:'manualShortEdge',imposition:'booklet'});
 assert.equal(result.totalPhysicalSheets,4);
 assert.equal(result.paddingSlots,2);
 assert.deepEqual(result.sides.map(side=>side.pages),[[8,1],[2,7],[6,3],[4,5],[null,9],[10,null],[14,11],[12,13]]);
});
for(const [label,settings,sheets,sides] of [
 ['10-page simplex',{},10,10],['10-page duplex',{duplex:'longEdge'},5,10],
 ['10-page 4-up',{pagesPerSide:4},3,3],['10-page 2-up duplex',{pagesPerSide:2,duplex:'shortEdge'},3,5],
 ['10-page 6-up',{pagesPerSide:6},2,2],['three copies',{copies:3},30,30],
 ['8-up duplex',{pagesPerSide:8,duplex:'longEdge'},1,2],['9-up',{pagesPerSide:9},2,2],['16-up',{pagesPerSide:16},1,1]
])test(label,()=>{const result=calculate({...base,...settings});assert.equal(result.totalPhysicalSheets,sheets);assert.equal(result.printedSides,sides);assert.equal(result.finalTotal,sheets*1000)});

test('duplex charges the configured rate per physical sheet',()=>{
 const rates={mono:1000,colour:5000,duplexMono:1600,duplexColour:8000};
 const duplex='longEdge';
 const mono=calculate({documentPages:5,copies:2,duplex,pricing:documentPricing(rates,duplex,'page')});
 assert.equal(mono.totalPhysicalSheets,6);
 assert.equal(mono.printedSides,10);
 assert.equal(mono.finalTotal,9600);
 assert.equal(calculate({documentPages:5,duplex,mode:'colour',pricing:documentPricing(rates,duplex)}).finalTotal,24000);
 assert.equal(calculate({documentPages:5,pricing:documentPricing(rates,'simplex')}).finalTotal,5000);
 assert.deepEqual(documentPricing({mono:1000,colour:5000},duplex),rate);
});
test('poster tiles drive sheet and paper cost while preserving the source page count',()=>{
 const input={documentPages:2,imposition:'poster',posterTiles:[1,1,1,1,2],pricing:{basis:'sheet',mono:100,colour:250,paperPerSheet:50,finishing:40}};
 const result=calculate(input);
 assert.deepEqual([result.selectedPages,result.totalPhysicalSheets,result.paperCost,result.finalTotal],[2,5,250,790]);
 assert.throws(()=>calculate({...input,posterTiles:[1]}),/cover the selected pages/);
});

test('range, odd/even and reverse operate on actual page numbers',()=>{
 const result=calculate({...base,range:'1-7, 5, 10',filter:'odd',reverse:true});
 assert.deepEqual(result.selectedPageNumbers,[7,5,3,1]);assert.equal(result.selectedPages,4);assert.equal(result.logicalDocumentPages,10);
 assert.deepEqual(calculate({...base,filter:'even'}).selectedPageNumbers,[2,4,6,8,10]);
 assert.throws(()=>calculate({...base,range:'11'}));assert.throws(()=>calculate({...base,selectedPages:[1,1]}));
 assert.throws(()=>calculate({...base,selectedPages:[11]}));assert.throws(()=>calculate({...base,selectedPages:[]}));
 assert.throws(()=>calculate({...base,range:'2-1'}));assert.throws(()=>calculate({...base,range:'1.5'}));
 assert.throws(()=>calculate({...base,selectedPages:[1],range:'2'}));
});
test('duplex padding distinguishes whole blank sides and empty slots',()=>{
 const result=calculate({...base,pagesPerSide:2,duplex:'longEdge',copies:2});
 assert.equal(result.blankSides,2);assert.equal(result.paddingSlots,0);assert.equal(result.physicalSheetsPerCopy,3);
 const partial=calculate({documentPages:9,pagesPerSide:4,duplex:'longEdge'});
 assert.equal(partial.printedSides,3);assert.equal(partial.blankSides,1);assert.equal(partial.paddingSlots,3);
});
test('booklet eight-page left binding has exact front and back order',()=>{
 const result=calculate({documentPages:8,pagesPerSide:2,duplex:'shortEdge',imposition:'booklet'});
 assert.deepEqual(result.sides.map(side=>side.pages),[[8,1],[2,7],[6,3],[4,5]]);
 assert.equal(result.totalPhysicalSheets,2);assert.equal(result.paddingSlots,0);
});
test('booklet ten pages pads to twelve, right binding mirrors each side',()=>{
 const result=calculate({...base,pagesPerSide:2,duplex:'shortEdge',imposition:'booklet',binding:'right'});
 assert.deepEqual(result.sides.map(side=>side.pages),[[1,null],[null,2],[3,10],[9,4],[5,8],[7,6]]);
 assert.equal(result.totalPhysicalSheets,3);assert.equal(result.paddingSlots,2);
 assert.equal(calculate({documentPages:1,pagesPerSide:2,duplex:'longEdge',imposition:'booklet'}).blankSides,1);
 assert.throws(()=>calculate({...base,imposition:'booklet'}));
});
test('manual duplex has explicit two-pass accounting',()=>{
 const result=calculate({...base,duplex:'manualLongEdge'});
 assert.equal(result.totalPhysicalSheets,5);assert.equal(result.manualDuplex,true);assert.equal(result.passesPerCopy,2);
});
test('mixed colour is charged by imposed side, sheet, or logical page',()=>{
 const mixed={...base,pagesPerSide:2,duplex:'longEdge',mode:'mixed',colourPages:[2,3]};
 const side=calculate({...mixed,pricing:{...rate,basis:'side'}});
 assert.equal(side.colourSides,2);assert.equal(side.blackAndWhiteSides,3);assert.equal(side.blankSides,1);assert.equal(side.finalTotal,13000);
 // Pages 2 and 3 share the same physical sheet on different sides.
 const sheet=calculate(mixed);assert.equal(sheet.pricing.colourUnits,1);assert.equal(sheet.finalTotal,7000);
 const page=calculate({...mixed,pricing:{...rate,basis:'page'}});assert.equal(page.finalTotal,18000);
 const mono=calculate({...mixed,mode:'grayscale'});assert.equal(mono.colourSides,0);
});
test('uncertain selected colour results require confirmation or explicit policy',()=>{
 const result=calculate({...base,mode:'mixed',uncertainPages:[2]});assert.equal(result.needsConfirmation,true);assert.equal(result.colourSides,1);
 assert.equal(calculate({...base,mode:'mixed',uncertainPages:[2],uncertainPolicy:'mono'}).needsConfirmation,false);
 assert.equal(calculate({...base,mode:'mixed',uncertainPages:[2],range:'3-4'}).needsConfirmation,false);
 assert.throws(()=>calculate({...base,colourPages:[11]}));
});
test('paper formats do not silently change the pricing policy',()=>{
 for(const [paper,mm] of [['A3',[297,420]],['A4',[210,297]],['A6',[105,148]],['B5',[176,250]],['Letter',[215.9,279.4]],['Legal',[215.9,355.6]]]){
  const result=calculate({...base,paper});assert.deepEqual(result.paperMm,mm);assert.equal(result.finalTotal,10000);
 }
 assert.throws(()=>calculate({...base,paper:'Custom'}));
 assert.deepEqual(calculate({...base,paper:'Custom',customPaper:{widthMm:200,heightMm:300}}).paperMm,[200,300]);
});
test('tier prices, setup, finishing, discount and minimum use integer minor units',()=>{
 const result=calculate({...base,pricing:{...rate,tiers:[{from:10,mono:800,colour:4000},{from:100,mono:500,colour:3000}],setup:500,finishing:1000,discount:200,minimum:10000}});
 assert.equal(result.estimatedPrintingCost,8500);assert.equal(result.finishingCost,1000);assert.equal(result.pricing.minimumAdjustment,700);assert.equal(result.finalTotal,10000);
 assert.throws(()=>calculate({...base,pricing:{...rate,mono:10.5}}));
 assert.throws(()=>calculate({...base,pricing:{...rate,tiers:[{from:10,mono:1,colour:1},{from:10,mono:2,colour:2}]}}));
});
test('price override requires recorded reason',()=>{
 const result=calculate({...base,pricing:{...rate,override:{amount:5500,reason:'Agreed school discount'}}});
 assert.equal(result.finalTotal,5500);assert.equal(result.estimatedPrintingCost,10000);assert.equal(result.pricing.overrideReason,'Agreed school discount');
 assert.throws(()=>calculate({...base,pricing:{...rate,override:{amount:1,reason:' '}}}));
});
test('booklet and photo billable units are separate from paper usage',()=>{
 const booklet=calculate({...base,pagesPerSide:2,duplex:'shortEdge',imposition:'booklet',copies:2,pricing:{...rate,basis:'booklet'}});
 assert.equal(booklet.pricing.units,2);assert.equal(booklet.totalPhysicalSheets,6);
 assert.equal(calculate({documentPages:1,copies:8,pricing:{...rate,basis:'photo'}}).pricing.units,8);
 assert.throws(()=>calculate({...base,pricing:{...rate,basis:'photo'}}));
 assert.throws(()=>calculate({...base,pricing:{...rate,basis:'booklet'}}));
});
test('bulk independently rounds each file and preserves individual price',()=>{
 const files=[1,2,3,4,5].map(id=>({id:String(id),customer:'same',settings:{documentPages:1,pagesPerSide:4,duplex:'longEdge',pricing:rate}}));
 const result=calculateBulk(files);assert.equal(result.totalPhysicalSheets,5);assert.equal(result.finalTotal,5000);assert.equal(result.files[0].calculation.finalTotal,1000);
 assert.equal(calculateBulk([{id:'a',customer:'same',settings:base},{id:'b',customer:'same',settings:{...base,duplex:'longEdge',copies:2}}]).totalPhysicalSheets,20);
 assert.throws(()=>calculateBulk([...files,{...files[0],id:'different',customer:'other'}]));
 assert.throws(()=>calculateBulk([files[0],files[0]]));assert.throws(()=>calculateBulk([]));
});
test('selected pages and copies remain bounded and calculations do not mutate input',()=>{
 const input={...base,selectedPages:[4,1,3],reverse:true,pricing:{...rate,tiers:[{from:2,mono:400,colour:2000}]}};
 const before=JSON.stringify(input);calculate(input);assert.equal(JSON.stringify(input),before);
 for(const copies of [0,-1,1.5,NaN,Infinity,10001])assert.throws(()=>calculate({...base,copies}));
 assert.throws(()=>calculate({...base,documentPages:0}));assert.throws(()=>calculate({...base,pagesPerSide:65}));
});
test('sheet and side invariants hold across N-up, copies and duplex boundaries',()=>{
 for(let pages=1;pages<=65;pages++)for(const nup of [1,2,4,6,8,9,16])for(const duplex of ['simplex','longEdge','manualShortEdge']){
  const result=calculate({documentPages:pages,pagesPerSide:nup,duplex,copies:3});
  assert.equal(result.totalPhysicalSheets,Math.ceil(pages/(nup*(duplex==='simplex'?1:2)))*3);
  assert.equal(result.printedSides,Math.ceil(pages/nup)*3);
  assert.equal(result.colourSides+result.blackAndWhiteSides,result.printedSides);
  assert.equal(result.printedSides+result.blankSides,result.totalPhysicalSheets*(duplex==='simplex'?1:2));
  assert.deepEqual(result.sides.flatMap(side=>side.pages).filter(page=>page!==null),result.selectedPageNumbers);
 }
});

test('24 pages 4-up are billed by physical sheets for simplex and duplex',()=>{
 const policy={basis:'sheet',mono:1003,colour:5000};
 const simplex=calculate({documentPages:24,pagesPerSide:4,pricing:policy});
 const duplex=calculate({documentPages:24,pagesPerSide:4,duplex:'longEdge',pricing:policy});
 assert.equal(simplex.totalPhysicalSheets,6);assert.equal(simplex.finalTotal,6018);
 assert.equal(duplex.totalPhysicalSheets,3);assert.equal(duplex.finalTotal,3009);
});
