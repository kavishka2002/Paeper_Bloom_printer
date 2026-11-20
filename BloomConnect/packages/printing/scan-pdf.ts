import {deflateSync} from 'node:zlib';
import type {Raster} from './scan-image';

export function scannedPdf(pages:Raster[],layout:'a4'|'original',marginMm:number){
 if(!pages.length)throw new Error('Select at least one processed page.');
 const chunks:Buffer[]=[Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n','latin1')],offsets=[0];
 let length=chunks[0].length;
 function append(data:string|Buffer){
  const bytes=typeof data==='string'?Buffer.from(data,'ascii'):data;
  length+=bytes.length;
  if(length>32*1024*1024)throw new Error('The scanned PDF exceeds 32 MB. Export fewer pages at a time.');
  chunks.push(bytes);
 }
 function object(id:number,body:string,data?:Buffer){
  offsets[id]=length;
  append(id+' 0 obj\n'+body);
  if(data){append('\nstream\n');append(data);append('\nendstream')}
  append('\nendobj\n');
 }
 object(1,'<< /Type /Catalog /Pages 2 0 R >>');
 object(2,'<< /Type /Pages /Count '+pages.length+' /Kids ['+pages.map((_,i)=>(3+i*3)+' 0 R').join(' ')+'] >>');
 for(const [index,page] of pages.entries()){
  const id=3+index*3,ratio=page.width/page.height,landscape=ratio>1,margin=marginMm*72/25.4;
  const a4w=landscape?841.89:595.28,a4h=landscape?595.28:841.89;
  const width=layout==='a4'?a4w:Math.max(24,landscape?841.89:841.89*ratio)+2*margin;
  const height=layout==='a4'?a4h:Math.max(24,landscape?841.89/ratio:841.89)+2*margin;
  const scale=Math.min((width-2*margin)/page.width,(height-2*margin)/page.height);
  const w=page.width*scale,h=page.height*scale,x=(width-w)/2,y=(height-h)/2;
  object(id,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+width.toFixed(3)+' '+height.toFixed(3)+'] /Resources << /XObject << /Scan '+(id+1)+' 0 R >> >> /Contents '+(id+2)+' 0 R >>');
  const raster=deflateSync(page.data,{level:6});
  object(id+1,'<< /Type /XObject /Subtype /Image /Width '+page.width+' /Height '+page.height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length '+raster.length+' >>',raster);
  const commands=Buffer.from('q '+[w,0,0,h,x,y].map(value=>value.toFixed(3)).join(' ')+' cm /Scan Do Q');
  object(id+2,'<< /Length '+commands.length+' >>',commands);
 }
 const xref=length;
 append('xref\n0 '+offsets.length+'\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join(''));
 append('trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');
 return Buffer.concat(chunks,length);
}
