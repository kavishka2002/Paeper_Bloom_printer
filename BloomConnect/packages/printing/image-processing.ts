/** Apply bounded sharpening only to the disposable output raster, never source bytes. */
export function sharpenPixels(data:Uint8ClampedArray,width:number,height:number,percent:number){
 if(!Number.isFinite(percent)||percent<0||percent>100||data.length!==width*height*4)throw new Error('Invalid sharpening raster or strength.');
 if(!percent)return;
 const source=new Uint8ClampedArray(data),amount=percent/100;
 for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
  const i=(y*width+x)*4;
  for(let c=0;c<3;c++)data[i+c]=source[i+c]+amount*(source[i+c]-(source[i-4+c]+source[i+4+c]+source[i-width*4+c]+source[i+width*4+c])/4);
 }
}

export type PhotoTones={autoContrast?:boolean;exposure?:number;warmth?:number;shadows?:number;highlights?:number;denoise?:number};
export function enhancePixels(data:Uint8ClampedArray,width:number,height:number,settings:PhotoTones){
 const {autoContrast=false,exposure=0,warmth=0,shadows=0,highlights=0,denoise=0}=settings;
 if(data.length!==width*height*4)throw new Error('Invalid enhancement raster.');
 if(denoise){
  const source=new Uint8ClampedArray(data),strength=denoise/100;
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
   const i=(y*width+x)*4;
   for(let c=0;c<3;c++){
    const center=source[i+c],left=source[i-4+c],right=source[i+4+c],above=source[i-width*4+c],below=source[i+width*4+c];
    let sum=0,count=0;
    if(Math.abs(left-center)<25){sum+=left;count++}
    if(Math.abs(right-center)<25){sum+=right;count++}
    if(Math.abs(above-center)<25){sum+=above;count++}
    if(Math.abs(below-center)<25){sum+=below;count++}
    if(count)data[i+c]=center+(sum/count-center)*strength;
   }
  }
 }
 if(!autoContrast&&!exposure&&!warmth&&!shadows&&!highlights)return;
 let low=0,high=255;
 if(autoContrast){
  const levels=new Uint32Array(256);
  let count=0;
  for(let i=0;i<data.length;i+=4)if(data[i+3]>127){
   levels[Math.round((data[i]+data[i+1]+data[i+2])/3)]++;count++;
  }
  const threshold=Math.max(1,Math.floor(count*.01));
  for(let sum=levels[0];sum<threshold&&low<255;sum+=levels[++low]){}
  for(let sum=levels[255];sum<threshold&&high>0;sum+=levels[--high]){}
  if(high-low<32){low=0;high=255}
 }
 const gain=2**exposure,contrast=255/(high-low);
 for(let i=0;i<data.length;i+=4){
  const tone=(data[i]+data[i+1]+data[i+2])/(3*255);
  const lift=shadows*Math.max(0,1-tone*2)*.7+highlights*Math.max(0,tone*2-1)*.7;
  data[i]=((data[i]-low)*contrast+lift)*gain+warmth*.4;
  data[i+1]=((data[i+1]-low)*contrast+lift)*gain;
  data[i+2]=((data[i+2]-low)*contrast+lift)*gain-warmth*.4;
 }
}

export function effectiveDpi(pixelWidth:number,pixelHeight:number,widthMm:number,heightMm:number){
 if([pixelWidth,pixelHeight,widthMm,heightMm].some(value=>!Number.isFinite(value)||value<=0))throw new Error('DPI requires positive pixel and print dimensions.');
 return Math.round(25.4*Math.min(pixelWidth/widthMm,pixelHeight/heightMm));
}
