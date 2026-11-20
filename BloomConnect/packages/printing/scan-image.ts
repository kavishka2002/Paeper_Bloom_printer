import {fullScanCorners,type ScanPoint,type ScanSettings} from '../shared/scan';

export type Raster={data:Uint8Array;width:number;height:number};
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
const luminance=(data:Uint8Array,i:number)=>(77*data[i]+150*data[i+1]+29*data[i+2])>>8;
const distance=(a:ScanPoint,b:ScanPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
const area=(points:ScanPoint[])=>points.reduce((sum,p,i)=>{const q=points[(i+1)%4];return sum+p.x*q.y-p.y*q.x},0)/2;

export function validateScanCorners(points:ScanPoint[]){
 if(points.length!==4||area(points)<.015||points.some((p,i)=>{
  const q=points[(i+1)%4],r=points[(i+2)%4];
  return (q.x-p.x)*(r.y-q.y)-(q.y-p.y)*(r.x-q.x)<=0;
 }))throw new Error('Place the four corners clockwise from top left around the entire document.');
}

export function detectDocument({data,width,height}:Raster){
 const count=width*height,light=new Uint8Array(count),hist=new Uint32Array(256);
 let all=0;
 for(let i=0;i<count;i++){const value=luminance(data,i*3);light[i]=value;hist[value]++;all+=value}
 let threshold=0,priorCount=0,priorSum=0,best=0;
 for(let value=0;value<255;value++){
  priorCount+=hist[value];priorSum+=hist[value]*value;
  if(!priorCount||priorCount===count)continue;
  const diff=priorSum/priorCount-(all-priorSum)/(count-priorCount),score=priorCount*(count-priorCount)*diff*diff;
  if(score>best){best=score;threshold=value}
 }
 // A bright connected sheet must account for most of its quadrilateral and have visible edges.
 const visited=new Uint8Array(count),queue=new Int32Array(count);
 let bestSize=0,bestQuad:ScanPoint[]=[];
 const cutoff=Math.max(86,threshold+8);
 for(let start=0;start<count;start++){
  if(visited[start]||light[start]<cutoff)continue;
  queue[0]=start;visited[start]=1;
  let cursor=0,end=1;
  const scores=[Infinity,Infinity,Infinity,Infinity],quad:ScanPoint[]=[];
  while(cursor<end){
   const i=queue[cursor++],x=i%width,y=Math.floor(i/width);
   const values=[x+y,y-x,-x-y,x-y];
   for(let k=0;k<4;k++)if(values[k]<scores[k]){scores[k]=values[k];quad[k]={x:x/(width-1),y:y/(height-1)}}
   const visit=(j:number)=>{if(!visited[j]&&light[j]>=cutoff){visited[j]=1;queue[end++]=j}};
   if(x>0)visit(i-1);if(x+1<width)visit(i+1);if(y>0)visit(i-width);if(y+1<height)visit(i+width);
  }
  if(end>bestSize){bestSize=end;bestQuad=quad}
 }
 const fallback={corners:fullScanCorners,detected:false};
 if(bestQuad.length!==4)return fallback;
 const footprint=area(bestQuad),coverage=bestSize/(count*footprint);
 if(footprint<.17||footprint>.92||coverage<.63||coverage>1.25||
  bestQuad.some(p=>p.x<.012||p.x>.988||p.y<.012||p.y>.988))return fallback;
 try{validateScanCorners(bestQuad)}catch{return fallback}
 const lightAt=(x:number,y:number)=>light[Math.round(clamp(y,0,1)*(height-1))*width+Math.round(clamp(x,0,1)*(width-1))];
 for(let edge=0;edge<4;edge++){
  const a=bestQuad[edge],b=bestQuad[(edge+1)%4],length=distance(a,b),nx=(a.y-b.y)*.025/length,ny=(b.x-a.x)*.025/length;
  let evident=0;
  for(let i=1;i<=9;i++){
   const x=a.x+(b.x-a.x)*i/10,y=a.y+(b.y-a.y)*i/10;
   if(lightAt(x+nx,y+ny)-lightAt(x-nx,y-ny)>12)evident++;
  }
  if(evident<5)return fallback;
 }
 // Expand the boundary slightly so that text close to the paper edge remains visible.
 const center=bestQuad.reduce((a,p)=>({x:a.x+p.x/4,y:a.y+p.y/4}),{x:0,y:0});
 return {detected:true,corners:bestQuad.map(p=>({x:clamp(center.x+(p.x-center.x)*1.045,0,1),y:clamp(center.y+(p.y-center.y)*1.045,0,1)}))};
}

export function rectifyDocument(raster:Raster,points:ScanPoint[],maxEdge:number,maxPixels:number){
 validateScanCorners(points);
 const [a,b,c,d]=points.map(p=>({x:p.x*(raster.width-1),y:p.y*(raster.height-1)}));
 const w=Math.max(distance(a,b),distance(d,c))+1,h=Math.max(distance(a,d),distance(b,c))+1;
 const scale=Math.min(1,maxEdge/Math.max(w,h),Math.sqrt(maxPixels/(w*h)));
 const width=Math.max(2,Math.round(w*scale)),height=Math.max(2,Math.round(h*scale)),data=new Uint8Array(width*height*3);
 const dx1=b.x-c.x,dx2=d.x-c.x,dx3=a.x-b.x+c.x-d.x;
 const dy1=b.y-c.y,dy2=d.y-c.y,dy3=a.y-b.y+c.y-d.y,det=dx1*dy2-dx2*dy1;
 if(Math.abs(det)<1e-7)throw new Error('The selected page corners are too narrow.');
 const g=(dx3*dy2-dx2*dy3)/det,k=(dx1*dy3-dx3*dy1)/det;
 const ax=b.x-a.x+g*b.x,bx=d.x-a.x+k*d.x,ay=b.y-a.y+g*b.y,by=d.y-a.y+k*d.y;
 for(let y=0;y<height;y++){
  const v=y/(height-1);
  for(let x=0;x<width;x++){
   const u=x/(width-1),den=1+g*u+k*v;
   const sx=clamp((ax*u+bx*v+a.x)/den,0,raster.width-1),sy=clamp((ay*u+by*v+a.y)/den,0,raster.height-1);
   const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(x0+1,raster.width-1),y1=Math.min(y0+1,raster.height-1),fx=sx-x0,fy=sy-y0;
   const top=(y0*raster.width+x0)*3,bottom=(y1*raster.width+x0)*3,step=(x1-x0)*3,dest=(y*width+x)*3;
   for(let ch=0;ch<3;ch++)data[dest+ch]=Math.round((raster.data[top+ch]*(1-fx)+raster.data[top+step+ch]*fx)*(1-fy)+(raster.data[bottom+ch]*(1-fx)+raster.data[bottom+step+ch]*fx)*fy);
  }
 }
 return {data,width,height,limited:scale<.999};
}

export function scanDetailScore({data,width,height}:Raster){
 let energy=0,edges=0;
 for(let y=Math.max(1,Math.floor(height*.06));y<height*.94-1;y+=2)for(let x=Math.max(1,Math.floor(width*.06));x<width*.94-1;x+=2){
  const i=(y*width+x)*3,level=luminance(data,i);
  const right=luminance(data,i+3),down=luminance(data,i+width*3);
  if(Math.max(Math.abs(level-right),Math.abs(level-down))<5)continue;
  const lap=4*level-luminance(data,i-3)-right-luminance(data,i-width*3)-down;
  energy+=lap*lap;edges++;
 }
 return edges?energy/edges:0;
}
export function estimateTextSkew({data,width,height}:Raster){
 const edges:{x:number;y:number}[]=[];
 for(let y=Math.max(2,Math.floor(height*.12));y<height*.88-2;y+=2){
  for(let x=Math.max(2,Math.floor(width*.12));x<width*.88-2;x+=2){
   const i=(y*width+x)*3,vertical=Math.abs(luminance(data,i-width*3)-luminance(data,i+width*3));
   const horizontal=Math.abs(luminance(data,i-3)-luminance(data,i+3));
   if(vertical>=24&&vertical>horizontal*1.4)edges.push({x:x-width/2,y});
  }
 }
 if(edges.length<65)return 0;
 const bins=new Uint16Array(height+width);
 function weight(angle:number){
  bins.fill(0);const slope=Math.tan(angle*Math.PI/180);
  for(const p of edges)bins[Math.round(p.y-p.x*slope)+Math.floor(width/2)]++;
  return bins.reduce((sum,count)=>sum+count*count,0);
 }
 const base=weight(0);
 let best=base,angle=0;
 for(let candidate=-9;candidate<=9;candidate++){
  const score=weight(candidate);
  if(score>best){best=score;angle=candidate}
 }
 return best>base*1.2&&Math.abs(angle)<9?-angle:0;
}

export function cleanDocument(raster:Raster,s:ScanSettings){
 const {data,width,height}=raster;
 const cols=Math.max(2,Math.ceil(width/112)),rows=Math.max(2,Math.ceil(height/112));
 const backgrounds=new Float32Array(rows*cols*3);
 let brightest=0,globalRed=0,globalGreen=0,globalBlue=0;
 for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
  const x0=Math.floor(col*width/cols),x1=Math.ceil((col+1)*width/cols),y0=Math.floor(row*height/rows),y1=Math.ceil((row+1)*height/rows);
  const histogram=new Uint16Array(256);
  let samples=0;
  for(let y=y0;y<y1;y+=3)for(let x=x0;x<x1;x+=3){histogram[luminance(data,(y*width+x)*3)]++;samples++}
  let threshold=255,upper=255,found=histogram[255];
  while(upper>0&&found<samples*.20)found+=histogram[--upper];
  threshold=upper;
  while(threshold>0&&found<samples*.45)found+=histogram[--threshold];
  let red=0,green=0,blue=0,count=0;
  for(let y=y0;y<y1;y+=3)for(let x=x0;x<x1;x+=3){
   const i=(y*width+x)*3;
   const value=luminance(data,i);
   if(value>=threshold&&value<=upper){red+=data[i];green+=data[i+1];blue+=data[i+2];count++}
  }
  const i=(row*cols+col)*3;
  backgrounds[i]=Math.max(35,red/count);backgrounds[i+1]=Math.max(35,green/count);backgrounds[i+2]=Math.max(35,blue/count);
  if(threshold>=brightest){brightest=threshold;globalRed=backgrounds[i];globalGreen=backgrounds[i+1];globalBlue=backgrounds[i+2]}
 }
 const out=new Uint8ClampedArray(data.length);
 const white=s.white/100,shadow=s.shadow/100,contrast=1+s.contrast/100,threshold=1-(.08+s.threshold*.0028);
 for(let y=0;y<height;y++){
  const dy=clamp((y+.5)*rows/height-.5,0,rows-1),r=Math.floor(dy),r1=Math.min(r+1,rows-1),fy=dy-r;
  for(let x=0;x<width;x++){
   const dx=clamp((x+.5)*cols/width-.5,0,cols-1),c=Math.floor(dx),c1=Math.min(c+1,cols-1),fx=dx-c;
   const i=(y*width+x)*3,a=(r*cols+c)*3,b=(r*cols+c1)*3,d=(r1*cols+c)*3,e=(r1*cols+c1)*3;
   const wa=(1-fx)*(1-fy)*shadow,wb=fx*(1-fy)*shadow,wd=(1-fx)*fy*shadow,we=fx*fy*shadow;
   const red=backgrounds[a]*wa+backgrounds[b]*wb+backgrounds[d]*wd+backgrounds[e]*we+globalRed*(1-shadow);
   const green=backgrounds[a+1]*wa+backgrounds[b+1]*wb+backgrounds[d+1]*wd+backgrounds[e+1]*we+globalGreen*(1-shadow);
   const blue=backgrounds[a+2]*wa+backgrounds[b+2]*wb+backgrounds[d+2]*wd+backgrounds[e+2]*we+globalBlue*(1-shadow);
   const paperGray=red*.299+green*.587+blue*.114;
   const level=luminance(data,i),ratio=level/Math.max(35,paperGray);
   if(s.mode==='bw'){
    const value=ratio+(s.brightness*.003)>=threshold?255:0;
    out[i]=value;out[i+1]=value;out[i+2]=value;continue;
   }
   if(s.mode==='gray'){
    const value=255-(255-level*(1-white)-ratio*255*white)*contrast+s.brightness;
    out[i]=value;out[i+1]=value;out[i+2]=value;continue;
   }
   const rr=data[i]/red,rg=data[i+1]/green,rb=data[i+2]/blue,lowest=Math.min(rr,rg,rb);
   const nearPaper=lowest>.88&&Math.max(rr,rg,rb)-lowest<.12;
   out[i]=255-(255-data[i]*(1-white)-(nearPaper?255:rr*255)*white)*contrast+s.brightness;
   out[i+1]=255-(255-data[i+1]*(1-white)-(nearPaper?255:rg*255)*white)*contrast+s.brightness;
   out[i+2]=255-(255-data[i+2]*(1-white)-(nearPaper?255:rb*255)*white)*contrast+s.brightness;
  }
 }
 if(s.mode!=='bw'&&(s.denoise||s.sharpness)){
  const source=new Uint8ClampedArray(out),stride=width*3;
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
   const i=(y*width+x)*3;
   for(let ch=0;ch<3;ch++){
    const p=i+ch,value=source[p],l=source[p-3],r=source[p+3],a=source[p-stride],b=source[p+stride];
    const smooth=(l+r+a+b)/4;
    const detail=value-smooth;
    // Dampen low-amplitude noise and sharpen moderate edges only.
    out[p]=Math.abs(detail)<7?value-detail*s.denoise/100:Math.abs(detail)<42?value+detail*s.sharpness/100:value;
   }
  }
 }
 return {data:new Uint8Array(out.buffer,out.byteOffset,out.byteLength),width,height};
}
