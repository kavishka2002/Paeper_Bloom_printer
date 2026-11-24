const maxPixels=120_000_000;
const minimumDpi=72;

export function fitRasterDpi(dimensions:readonly (readonly [number,number])[],requestedDpi:number){
 const pixelsAt=(dpi:number)=>dimensions.reduce((pixels,[width,height])=>
  pixels+Math.round(width*dpi/25.4)*Math.round(height*dpi/25.4),0);
 if(pixelsAt(requestedDpi)<=maxPixels)return requestedDpi;
 if(pixelsAt(minimumDpi)>maxPixels)throw new Error('This job is too large to prepare at 72 DPI. Print it in smaller page ranges.');
 let low=minimumDpi,high=requestedDpi;
 while(high-low>1){
  const midpoint=Math.floor((low+high)/2);
  if(pixelsAt(midpoint)<=maxPixels)low=midpoint;
  else high=midpoint;
 }
 return low;
}
