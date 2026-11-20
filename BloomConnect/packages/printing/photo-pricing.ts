import {documentPricing,pricingSchema,type PricingPolicy} from './calculation';
import type {DocumentPlan} from './plan';
import type {PrintSettingsInput} from './settings';
export function photoSizeKey(width:number,height:number){return [Math.round(Math.min(width,height)*100),Math.round(Math.max(width,height)*100)].join('x')}
export function findPhotoPricing<Rule extends {method:string;paper:string;media?:string;duplex:boolean;policy:PricingPolicy}>(
 rules:readonly Rule[],
 settings:Pick<PrintSettingsInput,'paper'|'photoMedia'|'duplex'>
){
 return rules.find(rule=>rule.method==='photo'&&rule.paper===settings.paper&&(rule.media??'Default')===(settings.photoMedia??'Default')&&rule.duplex===(settings.duplex!=='simplex'));
}
export function effectivePhotoPricing(
 configured:PricingPolicy|undefined,
 shop:{photo:number;mono:number;colour:number;duplexMono?:number;duplexColour?:number},
 duplex:PrintSettingsInput['duplex']
):{policy:PricingPolicy;source:'photo rule'|'shop photo rate'|'shop print rates'}{
 const policy=configured&&pricingSchema.parse(configured);
 if(policy&&(policy.override||[policy.mono,policy.colour,policy.paperPerSheet,policy.setup,policy.finishing,policy.minimum,
  ...Object.values(policy.photoSizes??{}),...policy.tiers.flatMap(tier=>[tier.mono,tier.colour])].some(rate=>rate>0))){
  return {policy,source:'photo rule'};
 }
 if(shop.photo>0)return {policy:{basis:'sheet',mono:shop.photo,colour:shop.photo},source:'shop photo rate'};
 return {policy:documentPricing(shop,duplex,'sheet'),source:'shop print rates'};
}
export function quotePhotos(plan:DocumentPlan,raw:PricingPolicy){
 const policy=pricingSchema.parse(raw);
 if(!['sheet','side','photo'].includes(policy.basis))throw new Error('Photo pricing requires physical-sheet, printed-side or per-photo billing.');
 const copies=plan.settings.copies;
 const sidesPerSheet=plan.settings.duplex==='simplex'?1:2;
 const sheetCount=Math.ceil(plan.sides.length/sidesPerSheet);
 const printedSides=plan.sides.filter(side=>side.placements.length>0);
 const billableGroups=policy.basis==='sheet'
  ?Array.from({length:sheetCount},(_,index)=>plan.sides.slice(index*sidesPerSheet,(index+1)*sidesPerSheet))
  :printedSides.map(side=>[side]);
 const units=(policy.basis==='photo'?plan.photoCount:billableGroups.length)*copies;
 const tier=[...policy.tiers].sort((a,b)=>b.from-a.from).find(t=>units>=t.from)??policy;
 let variable=0;
 if(policy.basis==='photo'){for(const side of printedSides)for(const p of side.placements){const size=p.cutBox??p.box;variable+=(policy.photoSizes?.[photoSizeKey(size.width,size.height)]??(p.colour?tier.colour:tier.mono))*copies}}
 else variable=billableGroups.reduce((sum,group)=>sum+(group.some(side=>side.ink==='colour')?tier.colour:tier.mono)*copies,0);
 const physicalSheets=sheetCount*copies,paperCost=physicalSheets*policy.paperPerSheet;
 const printing=variable+policy.setup,finishing=policy.finishing;
 const subtotal=paperCost+printing+finishing;
 const total=policy.override?.amount??Math.max(policy.minimum,Math.max(0,subtotal-policy.discount));
 if(!Number.isSafeInteger(subtotal)||!Number.isSafeInteger(total)||total<0)throw new Error('Photo price exceeds the safe monetary range.');
 const colourSides=printedSides.filter(side=>side.ink==='colour').length*copies;
 return {basis:policy.basis,units,physicalSheets,paperCost,printedSides:printedSides.length*copies,colourSides,blackAndWhiteSides:printedSides.length*copies-colourSides,requestedPrints:plan.photoCount*copies,printing,finishing,discount:policy.discount,total,policy};
}
