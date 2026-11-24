import {duplexEdge} from './duplex';
import {calculatePrint} from './calculation';
import {normalizedSettings,type PrintSettings,type PrintSettingsInput} from './settings';
import {paperDimensions} from './paper';
export type PageInfo={widthMm:number;heightMm:number;blank:boolean;ink:'mono'|'grayscale'|'colour'|'uncertain';coverage:number};
export type DocumentInfo={id:string;mime:string;pages:PageInfo[]};
export type Box={x:number;y:number;width:number;height:number};
export function constrainPhotoFrame(start:Box,target:Box,area:Box,neighbors:Box[],gap:number):Box{
  const fits=(box:Box)=>box.x>=area.x-1e-5&&box.y>=area.y-1e-5&&box.x+box.width<=area.x+area.width+1e-5&&box.y+box.height<=area.y+area.height+1e-5
    &&neighbors.every(other=>box.x+box.width+gap<=other.x+1e-5||other.x+other.width+gap<=box.x+1e-5||box.y+box.height+gap<=other.y+1e-5||other.y+other.height+gap<=box.y+1e-5);
  if(fits(target))return target;
  let low=0,high=1,best=start;
  for(let i=0;i<24;i++){
    const t=(low+high)/2;
    const candidate={x:start.x+(target.x-start.x)*t,y:start.y+(target.y-start.y)*t,width:start.width+(target.width-start.width)*t,height:start.height+(target.height-start.height)*t};
    if(fits(candidate)){low=t;best=candidate}else high=t;
  }
  return best;
}
export type Placement={copy?:number;edit?:PrintSettings['photoItems'][string];file?:string;fit?:'contain'|'cover';page:number;box:Box;rotation:number;colour:boolean;cutBox?:Box;poster?:{x:number;y:number;scale:number}};
export type PlannedSide={file:string;width:number;height:number;placements:Placement[];ink:'mono'|'colour'|'blank';back:boolean;turn:boolean;label?:string;marks:boolean;photo:boolean;notes?:Box[]};
export type DocumentPlan={sides:PlannedSide[];selected:number[];settings:PrintSettings;needsConfirmation:boolean;photoCount:number;logicalPages:number};
export function reorderPhotoFrames(positions:NonNullable<PrintSettingsInput['photoPositions']>,copies:{file:string;copy:number}[]){
  if(positions.length!==copies.length)throw new Error('The print order must include every photo copy.');
  const slots=[...positions].sort((a,b)=>a.sheet-b.sheet||a.y-b.y||a.x-b.x);
  return slots.map((slot,index)=>({...slot,...copies[index]}));
}

export function analysePixels(data:Uint8ClampedArray,colourTolerance=12,meaningfulCoverage=.001):Omit<PageInfo,'widthMm'|'heightMm'>{
  if(!data.length||data.length%4)throw new Error('Invalid page analysis pixels.');
  let coloured=0,grey=0,nonwhite=0;
  for(let i=0;i<data.length;i+=4){
    const alpha=data[i+3]/255,r=data[i]*alpha+255*(1-alpha),g=data[i+1]*alpha+255*(1-alpha),b=data[i+2]*alpha+255*(1-alpha);
    if(Math.min(r,g,b)<245)nonwhite++;
    if(Math.max(r,g,b)-Math.min(r,g,b)>colourTolerance&&Math.min(r,g,b)<245)coloured++;
    else if(Math.min(r,g,b)>25&&Math.max(r,g,b)<235)grey++;
  }
  const coverage=coloured/(data.length/4);
  return {blank:nonwhite===0,ink:coloured>=8&&coverage>=meaningfulCoverage?'colour':coloured>2?'uncertain':grey/(data.length/4)>.02?'grayscale':'mono',coverage};
}
export function selectedPages(s:PrintSettings,doc:DocumentInfo){
  const range=s.pageMode==='current'?String(s.currentPage):s.range;
  let selected=calculatePrint({documentPages:doc.pages.length,range,filter:s.pageFilter,reverse:s.reverse}).selectedPageNumbers;
  if(s.skipBlank)selected=selected.filter(page=>!doc.pages[page-1].blank);
  if(!selected.length)throw new Error('The selected range contains no pages after filtering.');
  return selected;
}
export function orientedPaper(s:PrintSettings,first?:PageInfo):[number,number]{
  const original=paperDimensions(s.paper,s.customPaper);
  if(s.booklet||s.orientation==='landscape'||s.orientation==='auto'&&first&&first.widthMm>first.heightMm)return [Math.max(...original),Math.min(...original)];
  if(s.orientation==='portrait'||s.orientation==='auto')return [Math.min(...original),Math.max(...original)];
  return s.landscape?[original[1],original[0]]:original;
}
export function contentBox(s:PrintSettings,width:number,height:number):Box{
  const margin=s.margins??{left:s.marginMm,right:s.marginMm,top:s.marginMm,bottom:s.marginMm};
  const hardware=s.scaling==='printable'?s.printable:undefined;
  if(s.scaling==='printable'&&!hardware)throw new Error('Select a printer and retrieve its printable area, or use explicit margins for PDF export.');
  let left=Math.max(margin.left,hardware?.left??0),right=Math.max(margin.right,hardware?.right??0);
  const top=Math.max(margin.top,hardware?.top??0),bottom=Math.max(margin.bottom,hardware?.bottom??0);
  if(!s.booklet){if(s.binding==='left')left+=s.gutterMm;else right+=s.gutterMm}
  const box={x:left,y:top,width:width-left-right,height:height-top-bottom};
  if(box.width<=0||box.height<=0)throw new Error('Margins leave no printable area.');
  return box;
}
export function gridShape(s:Pick<PrintSettings,'nup'|'booklet'|'grid'>,width:number,height:number):[number,number]{
  if(s.booklet)return [2,1];
  if(s.grid)return [s.grid.columns,s.grid.rows];
  const defaults:Record<number,[number,number]>={1:[1,1],2:[1,2],4:[2,2],6:[2,3],8:[2,4],9:[3,3],16:[4,4]};
  let grid=defaults[s.nup]??[Math.ceil(Math.sqrt(s.nup)),Math.ceil(s.nup/Math.ceil(Math.sqrt(s.nup)))] as [number,number];
  if(width>height)grid=[grid[1],grid[0]];return grid;
}
export function cellBox(index:number,columns:number,rows:number,area:Box,gap:number,order:PrintSettings['order']):Box{
  let col=index%columns,row=Math.floor(index/columns);
  if(order==='vertical'){col=Math.floor(index/rows);row=index%rows}
  if(order==='rightToLeft')col=columns-1-col;
  if(order==='bottomToTop')row=rows-1-row;
  const width=(area.width-gap*(columns-1))/columns,height=(area.height-gap*(rows-1))/rows;
  if(width<=0||height<=0)throw new Error('Spacing leaves no area for page cells.');
  return {x:area.x+col*(width+gap),y:area.y+row*(height+gap),width,height};
}
export function placementGeometry(sourceWidth:number,sourceHeight:number,cell:Box,s:PrintSettings){
  let rotate=s.rotation;
  let w=rotate%180?sourceHeight:sourceWidth,h=rotate%180?sourceWidth:sourceHeight;
  if(s.autoRotate&&Math.min(cell.width/h,cell.height/w)>Math.min(cell.width/w,cell.height/h)){rotate=(rotate+90)%360;[w,h]=[h,w]}
  const fit=Math.min(cell.width/w,cell.height/h);
  const scale=s.scaling==='actual'?1:s.scaling==='shrink'?Math.min(1,fit):s.scaling==='percent'?s.scalePercent/100:s.scaling==='fill'?Math.max(cell.width/w,cell.height/h):fit;
  const width=s.scaling==='stretch'?cell.width:w*scale,height=s.scaling==='stretch'?cell.height:h*scale;
  return {rotation:rotate,box:{x:cell.x+(s.center?(cell.width-width)/2:0),y:cell.y+(s.center?(cell.height-height)/2:0),width,height}};
}
export function photoPlacementGeometry(source:PageInfo,placement:Placement,settings:PrintSettings){
  const crop=placement.edit?.crop;
  const local={...settings,rotation:placement.rotation,scaling:placement.fit==='cover'||settings.layout==='passport'?'fill' as const:'fit' as const,autoRotate:!!settings.photoGrid&&settings.autoRotate};
  const geometry=placementGeometry(source.widthMm*(crop?.width??1),source.heightMm*(crop?.height??1),placement.box,local);
  const zoom=placement.edit?.zoom??1;
  if(zoom!==1){
    geometry.box.width*=zoom;geometry.box.height*=zoom;
    geometry.box.x=placement.box.x+(placement.box.width-geometry.box.width)/2;geometry.box.y=placement.box.y+(placement.box.height-geometry.box.height)/2;
  }
  return geometry;
}
export function tightPhotoFrame(source:PageInfo,placement:Placement,settings:PrintSettings){
  const {box:image,rotation}=photoPlacementGeometry(source,placement,settings);
  const frame=placement.cutBox??placement.box;
  if(placement.fit==='cover'||settings.layout==='passport'||(placement.edit?.zoom??1)!==1||image.width<1||image.height<1)return {...frame,rotation};
  const borderX=(frame.width-placement.box.width)/2,borderY=(frame.height-placement.box.height)/2;
  return {x:image.x-borderX,y:image.y-borderY,width:image.width+2*borderX,height:image.height+2*borderY,rotation};
}
export function planDocument(raw:PrintSettingsInput,doc:DocumentInfo):DocumentPlan{
  const s=normalizedSettings(raw),selected=selectedPages(s,doc),[width,height]=orientedPaper(s,doc.pages[selected[0]-1]);
  if(width*height*(s.renderDpi/25.4)**2>20000000)throw new Error('This paper and raster DPI exceed the safe 20 megapixel limit. Choose a lower rendering DPI.');
  const area=contentBox(s,width,height),isPhoto=doc.mime.startsWith('image/');
  if(s.documentFrame&&isPhoto)throw new Error('Use Bulk Photo Studio for exact photo dimensions.');
  const frame=s.documentFrame;
  if(frame&&(frame.widthMm>area.width+.00001||frame.heightMm>area.height+.00001))throw new Error('The requested PDF frame exceeds the available paper area. Reduce its dimensions or margins.');
  const explicitColour=s.colourRange.trim()?new Set(calculatePrint({documentPages:doc.pages.length,range:s.colourRange}).selectedPageNumbers):undefined;
  const ink=s.ink==='legacy'?(s.colour?'colour':'mono'):s.ink;
  const colour=(page:number)=>ink==='colour'||((ink==='auto'||ink==='mixed')&&(explicitColour?explicitColour.has(page):['colour','uncertain'].includes(doc.pages[page-1].ink)));
  const needsConfirmation=(ink==='auto'||ink==='mixed')&&!explicitColour&&!s.analysisConfirmed&&selected.some(page=>doc.pages[page-1].ink==='uncertain');
  const sides:PlannedSide[]=[];
  const add=(placements:Placement[],label?:string,photo=false)=>{
    const back=s.duplex!=='simplex'&&sides.length%2===1;
    sides.push({file:doc.id,width,height,placements,ink:placements.length?placements.some(p=>p.colour)?'colour':'mono':'blank',back,turn:s.booklet&&back&&duplexEdge(s.duplex,width>height)==='long',label,marks:!!s.poster?.marks||!!s.photo?.cutGuides,photo});
  };
  let photoCount=0;
  if(isPhoto){
    if(s.booklet||s.poster?.enabled||s.handoutNotes)throw new Error('Booklet, handout and poster modes require a document.');
    const requested=s.photo;
    const pw=requested?.widthMm??(s.layout==='passport'?35:area.width/(s.layout==='four'?2:1));
    const ph=requested?.heightMm??(s.layout==='passport'?45:area.height/(s.layout==='single'?1:s.layout==='four'?2:3));
    const quantity=requested?.quantity??(s.layout==='four'?4:s.layout==='passport'?6:1);photoCount=quantity;
    let w=pw,h=ph,columns=Math.floor((area.width+s.gapMm)/(w+s.gapMm)),rows=Math.floor((area.height+s.gapMm)/(h+s.gapMm)),rotation=s.rotation;
    if(s.autoRotate){const nc=Math.floor((area.width+s.gapMm)/(h+s.gapMm)),nr=Math.floor((area.height+s.gapMm)/(w+s.gapMm));if(nc*nr>columns*rows){[w,h]=[h,w];columns=nc;rows=nr;rotation=(rotation+90)%360}}
    if(!columns||!rows)throw new Error('The requested photo does not fit the paper and margins.');
    const border=s.photo?.whiteBorderMm??0;
    if(border*2>=Math.min(w,h))throw new Error('Photo border leaves no image area.');
    const capacity=columns*rows;
    for(let start=0;start<quantity;start+=capacity){
      add(Array.from({length:Math.min(capacity,quantity-start)},(_,i)=>({page:1,colour:colour(1),rotation,cutBox:{x:area.x+(i%columns)*(w+s.gapMm),y:area.y+Math.floor(i/columns)*(h+s.gapMm),width:w,height:h},box:{x:area.x+(i%columns)*(w+s.gapMm)+border,y:area.y+Math.floor(i/columns)*(h+s.gapMm)+border,width:w-2*border,height:h-2*border}})),undefined,true);
    }
  }else if(s.poster?.enabled){
    const overlap=s.poster.overlapMm;
    if(overlap>=Math.min(area.width,area.height))throw new Error('Poster overlap must be smaller than the tile printable area.');
    for(const page of selected){
      const source=doc.pages[page-1],scale=s.poster.scale/100;
      const w=(s.rotation%180?source.heightMm:source.widthMm)*scale,h=(s.rotation%180?source.widthMm:source.heightMm)*scale;
      const columns=Math.max(1,Math.ceil((w-overlap)/(area.width-overlap))),rows=Math.max(1,Math.ceil((h-overlap)/(area.height-overlap)));
      if(columns*rows>200)throw new Error('Poster exceeds the 200-side safety limit.');
      for(let row=0;row<rows;row++)for(let col=0;col<columns;col++)add([{page,box:area,rotation:s.rotation,colour:colour(page),poster:{x:col*(area.width-overlap),y:row*(area.height-overlap),scale}}],s.poster.labels?`Page ${page} - tile ${row+1}/${rows}, ${col+1}/${columns}`:undefined);
    }
  }else{
    const calculation=calculatePrint({documentPages:doc.pages.length,selectedPages:selected,pagesPerSide:s.nup,duplex:s.duplex,imposition:s.booklet?'booklet':'ordinary',binding:s.binding,signaturePages:s.signaturePages});
    const [columns,rows]=gridShape(s,width,height);
    for(const [sideIndex,side] of calculation.sides.entries()){
      const placements:Placement[]=[];
      const notes:Box[]=[];
      const sheetIndex=Math.floor(sideIndex/2);
      const creep=s.booklet?s.bookletCreepMm*(s.signaturePages?sheetIndex%(s.signaturePages/4):sheetIndex):0;
      for(let i=0;i<side.pages.length;i++){
        const page=side.pages[i];if(page===null)continue;
        const box=s.handoutNotes?cellBox(i*2,2,3,area,s.gapMm,'horizontal'):frame?{x:area.x+(s.center?(area.width-frame.widthMm)/2:0),y:area.y+(s.center?(area.height-frame.heightMm)/2:0),width:frame.widthMm,height:frame.heightMm}:cellBox(i,columns,rows,area,s.gapMm,s.order);
        if(s.handoutNotes)notes.push(cellBox(i*2+1,2,3,area,s.gapMm,'horizontal'));
        if(s.booklet&&s.gutterMm){if(i===0)box.width-=s.gutterMm;else{box.x+=s.gutterMm;box.width-=s.gutterMm}if(box.width<=0)throw new Error('Booklet gutter exceeds the page cell.')}
        if(creep){if(i===0)box.x+=creep;box.width-=creep;if(box.width<=0)throw new Error('Creep exceeds the available booklet cell.')}
        placements.push({page,box,rotation:s.rotation,colour:colour(page)});
      }
      add(placements);
      if(notes.length)sides[sides.length-1].notes=notes;
    }
  }
  if(s.duplex!=='simplex'&&sides.length%2)add([]);
  if(sides.length*s.copies>200)throw new Error('The job exceeds the 200-side safety limit including copies.');
  return {sides,selected,settings:s,needsConfirmation,photoCount,logicalPages:doc.pages.length};
}
/** Repeat complete sheet pairs for uncollated duplex; never pair fronts from different copies. */
export function expandCopies<T>(sides:T[],copies:number,collate:boolean,duplex:boolean):T[]{
  if(collate)return Array.from({length:copies},()=>sides).flat();
  const result:T[]=[];const group=duplex?2:1;
  for(let i=0;i<sides.length;i+=group)for(let copy=0;copy<copies;copy++)result.push(...sides.slice(i,i+group));
  return result;
}
export function plannedOutput(plan:DocumentPlan){
  let sides=expandCopies(plan.sides,plan.settings.copies,plan.settings.collate,plan.settings.duplex!=='simplex');
  if(plan.settings.sideSelection!=='all')sides=sides.filter(side=>plan.settings.sideSelection==='back'?side.back:!side.back);
  return sides;
}

/** Guillotine packing in millimetres. Input order is stable; originals are never changed. */
export function planPhotos(raw:PrintSettingsInput,docs:DocumentInfo[]):DocumentPlan{
 const s=normalizedSettings(raw);
 if(new Set(docs.map(d=>d.id)).size!==docs.length)throw new Error('Select each photograph once.');
 if(!docs.length||docs.some(d=>!d.mime.startsWith('image/')))throw new Error('Select supported photos.');
 if(s.booklet||s.poster?.enabled)throw new Error('Bulk photo sheets cannot use booklet or poster mode.');
 if(!s.photoGrid&&s.photoArrangement==='grid'){const sizes=docs.map(d=>s.photoItems[d.id]).filter(Boolean);if(sizes.some(i=>i.widthMm!==sizes[0].widthMm||i.heightMm!==sizes[0].heightMm))throw new Error('Grid layout requires matching photo sizes. Choose mixed auto arrangement for different sizes.')}
 const [width,height]=orientedPaper(s),area=contentBox({...s,scaling:s.printable?'printable':s.scaling},width,height);
 if(width*height*(s.renderDpi/25.4)**2>20000000)throw new Error('Photo sheet exceeds safe raster size. Lower DPI.');
 const sheets:{side:PlannedSide;free:Box[]}[]= [];let photoCount=0;
 const newSide=():PlannedSide=>({file:docs[0].id,width,height,placements:[],ink:'blank',back:false,turn:false,photo:true,marks:!!s.photo?.cutGuides});
 const positions=s.photoArrangement==='manual'&&!s.photoGrid?s.photoPositions:undefined;
 const framed=!!positions?.length&&positions.every(position=>position.frame);
 const positionByCopy=new Map(positions?.map(position=>[position.file+':'+position.copy,position]));
 const addPhoto=(side:PlannedSide,box:Box,doc:DocumentInfo,item:{fit:'contain'|'cover';rotation:number},copy:number,turn=false)=>{
   const border=s.photo?.whiteBorderMm??0,edit=s.photoItems[doc.id];
   if(border*2>=Math.min(box.width,box.height))throw new Error('White border leaves no image area.');
   const ink=edit?.ink??'inherit';
   const colour=ink==='colour'||ink==='original'||ink==='sepia'||(ink==='auto'?(edit?.detectedColour??true):ink==='inherit'&&s.ink!=='mono'&&s.ink!=='grayscale'&&s.colour);
   side.placements.push({copy,edit,file:doc.id,page:1,fit:item.fit,colour,rotation:(item.rotation+(turn?90:0))%360,cutBox:{...box},box:{x:box.x+border,y:box.y+border,width:box.width-border*2,height:box.height-border*2}});
 };
 const manualSide=(position:NonNullable<typeof positions>[number],box:Box)=>{
   if(box.x<area.x-.00001||box.y<area.y-.00001||box.x+box.width>area.x+area.width+.00001||box.y+box.height>area.y+area.height+.00001)throw new Error('Photo frame exceeds the printable area.');
   while(sheets.length<=position.sheet)sheets.push({side:newSide(),free:[]});
   const side=sheets[position.sheet].side;
   if(side.placements.some(({cutBox:b})=>b&&!(box.x+box.width+s.gapMm<=b.x+.00001||b.x+b.width+s.gapMm<=box.x+.00001||box.y+box.height+s.gapMm<=b.y+.00001||b.y+b.height+s.gapMm<=box.y+.00001)))throw new Error('Photo frames overlap or do not leave the requested spacing.');
   return side;
 };
 for(const doc of docs){
  const item=s.photoItems[doc.id]??{widthMm:s.photo?.widthMm??101.6,heightMm:s.photo?.heightMm??152.4,quantity:s.photo?.quantity??1,rotation:s.rotation,fit:s.fit};
  for(let copy=0;copy<item.quantity;copy++){
   photoCount++;if(photoCount>1000)throw new Error('Select at most 1000 photo prints.');
   if(framed){
    const position=positionByCopy.get(doc.id+':'+copy);
    if(!position?.frame)throw new Error('A manual photo frame is missing.');
    const box={x:position.x,y:position.y,width:position.frame.width,height:position.frame.height};
    addPhoto(manualSide(position,box),box,doc,{fit:item.fit,rotation:position.frame.rotation},copy);
    continue;
   }
   if(s.photoGrid){
    const {columns,rows,capacity}=s.photoGrid;
    const slot=(photoCount-1)%Math.min(capacity??rows*columns,rows*columns);
    if(slot===0)sheets.push({side:newSide(),free:[]});
    addPhoto(sheets[sheets.length-1].side,cellBox(slot,columns,rows,area,s.gapMm,s.order),doc,item,copy);
    continue;
   }
   let choice:{sheet:number;index:number;w:number;h:number;turn:boolean;score:number}|undefined;
   const search=()=>{for(let n=0;n<sheets.length;n++)for(let i=0;i<sheets[n].free.length;i++)for(const turn of s.autoRotate&&s.photoArrangement!=='grid'?[false,true]:[false]){
    if(s.photoMaxPerSheet&&sheets[n].side.placements.length>=s.photoMaxPerSheet)continue;
    const box=sheets[n].free[i],w=turn?item.heightMm:item.widthMm,h=turn?item.widthMm:item.heightMm;
    if(w<=box.width+.00001&&h<=box.height+.00001){const score=s.photoArrangement==='rows'?box.y*width+box.x:s.photoArrangement==='columns'?box.x*height+box.y:box.width*box.height-w*h;if(!choice||score<choice.score)choice={sheet:n,index:i,w,h,turn,score}}
   }};search();
   if(!choice){sheets.push({side:newSide(),free:[{...area}]});search()}
   if(!choice)throw new Error('Photo '+doc.id+' does not fit the selected paper and margins. Choose a smaller size or larger paper.');
   const c=choice as {sheet:number;index:number;w:number;h:number;turn:boolean;score:number},sheet=sheets[c.sheet],box=sheet.free.splice(c.index,1)[0];
   addPhoto(sheet.side,{x:box.x,y:box.y,width:c.w,height:c.h},doc,item,copy,c.turn);
   const right=box.width-c.w-s.gapMm,bottom=box.height-c.h-s.gapMm;
   if(right>0)sheet.free.push({x:box.x+c.w+s.gapMm,y:box.y,width:right,height:s.photoArrangement==='columns'?box.height:c.h});
   if(bottom>0)sheet.free.push({x:box.x,y:box.y+c.h+s.gapMm,width:s.photoArrangement==='columns'?c.w:box.width,height:bottom});
   if(sheets.length*s.copies>200)throw new Error('Photo job exceeds 200 sheets.');
  }
 }
 if(framed&&positions!.length!==photoCount)throw new Error('Manual layout requires one frame per requested photo copy.');
 if(!framed&&!s.photoGrid&&s.photoArrangement==='manual'){
  const positions=s.photoPositions;
  if(!positions||positions.length!==photoCount||new Set(positions.map(p=>p.file+':'+p.copy)).size!==photoCount)throw new Error('Manual layout requires one position for each requested photo copy. Use Auto Arrange to reset.');
  const placements=sheets.flatMap(sheet=>sheet.side.placements),manual:typeof sheets=[];
  for(const p of placements){
   const position=positions.find(v=>v.file===p.file&&v.copy===p.copy);if(!position)throw new Error('A manual photo position is missing.');
   const frame=p.cutBox!,dx=position.x-frame.x,dy=position.y-frame.y;
   const next={...p,cutBox:{...frame,x:position.x,y:position.y},box:{...p.box,x:p.box.x+dx,y:p.box.y+dy}};
   const box=next.cutBox;
   if(box.x<area.x-.00001||box.y<area.y-.00001||box.x+box.width>area.x+area.width+.00001||box.y+box.height>area.y+area.height+.00001)throw new Error('Manual photo position exceeds the printable area.');
   while(manual.length<=position.sheet)manual.push({side:{...sheets[0].side,placements:[]},free:[]});
   for(const other of manual[position.sheet].side.placements){const b=other.cutBox!;if(!(box.x+box.width+s.gapMm<=b.x+.00001||b.x+b.width+s.gapMm<=box.x+.00001||box.y+box.height+s.gapMm<=b.y+.00001||b.y+b.height+s.gapMm<=box.y+.00001))throw new Error('Manual photos overlap or do not preserve the requested spacing.')}
   manual[position.sheet].side.placements.push(next);
  }
  sheets.splice(0,sheets.length,...manual);
 }
 if(s.duplex!=='simplex'&&sheets.length%2)sheets.push({side:newSide(),free:[]});
 if(sheets.length*s.copies>200)throw new Error('Photo layout exceeds 200 physical sides including copies.');
 return {sides:sheets.map(({side},index)=>({...side,back:s.duplex!=='simplex'&&index%2===1,ink:!side.placements.length?'blank' as const:side.placements.some(p=>p.colour)?'colour' as const:'mono' as const})),selected:[1],settings:s,needsConfirmation:false,photoCount,logicalPages:docs.length};
}
