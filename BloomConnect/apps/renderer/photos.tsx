import {DuplexOptions} from './print-settings';
import {isFileOutputPrinter,isPdfPrinter,isVirtualPrinter,printerSupplyWarning} from '../../packages/printing/capabilities';
import {useQueryClient} from '@tanstack/react-query';
import {ArrowDown,ArrowLeft,ArrowUp,Images,Pencil,Printer,SlidersHorizontal} from 'lucide-react';
import {calculateBulk,documentPricing} from '../../packages/printing/calculation';
import {validateSubmissionPrinter} from '../../packages/printing/capabilities';
import {effectivePhotoPricing,findPhotoPricing,quotePhotos,photoSizeKey} from '../../packages/printing/photo-pricing';
import type {PricingRule} from '../../packages/shared/contracts';
import {colomboDay,DetailDrawer,Tabs} from './design';
import type {PrinterCapabilities} from '../../packages/printing/windows';
import {useEffect,useRef,useState} from 'react';
import {useData,Button,Panel,PrinterSelect,PrinterPropertiesButton,money,stamp,name} from './context';
import {useWorkspace} from './state';
import {DocumentPreview,DocumentThumbnail,ImposedPreview,inspectDocument} from './pdf';
import {cellBox,constrainPhotoFrame,contentBox,photoPlacementGeometry,planPhotos,reorderPhotoFrames,tightPhotoFrame,type DocumentInfo} from '../../packages/printing/plan';
import {effectiveDpi} from '../../packages/printing/image-processing';
import {normalizedSettings,type PrintSettingsInput} from '../../packages/printing/settings';
const sizes:Record<string,[number,number]>={'Passport (35 × 45 mm)':[35,45],'ID (25 × 35 mm)':[25,35],'1 × 1 inch':[25.4,25.4],'2 × 2 inch':[50.8,50.8],'3 × 4 inch':[76.2,101.6],'4 × 6 inch':[101.6,152.4],'5 × 7 inch':[127,177.8],'6 × 8 inch':[152.4,203.2],'8 × 10 inch':[203.2,254],A6:[105,148],A5:[148,210],A4:[210,297],A3:[297,420]};
const photoCounts=Array.from({length:64},(_,index)=>index+1);
const defaultLightening=55;
const automaticPhotoLimit=6;
function gridForPhotoCount(count:number,landscape:boolean){
 const ratio=landscape?297/210:210/297;
 let best={rows:8,columns:8,score:Infinity};
 for(let rows=1;rows<=8;rows++)for(let columns=1;columns<=8;columns++){
  if(rows*columns<count)continue;
  const score=(rows*columns-count)*.5+Math.abs(Math.log((columns/rows)/ratio));
  if(score<best.score)best={rows,columns,score};
 }
 return {rows:best.rows,columns:best.columns,capacity:count};
}
type Item=NonNullable<PrintSettingsInput['photoItems']>[string]&{rotation:number;fit:'contain'|'cover'};
type Positions=NonNullable<PrintSettingsInput['photoPositions']>;
type PhotoInk=NonNullable<Item['ink']>;
const inks:[PhotoInk,string][]=[['inherit','Use job ink'],['original','Original colour'],['colour','Full colour'],['mono','Black & white'],['grayscale','Grayscale'],['sepia','Sepia'],['auto','Auto-detect colour']];
const filterFields=[
 ['brightness','Brightness (%)',25,200,1,100],
 ['contrast','Contrast (%)',25,200,1,100],
 ['saturation','Saturation (%)',0,200,1,100],
 ['sharpness','Sharpness (%)',0,100,1,0],
 ['documentLightening','Lighten document paper (%)',0,100,1,0],
 ['exposure','Exposure (EV)',-2,2,.1,0],
 ['warmth','White balance warmth',-100,100,1,0],
 ['shadows','Shadows',-100,100,1,0],
 ['highlights','Highlights',-100,100,1,0],
 ['denoise','Noise reduction (%)',0,100,1,0]
] as const;
type PhotoFilters=Pick<Item,(typeof filterFields)[number][0]|'ink'|'autoContrast'>;
const clarityFilters:PhotoFilters={autoContrast:true,denoise:15,sharpness:20};
const resetFilters:PhotoFilters={brightness:100,contrast:100,saturation:100,sharpness:0,documentLightening:0,exposure:0,warmth:0,shadows:0,highlights:0,denoise:0,ink:'inherit',autoContrast:false};
const quickFilterDefaults:PhotoFilters={ink:'inherit',documentLightening:0,autoContrast:false,denoise:0,sharpness:0};
const quickFilters:{id:string;label:string;changes:PhotoFilters}[]=[
 {id:'none',label:'No filter',changes:resetFilters},
 {id:'enhance',label:'Enhance photo',changes:{...quickFilterDefaults,...clarityFilters}},
 {id:'lighten',label:'Lighten document paper',changes:{...quickFilterDefaults,documentLightening:defaultLightening}},
 {id:'mono',label:'Black & white',changes:{...quickFilterDefaults,ink:'mono'}},
 {id:'grayscale',label:'Grayscale',changes:{...quickFilterDefaults,ink:'grayscale'}},
 {id:'sepia',label:'Sepia',changes:{...quickFilterDefaults,ink:'sepia'}}
];
function matchesPhotoFilter(item:Item,filter:PhotoFilters){
 return (Object.keys(filter) as (keyof PhotoFilters)[]).every(key=>(item[key]??resetFilters[key])===filter[key]);
}

function PhotoFilterFields({filters,change,bulk=false}:{filters:PhotoFilters;change:(patch:PhotoFilters)=>void;bulk?:boolean}){
 return <div className="form-grid">
  {filterFields.map(([key,label,min,max,step,fallback])=><label key={key}>{label}
   <input type="number" min={min} max={max} step={step} value={filters[key]??(bulk?'':fallback)} placeholder={bulk?'Keep current':undefined}
    onChange={e=>change({[key]:e.target.value===''?undefined:e.target.valueAsNumber})}/>
  </label>)}
  <label>Photo ink<select value={filters.ink??(bulk?'':'inherit')} onChange={e=>change({ink:(e.target.value||undefined) as PhotoFilters['ink']})}>
   {bulk&&<option value="">Keep current</option>}
   {inks.map(([value,label])=><option key={value} value={value}>{label}</option>)}
  </select></label>
  <label>Auto contrast<select value={filters.autoContrast===undefined&&bulk?'':filters.autoContrast?'on':'off'} onChange={e=>change({autoContrast:e.target.value===''?undefined:e.target.value==='on'})}>
   {bulk&&<option value="">Keep current</option>}<option value="on">On</option><option value="off">Off</option>
  </select></label>
 </div>;
}
const grids:[string,number,number][]=[['Full page',1,1],['Half page',2,1],['One-third page',3,1],['Quarter page',2,2],['One-sixth page',3,2],['One-eighth page',4,2],['9-up',3,3],['12-up',4,3],['16-up',4,4]];
export function PhotoStudio({onBack}:{onBack:()=>void}){
 const [reviewPhoto,setReviewPhoto]=useState('');
 const [reviewOriginal,setReviewOriginal]=useState(false);
 const {data,run,refresh,error,printers}=useData(),state=useWorkspace(),active=data.jobs.find(j=>j.id===state.job);
 const queryClient=useQueryClient();
 const createdOrder=useRef<string>(undefined);
 const submitting=useRef(false);
 const [arrangement,setArrangement]=useState<'auto'|'grid'|'rows'|'columns'|'manual'>('auto'),[positions,setPositions]=useState<NonNullable<PrintSettingsInput['photoPositions']>>([]);
 const [ink,setInk]=useState<PhotoInk>('inherit'),[original,setOriginal]=useState('');
 const [qualityThreshold,setQualityThreshold]=useState(150);
 const [charge,setCharge]=useState(0),[discount,setDiscount]=useState(0),[pdfPrinter,setPdfPrinter]=useState('');
 const [lockAspect,setLockAspect]=useState(true);
 const [snap,setSnap]=useState(0),[past,setPast]=useState<Positions[]>([]),[future,setFuture]=useState<Positions[]>([]);
 const [settingsOpen,setSettingsOpen]=useState(false),[settingsSection,setSettingsSection]=useState('Layout');
 const [batchFilters,setBatchFilters]=useState<PhotoFilters>({});
 const [filterNotice,setFilterNotice]=useState('');
 const [editorOpen,setEditorOpen]=useState(false),[editorGap,setEditorGap]=useState<number>();
 const [autoFit,setAutoFit]=useState(true);
 const [customGrid,setCustomGrid]=useState(true),[customRows,setRows]=useState(1),[customColumns,setColumns]=useState(1);
 const [customCapacity,setGridCapacity]=useState<number>();
 const setGrid=(enabled:boolean)=>{setAutoFit(false);setCustomGrid(enabled)};
 const [duplex,setDuplex]=useState<PrintSettingsInput['duplex']>('simplex'),[order,setOrder]=useState<NonNullable<PrintSettingsInput['order']>>('horizontal');
 const [paperRate,setPaperRate]=useState(0),[finishing,setFinishing]=useState(0);
 const [monoRate,setMonoRate]=useState((data.settings?.photo??0)/100);
 const twoSided=duplex!=='simplex';
 const [media,setMedia]=useState('Default');
 const [pricingRules,setPricingRules]=useState<PricingRule[]>([]),[billing,setBilling]=useState<'sheet'|'side'|'photo'>('sheet'),[rate,setRate]=useState((data.settings?.photo??0)/100),[setupFee,setSetupFee]=useState(0),[sizeRates,setSizeRates]=useState<Record<string,number>>({});
 const [pricingReady,setPricingReady]=useState(false),[pricingError,setPricingError]=useState(false);
 async function loadPhotoPrices(){
  setPricingReady(false);setPricingError(false);
  try{setPricingRules(await window.bloom.call('pricingRules',null));setPricingReady(true)}
  catch(e){setPricingError(true);error(e)}
 }
 useEffect(()=>{void loadPhotoPrices()},[]);
 const [paperWidth,setPaperWidth]=useState(210),[paperHeight,setPaperHeight]=useState(297),[dpi,setDpi]=useState(150),[smoothing,setSmoothing]=useState(true);
 const [search,setSearch]=useState(''),[recent,setRecent]=useState(false),[maxPerSheet,setMaxPerSheet]=useState(0),[whiteBorder,setWhiteBorder]=useState(0),[customWidth,setCustomWidth]=useState(35),[customHeight,setCustomHeight]=useState(45),[unit,setUnit]=useState<'mm'|'cm'|'in'>('mm');
 const [libraryCount,setLibraryCount]=useState(1);
 const [pdfCopies,setPdfCopies]=useState(1),[pdfNup,setPdfNup]=useState(1),[pdfDuplex,setPdfDuplex]=useState<'simplex'|'longEdge'|'shortEdge'>('simplex'),[pdfColour,setPdfColour]=useState(false);
 const [extraPdfs,setExtraPdfs]=useState<string[]>([]),[pdfPages,setPdfPages]=useState<Record<string,number>>({}),[pdfPreview,setPdfPreview]=useState('');
 const [customer,setCustomer]=useState(active?(active.customer_id??'walk-in'):state.customer),[selected,setSelected]=useState<string[]>([]),[items,setItems]=useState<Record<string,Item>>({});
 const [paper,setPaper]=useState<'A4'|'A3'|'A5'|'A6'|'Letter'|'Legal'|'Custom'>('A4'),[printer,setPrinter]=useState(data.settings?.printer||localStorage.getItem('lastPhotoPrinter')||''),[landscape,setLandscape]=useState(false),[size,setSize]=useState('4 × 6 inch'),[quantity,setQuantity]=useState(1),[margin,setMargin]=useState(5),[gap,setGap]=useState(2),[guides,setGuides]=useState(true),[fit,setFit]=useState<'contain'|'cover'>('contain'),[colour,setColour]=useState(true),[date,setDate]=useState(''),[unprinted,setUnprinted]=useState(false),[busy,setBusy]=useState(false),[infos,setInfos]=useState<DocumentInfo[]>([]),[failure,setFailure]=useState('');
 useEffect(()=>{const {policy:saved}=effectivePhotoPricing(findPhotoPricing(pricingRules,{paper,photoMedia:media,duplex})?.policy,data.settings!,duplex);setPaperRate((saved?.paperPerSheet??0)/100);setFinishing((saved?.finishing??0)/100);setMonoRate((saved?.mono??data.settings?.photo??0)/100);setBilling(saved.basis==='photo'||saved.basis==='side'?saved.basis:'sheet');setRate((saved?.colour??data.settings?.photo??0)/100);setSetupFee((saved?.setup??0)/100);setSizeRates(Object.fromEntries(Object.entries(saved?.photoSizes??{}).map(([key,v])=>[key,v/100])))},[paper,media,twoSided,pricingRules]);
 useEffect(()=>{if(active&&active.id===createdOrder.current){createdOrder.current=undefined;return}let saved=active?.printSettings;const previous=data.queue.find(q=>q.job_id===active?.id&&q.settings&&['Submitted','Completed','Unconfirmed'].includes(q.status));if(!saved&&previous?.settings){try{const prior=normalizedSettings(JSON.parse(previous.settings));if(Object.keys(prior.photoItems).length)saved=prior}catch{}}setBatchFilters({});setFilterNotice('');setSettingsOpen(false);setEditorOpen(false);setOriginal('');setPast([]);setFuture([]);setInk('inherit');setColour(saved?.colour??true);setCharge((saved?.photoAdjustments?.charge??0)/100);setDiscount((saved?.photoAdjustments?.discount??0)/100);setPdfPrinter(saved?.pdfSettings?.printer??'');setAutoFit(!saved);setCustomGrid(!!saved?.photoGrid);setRows(saved?.photoGrid?.rows??1);setColumns(saved?.photoGrid?.columns??1);setGridCapacity(saved?.photoGrid?.capacity);setDuplex(saved?.duplex??'simplex');setOrder(saved?.order??'horizontal');setFit(saved?.fit??'contain');setSelected(active?[...new Set([...(saved?.fileSelection??[]),...active.files])].filter(id=>data.attachments.find(a=>a.id===id)?.mime.startsWith('image/')&&(!Object.keys(saved?.photoItems??{}).length||!!saved?.photoItems?.[id])):state.photoDraft);if(state.photoDraft.length)state.set({photoDraft:[],lightenPhotoDraft:false});setItems(!active&&state.lightenPhotoDraft?Object.fromEntries(state.photoDraft.map(id=>[id,{...defaultItem(),documentLightening:defaultLightening}])):Object.fromEntries(Object.entries(saved?.photoItems??{}).map(([id,v])=>[id,{...v,rotation:v.rotation??0,fit:v.fit??'contain'}])));setCustomer(active?(active.customer_id??'walk-in'):state.customer);setExtraPdfs(active&&!saved?.photoBatch?active.files.filter(id=>data.attachments.find(a=>a.id===id)?.mime==='application/pdf'):[]);if(saved){setPaper(['A4','A3','A5','A6','Letter','Legal','Custom'].includes(saved.paper)?saved.paper as typeof paper:'A4');setPrinter(saved.printer);setLandscape(saved.landscape);setMargin(saved.marginMm??5);setGap(saved.gapMm??2);setGuides(saved.photo?.cutGuides??false);setWhiteBorder(saved.photo?.whiteBorderMm??0);setMaxPerSheet(saved.photoMaxPerSheet??0);setPaperWidth(saved.customPaper?.widthMm??210);setPaperHeight(saved.customPaper?.heightMm??297);setDpi(saved.renderDpi??150);setSmoothing(saved.smoothing??true);setMedia(saved.photoMedia??'Default');setPdfCopies(saved.pdfSettings?.copies??1);setPdfNup(saved.pdfSettings?.nup??1);setPdfDuplex(saved.pdfSettings?.duplex??'simplex');setPdfColour(saved.pdfSettings?.colour??saved.colour);setArrangement(saved.photoArrangement??'auto');setPositions(saved.photoPositions??[])}},[active?.id]);
 const customerLibrary=data.attachments.filter(a=>a.status==='Ready'&&a.mime.startsWith('image/')&&(!customer||a.customer_id===(customer==='walk-in'?null:customer))&&a.name.toLowerCase().includes(search.toLowerCase())&&(!recent||Date.parse(a.created)>Date.now()-86400000)&&(!date||colomboDay(a.created)===date)&&(!unprinted||!data.jobs.some(j=>j.files.includes(a.id)&&j.status==='Completed')));
 const libraryLimit=Math.min(40-extraPdfs.length,customerLibrary.length);
 const [capabilities,setCapabilities]=useState<PrinterCapabilities>();
 const [capabilityError,setCapabilityError]=useState(''),[capabilityAttempt,setCapabilityAttempt]=useState(0);
 useEffect(()=>{let current=true;setCapabilities(undefined);setCapabilityError('');if(printer&&!isPdfPrinter(printer)&&(paper!=='Custom'||paperWidth>=20&&paperHeight>=20&&paperWidth<=2000&&paperHeight<=2000))void window.bloom.call('printerCapabilities',{printer,settings:normalizedSettings({printer,paper,customPaper:paper==='Custom'?{widthMm:paperWidth,heightMm:paperHeight}:undefined,copies:1,colour,landscape,duplex:'simplex',range:'',rotation:0,fit:'contain',layout:'single'})}).then(c=>{if(current)setCapabilities(c)}).catch(e=>{if(current)setCapabilityError(e instanceof Error?e.message:String(e))});return()=>{current=false}},[printer,paper,landscape,paperWidth,paperHeight,capabilityAttempt]);
 const pdfKey=extraPdfs.join('|');useEffect(()=>{let current=true;setPdfPages({});void (async()=>{const result:Record<string,number>={};for(const id of extraPdfs)result[id]=(await inspectDocument(id)).pages.length;if(current)setPdfPages(result)})().catch(error);return()=>{current=false}},[pdfKey]);
 const key=JSON.stringify([...selected].sort());
 useEffect(()=>{let current=true;setInfos([]);setFailure('');setFilterNotice('');void (async()=>{const values=[];for(const id of selected)values.push(await inspectDocument(id));if(current)setInfos(values)})().catch(e=>{if(current)setFailure(e.message)});return()=>{current=false}},[key]);
 const defaultItem=():Item=>({widthMm:size==='Custom'?customWidth*(unit==='in'?25.4:unit==='cm'?10:1):sizes[size][0],heightMm:size==='Custom'?customHeight*(unit==='in'?25.4:unit==='cm'?10:1):sizes[size][1],quantity,rotation:0,fit,ink});
 const photoItems=Object.fromEntries(selected.map(id=>{
  const item=items[id]??defaultItem(),source=infos.find(info=>info.id===id)?.pages[0];
  return [id,item.ink==='auto'?{...item,detectedColour:source?source.ink==='colour'||source.ink==='uncertain':item.detectedColour}:item];
 }));
 const customUnitFactor=unit==='in'?25.4:unit==='cm'?10:1;
 const commonPhotoSize=selected.length?Object.keys(sizes).find(preset=>selected.every(id=>photoItems[id].widthMm===sizes[preset][0]&&photoItems[id].heightMm===sizes[preset][1]))??(size==='Custom'?'Custom':'mixed'):size;
 const requestedPrints=Object.values(photoItems).reduce((sum,item)=>sum+item.quantity,0);
 const grid=autoFit||customGrid;
 const {rows,columns,capacity:gridCapacity}=autoFit
  ?gridForPhotoCount(Math.min(automaticPhotoLimit,Math.max(1,requestedPrints)),landscape)
  :{rows:customRows,columns:customColumns,capacity:customCapacity};
 const adjustments={charge:Math.round(charge*100),discount:Math.round(discount*100)};
 const options:PrintSettingsInput={fileSelection:[...selected,...extraPdfs],pdfSettings:{copies:pdfCopies,nup:pdfNup,duplex:pdfDuplex,colour:pdfColour,printer:pdfPrinter||undefined},photoAdjustments:adjustments,photoMedia:media,photoArrangement:grid?'auto':arrangement,photoGrid:grid?{rows,columns,capacity:gridCapacity}:undefined,order,photoPositions:!grid&&arrangement==='manual'?positions:undefined,renderDpi:dpi,smoothing,customPaper:paper==='Custom'?{widthMm:paperWidth,heightMm:paperHeight}:undefined,photoMaxPerSheet:maxPerSheet||undefined,printable:capabilities?.printable,photoBatch:extraPdfs.length===0,printer,paper,copies:1,colour,landscape,duplex,range:'',rotation:0,fit,layout:'single',marginMm:margin,gapMm:gap,autoRotate:true,photoItems,photo:{widthMm:35,heightMm:45,quantity:1,cutGuides:guides,whiteBorderMm:whiteBorder}};
 let plan:ReturnType<typeof planPhotos>|undefined,problem=failure;try{if(selected.length&&selected.every(id=>infos.some(info=>info.id===id)))plan=planPhotos(options,selected.map(id=>infos.find(info=>info.id===id)!))}catch(e){problem=e instanceof Error?e.message:String(e)}
 const outputColour=plan?plan.sides.some(side=>side.ink==='colour'):colour;
 const {policy,source:priceSource}=effectivePhotoPricing(findPhotoPricing(pricingRules,options)?.policy,data.settings!,duplex);let photoQuote:ReturnType<typeof quotePhotos>|undefined;try{if(plan)photoQuote=quotePhotos(plan,policy)}catch(e){problem=e instanceof Error?e.message:String(e)}
 const exportPrinter=isPdfPrinter(printer,capabilities?.driver);
 const supplyWarning=capabilities?printerSupplyWarning(capabilities.error):'';
 const virtualPrinter=isVirtualPrinter(printer)||isVirtualPrinter(capabilities?.driver??'')||isFileOutputPrinter(capabilities?.port??'');
 let printerProblem=active?.status==='Cancelled'?'Reopen the cancelled order before printing.':exportPrinter?'':!printer?'Select a Windows printer.':capabilityError?'Could not read printer settings. Check the connection and refresh printers.':'';
 if(capabilities&&!printerProblem&&!exportPrinter){
  try{validateSubmissionPrinter(normalizedSettings({...options,colour:outputColour}),capabilities,virtualPrinter)}catch(e){printerProblem=e instanceof Error?e.message:String(e)}
 }
 if(!exportPrinter&&printer&&!capabilities&&!printerProblem)printerProblem='Reading Windows printer capabilities...';
 const pdfReady=extraPdfs.every(id=>pdfPages[id]!==undefined);
 const pdfPolicy=pricingRules.find(rule=>rule.method===(pdfNup>1?'nup':'ordinary')&&rule.paper===paper&&rule.duplex===(pdfDuplex!=='simplex')&&(!rule.media||rule.media==='Default'))?.policy??documentPricing(data.settings!,pdfDuplex,'sheet',paper);
 let pdfCalculation:ReturnType<typeof calculateBulk>|undefined;
 try{if(extraPdfs.length&&pdfReady)pdfCalculation=calculateBulk(extraPdfs.map(id=>({id,customer:active?.customer_id??(customer==='walk-in'?null:customer),settings:{documentPages:pdfPages[id],copies:pdfCopies,pagesPerSide:pdfNup,duplex:pdfDuplex,paper,customPaper:options.customPaper,mode:pdfColour?'colour':'mono',pricing:pdfPolicy}})))}catch(e){problem=e instanceof Error?e.message:String(e)}
 const priceSizes=[...new Set((grid||arrangement==='manual'&&positions.some(position=>position.frame))
  ?plan?.sides.flatMap(side=>side.placements.map(p=>photoSizeKey(p.cutBox!.width,p.cutBox!.height)))??[]
  :Object.values(photoItems).map(item=>photoSizeKey(item.widthMm,item.heightMm)))];
 const sheets=photoQuote?.physicalSheets??0,photoTotal=photoQuote?.total??0,pdfTotal=pdfCalculation?.finalTotal??0;
 const subtotal=photoTotal+pdfTotal,total=subtotal+adjustments.charge-adjustments.discount;
 if(!Number.isSafeInteger(total)||total<0||adjustments.charge<0||adjustments.discount<0)problem='Check the additional charge and discount.';
 const resolutions=new Map<string,number>();
 if(plan)for(const side of plan.sides)for(const placement of side.placements){
  const source=infos.find(info=>info.id===placement.file)?.pages[0];
  if(!source||!placement.file)continue;
  const geometry=photoPlacementGeometry(source,placement,plan.settings),crop=placement.edit?.crop;
  const x=source.widthMm*96/25.4*(crop?.width??1),y=source.heightMm*96/25.4*(crop?.height??1);
  const dpi=effectiveDpi(geometry.rotation%180?y:x,geometry.rotation%180?x:y,geometry.box.width,geometry.box.height);
  resolutions.set(placement.file,Math.min(resolutions.get(placement.file)??dpi,dpi));
 }
 const lowQuality=[...resolutions].filter(([,dpi])=>dpi<qualityThreshold);
 const resolutionWarning=lowQuality.length>0&&!exportPrinter?'Some photos may look soft at this print size.':'';
 const qualityLabel=(dpi:number)=>dpi<qualityThreshold*2/3?'Very low':dpi<qualityThreshold?'Low':dpi>=Math.max(250,qualityThreshold*1.5)?'High':'Acceptable';
 const photoOutput={...options,fileSelection:selected,photoBatch:true,colour:outputColour};
 const pdfOutput={...options,printer:pdfPrinter||printer,fileSelection:extraPdfs,photoItems:{},photoGrid:undefined,photoBatch:false,copies:pdfCopies,nup:pdfNup,duplex:pdfDuplex,colour:pdfColour};
 function choose(ids:string[]){
  if(!ids.length){setSelected([]);setPositions([]);setPast([]);setFuture([]);return}
  const owner=data.attachments.find(a=>a.id===ids[0])?.customer_id;
  if(owner===undefined||active&&owner!==active.customer_id||ids.some(id=>data.attachments.find(a=>a.id===id)?.customer_id!==owner)){error(new Error('Select photographs from one customer.'));return}
  if(new Set([...ids,...extraPdfs,...(active?.files??[])]).size>40){error(new Error('Each order can contain up to 40 files. Use a separate order for the remaining photos.'));return}
  if(!grid&&arrangement==='manual'){
   const remaining=positions.filter(position=>ids.includes(position.file));
   const sides=[...new Set(remaining.map(position=>position.sheet))].sort((a,b)=>a-b);
   const kept=remaining.map(position=>({...position,sheet:sides.indexOf(position.sheet)}));
   const added=ids.filter(id=>!selected.includes(id));
   if(added.length&&kept.length&&kept.every(position=>position.frame)){
    try{
     const metadata=added.map(id=>({id,mime:'image/png',pages:[{widthMm:1,heightMm:1,blank:false,ink:'colour' as const,coverage:1}]}));
     const items=Object.fromEntries(added.map(id=>[id,photoItems[id]??defaultItem()]));
     const extra=planPhotos({...options,photoItems:items,photoArrangement:'auto',photoPositions:undefined},metadata);
     const more=extra.sides.flatMap((side,index)=>side.placements.map(p=>({
      file:p.file!,copy:p.copy!,sheet:sides.length+index,x:p.cutBox!.x,y:p.cutBox!.y,
      frame:{width:p.cutBox!.width,height:p.cutBox!.height,rotation:p.rotation}
     })));
     setPositions([...kept,...more]);
    }catch(e){error(e);return}
   }else if(added.length){setArrangement('auto');setPositions([])}
   else setPositions(kept);
   setPast([]);setFuture([]);
  }
  setSelected(ids);setCustomer(owner??'walk-in');
 }
 function reorderPhotos(next:string[]){
  if(!grid&&arrangement==='manual'){
   const assignments=next.flatMap(file=>Array.from({length:photoItems[file].quantity},(_,copy)=>({file,copy})));
   try{setPositions(reorderPhotoFrames(positions,assignments))}catch(e){error(e);return}setPast([]);setFuture([]);
  }
  setSelected(next);
 }
 function movePhoto(from:number,to:number){
  if(from===to||to<0||to>=selected.length)return;
  const next=[...selected];const [file]=next.splice(from,1);next.splice(to,0,file);reorderPhotos(next);
 }
 function selectAll(){
  if(!customer&&!active)return;
  choose([...new Set([...selected,...customerLibrary.map(file=>file.id)])]);
 }
 function selectPhotoCount(){
  choose(customerLibrary.slice(0,Math.min(libraryLimit,libraryCount)).map(file=>file.id));
 }
 async function importPhotos(){
  if(busy)return;
  setBusy(true);
  try{
   const owner=customer&&customer!=='walk-in'?customer:null;
   if(!await window.bloom.call('import',{customer:owner}))return;
   if(!customer)setCustomer('walk-in');
   await refresh();
  }catch(e){error(e)}finally{setBusy(false)}
 }
 function openPhotoSettings(section:string){
  setEditorOpen(false);
  setSettingsSection(section);
  setSettingsOpen(true);
 }
 function openPhotoOrder(){
  setSettingsOpen(false);
  setEditorOpen(true);
  setOriginal('');
  setPdfPreview('');
 }

 function setPhotoFit(nextFit:Item['fit']){
  setFit(nextFit);
  setItems(previous=>({...previous,...Object.fromEntries(selected.map(id=>[id,{...photoItems[id],fit:nextFit}]))}));
 }
 function applyFiltersToSelection(filters:PhotoFilters,message:string){
  const changes=Object.fromEntries(Object.entries(filters).filter(([,value])=>value!==undefined));
  setItems(previous=>({...previous,...Object.fromEntries(selected.map(id=>[id,{...photoItems[id],...changes}]))}));
  setOriginal('');
  setPdfPreview('');
  setFilterNotice(message);
 }
 const invalidBatchFilter=filterFields.some(([key,,min,max])=>{
  const value=batchFilters[key];
  return value!==undefined&&(!Number.isFinite(value)||value<min||value>max);
 });
 const hasBatchFilters=Object.values(batchFilters).some(value=>value!==undefined);
 function fullA4(crop=false){
  setPaper('A4');setGrid(true);setRows(1);setColumns(1);setGuides(false);setWhiteBorder(0);setOriginal('');setPdfPreview('');
  setGridCapacity(undefined);setMargin(0);
  setPhotoFit(crop?'cover':'contain');
 }
 function useStandardPrint(){
  fullA4();
  setDuplex('simplex');
 }
 function refreshPrinters(){
  void queryClient.invalidateQueries({queryKey:['printers']});
  setCapabilityAttempt(attempt=>attempt+1);
 }
 function fillFourOnA4(){
  setPaper('A4');setLandscape(true);setGrid(true);setRows(2);setColumns(2);setOrder('horizontal');
  setGridCapacity(undefined);
  setDuplex('simplex');setGuides(false);setMargin(0);setGap(0);setWhiteBorder(0);
  setOriginal('');setPdfPreview('');setPhotoFit('cover');
 }
 function setA4Grid(count:number){
  const best=gridForPhotoCount(count,landscape);
  setPaper('A4');setGrid(true);setRows(best.rows);setColumns(best.columns);setGridCapacity(count);
  setOrder('horizontal');setGuides(false);setWhiteBorder(0);setMargin(0);setGap(0);
  setOriginal('');setPdfPreview('');setPhotoFit('contain');
 }
 function fitOnA4(){
  const count=Math.min(64,requestedPrints);
  if(count)setA4Grid(count);
 }
 function useAutomaticFit(){
  setPaper('A4');setAutoFit(true);setOrder('horizontal');
  setGuides(false);setWhiteBorder(0);setMargin(0);setGap(2);setOriginal('');setPdfPreview('');
  setPhotoFit('contain');
 }
 function editOnSheet(){
  if(!plan)return;
  const next=plan.sides.flatMap((side,sheet)=>side.placements.map(p=>{
   const source=infos.find(info=>info.id===p.file)?.pages[0];
   const frame=source?tightPhotoFrame(source,p,plan.settings):{...p.cutBox!,rotation:p.rotation};
   return {file:p.file!,copy:p.copy!,sheet,x:frame.x,y:frame.y,
    frame:{width:frame.width,height:frame.height,rotation:frame.rotation}};
  }));
  if(!grid&&arrangement==='manual'){movePositions(next,true);return}
  setGrid(false);setArrangement('manual');setPositions(next);setPast([]);setFuture([]);
 }
 function fillSheets(){
  if(!plan)return;
  const spacing=Math.min(gap,Math.max(0,editorGap??gap));
  try{
   const next=plan.sides.flatMap((side,sheet)=>{
    const photos=side.placements;
    if(!photos.length)return [];
    const area=contentBox({...plan.settings,scaling:plan.settings.printable?'printable':plan.settings.scaling},side.width,side.height);
    const border=whiteBorder;
    let best:Positions|undefined,bestArea=-1;
    for(let rows=1;rows<=8;rows++){
     const columns=Math.ceil(photos.length/rows);
     if(columns>8||area.width-spacing*(columns-1)<=columns*border*2||area.height-spacing*(rows-1)<=rows*border*2)continue;
     let usedArea=0;
     const frames=photos.map((photo,index)=>{
      const cutBox=cellBox(index,columns,rows,area,spacing,'horizontal');
      const box={x:cutBox.x+border,y:cutBox.y+border,width:cutBox.width-border*2,height:cutBox.height-border*2};
      const source=infos.find(info=>info.id===photo.file)!.pages[0];
      const frame=tightPhotoFrame(source,{...photo,box,cutBox},plan.settings);
      usedArea+=frame.width*frame.height;
      return {file:photo.file!,copy:photo.copy!,sheet,x:frame.x,y:frame.y,frame:{width:frame.width,height:frame.height,rotation:frame.rotation}};
     });
     if(usedArea>bestArea){best=frames;bestArea=usedArea}
    }
    if(!best)throw new Error('Reduce the spacing or white border to fit the photos on this sheet.');
    return best;
   });
   planPhotos({...options,photoGrid:undefined,photoArrangement:'manual',photoPositions:next,gapMm:spacing},infos);
   setGap(spacing);setEditorGap(undefined);
   if(grid||arrangement!=='manual'){setGrid(false);setArrangement('manual');setPositions(next);setPast([]);setFuture([])}
   else movePositions(next);
  }catch(e){error(e)}
 }
 function movePositions(next:Positions,validate=false){
  try{if(validate)planPhotos({...options,photoPositions:next},infos)}catch(e){error(e);return}
  setPast(history=>[...history.slice(-29),positions]);setFuture([]);setPositions(next);
 }
 function undoMove(){
  const previous=past.at(-1);if(!previous)return;
  setFuture(history=>[positions,...history]);setPast(past.slice(0,-1));setPositions(previous);
 }
 function redoMove(){
  const next=future[0];if(!next)return;
  setPast(history=>[...history,positions]);setFuture(future.slice(1));setPositions(next);
 }
 function alignPosition(index:number,alignment:'left'|'center'|'right'){
  const position=positions[index],side=plan?.sides[position.sheet];
  if(!plan||!side)return;
  const placement=side.placements.find(item=>item.file===position.file&&item.copy===position.copy);
  if(!placement?.cutBox)return;
  const area=contentBox({...plan.settings,scaling:plan.settings.printable?'printable':plan.settings.scaling},side.width,side.height);
  const x=area.x+(area.width-placement.cutBox.width)*(alignment==='left'?0:alignment==='center'?.5:1);
  movePositions(positions.map((item,i)=>i===index?{...item,x}:item),true);
 }
 function duplicate(id:string){
  const item=photoItems[id],quantity=item.quantity+1;
  if(!grid&&arrangement==='manual'){
   if(!plan)return;
   const side=plan.sides[0],area=contentBox({...plan.settings,scaling:plan.settings.printable?'printable':plan.settings.scaling},side.width,side.height);
   const frame=positions.find(position=>position.file===id)?.frame;
   const next=[...positions,{file:id,copy:item.quantity,sheet:Math.max(-1,...positions.map(position=>position.sheet))+1,x:area.x,y:area.y,frame}];
   try{planPhotos({...options,photoItems:{...photoItems,[id]:{...item,quantity}},photoPositions:next},infos)}catch(e){error(e);return}
   setPositions(next);setPast([]);setFuture([]);
  }
  update(id,{quantity});
 }
 function removePhoto(id:string){
  setSelected(current=>current.filter(file=>file!==id));
  if(!grid&&arrangement==='manual'){
   const remaining=positions.filter(position=>position.file!==id);
   const sheets=[...new Set(remaining.map(position=>position.sheet))].sort((a,b)=>a-b);
   setPositions(remaining.map(position=>({...position,sheet:sheets.indexOf(position.sheet)})));
   setPast([]);setFuture([]);
  }
 }
 function setIndividualPhotoSize(id:string,preset:string){
  // Fixed grids and manual placements use their own frame dimensions.
  if(grid||arrangement==='grid'||arrangement==='manual'){
   if(grid&&!autoFit)setMaxPerSheet(gridCapacity??rows*columns);
   setGrid(false);setArrangement('auto');setPositions([]);setPast([]);setFuture([]);
  }
  const dimensions=sizes[preset];
  if(dimensions)update(id,{widthMm:dimensions[0],heightMm:dimensions[1]});
 }
 function applyPhotoSize(preset:string){
  if(preset==='A4'){fullA4();return}
  const dimensions=preset==='Custom'?[customWidth*customUnitFactor,customHeight*customUnitFactor]:sizes[preset];
  if(!dimensions)return;
  if(grid&&!autoFit)setMaxPerSheet(gridCapacity??rows*columns);
  setGrid(false);setArrangement('auto');setPositions([]);setPast([]);setFuture([]);
  setSize(preset);setFit('contain');setOriginal('');
  setItems(previous=>({...previous,...Object.fromEntries(selected.map(id=>[id,{
   ...photoItems[id],widthMm:dimensions[0],heightMm:dimensions[1],fit:'contain' as const
  }]))}));
 }
 function update(id:string,value:Partial<Item>){
 if(value.rotation!==undefined&&!grid&&arrangement==='manual'){
  const delta=value.rotation-(photoItems[id]?.rotation??0);
  if(delta)setPositions(current=>current.map(position=>position.file===id&&position.frame?{...position,frame:{...position.frame,rotation:(position.frame.rotation+delta+360)%360}}:position));
 }
 setItems(prior=>({...prior,[id]:{...(prior[id]??defaultItem()),...value}}))}
 async function createOrder(){
  const owner=data.attachments.find(a=>a.id===selected[0])!.customer_id;
  const id=await window.bloom.call('order',{customer:owner,files:[...selected,...extraPdfs],copies:1,paper,colour:outputColour,price:subtotal,discount:adjustments.discount,charge:adjustments.charge,printSettings:normalizedSettings(options)});
  createdOrder.current=id;
  await refresh();
  state.set({job:id});
  return id;
 }
 async function saveOrder(){
  if(exportBlocked||!completeSelection)return;
  setBusy(true);
  try{
   if(active)await run('updatePhotoOrder',{id:active.id,files:[...selected,...extraPdfs],printSettings:normalizedSettings(options),total,reason:'Saved photo layout and settings'},'Photo order settings saved');
   else await createOrder();
  }catch(e){error(e)}finally{setBusy(false)}
 }
 const addedPhotos=!!active&&selected.some(id=>!active.files.includes(id));
 const completeSelection=!active||active.files.every(id=>selected.includes(id)||extraPdfs.includes(id));
 const exportBlocked=!plan||!!problem||!pdfReady||!pricingReady||busy||(addedPhotos&&!completeSelection);
 const printBlocked=exportPrinter||exportBlocked||!!printerProblem;
 const alreadyQueued=new Set<string>();
 if(active&&extraPdfs.length)for(const entry of data.queue){
  if(entry.job_id!==active.id||!['Printing','Submitted','Unconfirmed','Completed'].includes(entry.status))continue;
  for(const file of JSON.parse(entry.settings??'{}').fileSelection??active.files)alreadyQueued.add(file);
 }
 const photosToPrint=selected.filter(id=>!alreadyQueued.has(id));
 const pdfsToPrint=extraPdfs.filter(id=>!alreadyQueued.has(id));
 async function submitPhotos(operation:'print'|'savePrintPdf',includePdfs=false){
  if(submitting.current||(operation==='print'?printBlocked||!photosToPrint.length&&!pdfsToPrint.length:exportBlocked))return;
  submitting.current=true;
  setBusy(true);
  try{
   const id=active?.id??await createOrder();
   if(addedPhotos&&!await run('updatePhotoOrder',{id,files:[...selected,...extraPdfs],printSettings:normalizedSettings(options),total,reason:'Added the selected customer photos'},'Selected photos added to the order'))return;
   if(operation==='print'){
    if(photosToPrint.length){
     if(!await run('print',{id,...photoOutput,fileSelection:photosToPrint},'Photo print job submitted to '+printer+'. Check Print Queue for status.'))return;
     localStorage.setItem('lastPhotoPrinter',printer);
    }
   }
   else if(!await run('savePrintPdf',{id,...photoOutput},'Photo sheets saved as a PDF.'))return;
   if(includePdfs&&pdfsToPrint.length){
    const pdfOperation=isPdfPrinter(pdfOutput.printer)?'savePrintPdf':'print';
    await run(pdfOperation,{id,...pdfOutput,fileSelection:pdfsToPrint},pdfOperation==='print'?'PDFs sent under the same order.':'Prepared PDF document layout saved');
   }
  }catch(e){error(e)}finally{submitting.current=false;setBusy(false)}
 }
 const photoPreview=plan&&selected.length?(<ImposedPreview id={selected[0]} photoIds={selected} lockPhotoAspect={lockAspect} onPhotoMove={!grid&&arrangement==='manual'?(move)=>{
 const side=plan.sides[move.sheet];
 if(!side)return;
 const area=contentBox({...plan.settings,scaling:plan.settings.printable?'printable':plan.settings.scaling},side.width,side.height);
 const round=(value:number)=>snap?Math.round(value/snap)*snap:value;
 const current=side.placements.find(p=>p.file===move.file&&p.copy===move.copy)?.cutBox;
 if(!current)return;
 const neighbors=side.placements.filter(p=>p.file!==move.file||p.copy!==move.copy).map(p=>p.cutBox!);
 const target={x:move.resizing?move.x:round(move.x),y:move.resizing?move.y:round(move.y),width:move.width,height:move.height};
 const frame=constrainPhotoFrame(current,target,area,neighbors,gap);
 movePositions(positions.map(p=>p.file===move.file&&p.copy===move.copy?{...p,sheet:move.sheet,x:frame.x,y:frame.y,frame:{width:frame.width,height:frame.height,rotation:move.rotation}}:p),true)
 }:undefined} input={{id:active?.id??'preview',...options}}/>):null;
 let printHint=resolutionWarning;
 if(!selected.length)printHint='Select photos to print.';
 else if(problem)printHint=problem;
 else if(!plan)printHint='Preparing the photo preview...';
 else if(!pdfReady)printHint='Reading the selected PDFs...';
 else if(!pricingReady)printHint=pricingError?'Shop prices could not be loaded.':'Loading shop prices...';
 else if(addedPhotos&&!completeSelection)printHint='Select every order file to add new photos.';
 else if(!exportPrinter&&printerProblem)printHint=printerProblem+(capabilities&&!capabilities.colour&&outputColour?' Select Black & white.':'');
 else if(!exportPrinter&&!photosToPrint.length&&!pdfsToPrint.length)printHint='The selected files have already been submitted.';
 const printButton=<div className="stack photo-print-action">
  <div className="actions"><PrinterPropertiesButton printer={printer} disabled={busy} onClose={()=>setCapabilityAttempt(attempt=>attempt+1)}/>
  <Button disabled={exportPrinter?exportBlocked:printBlocked||!photosToPrint.length&&!pdfsToPrint.length} aria-busy={busy}
   onClick={()=>void submitPhotos(exportPrinter?'savePrintPdf':'print',true)}><Printer size={16}/> {busy?'Working...':exportPrinter?'Save PDF':'Print Now'}</Button></div>
  {printHint&&<small role="status">{printHint}</small>}
 </div>;
 const monoSelected=selected.length>0&&selected.every(id=>photoItems[id].ink==='mono'||photoItems[id].ink==='inherit'&&!colour);
 const monoButton=<Button className="secondary" disabled={!selected.length||busy} aria-pressed={monoSelected} onClick={()=>{
  const mono=!monoSelected;
  setInk(mono?'mono':'inherit');
  setColour(!mono);
  applyFiltersToSelection({ink:mono?'mono':'inherit'},mono?'Black & white applied to all selected photos.':'Colour printing selected.');
 }}>Black &amp; white</Button>;
 const relatedPdfs=data.attachments.filter(file=>file.status==='Ready'&&file.mime==='application/pdf'&&file.customer_id===(active?active.customer_id:customer==='walk-in'?null:customer)&&(!active||active.files.includes(file.id)));
 const pdfChoices=relatedPdfs.map(file=><label className="check" key={file.id}><input type="checkbox" disabled={busy||!extraPdfs.includes(file.id)&&selected.length+extraPdfs.length>=40} checked={extraPdfs.includes(file.id)} onChange={e=>setExtraPdfs(ids=>e.target.checked?[...ids,file.id]:ids.filter(id=>id!==file.id))}/>{file.name}</label>);
 const printerControl=<label>Printer<PrinterSelect value={printer} change={setPrinter} labelOutput/></label>;
 const sidesControl=<label>Print sides<select value={duplex} onChange={e=>setDuplex(e.target.value as typeof duplex)}>
  <DuplexOptions/>
 </select></label>;
 const filterShortcuts=<div className="actions" role="group" aria-label="Selected photo filters">
  {monoButton}
  <Button className="secondary" disabled={!selected.length||busy}
   onClick={()=>applyFiltersToSelection(clarityFilters,'Clarity enhanced for selected photos.')}>Enhance clarity</Button>
  <Button className="quiet" disabled={!selected.length||busy}
   onClick={()=>{setBatchFilters({});applyFiltersToSelection(resetFilters,'Filters cleared from selected photos.')}}>Clear filters</Button>
 </div>;
 const selectedFilter=selected.length?quickFilters.find(preset=>selected.every(id=>matchesPhotoFilter(photoItems[id],preset.changes)))?.id??'custom':'none';
 const quickFilterControl=<label>Filter<select value={selectedFilter} disabled={!selected.length||busy} onChange={e=>{
  const preset=quickFilters.find(filter=>filter.id===e.target.value);
  if(preset)applyFiltersToSelection(preset.changes,preset.id==='none'?'Filters cleared.':preset.label+' applied to '+selected.length+(selected.length===1?' photo.':' photos.'));
 }}>
  {selectedFilter==='custom'&&<option value="custom" disabled>Custom or mixed filters</option>}
  {quickFilters.map(preset=><option key={preset.id} value={preset.id}>{preset.label}</option>)}
 </select></label>;
 const photoSubmitButtons=<>
  {active&&!completeSelection&&<small>Select every order file to save changes to the order.</small>}
  {exportPrinter&&<small>Microsoft Print to PDF is selected. Choose a physical printer to print on paper, or save the photo sheets as a PDF.</small>}
  <Button className={exportPrinter?'':'secondary'} disabled={exportBlocked} onClick={()=>void submitPhotos('savePrintPdf')}>Save photo sheets as PDF</Button>
  <Button className="secondary" disabled={exportBlocked||!completeSelection} onClick={()=>void saveOrder()}>Save photo order</Button>
 </>;
 return <div className="studio-workspace photo-studio-workspace"
 onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy'}}}
 onDrop={async e=>{
  if(!e.dataTransfer.files.length)return;
  e.preventDefault();
  if(busy)return;
  if(!customer){error(new Error('Choose a customer or Walk-in before dropping photos.'));return}
  try{
   const imported=await window.bloom.importDropped(Array.from(e.dataTransfer.files),customer==='walk-in'?null:customer);
   if(!imported){error(new Error('No new photos were imported.'));return}
   await refresh();
  }catch(e){error(e)}
 }}>
 <div className="photo-studio-heading">
  <div className="actions"><Button className="secondary" disabled={busy} onClick={onBack}><ArrowLeft size={16}/> Back</Button><h2>Photo print</h2></div>
  {active&&<Button className="quiet" disabled={busy} onClick={()=>state.set({job:''})}>New photo order</Button>}
 </div>
 <Panel className="stack photo-selection-panel">
  <div className="panel-head">
   <h2>Customer photos</h2>
   <Button className="secondary" disabled={busy} onClick={()=>void importPhotos()}>{customer?'Import photos':'Import as walk-in'}</Button>
  </div>
  <div className="form-grid">
   <label>Customer<select disabled={!!active||busy} value={customer} onChange={e=>{choose([]);setCustomer(e.target.value);setExtraPdfs([])}}>
    <option value="">Choose a customer</option><option value="walk-in">Walk-in</option>
    {data.customers.map(c=><option key={c.id} value={c.id}>{c.name}{c.phone?' '+c.phone:''}</option>)}
   </select></label>
  </div>
  <div className="actions">
   <Button className="secondary" disabled={!customer||!customerLibrary.length||busy} onClick={selectAll}>Select all matching photos</Button>
   {selected.length>0&&<Button className="quiet" disabled={busy} onClick={()=>choose([])}>Clear selection</Button>}
   <small>{selected.length} selected</small>
  </div>
  {libraryLimit>0&&customer&&<div className="photo-main-tools">
    <label>Number of photos to select<select value={Math.min(libraryCount,libraryLimit)} disabled={!customer||!customerLibrary.length||busy} onChange={e=>setLibraryCount(Number(e.target.value))}>
     {photoCounts.slice(0,libraryLimit).map(count=><option key={count}>{count}</option>)}
    </select></label>
    <Button className="secondary" disabled={!customer||!customerLibrary.length||busy} onClick={selectPhotoCount}>Select newest</Button>
  </div>}
  {!customerLibrary.length&&<p>No matching photos.</p>}
  <div className="photo-library">
   {customerLibrary.map(file=><label key={file.id} className="photo-library-card" data-selected={selected.includes(file.id)}>
    <input type="checkbox" checked={selected.includes(file.id)} disabled={busy} onChange={e=>choose(e.target.checked?[...selected,file.id]:selected.filter(id=>id!==file.id))}/>
    <DocumentThumbnail id={file.id}/>
    <span className="photo-library-caption">{file.name}<small>{stamp(file.created)}</small></span>
   </label>)}
  </div>
  <details><summary>More selection options</summary>
   <div className="stack">
    <label>Search photos<input value={search} onChange={e=>setSearch(e.target.value)}/></label>
    <label className="check"><input type="checkbox" checked={recent} onChange={e=>setRecent(e.target.checked)}/>Recent 24 hours</label>
    <label>Received date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
    <label className="check"><input type="checkbox" checked={unprinted} onChange={e=>setUnprinted(e.target.checked)}/>Unprinted orders only</label>

   </div>
  </details>
 </Panel>
 <Panel className="stack photo-review-panel">
  <div className="panel-head">
   <h2>Print preview</h2>
   {plan&&<small>{paper} / {plan.photoCount} prints / {sheets} {sheets===1?'sheet':'sheets'}</small>}
  </div>
  <fieldset className="form-grid photo-quick-print-settings" disabled={busy}>
   {printerControl}
   {sidesControl}
  </fieldset>
  <fieldset className="form-grid photo-quick-print-settings" disabled={busy}>
   <label>Photos per A4 side<select aria-label="Photos per A4 side" value={paper==='A4'&&autoFit?'auto':paper==='A4'&&grid?gridCapacity??rows*columns:''} onChange={e=>e.target.value==='auto'?useAutomaticFit():setA4Grid(Number(e.target.value))}>
    <option value="" disabled>{grid?'Choose an A4 layout':'Fixed photo sizes'}</option>
    <option value="auto">Auto (up to {automaticPhotoLimit} per side)</option>
    {photoCounts.map(count=><option key={count} value={count}>{count}</option>)}
   </select></label>
   <label>Photo size<select aria-label="Photo size" value={grid?(paper==='A4'&&!autoFit&&rows===1&&columns===1?'A4':'frame'):commonPhotoSize} onChange={e=>e.target.value==='frame'?useAutomaticFit():applyPhotoSize(e.target.value)}>
    <option value="frame">Fit to A4 layout</option>
    <option value="mixed" disabled>Individual photo sizes</option>
    {Object.keys(sizes).filter(preset=>preset!=='A3').map(preset=><option key={preset} value={preset}>{preset==='A4'?'Full A4 per photo':preset}</option>)}
    <option value="Custom">Custom size</option>
   </select></label>
   {!grid&&size==='Custom'&&<><label>Width ({unit})<input type="number" min={10/customUnitFactor} max={1000/customUnitFactor} step="any" value={customWidth||''} onChange={e=>{
    const width=Number(e.target.value);setCustomWidth(width);
    for(const id of selected)update(id,{widthMm:width*customUnitFactor});
   }}/></label>
   <label>Height ({unit})<input type="number" min={10/customUnitFactor} max={1000/customUnitFactor} step="any" value={customHeight||''} onChange={e=>{
    const height=Number(e.target.value);setCustomHeight(height);
    for(const id of selected)update(id,{heightMm:height*customUnitFactor});
   }}/></label></>}
   {grid&&<label>Fit photos<select aria-label="Fit photos" value={fit} onChange={e=>setPhotoFit(e.target.value as Item['fit'])}>
    <option value="contain">Fit whole photo</option><option value="cover">Fill and crop</option>
   </select></label>}
   {!grid&&arrangement!=='manual'&&<label>Maximum per side at chosen sizes<select aria-label="Maximum per side at chosen sizes" value={maxPerSheet} onChange={e=>setMaxPerSheet(Number(e.target.value))}>
    <option value={0}>As many as fit</option>{photoCounts.map(count=><option key={count} value={count}>{count}</option>)}
   </select></label>}
  </fieldset>
  <div className="actions photo-quick-layout" role="group" aria-label="A4 layout shortcuts">
   {[1,2,4,6,8,9,16].map(count=><Button key={count} className="secondary" disabled={busy} title={count+' photos per side'} aria-pressed={paper==='A4'&&grid&&!autoFit&&(gridCapacity??rows*columns)===count} onClick={()=>setA4Grid(count)}>{count}</Button>)}
  </div>
  <div className="actions">
   <Button className="quiet" disabled={busy} onClick={refreshPrinters}>Refresh printers</Button>
   {!printers.some(item=>item.name===printer)&&<Button className="quiet" onClick={()=>void window.bloom.call('openPrinterSettings',null).catch(error)}>Open Windows printer settings</Button>}
  </div>
  <div className="photo-main-tools">
   {quickFilterControl}
   {monoButton}
   <Button className="secondary" disabled={!selected.length||busy} onClick={()=>applyFiltersToSelection({documentLightening:defaultLightening},'Document paper lightened for all selected photos.')}>Lighten all selected</Button>
   {selected.length===1&&selectedFilter!=='none'&&<Button className="quiet" disabled={busy} onClick={()=>setOriginal(original?'':selected[0])}>{original?'Show print preview':'Compare original'}</Button>}
   <Button className="secondary" disabled={!selected.length||busy} onClick={openPhotoOrder}><Pencil size={16}/> Edit photos</Button>
   <Button className="secondary" disabled={busy} onClick={()=>openPhotoSettings('Layout')}><SlidersHorizontal size={16}/> More print settings</Button>
   {printButton}
  </div>
  {filterNotice&&<small role="status">{filterNotice}</small>}
  {selected.length>0&&(()=>{
   const strength=photoItems[selected[0]].documentLightening??0;
   const mixed=selected.some(id=>(photoItems[id].documentLightening??0)!==strength);
   return <label>Paper lightening for selected photos · {mixed?'Mixed':strength+'%'}
    <input type="range" min={0} max={100} value={mixed?defaultLightening:strength} disabled={busy} onChange={e=>{
     applyFiltersToSelection({documentLightening:e.target.valueAsNumber},'');
    }}/>
   </label>;
  })()}
  {selected.length>0&&<section className="stack" aria-label="Selected photos">
   <strong>Selected photos ({selected.length})</strong>
   <div className="photo-selected-strip">
    {selected.map((id,index)=>{
     const label=data.attachments.find(file=>file.id===id)?.name??'Photo';
     return <div className="photo-selected-card" key={id}>
      <button aria-label={'Preview '+label} onClick={()=>{setReviewPhoto(id);setReviewOriginal(false)}}>
       <DocumentThumbnail id={id}/><span>{label}</span>
      </button>
      <Button className="secondary" disabled={busy} aria-label={'Lighten '+label} aria-pressed={!!photoItems[id].documentLightening} onClick={()=>{
       const enabled=!!photoItems[id].documentLightening;
       update(id,{documentLightening:enabled?0:defaultLightening});
       setFilterNotice(enabled?'Lightening removed from '+label+'.':'Document paper lightened for '+label+'.');
      }}>{photoItems[id].documentLightening?'Undo lighten':'Lighten'}</Button>
      <Button className="quiet" disabled={busy} aria-label={'Remove '+label+' from selection'} onClick={()=>removePhoto(id)}>Remove</Button>
      <div className="actions photo-order-quick">
       <Button className="quiet" disabled={busy||index===0} aria-label={'Move '+label+' earlier'} onClick={()=>movePhoto(index,index-1)}><ArrowUp size={14}/></Button>
       <Button className="quiet" disabled={busy||index===selected.length-1} aria-label={'Move '+label+' later'} onClick={()=>movePhoto(index,index+1)}><ArrowDown size={14}/></Button>
      </div>
     </div>;
    })}
   </div>
  </section>}
  {selected.length>0&&relatedPdfs.length>0&&<details><summary>Include customer PDFs {extraPdfs.length>0?'('+extraPdfs.length+')':''}</summary><div className="stack">{pdfChoices}<small>Photos and PDFs are billed together. Each uses its own print settings.</small></div></details>}
  <div className="photo-print-footer">
   <div><small>{printer||'No printer selected'}</small>{plan&&<strong>{active?'Order total':'Estimated price'} {money(active?.total??total)}</strong>}</div>
   <div className="photo-print-confirmation">
    {exportPrinter&&<small>Microsoft Print to PDF saves a PDF file.</small>}
    {virtualPrinter&&!exportPrinter&&<small>For paper output, choose a physical printer. {printer} is a virtual destination.</small>}
    {selected.length>0&&(pricingError?<Button className="quiet" onClick={()=>void loadPhotoPrices()}>Retry loading prices</Button>:!pricingReady&&<small role="status">Loading shop prices...</small>)}
    {!printerProblem&&supplyWarning&&<small role="status">{supplyWarning}</small>}
   </div>
  </div>
  <div className="photo-preview-display">
   {editorOpen||settingsOpen?null:selected.includes(original)?<DocumentPreview key={original} id={original}/>:photoPreview}
   {!plan&&!problem&&<div className="photo-preview-empty"><Images size={30}/><p role="status">{selected.length?'Preparing your preview…':'Tick the photos you want to print.'}</p></div>}
   {problem&&<p role="alert">{problem}</p>}
  </div>
 </Panel>
 {selected.includes(reviewPhoto)&&<DetailDrawer title={'Photo preview · '+(data.attachments.find(file=>file.id===reviewPhoto)?.name??'Photo')} presentation="wide" onClose={()=>setReviewPhoto('')}>
  <div className="stack">
   <div className="actions">
    <Button className="secondary" onClick={()=>setReviewPhoto('')}><ArrowLeft size={16}/> Back to print setup</Button>
    <Button className="secondary" onClick={()=>setReviewOriginal(!reviewOriginal)}>{reviewOriginal?'Show print preview':'Compare original'}</Button>
    <Button disabled={busy} onClick={()=>{update(reviewPhoto,{documentLightening:defaultLightening});setReviewOriginal(false)}}>Lighten this photo</Button>
    <Button className="secondary" disabled={busy} onClick={()=>{applyFiltersToSelection({documentLightening:defaultLightening},'Document paper lightened for all selected photos.');setReviewOriginal(false)}}>Lighten all selected</Button>
    <Button className="quiet" disabled={busy} onClick={()=>{update(reviewPhoto,{documentLightening:0});setReviewOriginal(false)}}>Reset lightening</Button>
   </div>
   <label>Paper lightening · {photoItems[reviewPhoto].documentLightening??0}%
    <input type="range" min={0} max={100} value={photoItems[reviewPhoto].documentLightening??0} disabled={busy} onChange={e=>{
     update(reviewPhoto,{documentLightening:e.target.valueAsNumber});setReviewOriginal(false);
    }}/>
   </label>
   <small>Paper lightening keeps gray tones in black-and-white output so faint text stays visible.</small>
   {reviewOriginal?<DocumentPreview key={reviewPhoto} id={reviewPhoto}/>:<ImposedPreview id={reviewPhoto} photoIds={[reviewPhoto]} input={{
    id:active?.id??'preview',...options,fileSelection:[reviewPhoto],photoItems:{[reviewPhoto]:{...photoItems[reviewPhoto],quantity:1}},
    photoGrid:undefined,photoArrangement:'auto',photoPositions:undefined,photoBatch:true,duplex:'simplex'
   }}/>}
   <details><summary>More filters for this photo</summary><PhotoFilterFields filters={photoItems[reviewPhoto]} change={patch=>{update(reviewPhoto,patch);setReviewOriginal(false)}}/></details>
  </div>
 </DetailDrawer>}
 {settingsOpen&&<DetailDrawer title="Photo print settings" presentation="wide" onClose={()=>setSettingsOpen(false)}>
 <Tabs label="Print settings sections" values={['Layout','Printer','Photos','Quality','Pricing','PDFs']} value={settingsSection} onChange={setSettingsSection}/>
 <div className="photo-settings-popup">
 <div className="photo-settings-controls">
 <section className="stack" hidden={settingsSection!=='Layout'}>
 <div className="form-grid">{printerControl}{sidesControl}</div>
 <Button className="secondary" disabled={busy} onClick={refreshPrinters}>Refresh printers</Button>
 <div className="actions"><Button className="secondary" disabled={!selected.length} onClick={useAutomaticFit}>Fit together on A4</Button><Button className="secondary" disabled={!selected.length} onClick={useStandardPrint}>One per A4 page</Button></div>
 <div className="form-grid">
 <label>Photos per A4 side<select disabled={!selected.length} value={paper==='A4'&&grid?gridCapacity??rows*columns:''} onChange={e=>setA4Grid(Number(e.target.value))}>
 <option value="" disabled>Choose a count</option>
 {photoCounts.map(count=><option key={count} value={count}>{count}</option>)}
 </select></label>
 {grid&&<label>How photos fit<select value={fit} onChange={e=>setPhotoFit(e.target.value as Item['fit'])}><option value="contain">Show whole photo</option><option value="cover">Fill frame and crop</option></select></label>}
 {!grid&&arrangement!=='manual'&&<label>Maximum per side at chosen sizes<select value={maxPerSheet} onChange={e=>setMaxPerSheet(Number(e.target.value))}>
 <option value={0}>As many as fit</option>
 {photoCounts.map(count=><option key={count} value={count}>{count}</option>)}
 </select></label>}
 </div>

 <div className="form-grid"><label>Paper<select value={paper} onChange={e=>setPaper(e.target.value as typeof paper)}>{['A4','A3','A5','A6','Letter','Legal','Custom'].map(p=><option key={p}>{p}</option>)}</select></label>{paper==='Custom'&&<div className="form-grid"><label>Paper width mm<input type="number" min="20" max="2000" value={paperWidth} onChange={e=>setPaperWidth(Number(e.target.value))}/></label><label>Paper height mm<input type="number" min="20" max="2000" value={paperHeight} onChange={e=>setPaperHeight(Number(e.target.value))}/></label></div>}<label>Orientation<select value={landscape?'landscape':'portrait'} onChange={e=>setLandscape(e.target.value==='landscape')}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label></div>
 <div className="actions">
 <Button className="secondary" onClick={fillFourOnA4}>Fill A4 landscape · 4 photos (crop)</Button>
 <Button className="secondary" onClick={()=>fullA4()}>Full page: 1 photo per side</Button>
 </div>
 {!grid&&<label>Image fitting<select value={fit} onChange={e=>grid?setPhotoFit(e.target.value as Item['fit']):setFit(e.target.value as Item['fit'])}><option value="contain">Fit whole photo</option><option value="cover">Fill and crop (approved)</option></select></label>}
 <small>Fill and crop covers each frame. Fit whole photo keeps every edge visible.</small>
 <label>Quick frame or grid<select value="" onChange={e=>{const [target,spec]=e.target.value.includes(':')?e.target.value.split(':'):['',e.target.value];const [r,c]=spec.split('x').map(Number);if(target)setPaper(target as typeof paper);if(r&&c){setGrid(true);setRows(r);setColumns(c);setGridCapacity(undefined);setGuides(false)}}}><option value="">Choose a page fraction or grid</option>{(['A4','A3','A5'] as const).map(value=><option key={value} value={value+':1x1'}>{value} full page</option>)}{grids.map(([label,r,c])=><option key={label} value={r+'x'+c}>{label} ({r*c} per side)</option>)}</select></label>
 <small>Page fractions divide the printable area. Pack by photo size preserves exact physical dimensions.</small>
 <label>Photo layout<select value={grid?'grid':'sizes'} onChange={e=>setGrid(e.target.value==='grid')}><option value="sizes">Pack by photo size</option><option value="grid">Custom grid / fill page</option></select></label>
 {grid&&<div className="form-grid"><label>Rows<input type="number" min="1" max="8" value={rows} onChange={e=>{setGrid(true);setRows(Number(e.target.value));setColumns(columns);setGridCapacity(undefined)}}/></label><label>Columns<input type="number" min="1" max="8" value={columns} onChange={e=>{setGrid(true);setRows(rows);setColumns(Number(e.target.value));setGridCapacity(undefined)}}/></label><label>Grid order<select value={order} onChange={e=>setOrder(e.target.value as typeof order)}><option value="horizontal">Across rows</option><option value="vertical">Down columns</option><option value="rightToLeft">Right to left</option><option value="bottomToTop">Bottom row first</option></select></label></div>}
{!grid&&<><label>Photo size<select value={size} onChange={e=>setSize(e.target.value)}>{[...Object.keys(sizes),'Custom'].map(s=><option key={s}>{s}</option>)}</select></label>{size==='Custom'&&<div className="form-grid"><label>Width<input type="number" min=".1" value={customWidth} onChange={e=>setCustomWidth(Number(e.target.value))}/></label><label>Height<input type="number" min=".1" value={customHeight} onChange={e=>setCustomHeight(Number(e.target.value))}/></label><label>Units<select value={unit} onChange={e=>setUnit(e.target.value as typeof unit)}><option>mm</option><option>cm</option><option>in</option></select></label></div>}</>}<label>Copies per photo<input type="number" min="1" max="100" value={quantity} onChange={e=>setQuantity(Number(e.target.value))}/></label><Button onClick={()=>setItems(prior=>({...prior,...Object.fromEntries(selected.map(id=>[id,{...(prior[id]??defaultItem()),...(!grid&&{widthMm:defaultItem().widthMm,heightMm:defaultItem().heightMm}),quantity,fit}]))}))}>{grid?'Apply fit and copies to selected':'Apply size and copies to selected'}</Button><label className="check" title={capabilities?.borderless?'Driver reports zero hard margins':'This printer has not confirmed borderless output'}><input type="checkbox" disabled={!capabilities?.borderless} checked={margin===0&&whiteBorder===0} onChange={e=>{setMargin(e.target.checked?0:5);if(e.target.checked)setWhiteBorder(0)}}/>Borderless (driver support required)</label><label>Job photo ink<select value={ink==='inherit'?(colour?'colour':'mono'):ink} onChange={e=>{const value=e.target.value as PhotoInk;setInk(value);setColour(value==='colour'||value==='original'||value==='sepia')}}>{inks.filter(([value])=>value!=='inherit').map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
 <Button className="secondary" disabled={!selected.length} onClick={()=>setItems(prior=>({...prior,...Object.fromEntries(selected.map(id=>[id,{...(prior[id]??defaultItem()),ink:ink==='inherit'?(colour?'colour':'mono'):ink}]))}))}>Apply job ink to selected</Button><div className="form-grid"><label>Margins mm<input type="number" min="0" max="150" value={margin} onChange={e=>setMargin(Number(e.target.value))}/></label><label>Spacing mm<input type="number" min="0" max="150" value={gap} onChange={e=>setGap(Number(e.target.value))}/></label></div>{!grid&&<><label>Arrangement<select value={arrangement} onChange={e=>{const mode=e.target.value as typeof arrangement;if(mode==='manual'&&plan)setPositions(planPhotos({...options,photoArrangement:'auto',photoPositions:undefined},infos).sides.flatMap((side,sheet)=>side.placements.map(p=>({file:p.file!,copy:p.copy!,sheet,x:p.cutBox!.x,y:p.cutBox!.y}))));setArrangement(mode)}}><option value="auto">Auto best fit / mixed sizes</option><option value="grid">Grid (matching sizes)</option><option value="rows">Rows</option><option value="columns">Columns</option><option value="manual">Manual positions</option></select></label><Button className="secondary" onClick={()=>{setArrangement('auto');setPositions([]);setPast([]);setFuture([])}}>Auto Arrange / reset positions</Button>{arrangement==='manual'&&<details open><summary>Manual positions in millimetres</summary><label>Snap drag to grid (mm)<input type="number" min="0" max="25" step="1" value={snap} onChange={e=>setSnap(Math.max(0,Math.min(25,Number(e.target.value))))}/></label><small>Zero allows free movement.</small><div className="actions"><Button className="secondary" disabled={!past.length} onClick={undoMove}>Undo move</Button><Button className="secondary" disabled={!future.length} onClick={redoMove}>Redo move</Button></div>{positions.map((p,index)=><div className="form-grid" key={p.file+':'+p.copy}><small>{data.attachments.find(a=>a.id===p.file)?.name} / copy {p.copy+1}</small>{(['sheet','x','y'] as const).map(key=><label key={key}>{key==='sheet'?'Sheet number':key+' mm'}<input type="number" min={key==='sheet'?1:0} max={key==='sheet'?200:2000} step={key==='sheet'?1:.1} value={key==='sheet'?p.sheet+1:p[key]} onChange={e=>movePositions(positions.map((v,i)=>i===index?{...v,[key]:Number(e.target.value)-(key==='sheet'?1:0)}:v))}/></label>)}{p.frame&&(['width','height'] as const).map(dimension=><label key={dimension}>Frame {dimension} (mm)<input type="number" min="1" max="2000" step=".1" value={p.frame![dimension]} onChange={e=>movePositions(positions.map((item,i)=>i===index?{...item,frame:{...item.frame!,[dimension]:Number(e.target.value)}}:item))}/></label>)}<div className="actions">{(['left','center','right'] as const).map(alignment=><Button key={alignment} className="quiet" disabled={!plan} onClick={()=>alignPosition(index,alignment)}>Align {alignment}</Button>)}</div></div>)}</details>}<label>Maximum photos per sheet<select value={maxPerSheet} onChange={e=>setMaxPerSheet(Number(e.target.value))}><option value={0}>Auto best fit</option>{photoCounts.map(n=><option key={n} value={n}>Up to {n}</option>)}</select></label></>}<label>White border mm<input type="number" min="0" max="20" value={whiteBorder} onChange={e=>setWhiteBorder(Number(e.target.value))}/></label><label className="check"><input type="checkbox" checked={guides} onChange={e=>setGuides(e.target.checked)}/>Cut guides</label>
 </section>
 <section className="stack" hidden={settingsSection!=='Printer'}>
 <div className="actions">
  <Button className="secondary" disabled={busy} onClick={useStandardPrint}>Standard print</Button>
  <Button className="secondary" disabled={busy} onClick={refreshPrinters}>Refresh printers</Button>
 </div>
 <small>Standard print fits one image per A4 page and prints one-sided.</small>
 {virtualPrinter&&!exportPrinter&&<small>This destination receives the prepared pages in order. Choose a physical printer for paper output.</small>}
 {twoSided&&<small>The first photo side prints on the front, the next on the back. Change the photo order below to choose the pairs.</small>}
 <Button className="secondary" disabled={!printer} onClick={()=>void run('printerDialog',{printer,kind:'preferences'})}>Printer preferences</Button>{capabilityError&&!!printerProblem&&<Button className="secondary" onClick={()=>setCapabilityAttempt(attempt=>attempt+1)}>Retry printer check</Button>}
 </section>
 <section className="stack" hidden={settingsSection!=='Pricing'}><label>Pricing media category<input value={media} maxLength={80} onChange={e=>setMedia(e.target.value)}/></label><small>Billing category only. Select the matching actual media in Printer preferences.</small><label>Billing basis<select value={billing} onChange={e=>setBilling(e.target.value as typeof billing)}><option value="sheet">Per physical sheet</option><option value="side">Per printed side</option><option value="photo">Per requested photo print</option></select></label><label>Black &amp; white rate LKR<input type="number" min="0" step=".01" value={monoRate} onChange={e=>setMonoRate(Number(e.target.value))}/></label><label>Colour rate LKR<input type="number" min="0" step=".01" value={rate} onChange={e=>setRate(Number(e.target.value))}/></label><label>Paper cost per physical sheet (LKR)<input type="number" min="0" step=".01" value={paperRate} onChange={e=>setPaperRate(Number(e.target.value))}/></label><label>Finishing fee (LKR)<input type="number" min="0" step=".01" value={finishing} onChange={e=>setFinishing(Number(e.target.value))}/></label><label>Fixed service fee LKR<input type="number" min="0" step=".01" value={setupFee} onChange={e=>setSetupFee(Number(e.target.value))}/></label>{billing==='photo'&&priceSizes.map(key=><label key={key}>Size {key.split('x').map(n=>Number(n)/100).join(' x ')} mm rate LKR<input type="number" min="0" step=".01" value={sizeRates[key]??rate} onChange={e=>setSizeRates(prev=>({...prev,[key]:Number(e.target.value)}))}/></label>)}<Button className="secondary" onClick={async()=>{const existing=findPhotoPricing(pricingRules,options);if(await run('savePricingRule',{id:existing?.id,name:paper+' '+media+' photo pricing',media,paper,method:'photo',duplex:twoSided,policy:{...existing?.policy,basis:billing,mono:Math.round(monoRate*100),colour:Math.round(rate*100),paperPerSheet:Math.round(paperRate*100),finishing:Math.round(finishing*100),setup:Math.round(setupFee*100),photoSizes:billing==='photo'?Object.fromEntries(Object.entries(sizeRates).map(([key,value])=>[key,Math.round(value*100)])):undefined}},'Shop photo pricing saved'))setPricingRules(await window.bloom.call('pricingRules',null))}}>Save shop pricing for {paper}</Button><p>Applies to future estimates for this paper. Existing recorded order totals change only when explicitly saved.</p></section>
 <section className="stack" hidden={settingsSection!=='Quality'}><label>Warn below source DPI<input type="number" min="50" max="600" value={qualityThreshold} onChange={e=>setQualityThreshold(Math.max(50,Math.min(600,Number(e.target.value))))}/></label><label>Document raster DPI<select value={dpi} onChange={e=>setDpi(Number(e.target.value))}>{[72,150,300,600].map(n=><option key={n}>{n}</option>)}</select></label><label className="check"><input type="checkbox" checked={smoothing} onChange={e=>setSmoothing(e.target.checked)}/>Image smoothing</label><p>Printer quality, media and toner-saving options are managed in Printer preferences. Sharpening is applied to the disposable output raster. Manual photo positions are edited in millimetres.</p></section>
 <section className="stack" hidden={settingsSection!=='PDFs'}><label>Separate PDF printer<PrinterSelect value={pdfPrinter} change={setPdfPrinter}/></label><small>Leave empty to use the photo printer.</small><PrinterPropertiesButton printer={pdfPrinter||printer} disabled={busy} onClose={()=>setCapabilityAttempt(attempt=>attempt+1)}/><div className="form-grid"><label>PDF copies<input type="number" min="1" max="100" value={pdfCopies} onChange={e=>setPdfCopies(Number(e.target.value))}/></label><label>PDF pages per side<select value={pdfNup} onChange={e=>setPdfNup(Number(e.target.value))}>{[1,2,4,6,8,9,16].map(n=><option key={n}>{n}</option>)}</select></label><label>PDF sides<select value={pdfDuplex} onChange={e=>setPdfDuplex(e.target.value as typeof pdfDuplex)}><option value="simplex">One-sided</option><option value="longEdge">Duplex long edge</option><option value="shortEdge">Duplex short edge</option></select></label></div><label className="check"><input type="checkbox" checked={pdfColour} onChange={e=>setPdfColour(e.target.checked)}/>Colour PDFs</label><p>Print Now sends photos and PDFs in order using these settings. Both appear on one bill.</p>{data.attachments.filter(a=>a.status==='Ready'&&a.mime==='application/pdf'&&a.customer_id===(active?active.customer_id:customer==='walk-in'?null:customer)&&(!active||active.files.includes(a.id))).map(a=><label className="check" key={a.id}><input type="checkbox" checked={extraPdfs.includes(a.id)} onChange={e=>setExtraPdfs(ids=>e.target.checked?[...ids,a.id]:ids.filter(id=>id!==a.id))}/>{a.name} {pdfPages[a.id]!==undefined&&`(${pdfPages[a.id]} pages)`}</label>)}{active&&extraPdfs.length>0&&<><Button className="secondary" disabled={!pdfReady||!!problem||!pdfOutput.printer} onClick={()=>void run('print',{id:active.id,...pdfOutput},'PDF submission accepted; verify physical printing in Print Queue.')}>Print PDFs separately</Button><Button className="secondary" disabled={!pdfReady||!!problem} onClick={()=>void run('savePrintPdf',{id:active.id,...pdfOutput},'Prepared PDF document layout saved')}>Save PDF print layout</Button></>}</section>
 <section className="stack" hidden={settingsSection!=='Photos'}><div className="photo-clarity stack">
 <h3>Filters for selected photos ({selected.length})</h3>
 {filterShortcuts}
 <p>Set the filters you want to apply to every selected photo. Blank fields keep each photo's current value.</p>
 <fieldset className="stack" disabled={!selected.length||busy}>
  <legend>Batch photo filters</legend>
  <PhotoFilterFields filters={batchFilters} change={patch=>{setBatchFilters(previous=>({...previous,...patch}));setFilterNotice('')}} bulk/>
  {invalidBatchFilter&&<small role="alert">Enter filter values within their allowed ranges.</small>}
  <div className="actions">
   <Button disabled={!hasBatchFilters||invalidBatchFilter} onClick={()=>applyFiltersToSelection(batchFilters,'Filters applied to '+selected.length+' selected '+(selected.length===1?'photo.':'photos.'))}>Apply filters to selected photos</Button>
   <Button className="secondary" onClick={()=>applyFiltersToSelection(clarityFilters,'Auto Enhance applied.')}>Enhance selected photos</Button>
   <Button className="quiet" onClick={()=>applyFiltersToSelection(resetFilters,'Filters reset for the selected photos.')}>Reset selected filters</Button>
  </div>
 </fieldset>
 {filterNotice&&<p role="status">{filterNotice}</p>}
 </div><p>Choose a print size for each photo. Choosing an individual size switches fixed grids or manual placements to automatic packing.</p>{!grid&&<label className="check"><input type="checkbox" checked={lockAspect} onChange={e=>setLockAspect(e.target.checked)}/> Lock each photo frame's proportions while resizing</label>}{selected.map((id,index)=>{const item=photoItems[id];return <div className="stack photo-edit-item" key={id} draggable onDragStart={e=>e.dataTransfer.setData('text/plain',id)} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const dragged=e.dataTransfer.getData('text/plain');if(!selected.includes(dragged))return;movePhoto(selected.indexOf(dragged),index)}}><strong>{index+1}. {data.attachments.find(a=>a.id===id)?.name}</strong><div className="actions">{[-1,1].map(step=><Button key={step} className="quiet" disabled={index+step<0||index+step>=selected.length} onClick={()=>movePhoto(index,index+step)}>{step<0?'Move earlier':'Move later'}</Button>)}</div>{infos.find(d=>d.id===id)&&<small>{resolutions.get(id)??'-'} effective DPI{resolutions.has(id)?' ('+qualityLabel(resolutions.get(id)!)+')':''}</small>}<div className="form-grid"><label>Print size for photo {index+1}<select value="" onChange={e=>{if(e.target.value)setIndividualPhotoSize(id,e.target.value)}}>
 <option value="">Choose size preset</option>{Object.keys(sizes).map(preset=><option key={preset}>{preset}</option>)}<option value="Custom">Custom (mm)</option>
 </select></label>{!grid&&!(arrangement==='manual'&&positions.some(p=>p.file===id&&p.frame))&&<><label>Width mm<input type="number" min="10" max="1000" value={item.widthMm} onChange={e=>update(id,{widthMm:Number(e.target.value),...(lockAspect&&{heightMm:Number((Number(e.target.value)*item.heightMm/item.widthMm).toFixed(3))})})}/></label><label>Height mm<input type="number" min="10" max="1000" value={item.heightMm} onChange={e=>update(id,{heightMm:Number(e.target.value),...(lockAspect&&{widthMm:Number((Number(e.target.value)*item.widthMm/item.heightMm).toFixed(3))})})}/></label></>}<label>Copies<input type="number" min="1" max="100" value={item.quantity} onChange={e=>update(id,{quantity:Number(e.target.value)})}/></label><label>Fit<select value={item.fit} onChange={e=>update(id,{fit:e.target.value as Item['fit']})}><option value="contain">Fit whole photo</option><option value="cover">Fill and crop (approved)</option></select></label><label>Rotation<select value={item.rotation} onChange={e=>update(id,{rotation:Number(e.target.value)})}>{[0,90,180,270].map(n=><option key={n}>{n}</option>)}</select></label></div><details><summary>Image edits (original preserved)</summary>
 <PhotoFilterFields filters={item} change={patch=>update(id,patch)}/>
 <div className="form-grid"><label>Zoom (crops beyond frame)<input type="number" min="1" max="4" step=".1" value={item.zoom??1} onChange={e=>update(id,{zoom:Number(e.target.value)})}/></label><label>Background<input type="color" value={item.background??'#ffffff'} onChange={e=>update(id,{background:e.target.value})}/></label></div><label className="check"><input type="checkbox" checked={item.flipX??false} onChange={e=>update(id,{flipX:e.target.checked})}/>Flip horizontal</label><label className="check"><input type="checkbox" checked={item.flipY??false} onChange={e=>update(id,{flipY:e.target.checked})}/>Flip vertical</label><p>Crop coordinates in percent of the original photograph:</p><div className="form-grid">{(['x','y','width','height'] as const).map(key=><label key={key}>{key}<input type="number" min={key==='width'||key==='height'?1:0} max="100" value={Math.round((item.crop?.[key]??(key==='width'||key==='height'?1:0))*100)} onChange={e=>update(id,{crop:{x:0,y:0,width:1,height:1,...item.crop,[key]:Number(e.target.value)/100}})}/></label>)}</div><div className="actions">
 <Button className="secondary" onClick={()=>update(id,clarityFilters)}>Auto Enhance photo</Button>
 <Button className="secondary" disabled={selected.length<2||busy} onClick={()=>{
  const filters={...resetFilters};
  for(const [key] of filterFields)filters[key]=item[key]??filters[key];
  filters.ink=item.ink??filters.ink;
  filters.autoContrast=item.autoContrast??filters.autoContrast;
  applyFiltersToSelection(filters,'This photo’s filters were applied to all '+selected.length+' selected photos.');
 }}>Copy this photo’s filters to selected photos</Button>
 <Button className="quiet" onClick={()=>update(id,{...resetFilters,crop:undefined,zoom:1,flipX:false,flipY:false})}>Reset image edits</Button>
 </div></details><Button className="quiet" disabled={item.quantity>=100||!plan} onClick={()=>duplicate(id)}>{!grid&&arrangement==='manual'?'Duplicate onto new side':'Duplicate one copy'}</Button><Button className="quiet" onClick={()=>removePhoto(id)}>Remove</Button></div>})}</section>
 <section className="stack" hidden={settingsSection!=='Pricing'}>
 <details><summary>Sheet and price breakdown</summary><div className="stack"><div className="print-calculation-summary"><div><small>Photographs</small><strong>{selected.length}</strong></div><div><small>Requested prints</small><strong>{plan?.photoCount??0}</strong></div><div><small>Physical photo sheets</small><strong>{sheets}</strong></div><div><small>Printed photo sides</small><strong>{photoQuote?.printedSides??0}</strong></div><div><small>Estimate</small><strong>{money(total)}</strong></div></div>{extraPdfs.length>0&&<><p>Total physical sheets including PDFs: {sheets+(pdfCalculation?.totalPhysicalSheets??0)}</p><p>Photo subtotal: {money(photoTotal)} / PDF subtotal: {money(pdfTotal)} ({pdfCopies} copies, {pdfNup}-up, {pdfDuplex==='simplex'?'one-sided':'two-sided'}; each PDF starts on a fresh sheet)</p></>}{photoQuote&&<dl className="detail-list"><div><dt>Paper ({photoQuote.physicalSheets} physical sheets)</dt><dd>{money(photoQuote.paperCost)}</dd></div><div><dt>Photo printing and setup</dt><dd>{money(photoQuote.printing)}</dd></div><div><dt>Finishing</dt><dd>{money(photoQuote.finishing)}</dd></div><div><dt>Colour / black &amp; white sides</dt><dd>{photoQuote.colourSides} / {photoQuote.blackAndWhiteSides}</dd></div></dl>}<p className="subtle">{priceSource==='shop print rates'?'No photo rate configured. Using shop print rates per physical sheet.':priceSource==='shop photo rate'?'Using the shop photo rate.':'Using the saved photo pricing rule.'}</p><p className="subtle">Photo billing: {photoQuote?.basis??'sheet'} ({photoQuote?.units??0} units), printing {money(photoQuote?.printing??0)}, finishing {money(photoQuote?.finishing??0)}.</p></div></details>
 {active&&<p>Recorded order: {money(active.total)}. Printing a revised layout keeps the recorded total unchanged.</p>}
 <details><summary>Order charges and discount</summary><div className="form-grid"><label>Extra charges (LKR)<input type="number" min="0" step=".01" value={charge} onChange={e=>setCharge(Number(e.target.value))}/></label><label>Discount (LKR)<input type="number" min="0" step=".01" value={discount} onChange={e=>setDiscount(Number(e.target.value))}/></label></div><p>Photo {money(photoTotal)} / PDF {money(pdfTotal)} / Extras {money(adjustments.charge)} / Discount {money(adjustments.discount)}</p></details>
 </section>
 </div>
 <aside className="stack photo-settings-preview">
 <h3>{selected.length?'Live sheet preview':'Example layout'}</h3>
 {plan&&<div className="total"><span>{active?'Order total':'Estimated price'}</span><strong>{money(active?.total??total)}</strong></div>}
 {printButton}
 {photoPreview??(selected.length?<p role="status">{problem||'Preparing selected photos…'}</p>:<div className="photo-layout-example" aria-label={grid?rows+' rows, '+columns+' columns':'Example photo frame'} style={{aspectRatio:landscape?'1.414':'0.707',gridTemplateColumns:'repeat('+Math.min(8,Math.max(1,grid?columns:1))+', minmax(0, 1fr))'}}>{Array.from({length:grid?Math.min(8,Math.max(1,rows))*Math.min(8,Math.max(1,columns)):1},(_,index)=><span key={index}>{index+1}</span>)}</div>)}
 <small>{paper} {landscape?'landscape':'portrait'} · {selected.length} selected · {sheets} {sheets===1?'sheet':'sheets'}</small>
 {photoSubmitButtons}
 <Button className="secondary" onClick={()=>setSettingsOpen(false)}>Back to print setup</Button>
 </aside>
 </div>
 </DetailDrawer>}{editorOpen&&<DetailDrawer title="Edit photos" presentation="wide" onClose={()=>setEditorOpen(false)}>
 <div className="photo-editor-popup">
 <div>{selected.includes(original)?<DocumentPreview key={original} id={original}/>:pdfPreview&&extraPdfs.includes(pdfPreview)?<ImposedPreview id={pdfPreview} input={{id:active?.id??'preview',...pdfOutput}}/>:photoPreview??<p>{problem||'Preparing selected photos...'}</p>}</div>
 <aside className="stack photo-editor-controls">
 <div className="actions">
  {printButton}
  <Button className="secondary" onClick={()=>openPhotoSettings('Photos')}>Adjust photos</Button>
  <Button className="secondary" onClick={()=>openPhotoSettings('Printer')}>Print settings</Button>
 </div>
 <strong>Print order ({selected.length} photos)</strong>
 <small>Drag a row or use Earlier and Later to change which photos fill the sheet positions.</small>
 <div className="photo-editor-order">{selected.map((id,index)=><div className="photo-editor-order-item" key={id} draggable onDragStart={e=>e.dataTransfer.setData('text/plain',id)} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const from=selected.indexOf(e.dataTransfer.getData('text/plain'));if(from>=0)movePhoto(from,index)}}>
  <div className="photo-order-thumbnail"><DocumentThumbnail id={id}/></div>
 <div className="photo-order-caption"><strong>{index+1}. {data.attachments.find(file=>file.id===id)?.name}</strong><small>{photoItems[id].quantity} {photoItems[id].quantity===1?'copy':'copies'}</small></div>
 <div className="actions photo-order-move">
  <Button className="quiet" aria-label={'Move photo '+(index+1)+' earlier'} title="Move earlier" disabled={index===0} onClick={()=>movePhoto(index,index-1)}><ArrowUp size={15}/></Button>
  <Button className="quiet" aria-label={'Move photo '+(index+1)+' later'} title="Move later" disabled={index===selected.length-1} onClick={()=>movePhoto(index,index+1)}><ArrowDown size={15}/></Button>
 </div>
 </div>)}</div>
 <details><summary>Compare originals</summary><div className="stack">{selected.length>0&&<label>Compare original photo<select value={original} onChange={e=>setOriginal(e.target.value)}><option value="">Final sheet</option>{selected.map((id,index)=><option value={id} key={id}>Original {index+1} - {data.attachments.find(file=>file.id===id)?.name}</option>)}</select></label>}{extraPdfs.length>0&&<div className="actions"><Button className="secondary" onClick={()=>setPdfPreview('')}>Photo sheets</Button>{extraPdfs.map(id=><Button className="quiet" key={id} onClick={()=>setPdfPreview(id)}>{data.attachments.find(a=>a.id===id)?.name}</Button>)}</div>}</div></details>
 <details open={!grid&&arrangement==='manual'}>
 <summary>Sheet layout and frame editing</summary>
 <div className="stack">
 <div className="actions"><Button className="secondary" onClick={fitOnA4}>Fit selected photos on A4</Button><Button className="secondary" disabled={!selected.length} onClick={()=>fullA4()}>Full A4 per photo</Button><Button className="secondary" disabled={!selected.length} onClick={()=>fullA4(true)}>Fill A4 per photo (crop)</Button></div>
 <Button className="secondary" disabled={!plan} onClick={editOnSheet}>{grid||arrangement!=='manual'?'Enable move and resize':'Fit frames to photos'}</Button><label>Photo gap (mm)<input type="number" min="0" max={gap} step=".5" value={editorGap??gap} onChange={e=>setEditorGap(Math.max(0,Math.min(gap,Number(e.target.value))))}/></label>
 <Button className="secondary" disabled={!plan} onClick={fillSheets}>Fill sheet evenly</Button>
 <label className="check"><input type="checkbox" checked={lockAspect} onChange={e=>setLockAspect(e.target.checked)}/> Lock frame proportions</label>
 <div className="actions"><Button className="secondary" disabled={!past.length} onClick={undoMove}>Undo</Button><Button className="secondary" disabled={!future.length} onClick={redoMove}>Redo</Button></div>
 </div>
 </details>
 <p>{sheets} physical sheets / {money(total)}</p>
 {problem&&<small role="alert">{problem}</small>}
 {photoSubmitButtons}<Button className="secondary" disabled={busy} onClick={()=>setEditorOpen(false)}>Back to print setup</Button>
 </aside>
 </div>
 </DetailDrawer>}
 </div>
}
