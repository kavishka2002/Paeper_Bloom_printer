export const studioBackdropPixelLimit=20_000_000;

/** Remove a solid backdrop connected to an image edge, retaining enclosed subjects. */
export function removeStudioBackground(data:Uint8ClampedArray,width:number,height:number,background:[number,number,number],tolerance:number,replacement?:[number,number,number],removeFloorShadow=false){
 const count=width*height;
 if(count>studioBackdropPixelLimit||count<1||data.length!==count*4)throw new Error('The photo exceeds the background processing limit.');
 const queue=new Int32Array(count),seen=new Uint8Array(count);
 let head=0,tail=0;
 const boundary=tolerance*tolerance*3;
 const shadowBand=removeFloorShadow&&background.every(channel=>channel>=230)?width*Math.floor(height*.82):count;
 const visit=(px:number)=>{
  if(seen[px])return;
  seen[px]=1;
  const i=px*4,dr=data[i]-background[0],dg=data[i+1]-background[1],db=data[i+2]-background[2];
  if(data[i+3]&&dr*dr+dg*dg+db*db>boundary){
   if(px<shadowBand)return;
   const min=Math.min(data[i],data[i+1],data[i+2]),max=Math.max(data[i],data[i+1],data[i+2]);
   if(min<75||max-min>35)return;
  }
  queue[tail++]=px;
  data[i+3]=0;
 };
 for(let x=0;x<width;x++){visit(x);visit((height-1)*width+x)}
 for(let y=1;y<height-1;y++){visit(y*width);visit(y*width+width-1)}
 while(head<tail){
  const px=queue[head++],x=px%width;
  if(x>0)visit(px-1);
  if(x+1<width)visit(px+1);
  if(px>=width)visit(px-width);
  if(px+width<count)visit(px+width);
 }
 if(replacement)for(let i=0;i<data.length;i+=4){
  const opacity=data[i+3]/255;
  for(let channel=0;channel<3;channel++)data[i+channel]=data[i+channel]*opacity+replacement[channel]*(1-opacity);
  data[i+3]=255;
 }
 return tail;
}
