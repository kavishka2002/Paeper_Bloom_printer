import {clip,degrees,endPath,PDFDocument,popGraphicsState,pushGraphicsState,rectangle,rgb,StandardFonts} from 'pdf-lib';
import {zipSync} from 'fflate';
import {selectPages} from './layout';

export type StudioMark={kind:'text'|'highlight'|'whiteout'|'rectangle'|'image';text:string;x:number;y:number;size:number;angle:number;opacity:number;image?:Uint8Array};
export type StudioCrop={left:number;top:number;right:number;bottom:number};
export type StudioPage={source:number;page:number;turn:number;marks?:StudioMark[];crop?:StudioCrop};
export type StudioOutput={name:string;format:'pdf'|'zip'|'jpg'|'png'|'txt'|'docx';bytes:Uint8Array};
export type StudioImage={name:string;bytes:Uint8Array;pageSize?:[number,number]};
export type ImageSheet={width:number;height:number;margin:number;fill:boolean};

export function splitStudioPages(count:number,mode:string,value:string):number[][]{
  const pages=Array.from({length:count},(_,i)=>i);
  if(mode==='extract')return [selectPages(value,count).map(page=>page-1)];
  if(mode==='ranges'){
    if(!value.trim())throw new Error('Enter page ranges separated by semicolons.');
    return value.split(';').map(range=>{
      if(!range.trim())throw new Error('Each page range must contain at least one page.');
      return selectPages(range,count).map(page=>page-1);
    });
  }
  if(mode==='after'){
    if(!value.trim())throw new Error('Enter the pages after which the document should split.');
    const breaks=selectPages(value,count).filter(page=>page<count);
    return [...breaks,count].map((end,index)=>pages.slice(breaks[index-1]??0,end));
  }
  const size=mode==='every'?1:Number(value);
  if(!Number.isInteger(size)||size<1)throw new Error('Enter a whole number of pages per group.');
  return Array.from({length:Math.ceil(count/size)},(_,i)=>pages.slice(i*size,(i+1)*size));
}

export async function exportStudioPages(sources:Uint8Array[],groups:StudioPage[][],name:string):Promise<StudioOutput>{
  if(!groups.length||groups.some(group=>!group.length))throw new Error('Select at least one page to export.');
  const documents=await Promise.all(sources.map(bytes=>PDFDocument.load(bytes,{updateMetadata:false,throwOnInvalidObject:true})));
  const files:Record<string,Uint8Array>={};
  for(const [index,group] of groups.entries()){
    const output=await PDFDocument.create();
    const font=group.some(frame=>frame.marks?.some(mark=>mark.kind==='text'))?await output.embedFont(StandardFonts.Helvetica):undefined;
    const batches=new Map<number,{indices:number[];positions:number[]}>();
    for(const [position,frame] of group.entries()){
      const source=documents[frame.source];
      if(!source||frame.page<0||frame.page>=source.getPageCount())throw new Error('An output page is outside the source document.');
      const batch=batches.get(frame.source)??{indices:[],positions:[]};
      batch.indices.push(frame.page);batch.positions.push(position);batches.set(frame.source,batch);
    }
    const copied:Awaited<ReturnType<typeof output.copyPages>>=[];
    for(const [source,{indices,positions}] of batches){
      const pages=await output.copyPages(documents[source],indices);
      for(const [index,position] of positions.entries())copied[position]=pages[index];
    }
    for(const [position,frame] of group.entries()){
      const page=copied[position];
      if(frame.turn)page.setRotation(degrees((page.getRotation().angle+frame.turn+360)%360));
      const box=page.getCropBox();
      if(frame.crop){
        const {left,top,right,bottom}=frame.crop;
        if(left+right>=100||top+bottom>=100)throw new Error('Crop margins must leave some of the page visible.');
        page.setCropBox(box.x+box.width*left/100,box.y+box.height*bottom/100,box.width*(100-left-right)/100,box.height*(100-top-bottom)/100);
      }
      for(const mark of frame.marks??[]){
        const x=box.x+box.width*mark.x/100,y=box.y+box.height*(1-mark.y/100);
        if(mark.kind==='text'){
          try{page.drawText(mark.text,{font,x,y,size:mark.size,rotate:degrees(mark.angle),opacity:mark.opacity,color:rgb(0.12,0.15,0.2)})}
          catch{throw new Error('The built-in PDF font cannot encode this text. Use a PDF with compatible Latin text for this tool.')}
        }else if(mark.kind==='image'&&mark.image){
          const image=await output.embedPng(mark.image),height=mark.size*image.height/image.width;
          page.drawImage(image,{x,y:y-height,width:mark.size,height,opacity:mark.opacity,rotate:degrees(mark.angle)});
        }else{
          const fill=mark.kind==='highlight'?rgb(1,.85,.05):mark.kind==='whiteout'?rgb(1,1,1):undefined;
          page.drawRectangle({x,y:y-mark.size,width:mark.size*3,height:mark.size,color:fill,opacity:mark.opacity,
            borderColor:fill?undefined:rgb(.12,.15,.2),borderWidth:fill?0:2});
        }
      }
      output.addPage(page);
    }
    const bytes=await output.save();
    if(groups.length===1)return {name,bytes,format:'pdf'};
    files['part-'+String(index+1).padStart(String(groups.length).length,'0')+'.pdf']=bytes;
  }
  return {name,bytes:zipSync(files,{level:0}),format:'zip'};
}

export async function compressStudioPdf(bytes:Uint8Array,name:string):Promise<StudioOutput>{
  const doc=await PDFDocument.load(bytes,{updateMetadata:false,throwOnInvalidObject:true});
  const optimized=await doc.save({useObjectStreams:true,updateFieldAppearances:false});
  return {name,format:'pdf',bytes:optimized.length<bytes.length?optimized:bytes};
}

export async function studioImagesToPdf(images:StudioImage[],sheet:ImageSheet,name:string):Promise<StudioOutput>{
  if(!images.length)throw new Error('Add at least one image.');
  const {margin,fill}=sheet;
  const output=await PDFDocument.create();
  for(const {bytes,pageSize} of images){
    const [width,height]=pageSize??[sheet.width,sheet.height];
    if(width<=0||height<=0||margin<0||margin*2>=Math.min(width,height))throw new Error('Margins leave no room for the image.');
    const image=bytes[0]===137?await output.embedPng(bytes):await output.embedJpg(bytes);
    const page=output.addPage([width,height]);
    const areaWidth=width-2*margin,areaHeight=height-2*margin;
    const scale=(fill?Math.max:Math.min)(areaWidth/image.width,areaHeight/image.height);
    const w=image.width*scale,h=image.height*scale;
    if(fill)page.pushOperators(pushGraphicsState(),rectangle(margin,margin,areaWidth,areaHeight),clip(),endPath());
    page.drawImage(image,{x:(width-w)/2,y:(height-h)/2,width:w,height:h});
    if(fill)page.pushOperators(popGraphicsState());
  }
  return {name,format:'pdf',bytes:await output.save()};
}

export function packageStudioImages(images:StudioImage[],format:'jpg'|'png',name:string):StudioOutput{
  if(!images.length)throw new Error('Select pages to export.');
  if(images.length===1)return {name,format,bytes:images[0].bytes};
  return {name,format:'zip',bytes:zipSync(Object.fromEntries(images.map(image=>[image.name,image.bytes])),{level:0})};
}

export function packageStudioBatch(files:StudioImage[]):StudioOutput{
  if(!files.length)throw new Error('There are no completed files to export.');
  if(files.reduce((size,file)=>size+file.bytes.length,0)>140*1024*1024)throw new Error('Export fewer files to stay below the ZIP size limit.');
  return {name:'pdf-studio-batch',format:'zip',bytes:zipSync(Object.fromEntries(files.map((file,index)=>[
    String(index+1).padStart(String(files.length).length,'0')+'-'+file.name.replace(/[^\p{L}\p{N} ._-]/gu,'_'),file.bytes
  ])),{level:0})};
}
