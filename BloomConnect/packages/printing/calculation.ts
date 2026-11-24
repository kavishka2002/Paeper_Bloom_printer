import {duplexModes} from './duplex';
import {z} from 'zod';
import {paperSizes,paperNames,type Paper} from './paper';
export {paperSizes} from './paper';

const count=z.number().int().min(1).max(10000);
const money=z.number().int().min(0).max(100000000);
export const paperRateSizes=['A4','A3','Legal'] as const;
export const paperDocumentRatesSchema=z.partialRecord(z.enum(paperRateSizes),z.object({
  mono:money.optional(),colour:money.optional(),duplexMono:money.optional(),duplexColour:money.optional(),samePrice:z.boolean().optional()
}));
export type DocumentRates={mono:number;colour:number;duplexMono?:number;duplexColour?:number;paperRates?:z.infer<typeof paperDocumentRatesSchema>};
export const pricingSchema=z.object({
  basis:z.enum(['sheet','side','page','photo','booklet']).default('page'),
  mono:money,colour:money,
  tiers:z.array(z.object({from:count,mono:money,colour:money})).max(100).default([]),
  photoSizes:z.record(z.string().regex(/^\d+x\d+$/),money).optional(),
  paperPerSheet:money.default(0),setup:money.default(0),finishing:money.default(0),discount:money.default(0),minimum:money.default(0),
  override:z.object({amount:money,reason:z.string().trim().min(3).max(500)}).optional()
});
export const calculationSchema=z.object({
  documentPages:count,
  selectedPages:z.array(count).max(10000).optional(),
  range:z.string().max(2000).default(''),
  filter:z.enum(['all','odd','even']).default('all'),reverse:z.boolean().default(false),
  copies:z.number().int().min(1).max(10000).default(1),
  pagesPerSide:z.number().int().min(1).max(64).default(1),
  duplex:z.enum(duplexModes).default('simplex'),
  imposition:z.enum(['ordinary','booklet','poster']).default('ordinary'),binding:z.enum(['left','right']).default('left'),
  signaturePages:z.number().int().min(4).max(128).multipleOf(4).optional(),
  posterTiles:z.array(count).min(1).max(200).optional(),
  paper:z.enum(paperNames).default('A4'),
  customPaper:z.object({widthMm:z.number().min(20).max(2000),heightMm:z.number().min(20).max(2000)}).optional(),
  mode:z.enum(['mono','grayscale','colour','mixed']).default('mono'),
  colourPages:z.array(count).max(10000).default([]),
  uncertainPages:z.array(count).max(10000).default([]),
  uncertainPolicy:z.enum(['requireConfirmation','colour','mono']).default('requireConfirmation'),
  pricing:pricingSchema.optional()
}).superRefine((value,ctx)=>{
  if(value.paper==='Custom'&&!value.customPaper)ctx.addIssue({code:'custom',message:'Custom paper dimensions are required.'});
  if(value.imposition==='booklet'&&(value.pagesPerSide!==2||value.duplex==='simplex'))ctx.addIssue({code:'custom',message:'Booklets require two pages per side and duplex.'});
  if(value.imposition==='poster'&&(value.duplex!=='simplex'||value.pagesPerSide!==1||!value.posterTiles))ctx.addIssue({code:'custom',message:'Poster tiles require one-sided, one-up printing.'});
});
export type CalculationInput=z.input<typeof calculationSchema>;
export type PricingPolicy=z.input<typeof pricingSchema>;
export function documentPricing(
  rates:DocumentRates,
  duplex:CalculationInput['duplex'],
  basis:'sheet'|'side'|'page'='sheet',
  paper?:Paper
):PricingPolicy{
  const sizeRates=paper==='A4'||paper==='A3'||paper==='Legal'?rates.paperRates?.[paper]:undefined;
  if(!duplex||duplex==='simplex')return {basis,mono:sizeRates?.mono??rates.mono,colour:sizeRates?.colour??rates.colour};
  if(sizeRates?.samePrice)return {basis:'sheet',mono:sizeRates.mono??rates.mono,colour:sizeRates.colour??rates.colour};
  return {basis:'sheet',mono:sizeRates?.duplexMono??sizeRates?.mono??rates.duplexMono??rates.mono,
    colour:sizeRates?.duplexColour??sizeRates?.colour??rates.duplexColour??rates.colour};
}
export type ImposedSide={pages:(number|null)[];ink:'mono'|'colour'|'blank'};

function safe(value:number){if(!Number.isSafeInteger(value)||value<0)throw new Error('Calculation exceeds the safe integer range.');return value}
function sum(values:number[]){return values.reduce((total,value)=>safe(total+value),0)}
function pageList(input:z.output<typeof calculationSchema>){
  let pages:number[];
  if(input.selectedPages){
    if(input.range.trim())throw new Error('Use either selected pages or a page range.');
    if(new Set(input.selectedPages).size!==input.selectedPages.length)throw new Error('Select each page once.');
    pages=[...input.selectedPages];
  }else if(input.range.trim()){
    const selected=new Set<number>();
    for(const token of input.range.split(',')){
      const match=/^(\d+)(?:\s*-\s*(\d+))?$/.exec(token.trim());
      if(!match)throw new Error('Enter page ranges such as 1-3, 5.');
      const first=Number(match[1]),last=Number(match[2]??match[1]);
      if(first<1||last>input.documentPages||last<first)throw new Error('Page range is outside the document.');
      for(let page=first;page<=last;page++)selected.add(page);
    }
    pages=[...selected].sort((a,b)=>a-b);
  }else pages=Array.from({length:input.documentPages},(_,i)=>i+1);
  if(pages.some(page=>page>input.documentPages))throw new Error('Selected page is outside the document.');
  pages=pages.filter(page=>input.filter==='all'||page%2===(input.filter==='odd'?1:0));
  if(!pages.length)throw new Error('Select at least one page.');
  if(input.reverse)pages.reverse();
  return pages;
}

/** Pure calculation and imposition. No printer submission, PDF parsing or database writes. */
export function calculatePrint(raw:CalculationInput){
  const input=calculationSchema.parse(raw),pages=pageList(input);
  for(const page of [...input.colourPages,...input.uncertainPages])if(page>input.documentPages)throw new Error('Colour analysis page is outside the document.');
  const uncertain=new Set(input.uncertainPages),colour=new Set(input.colourPages);
  const needsConfirmation=input.mode==='mixed'&&input.uncertainPolicy==='requireConfirmation'&&pages.some(page=>uncertain.has(page));
  // Conservative estimate until uncertain pages have been confirmed.
  if(input.uncertainPolicy!=='mono')for(const page of uncertain)colour.add(page);
  const isColour=(page:number)=>input.mode==='colour'||input.mode==='mixed'&&colour.has(page);
  const sides:ImposedSide[]=[];
  const add=(slots:(number|null)[])=>sides.push({pages:slots,ink:slots.every(page=>page===null)?'blank':slots.some(page=>page!==null&&isColour(page))?'colour':'mono'});
  let paddingSlots=0;
  if(input.imposition==='booklet'){
    const signatureSize=input.signaturePages??pages.length;
    for(let start=0;start<pages.length;start+=signatureSize){
      const signature=pages.slice(start,start+signatureSize);
      const padded=[...signature] as (number|null)[];
      while(padded.length%4)padded.push(null);
      paddingSlots+=padded.length-signature.length;
      for(let sheet=0;sheet<padded.length/4;sheet++){
        const front=[padded[padded.length-1-2*sheet],padded[2*sheet]];
        const back=[padded[2*sheet+1],padded[padded.length-2-2*sheet]];
        add(input.binding==='right'?front.reverse():front);
        add(input.binding==='right'?back.reverse():back);
      }
    }
  }else if(input.imposition==='poster'){
    const expected=new Set(pages),tiles=input.posterTiles!;
    if(tiles.some(page=>!expected.has(page))||new Set(tiles).size!==expected.size)throw new Error('Poster tiles must cover the selected pages.');
    for(const page of tiles)add([page]);
  }else{
    for(let i=0;i<pages.length;i+=input.pagesPerSide){
      const slots:(number|null)[]=pages.slice(i,i+input.pagesPerSide);
      while(slots.length<input.pagesPerSide)slots.push(null);
      paddingSlots+=slots.filter(page=>page===null).length;add(slots);
    }
    if(input.duplex!=='simplex'&&sides.length%2)add(Array.from({length:input.pagesPerSide},()=>null));
  }
  const sidesPerSheet=input.duplex==='simplex'?1:2;
  const physicalSheetsPerCopy=sides.length/sidesPerSheet;
  const printedSidesPerCopy=sides.filter(side=>side.ink!=='blank').length;
  const colourSidesPerCopy=sides.filter(side=>side.ink==='colour').length;
  const blankSidesPerCopy=sides.length-printedSidesPerCopy;
  const colourSheetsPerCopy=Array.from({length:physicalSheetsPerCopy},(_,i)=>sides.slice(i*sidesPerSheet,(i+1)*sidesPerSheet).some(side=>side.ink==='colour')).filter(Boolean).length;
  const counts={logicalDocumentPages:input.documentPages,selectedPages:pages.length,pagesPerSide:input.pagesPerSide,
    printedSides:safe(printedSidesPerCopy*input.copies),physicalSheetsPerCopy,copies:input.copies,totalPhysicalSheets:safe(physicalSheetsPerCopy*input.copies),
    colourSides:safe(colourSidesPerCopy*input.copies),blackAndWhiteSides:safe((printedSidesPerCopy-colourSidesPerCopy)*input.copies),
    blankSides:safe(blankSidesPerCopy*input.copies),paddingSlots:safe(paddingSlots*input.copies),
    colourLogicalPages:safe(pages.filter(isColour).length*input.copies),blackAndWhiteLogicalPages:safe(pages.filter(page=>!isColour(page)).length*input.copies)};
  let pricing:{basis:string;units:number;monoUnits:number;colourUnits:number;monoRate:number;colourRate:number;setup:number;discount:number;minimumAdjustment:number;overrideReason?:string}|null=null;
  let estimatedPrintingCost=0,paperCost=0,finishingCost=0,finalTotal=0;
  if(input.pricing){
    const policy=input.pricing;
    if(new Set(policy.tiers.map(tier=>tier.from)).size!==policy.tiers.length)throw new Error('Tier quantities must be unique.');
    if(policy.basis==='booklet'&&input.imposition!=='booklet')throw new Error('Booklet pricing requires booklet imposition.');
    // Photo pricing is only for one source image; multi-size packing uses its own layout engine.
    if(policy.basis==='photo'&&(input.documentPages!==1||input.imposition!=='ordinary'||input.pagesPerSide!==1))throw new Error('Photo pricing requires a single image with one requested photo per copy.');
    const units=policy.basis==='sheet'?counts.totalPhysicalSheets:policy.basis==='side'?counts.printedSides:policy.basis==='booklet'||policy.basis==='photo'?input.copies:pages.length*input.copies;
    const colourUnits=policy.basis==='sheet'?colourSheetsPerCopy*input.copies:policy.basis==='side'?counts.colourSides:policy.basis==='booklet'||policy.basis==='photo'?(pages.some(isColour)?input.copies:0):counts.colourLogicalPages;
    const tier=[...policy.tiers].sort((a,b)=>b.from-a.from).find(tier=>units>=tier.from)??policy;
    estimatedPrintingCost=sum([safe((units-colourUnits)*tier.mono),safe(colourUnits*tier.colour),policy.setup]);
    paperCost=safe(counts.totalPhysicalSheets*policy.paperPerSheet);
    finishingCost=policy.finishing;
    const discounted=Math.max(0,sum([paperCost,estimatedPrintingCost,finishingCost])-policy.discount);
    const minimumAdjustment=Math.max(0,policy.minimum-discounted);
    finalTotal=policy.override?.amount??safe(discounted+minimumAdjustment);
    pricing={basis:policy.basis,units,monoUnits:units-colourUnits,colourUnits,monoRate:tier.mono,colourRate:tier.colour,setup:policy.setup,discount:policy.discount,minimumAdjustment,overrideReason:policy.override?.reason};
  }
  return {...counts,paper:input.paper,paperMm:input.paper==='Custom'?[input.customPaper!.widthMm,input.customPaper!.heightMm]:[...paperSizes[input.paper]],
    imposition:input.imposition,manualDuplex:input.duplex.startsWith('manual'),passesPerCopy:input.duplex.startsWith('manual')?2:1,
    selectedPageNumbers:pages,sides,needsConfirmation,pricing,paperCost,estimatedPrintingCost,finishingCost,finalTotal};
}
export type PrintCalculation=ReturnType<typeof calculatePrint>;

/** Each file starts on a fresh sheet. No implicit PDF merging or cross-customer batching. */
export function calculateBulk(items:{id:string;customer:string|null;settings:CalculationInput}[]){
  if(!items.length||items.length>40)throw new Error('Select between 1 and 40 files.');
  if(new Set(items.map(item=>item.id)).size!==items.length)throw new Error('Select each file once.');
  if(items.some(item=>item.customer!==items[0].customer))throw new Error('Never combine files from different customers.');
  const files=items.map(item=>({id:item.id,calculation:calculatePrint(item.settings)}));
  const total=(key:'totalPhysicalSheets'|'printedSides'|'colourSides'|'blackAndWhiteSides'|'blankSides'|'finalTotal'|'paperCost'|'estimatedPrintingCost'|'finishingCost')=>sum(files.map(file=>file.calculation[key]));
  return {files,logicalDocumentPages:sum(files.map(file=>file.calculation.logicalDocumentPages)),selectedPages:sum(files.map(file=>file.calculation.selectedPages)),
    totalPhysicalSheets:total('totalPhysicalSheets'),printedSides:total('printedSides'),colourSides:total('colourSides'),blackAndWhiteSides:total('blackAndWhiteSides'),blankSides:total('blankSides'),
    paperCost:total('paperCost'),estimatedPrintingCost:total('estimatedPrintingCost'),finishingCost:total('finishingCost'),finalTotal:total('finalTotal'),needsConfirmation:files.some(file=>file.calculation.needsConfirmation)};
}
