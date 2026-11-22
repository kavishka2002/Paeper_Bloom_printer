import {useQueryClient} from '@tanstack/react-query';
import {PhotoStudio} from './photos';
import type {PrinterCapabilities} from '../../packages/printing/windows';
import {isFileOutputPrinter,isPdfPrinter,isVirtualPrinter,validatePrinter} from '../../packages/printing/capabilities';
import {paperNames} from '../../packages/printing/paper';
import {BookletWizard,DocumentPricingSettings,ProfessionalSettings} from './print-settings';
import type {PrintSettingsInput} from '../../packages/printing/settings';
import {planDocument,selectedPages,type DocumentInfo} from '../../packages/printing/plan';
import {inspectDocument} from './pdf';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Plus,Printer,ShoppingBag,Wallet} from 'lucide-react';
import {colomboDay,DetailDrawer,RevenueChart,StatCard,Tabs} from './design';
import {schemas,stages,type Input,type Job,type PricingRule} from '../../packages/shared/contracts';
import {useData,Button,Panel,Badge,Empty,Table,PrinterSelect,match,stamp,money,name} from './context';
import {useWorkspace} from './state';
import {DocumentPreview,DocumentThumbnail,ImposedPreview} from './pdf';
import {calculateBulk,documentPricing,paperSizes,type CalculationInput} from '../../packages/printing/calculation';
export function Studio(){const {data}=useData(),state=useWorkspace(),[photos,setPhotos]=useState(state.photoStudio);const active=data.jobs.find(j=>j.id===state.job);useEffect(()=>{if(active)setPhotos(!!Object.keys(active.printSettings?.photoItems??{}).length||active.files.some(id=>data.attachments.find(file=>file.id===id)?.mime.startsWith('image/')))},[active?.id]);return <><div className="actions"><Button className="secondary" onClick={()=>setPhotos(false)}>PDF / existing studio</Button><Button onClick={()=>setPhotos(true)}>Bulk Photo Studio</Button></div>{photos?<PhotoStudio/>:<PdfStudio/>}</>}
export function PdfPrintPopup(){
 const {data}=useData(),state=useWorkspace();
 const seen=useRef<Set<string> | null>(null);
 const pending=useRef<string[]>([]);
 useEffect(()=>{
  const incoming=new Set(data.messages.filter(message=>message.direction==='incoming'&&message.status!=='history').map(message=>message.id));
  const ready=data.attachments.filter(file=>file.status==='Ready'&&file.mime==='application/pdf'&&file.message_id&&incoming.has(file.message_id));
  if(!seen.current){seen.current=new Set(ready.map(file=>file.id));return}
  for(const file of ready){
   if(seen.current.has(file.id))continue;
   seen.current.add(file.id);
   if(state.autoPdfPrint)pending.current.push(file.id);
  }
  if(!state.autoPdfPrint)pending.current=[];
  if(state.pdfPrintAttachment||state.view==='Print Queue'||!pending.current.length)return;
  const next=pending.current.shift();
  if(next)state.set({pdfPrintAttachment:next});
 },[data.attachments,data.messages,state.autoPdfPrint,state.pdfPrintAttachment,state.view]);
 const file=data.attachments.find(item=>item.id===state.pdfPrintAttachment);
 if(!file)return null;
 return <DetailDrawer key={file.id} title="PDF Print Preview" presentation="wide" onClose={()=>state.set({pdfPrintAttachment:''})}>
  <PdfStudio attachmentId={file.id}/>
 </DetailDrawer>;
}

function PdfStudio({attachmentId}:{attachmentId?:string}={}){
 const {data,run,error,refresh,printers}=useData(),state=useWorkspace();
 const queryClient=useQueryClient();
 const [popupOrder,setPopupOrder]=useState('');
 const [popupError,setPopupError]=useState('');
 const active=data.jobs.find(j=>j.id===(attachmentId?popupOrder:state.job));
 const [wizard,setWizard]=useState(false);
 const [mode,setMode]=useState<'basic'|'advanced'>('basic');
 const [pricingRules,setPricingRules]=useState<PricingRule[]>([]);
 const loadPricing=()=>window.bloom.call('pricingRules',null).then(setPricingRules);
 useEffect(()=>{void loadPricing().catch(error)},[]);
 const [capabilities,setCapabilities]=useState<PrinterCapabilities>();
 const [advanced,setAdvanced]=useState<Partial<PrintSettingsInput>>({});
 const [quote,setQuote]=useState(''),[quoteReason,setQuoteReason]=useState(''),[file,setFile]=useState(''),[copies,setCopies]=useState(1);
 const [matchPdfPaper,setMatchPdfPaper]=useState(false);
 const [manualPaper,setPaper]=useState<Input<'print'>['paper']>('A4'),[colour,setColour]=useState(false),[range,setRange]=useState('');
 const [selectedPrinter,setPrinter]=useState(data.settings?.printer??''),[landscape,setLandscape]=useState(false),[duplex,setDuplex]=useState<Input<'print'>['duplex']>('simplex');
 const [rotation,setRotation]=useState(0),[fit,setFit]=useState<Input<'print'>['fit']>('contain'),[layout,setLayout]=useState<Input<'print'>['layout']>('single');
 const [nup,setNup]=useState<NonNullable<Input<'print'>['nup']>>(1),[booklet,setBooklet]=useState(false),[binding,setBinding]=useState<'left'|'right'>('left');
 const [marginMm,setMargin]=useState(0),[gapMm,setGap]=useState(0),[borders,setBorders]=useState(false);
 const [basis,setBasis]=useState<'page'|'sheet'|'side'>('sheet'),[discount,setDiscount]=useState(0),[charge,setCharge]=useState(0),[saving,setSaving]=useState(false);
 const [infos,setInfos]=useState<Record<string,DocumentInfo>>({});
 const [counts,setCounts]=useState<Record<string,number>>({}),[countError,setCountError]=useState(''),[previewMode,setPreviewMode]=useState<'source'|'sheet'>('sheet');
 const docs=attachmentId?data.attachments.filter(a=>a.id===attachmentId):active?active.files.map(id=>data.attachments.find(a=>a.id===id)).filter((item):item is typeof data.attachments[number]=>!!item):data.attachments.filter(a=>a.status==='Ready');
 const preview=docs.find(a=>a.id===file)??(active||attachmentId?docs[0]:undefined);
 const files=active?docs:preview?[preview]:[];
 const fileKey=files.map(item=>item.id+':'+item.status).join('|');
 useEffect(()=>{
  let current=true;setCountError('');
  void (async()=>{
   const values:Record<string,number>={},metadata:Record<string,DocumentInfo>={};
   // Bound PDF decoding and IPC memory: load metadata in sequence, releasing each worker.
   for(const item of files){
    if(item.status!=='Ready')throw new Error(item.name+' is not downloaded yet.');
    metadata[item.id]=await inspectDocument(item.id);values[item.id]=metadata[item.id].pages.length;
   }
   if(current){setCounts(values);setInfos(metadata)}
  })().catch(e=>{if(current){setCounts({});setCountError(e.message??String(e))}});
  return()=>{current=false};
 },[fileKey]);
 useEffect(()=>{
  if(attachmentId){if(active)setQuote(String(active.total/100));return}
  const previous=data.queue.find(entry=>entry.job_id===active?.id&&entry.settings&&['Submitted','Completed','Unconfirmed'].includes(entry.status));
  let parsed:unknown=null;try{parsed=previous?.settings?JSON.parse(previous.settings):null}catch{}
  const saved=schemas.print.safeParse(parsed),options=saved.success?saved.data:active?.printSettings;
  setCopies(options?.copies??active?.copies??1);setPaper(options?.paper??(Object.hasOwn(paperSizes,active?.paper??'')?active!.paper as Input<'print'>['paper']:'A4'));
  setColour(options?.colour??!!active?.colour);setRange(options?.range??'');setFile('');setQuote(active?String(active.total/100):'');
  setPrinter(options?.printer??data.settings!.printer);setLandscape(options?.landscape??false);setDuplex(options?.duplex??'simplex');
  setRotation(options?.rotation??0);setFit(options?.fit??'contain');setLayout(options?.layout??'single');
  setAdvanced(options??{});setNup(options?.nup??1);setBooklet(options?.booklet??false);setBinding(options?.binding??'left');setMargin(options?.marginMm??0);setGap(options?.gapMm??0);setBorders(options?.borders??false);
  const priorBasis=active?.calculations?.[0]?.result.pricing?.basis;
  setBasis(priorBasis==='page'||priorBasis==='side'?priorBasis:'sheet');setDiscount(0);setCharge(0);
 },[active?.id]);
 const orientation=advanced.orientation==='auto'?'auto':landscape?'landscape':'portrait';
 const applySettings=(value:Partial<PrintSettingsInput>)=>{setAdvanced(prior=>({...prior,...value,...(value.paper&&{customPaper:value.customPaper,grid:value.grid,poster:value.poster,documentFrame:value.documentFrame,handoutNotes:value.handoutNotes??false,signaturePages:value.signaturePages,margins:value.margins,driverDpi:value.driverDpi,tray:value.tray})}));if(value.paper)setPaper(value.paper);if(value.copies)setCopies(value.copies);if(value.colour!==undefined)setColour(value.colour);if(value.landscape!==undefined)setLandscape(value.landscape);if(value.fit)setFit(value.fit);if(value.layout)setLayout(value.layout);if(value.duplex)setDuplex(value.duplex);if(value.range!==undefined)setRange(value.range);if(value.nup)setNup(value.nup);if(value.booklet!==undefined)setBooklet(value.booklet);if(value.binding)setBinding(value.binding);if(value.marginMm!==undefined)setMargin(value.marginMm);if(value.gapMm!==undefined)setGap(value.gapMm);if(value.borders!==undefined)setBorders(value.borders);if(value.printer!==undefined)setPrinter(value.printer)};
 useEffect(()=>{
  if(active)return;
  let current=true;
  void window.bloom.call('printPresets',null).then(({presets,defaultId})=>{
   const preset=presets.find(item=>item.id===defaultId);
   if(current&&preset)applySettings({...preset.settings,printer:preset.settings.printer||data.settings!.printer});
  }).catch(error);
  return()=>{current=false};
 },[active?.id]);
 const printer=selectedPrinter;
 const refreshPrinters=()=>{
  void queryClient.invalidateQueries({queryKey:['printers']});
  refreshCapabilities(value=>value+1);
 };
 useEffect(()=>{if(attachmentId)void queryClient.invalidateQueries({queryKey:['printers']})},[attachmentId,queryClient]);
 const baseOptions={...advanced,orientation,printer,paper:manualPaper,copies,colour,landscape,duplex,range,rotation:advanced.rotation??rotation,fit,layout,nup,booklet,binding,marginMm,gapMm,borders,printable:capabilities?.printable} as const;
 const pdfInfo=preview?.mime==='application/pdf'?infos[preview.id]:undefined;
 const canMatch=!!pdfInfo&&files.length===1&&nup===1&&!booklet&&!advanced.poster?.enabled;
 let matched:{paper:typeof manualPaper;customPaper?:{widthMm:number;heightMm:number}}|undefined;
 let matchHint='';
 if(matchPdfPaper&&canMatch&&pdfInfo){
  try{
   const selected=selectedPages(schemas.print.parse({id:'preview',...baseOptions}),pdfInfo);
   const sizes=selected.map(page=>[pdfInfo.pages[page-1].widthMm,pdfInfo.pages[page-1].heightMm].sort((a,b)=>a-b));
   const [width,height]=sizes[0];
   if(sizes.every(([w,h])=>Math.abs(w-width)<1&&Math.abs(h-height)<1)&&width>=20&&height<=2000){
    const standard=Object.entries(paperSizes).find(([,dimensions])=>{
     const [w,h]=[...dimensions].sort((a,b)=>a-b);
     return Math.abs(w-width)<1&&Math.abs(h-height)<1;
    });
    matched=standard?{paper:standard[0] as typeof manualPaper}:{paper:'Custom',customPaper:{widthMm:Math.round(width*100)/100,heightMm:Math.round(height*100)/100}};
    matchHint=matched.paper==='Custom'? 'PDF size matched. Physical printing requires a driver paper form of this size.':'Matched PDF paper size: '+matched.paper+'.';
   }else matchHint='The selected pages need different or unsupported paper sizes. Using the paper selected in Page Setup.';
  }catch{matchHint='Choose a valid page range to match the PDF paper size.'}
 }
 const paper=matched?.paper??manualPaper;
 const options={...baseOptions,paper,orientation:matched&&orientation==='portrait'&&advanced.orientation===undefined?'auto' as const:orientation,...(matched&&{customPaper:matched.customPaper,tray:undefined})} as const;
 const paperWidth=options.customPaper?.widthMm,paperHeight=options.customPaper?.heightMm;
 const [capabilityError,setCapabilityError]=useState('');
 const [capabilityRefresh,refreshCapabilities]=useState(0);
 useEffect(()=>{
  let current=true;setCapabilities(undefined);setCapabilityError('');
  if(printer)void window.bloom.call('printerCapabilities',{printer,settings:{...options,printable:undefined}}).then(value=>{if(current)setCapabilities(value)}).catch(e=>{if(current)setCapabilityError(e.message)});
  return()=>{current=false};
 },[printer,paper,paperWidth,paperHeight,options.orientation,capabilityRefresh]);
 const twoSided=duplex!=='simplex';
 const manualDuplex=duplex==='manualLongEdge'||duplex==='manualShortEdge';
 const pdfOutput=isPdfPrinter(printer,capabilities?.driver);
 const fileOutput=isFileOutputPrinter(capabilities?.port??'');
 const virtualPrinter=isVirtualPrinter(printer)||isVirtualPrinter(capabilities?.driver??'')||fileOutput;
 const quickHandling=booklet?'booklet':advanced.poster?.enabled?'poster':nup>1?'multiple':'size';
 const method=booklet?'booklet':options.poster?.enabled?'poster':nup>1?'nup':'ordinary';
 const rule=pricingRules.find(value=>value.method===method&&value.paper===paper&&value.duplex===twoSided&&(!value.media||value.media==='Default'));
 const policy=rule?.policy??documentPricing(data.settings!,duplex,basis);
 const pricedBasis=policy.basis??'sheet';
 const automaticDuplex=duplex==='longEdge'||duplex==='shortEdge';
 const unsupportedDuplex=!!printer&&twoSided&&(virtualPrinter||automaticDuplex&&!capabilities?.duplex);
 const inkMode=advanced.ink==='auto'||advanced.ink==='mixed'?'mixed':advanced.ink==='grayscale'?'grayscale':advanced.ink==='mono'?'mono':advanced.ink==='colour'||colour?'colour':'mono';
 const countsReady=files.length>0&&files.every(item=>counts[item.id]!==undefined);
 let calculation:ReturnType<typeof calculateBulk>|undefined,calculationError='';
 let calculations:{id:string;settings:CalculationInput}[]=[];
 try{
  if(countsReady){
   calculations=files.map(item=>{
    const image=item.mime.startsWith('image/');
    if(image&&(nup!==1||booklet||marginMm!==0||gapMm!==0||borders))throw new Error('PDF layout options cannot be applied to photos. Use a separate photo order.');
    const fileCopies=options.fileCopies?.[item.id]??copies;
    const plan=planDocument({...options,copies:fileCopies},infos[item.id]);
    const colourPages=[...new Set(plan.sides.flatMap(side=>side.placements.filter(p=>p.colour).map(p=>p.page)))];
    const settings:CalculationInput={documentPages:counts[item.id],selectedPages:plan.selected,copies:fileCopies,paper,customPaper:options.customPaper,
     mode:inkMode,colourPages,uncertainPages:plan.needsConfirmation?plan.selected.filter(page=>infos[item.id].pages[page-1].ink==='uncertain'):[],
     pagesPerSide:nup,duplex,signaturePages:options.signaturePages,imposition:method==='booklet'||method==='poster'?method:'ordinary',binding,
     posterTiles:method==='poster'?plan.sides.map(side=>side.placements[0].page):undefined,
     pricing:image?{basis:'sheet',mono:data.settings!.photo,colour:data.settings!.photo}:policy};
    return {id:item.id,settings};
   });
   calculation=calculateBulk(calculations.map(item=>({...item,customer:files.find(file=>file.id===item.id)!.customer_id})));
  }
  if(calculation?.needsConfirmation)calculationError='Review colour analysis under Colour and confirm the estimated colour pages before printing. Open Advanced to review these settings.';
  if(booklet&&!landscape)throw new Error('Booklet sheets require landscape orientation.');
 }catch(e){calculationError=e instanceof Error?e.message:'Invalid print settings'}
 const extra=Math.round(charge*100),reduction=Math.round(discount*100);
 const estimatedTotal=calculation?calculation.finalTotal+extra-reduction:0;
 if(estimatedTotal<0)calculationError='Discount cannot exceed the calculated order total.';
 let driverBlock=capabilityError;
 if(capabilities){try{validatePrinter(schemas.print.parse({id:active?.id??'preview',...options}),capabilities)}catch(e){driverBlock=e instanceof Error?e.message:String(e)}}
 const printerNotice=!printer?(printers.length?'Select a Windows printer.':'Windows returned no printers. Add one under Windows Settings > Printers & scanners, then refresh.'):
  pdfOutput?'This printer creates a PDF file. Choose a physical printer to print on paper.':
  unsupportedDuplex?'Choose a physical printer for two-sided printing, or manual duplex when automatic duplex is unavailable.':
  driverBlock||(!capabilities?'Checking Windows printer capabilities.':virtualPrinter?'This virtual printer can open a Windows dialog or another app.':'');
 const printBlock=active&&!pdfOutput&&(!printer||unsupportedDuplex||driverBlock||!capabilities)?printerNotice:'';
 async function submit(e:FormEvent){
  e.preventDefault();if(!preview||saving||!calculation||calculationError||countError||popupOrder&&!active)return;setSaving(true);setPopupError('');
  try{
   if(active&&pdfOutput){await window.bloom.call('savePrintPdf',{id:active.id,...options});return}
   if(active&&printBlock)throw new Error(printBlock);
   if(active&&unsupportedDuplex)throw new Error('Choose a physical printer and a supported two-sided mode, or save the prepared PDF.');
   if(active){
    await window.bloom.call('print',{id:active.id,...options});
    state.set({pdfPrintAttachment:'',view:'Print Queue'});
    await refresh();
    return;
   }
   const id=await window.bloom.call('order',{customer:preview.customer_id,files:[preview.id],copies,paper,colour,price:0,discount:reduction,charge:extra,calculations,printSettings:options});
   if(attachmentId)setPopupOrder(id);
   await refresh();if(!attachmentId)state.set({job:id});
  }catch(e){if(attachmentId)setPopupError(e instanceof Error?e.message:String(e));else error(e)}finally{setSaving(false)}
 }
 return <div className={"studio-workspace"+(attachmentId?" quick-pdf-workspace":"")}>{!attachmentId&&<Panel className="studio-list"><h2>Customer files</h2>
 <select aria-label="Order" value={active?.id??''} onChange={e=>state.set({job:e.target.value})}><option value="">New order</option>{data.jobs.map(j=><option key={j.id} value={j.id}>{j.id} - {name(data,j.customer_id)}</option>)}</select>
 <div className="studio-files">{docs.map(item=><button key={item.id} type="button" aria-pressed={preview?.id===item.id} onClick={()=>setFile(item.id)}><DocumentThumbnail id={item.id}/><span>{item.name}<small>{counts[item.id]!==undefined?counts[item.id]+' pages':'Select to inspect'}</small></span></button>)}</div>{!docs.length&&<small>No ready files</small>}
 {active&&<p className="subtle">Each file starts on a fresh physical sheet. The settings shown apply to every file in this submission.</p>}</Panel>}
 <Panel><div className="panel-head"><h2>Print preview</h2>{preview&&<small>{preview.name}</small>}</div>{preview?<>
 {<Tabs label="Preview mode" values={['Final sheet','Source']} value={previewMode==='sheet'?'Final sheet':'Source'} onChange={value=>setPreviewMode(value==='Final sheet'?'sheet':'source')}/>}
 {previewMode==='sheet'?<ImposedPreview id={preview.id} input={{id:active?.id??'preview',...options}}/>:<DocumentPreview key={preview.id} id={preview.id}/>}
 </>:<Empty title="Choose a document"><p>Import files from Documents to prepare a print order.</p></Empty>}
 {calculation&&<div className="print-calculation-summary" aria-live="polite"><div><small>Selected pages</small><strong>{calculation.selectedPages}</strong></div><div><small>Printed sides</small><strong>{calculation.printedSides}</strong></div><div><small>Physical sheets</small><strong>{calculation.totalPhysicalSheets}</strong></div><div><small>Blank sides</small><strong>{calculation.blankSides}</strong></div><div><small>Colour sides</small><strong>{calculation.colourSides}</strong></div><div><small>Black &amp; white sides</small><strong>{calculation.blackAndWhiteSides}</strong></div><div><small>Estimate</small><strong>{money(estimatedTotal)}</strong></div></div>}
 {calculation&&files.length>1&&<Table headers={['File','Pages','Sheets','Estimate']}>{calculation.files.map(item=><tr key={item.id}><td>{files.find(file=>file.id===item.id)?.name}</td><td>{item.calculation.selectedPages}</td><td>{item.calculation.totalPhysicalSheets}</td><td>{money(item.calculation.finalTotal)}</td></tr>)}</Table>}
 </Panel>
 <Panel className="document-print-settings"><form className="stack" onSubmit={submit}><div className={attachmentId?"stack quick-pdf-settings-scroll":"stack"}><h2>{active?'Print settings':'New order settings'}</h2>
 <Tabs label="Print settings mode" values={['Basic','Advanced']} value={mode==='basic'?'Basic':'Advanced'} onChange={value=>setMode(value==='Basic'?'basic':'advanced')}/><div className="form-grid">
 <label>Paper<select value={paper} disabled={!!matched} onChange={e=>{const value=e.target.value as typeof paper;setPaper(value);if(value==='Custom'&&!advanced.customPaper)setAdvanced(prior=>({...prior,customPaper:{widthMm:210,heightMm:297}}))}}>{paperNames.map(value=><option key={value}>{value}</option>)}</select></label>
 <label>Copies<input type="number" min="1" max="100" required value={copies} onChange={e=>setCopies(Number(e.target.value))}/></label>
 <label>Ink<select value={advanced.ink==='grayscale'?'grayscale':colour?'colour':'mono'} onChange={e=>{const value=e.target.value;setColour(value==='colour');setAdvanced(prior=>({...prior,ink:value==='grayscale'?'grayscale':'legacy'}))}}><option value="mono">Black &amp; white</option><option value="grayscale">Grayscale</option><option value="colour">Colour</option></select></label>
 <label>Orientation<select value={options.orientation} onChange={e=>{setLandscape(e.target.value==='landscape');setAdvanced(prior=>({...prior,orientation:e.target.value as typeof orientation}))}}><option value="portrait">Portrait</option><option value="landscape">Landscape</option><option value="auto" disabled={booklet||advanced.scaling==='printable'}>Auto by first selected page</option></select></label></div>
 {manualPaper==='Custom'&&!matched&&<div className="form-grid">{(['widthMm','heightMm'] as const).map(key=><label key={key}>{key==='widthMm'?'Paper width (mm)':'Paper height (mm)'}<input type="number" min="20" max="2000" value={options.customPaper?.[key]??(key==='widthMm'?210:297)} onChange={e=>setAdvanced(prior=>({...prior,customPaper:{widthMm:210,heightMm:297,...prior.customPaper,[key]:Number(e.target.value)}}))}/></label>)}</div>}
 <label>Printer<PrinterSelect value={printer} change={setPrinter} labelOutput/></label>{attachmentId&&<div className="actions"><Button className="secondary" onClick={refreshPrinters}>Refresh printers</Button><Button className="secondary" disabled={!printer} onClick={()=>void window.bloom.call('printerDialog',{printer,kind:'preferences'}).then(()=>refreshCapabilities(value=>value+1)).catch(error)}>Printer properties</Button></div>}{capabilities&&<small>{capabilities.model||capabilities.name} ? {capabilities.offline?'Offline':capabilities.error>2?'Driver error '+capabilities.error:'Windows status '+capabilities.status}</small>}
 <label>Two-sided printing<select value={duplex} onChange={e=>setDuplex(e.target.value as typeof duplex)}><option value="simplex">One-sided</option><option value="longEdge">Two-sided automatic (long edge)</option><option value="shortEdge">Two-sided automatic (short edge)</option><option value="manualLongEdge">Two-sided manual (long edge)</option><option value="manualShortEdge">Two-sided manual (short edge)</option></select></label>
 {twoSided&&calculation&&<p role="status">{calculation.totalPhysicalSheets} physical sheets / {calculation.printedSides} printed sides</p>}
 {files.some(item=>item.mime==='application/pdf')&&<p>{inkMode==='mixed'?<>Black &amp; white {money(policy.mono)} / Colour {money(policy.colour)}</>:<>{inkMode==='colour'?'Colour':'Black & white'} {money(inkMode==='colour'?policy.colour:policy.mono)}</>} per {pricedBasis==='sheet'?'physical sheet':pricedBasis==='side'?'printed side':pricedBasis==='booklet'?'booklet':'selected page'}</p>}
 {automaticDuplex&&!virtualPrinter&&unsupportedDuplex&&<p role="status">{capabilities?'This printer does not advertise automatic two-sided printing. Choose a manual two-sided mode.':'Checking printer support for automatic two-sided printing.'}</p>}
 {manualDuplex&&!virtualPrinter&&<p>Print the fronts first. BloomConnect will prompt you to reload the sheets before printing the backs.</p>}
 <label>PDF page range<input value={range} onChange={e=>setRange(e.target.value)} placeholder="All pages, or 1-3, 5"/></label>
 {attachmentId&&<fieldset className="quick-pdf-sizing"><legend>Page sizing and handling</legend>
  <div className="quick-pdf-handling" role="group" aria-label="Page handling">
   <Button aria-pressed={quickHandling==='size'} className={quickHandling==='size'?'':'secondary'} onClick={()=>{setNup(1);setBooklet(false);setAdvanced(prior=>({...prior,grid:undefined,poster:undefined,handoutNotes:false}))}}>Size</Button>
   <Button aria-pressed={quickHandling==='poster'} className={quickHandling==='poster'?'':'secondary'} onClick={()=>{setBooklet(false);setNup(1);setDuplex('simplex');setAdvanced(prior=>({...prior,grid:undefined,documentFrame:undefined,handoutNotes:false,poster:{enabled:true,scale:200,overlapMm:5,marks:true,labels:true}}))}}>Poster</Button>
   <Button aria-pressed={quickHandling==='multiple'} className={quickHandling==='multiple'?'':'secondary'} onClick={()=>{setBooklet(false);setNup(nup>1?nup:2);setAdvanced(prior=>({...prior,poster:undefined,documentFrame:undefined,handoutNotes:false}))}}>Multiple</Button>
   <Button aria-pressed={booklet} className={booklet?'':'secondary'} onClick={()=>setWizard(true)}>Booklet</Button>
  </div>
  {quickHandling==='poster'&&advanced.poster?.enabled&&<div className="form-grid">
   <label>Poster scale (%)<input type="number" min={10} max={1000} value={advanced.poster.scale??200} onChange={event=>setAdvanced(prior=>({...prior,poster:{...prior.poster,scale:Number(event.target.value)}}))}/></label>
   <label>Tile overlap (mm)<input type="number" min={0} max={40} value={advanced.poster.overlapMm??5} onChange={event=>setAdvanced(prior=>({...prior,poster:{...prior.poster,overlapMm:Number(event.target.value)}}))}/></label>
  </div>}
  {quickHandling==='multiple'&&<label>Pages per side<select value={nup} onChange={e=>{setNup(Number(e.target.value) as typeof nup);setBooklet(false);setAdvanced(prior=>({...prior,grid:undefined,poster:undefined,documentFrame:undefined,handoutNotes:false}))}}>{[...new Set([1,2,3,4,6,8,9,12,16,nup])].sort((a,b)=>a-b).map(value=><option key={value}>{value}</option>)}</select></label>}
  {(quickHandling==='size'||quickHandling==='multiple')&&<div className="quick-pdf-scale" role="group" aria-label="Scaling">
   {([['fit','Fit'],['actual','Actual size'],['shrink','Shrink oversized pages'],['percent','Custom scale']] as const).map(([value,label])=><label key={value}>
    <input type="radio" name="pdf-sizing" checked={(advanced.scaling??'fit')===value} onChange={()=>setAdvanced(prior=>({...prior,scaling:value}))}/>
    <span>{label}</span>
   </label>)}
   {advanced.scaling==='percent'&&<label className="quick-pdf-percent">Scale (%)<input type="number" min={10} max={400} value={advanced.scalePercent??100} onChange={event=>setAdvanced(prior=>({...prior,scalePercent:Number(event.target.value)}))}/></label>}
  </div>}
  <label className="check"><input type="checkbox" checked={matchPdfPaper&&canMatch} disabled={!canMatch} onChange={event=>setMatchPdfPaper(event.target.checked)}/> Match paper to PDF page size</label>
  <small>{matchHint||'Available for one PDF at 1 page per side. Uses the default printer tray for the matched paper size.'}</small>
  <details><summary>Page Setup</summary><div className="stack">
   <small>Use Paper and Orientation above to set the sheet dimensions and direction.</small>
   <label>Layout margin (mm)<input type="number" min={0} max={40} step={.5} value={marginMm} onChange={event=>{setMargin(Number(event.target.value));setAdvanced(prior=>({...prior,margins:undefined}))}}/></label>
   <label>Paper source<select value={matched?'':advanced.tray??''} disabled={!!matched||virtualPrinter||!capabilities?.trays.length} onChange={event=>setAdvanced(prior=>({...prior,tray:event.target.value?Number(event.target.value):undefined}))}><option value="">Driver default</option>{capabilities?.trays.map(tray=><option key={tray.id} value={tray.id}>{tray.name}</option>)}</select></label>
  </div></details>
 </fieldset>}
 {attachmentId&&<details className="quick-pdf-help"><summary>Print settings with examples</summary><ul>
  <li><strong>Paper and orientation.</strong> A4 Portrait is the usual size for a letter. Landscape turns the sheet sideways.</li>
  <li><strong>Page range.</strong> Enter 1–3 and 5 as <code>1-3, 5</code> to print four pages in each copy.</li>
  <li><strong>Copies.</strong> Enter 2 to print that selection twice.</li>
  <li><strong>Two-sided.</strong> Four pages at 1 page per side use 4 sheets one-sided or 2 sheets two-sided. Long edge usually flips a portrait document like a book.</li>
  <li><strong>Pages per side.</strong> Choose 2 to put four pages onto two printed sides. Choose Advanced for scaling, margins, ink processing, and driver controls.</li>
 </ul></details>}
 {!attachmentId&&<label>Pages per side<select value={nup} onChange={e=>{setNup(Number(e.target.value) as typeof nup);setBooklet(false);setAdvanced(prior=>({...prior,grid:undefined,poster:undefined,documentFrame:undefined,handoutNotes:false}))}}>{[...new Set([1,2,3,4,6,8,9,12,16,nup])].sort((a,b)=>a-b).map(value=><option key={value}>{value}</option>)}</select></label>}
 {!attachmentId&&<div className="actions"><Button className="secondary" disabled={!preview||preview.mime.startsWith('image/')} onClick={()=>setWizard(true)}>Booklet Wizard</Button></div>}
 {wizard&&preview&&<BookletWizard document={files.length>1?files.length+' documents (separate booklets)':preview.name} settings={{id:active?.id??'preview',...options}} onClose={()=>setWizard(false)} apply={applySettings}/>}
 <div hidden={mode!=='advanced'}>
 <details><summary>Presentation handouts</summary><div className="stack">
 <label className="check"><input type="checkbox" checked={!!advanced.handoutNotes} disabled={files.some(file=>file.mime.startsWith('image/'))} onChange={e=>{const enabled=e.target.checked;if(enabled){setNup(3);setBooklet(false)}setAdvanced(prior=>({...prior,handoutNotes:enabled,grid:undefined,poster:undefined,documentFrame:undefined}))}}/> Three slides with writing lines</label>
 <small>Convert PowerPoint to full-page slides in Documents. Slide ranges, colour and duplex use the same controls as PDF pages.</small>
 </div></details>
 <details><summary>Layout, margins and booklet</summary><div className="stack">
 <label className="check"><input type="checkbox" checked={!!advanced.grid} onChange={e=>{const grid=e.target.checked?{rows:2,columns:2}:undefined;if(grid){setNup(4);setBooklet(false)}setAdvanced(prior=>({...prior,grid,poster:undefined,documentFrame:undefined,handoutNotes:false}))}}/> Custom N-up grid</label>
 {advanced.grid&&<div className="form-grid">{(['rows','columns'] as const).map(key=><label key={key}>{key==='rows'?'Rows':'Columns'}<input type="number" min="1" max="8" value={advanced.grid![key]} onChange={e=>{const grid={...advanced.grid!,[key]:Number(e.target.value)};setNup(grid.rows*grid.columns);setAdvanced(prior=>({...prior,grid}))}}/></label>)}</div>}
 <label>Margin preset<select value={advanced.margins?'custom':String(marginMm)} onChange={e=>{const custom=e.target.value==='custom';if(!custom)setMargin(Number(e.target.value));setAdvanced(prior=>({...prior,margins:custom?{left:marginMm,right:marginMm,top:marginMm,bottom:marginMm}:undefined}))}}><option value="0">Zero layout margins</option><option value="5">Narrow (5 mm)</option><option value="10">Normal (10 mm)</option><option value="20">Wide (20 mm)</option>{![0,5,10,20].includes(marginMm)&&<option value={marginMm}>Uniform ({marginMm} mm)</option>}<option value="custom">Each edge separately</option></select></label>
 {advanced.margins&&<div className="form-grid">{(['left','right','top','bottom'] as const).map(edge=><label key={edge}>{edge} (mm)<input type="number" min="0" max="150" step=".5" value={advanced.margins![edge]} onChange={e=>setAdvanced(prior=>({...prior,margins:{...prior.margins!,[edge]:Number(e.target.value)}}))}/></label>)}</div>}
 <label>Binding gutter (mm)<input type="number" min="0" max="150" step=".5" value={advanced.gutterMm??0} onChange={e=>setAdvanced(prior=>({...prior,gutterMm:Number(e.target.value)}))}/></label>
 <label className="check"><input type="checkbox" checked={booklet} onChange={e=>{setBooklet(e.target.checked);if(e.target.checked){setNup(2);setLandscape(true);setDuplex('shortEdge');setAdvanced(prior=>({...prior,orientation:'landscape',grid:undefined,poster:undefined,documentFrame:undefined,handoutNotes:false}))}}}/> Saddle-stitch booklet</label>
 {booklet&&calculation&&<small>Booklet padding: {calculation.files.reduce((sum,file)=>sum+file.calculation.paddingSlots,0)} page slots across all copies.</small>}{booklet&&<label>Binding<select value={binding} onChange={e=>setBinding(e.target.value as typeof binding)}><option value="left">Left</option><option value="right">Right</option></select></label>}
 <div className="form-grid"><label>Margins - mm<input type="number" min="0" max="40" step="0.5" value={marginMm} onChange={e=>setMargin(Number(e.target.value))}/></label><label>Spacing - mm<input type="number" min="0" max="20" step="0.5" value={gapMm} onChange={e=>setGap(Number(e.target.value))}/></label></div>
 <label className="check"><input type="checkbox" checked={borders} onChange={e=>setBorders(e.target.checked)}/> Page borders</label>
 <p className="subtle">Booklets pad to a multiple of four. Select A4 for A5 booklet pages or A3 for A4 booklet pages.</p></div></details>
 <details><summary>Poster tiling</summary><div className="stack">
 <label className="check"><input type="checkbox" checked={!!advanced.poster?.enabled} onChange={e=>{if(e.target.checked){setBooklet(false);setNup(1);setDuplex('simplex')}setAdvanced(prior=>({...prior,grid:undefined,documentFrame:undefined,handoutNotes:false,poster:e.target.checked?{enabled:true,scale:200,overlapMm:5,marks:true,labels:true}:undefined}))}}/> Print a poster across multiple sheets</label>
 {advanced.poster?.enabled&&<><label>Poster scale (%)<input type="number" min="10" max="1000" value={advanced.poster.scale??200} onChange={e=>setAdvanced(prior=>({...prior,poster:{...prior.poster,scale:Number(e.target.value)}}))}/></label><label>Tile overlap (mm)<input type="number" min="0" max="40" value={advanced.poster.overlapMm??5} onChange={e=>setAdvanced(prior=>({...prior,poster:{...prior.poster,overlapMm:Number(e.target.value)}}))}/></label>{(['marks','labels'] as const).map(key=><label className="check" key={key}><input type="checkbox" checked={advanced.poster?.[key]??true} onChange={e=>setAdvanced(prior=>({...prior,poster:{...prior.poster,[key]:e.target.checked}}))}/>{key==='marks'?'Tile cut marks':'Tile assembly labels'}</label>)}</>}
 </div></details>
 {files.length>1&&<details><summary>Copies per file</summary>{files.map(file=><label key={file.id}>{file.name}<input type="number" min="1" max="100" value={advanced.fileCopies?.[file.id]??copies} onChange={e=>setAdvanced(prior=>({...prior,fileCopies:{...prior.fileCopies,[file.id]:Number(e.target.value)}}))}/></label>)}</details>}
 </div>
 {files.some(item=>item.mime.startsWith('image/'))&&<details><summary>Photo options</summary><div className="form-grid"><label>Rotation<select value={rotation} onChange={e=>setRotation(Number(e.target.value))}>{[0,90,180,270].map(value=><option key={value}>{value}</option>)}</select></label><label>Fit<select value={fit} onChange={e=>setFit(e.target.value as typeof fit)}><option value="contain">Fit inside</option><option value="cover">Fill and crop</option></select></label><label>Photo layout<select value={layout} onChange={e=>setLayout(e.target.value as typeof layout)}><option value="single">One photo</option><option value="four">Four per sheet</option><option value="passport">Six 35 x 45 mm</option></select></label></div></details>}
 <details><summary>Price calculation</summary><div className="stack"><label>Document billing basis<select value={rule?pricedBasis:twoSided?'sheet':basis} disabled={twoSided||!!rule} onChange={e=>setBasis(e.target.value as typeof basis)}><option value="page">Per selected logical page</option><option value="sheet">Per physical sheet</option><option value="side">Per printed side</option>{method==='booklet'&&<option value="booklet">Per finished booklet</option>}</select></label><p className="subtle">Shop rates in Settings &gt; Pricing apply until a matching method rate is saved. Existing orders use their recorded total until the estimate is applied.</p><DocumentPricingSettings policy={policy} paper={paper} method={method} duplex={twoSided} ruleId={rule?.id} onSaved={loadPricing}/>{calculation&&<dl className="detail-list"><div><dt>Paper</dt><dd>{money(calculation.paperCost)}</dd></div><div><dt>Printing and setup</dt><dd>{money(calculation.estimatedPrintingCost)}</dd></div><div><dt>Finishing</dt><dd>{money(calculation.finishingCost)}</dd></div></dl>}
 {calculation?.files.map(item=><small key={item.id}>{files.find(file=>file.id===item.id)?.name}: {item.calculation.pricing?.units} billable units - {money(item.calculation.finalTotal)}</small>)}
 {!active&&<div className="form-grid"><label>Discount - LKR<input type="number" min="0" step=".01" value={discount} onChange={e=>setDiscount(Number(e.target.value))}/></label><label>Additional charge - LKR<input type="number" min="0" step=".01" value={charge} onChange={e=>setCharge(Number(e.target.value))}/></label></div>}</div></details>
 <div className="total"><span>{active?'Recorded order total':'Estimated total'}</span><strong>{active?money(active.total):calculation?money(estimatedTotal):'-'}</strong></div>
 {countError&&<p role="alert">{countError}</p>}{calculationError&&<p role="alert">{calculationError}</p>}{files.length>0&&!countsReady&&!countError&&<p role="status">Reading each file's page count...</p>}
 {active&&<div className="actions"><label>Adjust order total - LKR<input type="number" min={active.paid/100} step=".01" value={quote} onChange={e=>setQuote(e.target.value)}/></label><label>Reason for price adjustment<input value={quoteReason} maxLength={500} onChange={e=>setQuoteReason(e.target.value)}/></label><Button className="secondary" disabled={!quote||quoteReason.trim().length<3||Math.round(Number(quote)*100)===active.total} onClick={()=>void run('quote',{id:active.id,total:Math.round(Number(quote)*100),reason:quoteReason},'Order total updated')}>Save total</Button></div>}
 {active&&calculation&&estimatedTotal!==active.total&&<Button className="secondary" disabled={estimatedTotal<active.paid||!!calculationError} onClick={()=>{setQuote(String(estimatedTotal/100));setQuoteReason('Applied current '+policy.basis+' estimate');void run('quote',{id:active.id,total:estimatedTotal,reason:'Operator applied current '+policy.basis+' estimate'},'Order price updated')}}>Apply current estimate to order</Button>}
 <div hidden={mode!=='advanced'}><ProfessionalSettings capabilities={capabilities} refresh={()=>refreshCapabilities(value=>value+1)} settings={{id:active?.id??'preview',...options}} change={applySettings}/></div>
 {active&&<Button className="secondary" disabled={saving||!countsReady||!!calculationError} onClick={()=>void run('savePrintPdf',{id:active.id,...options},'Prepared PDF export finished')}>Save prepared PDF</Button>}
 {printerNotice&&<p role="status" id="print-submit-block">{printerNotice}</p>}
 <p className="subtle">Paper and duplex support depend on the Windows driver. Confirm physical completion in Print Queue.</p>
 {popupError&&<p role="alert">{popupError}</p>}
 {attachmentId&&active&&<p role="status">{active.id} · Order created. Review the preview and submit when ready.</p>}
 </div><div className="print-sticky-actions"><div className="total"><span>Live estimate</span><strong>{calculation?money(estimatedTotal):'-'}</strong></div><Button type="submit" aria-describedby={printBlock?'print-submit-block':undefined} disabled={saving||!!(popupOrder&&!active)||!preview||!countsReady||!!countError||!!calculationError||!!printBlock}><Printer size={17}/>{saving?'Working...':active?pdfOutput?'Save as PDF':manualDuplex?'Start manual duplex':'Submit print job':attachmentId?'Create order to print':'Create order'}</Button></div>
 </form></Panel></div>;
}
export function Queue({history=false}:{history?:boolean}){
 const {data,run}=useData(),s=useWorkspace(),[status,filter]=useState('All'),[view,setView]=useState('List'),[close,setClose]=useState('');
 const groups=['Pending','Needs attention','Closed'];
 const lane=(value:string)=>['Completed','Cancelled'].includes(value)?'Closed':['Printing','Submitted'].includes(value)?'Pending':'Needs attention';
 const queueStatus=(value:string)=>value==='Submitted'?'Pending confirmation':value==='Printing'?'Preparing':value;
 const entries=data.queue.filter(q=>(!history||lane(q.status)==='Closed')&&(status==='All'||lane(q.status)===status)&&match(s.search,q.job_id,q.printer,q.status,queueStatus(q.status)));
 const findJob=(id:string)=>data.jobs.find(job=>job.id===id);
 const firstFile=(id:string)=>data.attachments.find(file=>findJob(id)?.files.includes(file.id))?.name??'—';
 const actionsFor=(q:typeof entries[number])=><div className="actions">{['Submitted','Unconfirmed'].includes(q.status)&&<Button onClick={()=>void run('queue',{id:q.id,status:'Completed'},'Physical completion recorded')}>Confirm printed</Button>}{['Failed','Unconfirmed','Submitted'].includes(q.status)&&<Button className="secondary" onClick={()=>setClose(q.id)}>Close entry</Button>}<Button className="quiet" onClick={()=>s.set({view:'Print Studio',job:q.job_id})}>{q.status==='Failed'?'Retry':'Open order'}</Button></div>;
 return <Panel><div className="panel-head"><div><h2>{history?'Closed submissions':'Print submissions'}</h2><p>{entries.length} entries</p></div><Button onClick={()=>s.set({view:'Print Studio',job:''})}>Open Print Studio</Button></div>
 <div className="queue-toolbar">{!history&&<Tabs label="Queue status" values={['All',...groups]} value={status} onChange={filter}/>}<Tabs label="Queue view" values={['List','Board']} value={view} onChange={setView}/></div>
 {view==='List'?<Table headers={['Order','Customer / file','Printer','Status','Date','Actions']}>{entries.map(q=><tr key={q.id}><td>{q.job_id}<small>{findJob(q.job_id)?.copies??'—'} copies</small></td><td>{name(data,findJob(q.job_id)?.customer_id??null)}<small>{firstFile(q.job_id)}</small></td><td>{q.printer}</td><td><Badge>{queueStatus(q.status)}</Badge>{q.error&&<small>{q.error}</small>}</td><td>{stamp(q.created)}</td><td>{actionsFor(q)}</td></tr>)}</Table>:
 <div className="queue-lanes">{(history?['Closed']:status==='All'?groups:[status]).map(group=><section className="queue-lane" key={group}><h3>{group}</h3>{entries.filter(q=>lane(q.status)===group).map(q=><article className="print-job-card" key={q.id}><div className="panel-head"><strong>{q.job_id}</strong><Badge>{queueStatus(q.status)}</Badge></div><p>{name(data,findJob(q.job_id)?.customer_id??null)}</p><p>{firstFile(q.job_id)}</p><small>{q.printer} · {findJob(q.job_id)?.copies??'—'} copies</small>{q.error&&<p>{q.error}</p>}{actionsFor(q)}</article>)}</section>)}</div>}
 {!entries.length&&<Empty title={history?'No closed print submissions':'No matching print submissions'}/>}
 {close&&<DetailDrawer title="Close print entry" presentation="center" onClose={()=>setClose('')}><div className="stack"><p>This closes the BloomConnect entry. Any Windows spooler job needs to be managed separately.</p><div className="actions"><Button className="secondary" onClick={()=>setClose('')}>Keep entry</Button><Button onClick={async()=>{if(await run('queue',{id:close,status:'Cancelled'},'Queue entry closed'))setClose('')}}>Close entry</Button></div></div></DetailDrawer>}</Panel>;
}
export function Orders(){
 const {data,run}=useData(),s=useWorkspace(),[status,filter]=useState('All'),[date,setDate]=useState(''),[customer,setCustomer]=useState(''),[selected,setSelected]=useState('');
 const jobs=data.jobs.filter(j=>(status==='All'||j.status===status)&&(!date||colomboDay(j.created)===date)&&(!customer||j.customer_id===customer)&&match(s.search,j.id,name(data,j.customer_id),j.status));
 const detail=data.jobs.find(job=>job.id===selected);
 const buttons=(job:Job)=><div className="actions"><Button className="quiet" onClick={()=>s.set({view:'Print Studio',job:job.id})}>Print</Button><Button className="quiet" onClick={()=>s.set({view:'Payments',job:job.id})}>Payments</Button><Button className="quiet" disabled={job.status==='Cancelled'} onClick={()=>void run('confirmPrice',{id:job.id,total:job.total},'Order price confirmed')}>Confirm price</Button></div>;
 const stage=(job:Job)=><select aria-label={'Status '+job.id} value={job.status} onChange={e=>void run('stage',{id:job.id,status:e.target.value as Job['status']},'Order status updated')}>{stages.map(a=><option key={a}>{a}</option>)}</select>;
 return <Panel><div className="panel-head"><h2>Shop orders</h2><Button onClick={()=>s.set({view:'Print Studio',job:''})}><Plus size={16}/> New order</Button></div>
 <Tabs label="Order status" values={['All',...stages]} value={status} onChange={filter}/><div className="filter-bar"><input type="date" aria-label="Order date" value={date} onChange={e=>setDate(e.target.value)}/><select aria-label="Order customer" value={customer} onChange={e=>setCustomer(e.target.value)}><option value="">All customers</option>{data.customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
 <Table headers={['Order','Customer','Print details','Status','Total','Payment','Actions']}>{jobs.map(j=><tr key={j.id} className={s.job===j.id?'highlight':''}><td><button className="text-button" onClick={()=>setSelected(j.id)}>{j.id}</button><small>{stamp(j.created)}</small></td><td>{name(data,j.customer_id)}</td><td>{j.files.length} files · {j.copies} copies · {j.paper} · {j.colour?'Colour':'B&W'}</td><td>{stage(j)}</td><td>{money(j.total)}</td><td><Badge>{j.paid>=j.total?'Paid':j.paid?'Partially Paid':'Unpaid'}</Badge></td><td>{buttons(j)}</td></tr>)}</Table>
 {!jobs.length&&<Empty title="No matching orders"/>}{detail&&<DetailDrawer title={detail.id} onClose={()=>setSelected('')}><div className="stack"><p>{name(data,detail.customer_id)} · {stamp(detail.created)}</p><label>Status{stage(detail)}</label><dl className="detail-list"><div><dt>Order total</dt><dd>{money(detail.total)}</dd></div><div><dt>Paid</dt><dd>{money(detail.paid)}</dd></div><div><dt>Outstanding</dt><dd>{money(detail.total-detail.paid)}</dd></div></dl><h3>Documents</h3>{detail.files.map(id=><button className="file-link" key={id} onClick={()=>s.set({view:'Documents',attachment:id})}>{data.attachments.find(file=>file.id===id)?.name??'Document'}</button>)}{buttons(detail)}</div></DetailDrawer>}</Panel>;
}
export function Payments(){
 const {data,run}=useData(),s=useWorkspace(),[amount,setAmount]=useState(''),[method,setMethod]=useState<Input<'payment'>['method']>('Cash'),[saving,setSaving]=useState(false);
 const active=data.jobs.find(j=>j.id===s.job);
 const [receipt,setReceipt]=useState(''),[query,setQuery]=useState('');
 const item=data.payments.find(payment=>payment.id===receipt);
 const owing=data.jobs.filter(job=>job.status!=='Cancelled'&&job.paid<job.total);
 return <div className="stack"><div className="summary-grid"><StatCard label="Today's revenue" value={money(data.payments.filter(payment=>colomboDay(payment.created)===colomboDay(new Date())).reduce((sum,payment)=>sum+payment.amount,0))} icon={Wallet} tone="emerald"/><StatCard label="Payments recorded" value={data.payments.length} icon={Wallet}/><StatCard label="Orders awaiting payment" value={owing.length} icon={ShoppingBag} tone="amber"/><StatCard label="Outstanding" value={money(owing.reduce((sum,job)=>sum+job.total-job.paid,0))} icon={Wallet} tone="cyan"/></div>
 <div className="split"><Panel><div className="panel-head"><h2>Payment history</h2><input className="field-search" aria-label="Search payments" placeholder="Search payments" value={query} onChange={e=>setQuery(e.target.value)}/></div><Table headers={['Order','Amount','Method','Date','Receipt']}>{data.payments.filter(p=>match(s.search,p.job_id,p.method)&&match(query,p.job_id,p.method)).map(p=><tr key={p.id}><td>{p.job_id}</td><td>{money(p.amount)}</td><td>{p.method}</td><td>{stamp(p.created)}</td><td><div className="actions"><Button className="quiet" onClick={()=>setReceipt(p.id)}>Preview</Button><Button className="quiet" onClick={()=>void run('receipt',{id:p.id})}>Save PDF</Button></div></td></tr>)}</Table>{!data.payments.length&&<Empty title="No payments recorded"/>}</Panel><Panel><form className="stack" onSubmit={async e=>{e.preventDefault();if(!active||saving)return;setSaving(true);try{if(await run('payment',{id:active.id,amount:Math.round(Number(amount)*100),method},'Payment recorded'))setAmount('')}finally{setSaving(false)}}}>
 <h2>Record a payment</h2><label>Order<select value={active?.id??''} onChange={e=>{s.set({job:e.target.value});setAmount('')}}><option value="">Choose an order</option>{data.jobs.map(j=><option key={j.id} value={j.id}>{j.id} · {name(data,j.customer_id)}</option>)}</select></label>{active&&<div className="total"><span>Balance</span><strong>{money(active.total-active.paid)}</strong></div>}<label>Amount · LKR<input type="number" min=".01" max={active?(active.total-active.paid)/100:undefined} step=".01" required value={amount} onChange={e=>setAmount(e.target.value)}/></label><label>Method<select value={method} onChange={e=>setMethod(e.target.value as typeof method)}>{['Cash','Bank Transfer','Other'].map(m=><option key={m}>{m}</option>)}</select></label><Button type="submit" disabled={saving||!active||active.total<=active.paid}>Record payment</Button></form></Panel></div>{item&&<DetailDrawer title="Payment receipt" onClose={()=>setReceipt('')}><div className="stack"><h3>{data.settings?.shop}</h3><dl className="detail-list"><div><dt>Order</dt><dd>{item.job_id}</dd></div><div><dt>Amount</dt><dd>{money(item.amount)}</dd></div><div><dt>Method</dt><dd>{item.method}</dd></div><div><dt>Date</dt><dd>{stamp(item.created)}</dd></div></dl><div className="actions"><Button onClick={()=>void run('receipt',{id:item.id})}>Save printable PDF</Button></div></div></DetailDrawer>}</div>
}
export function Reports(){
 const {data}=useData(),[period,setPeriod]=useState('30'),search=useWorkspace(s=>s.search);
 const threshold=Date.now()-Number(period)*86400000;
 const payments=data.payments.filter(p=>Date.parse(p.created)>=threshold),jobs=data.jobs.filter(j=>Date.parse(j.created)>=threshold);
 return <div className="stack"><Panel><div className="panel-head"><h2>Shop performance</h2><select aria-label="Report period" value={period} onChange={e=>setPeriod(e.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="365">Last 365 days</option></select></div><div className="report-metrics"><div><span>Collected</span><strong>{money(payments.reduce((n,p)=>n+p.amount,0))}</strong></div><div><span>Orders</span><strong>{jobs.length}</strong></div><div><span>Outstanding</span><strong>{money(jobs.filter(j=>j.status!=='Cancelled').reduce((n,j)=>n+j.total-j.paid,0))}</strong></div><div><span>Completed orders</span><strong>{jobs.filter(j=>j.status==='Completed').length}</strong></div><div><span>Print submissions</span><strong>{data.queue.filter(q=>Date.parse(q.created)>=threshold).length}</strong></div><div><span>New customers</span><strong>{data.customers.filter(c=>Date.parse(c.created)>=threshold).length}</strong></div></div></Panel><div className="dashboard-grid"><RevenueChart payments={payments} days={Math.min(Number(period),30)}/><Panel><div className="panel-head"><h2>Document types</h2></div><dl className="detail-list">{['PDF','Images','Other'].map((label,index)=><div key={label}><dt>{label}</dt><dd>{data.attachments.filter(file=>Date.parse(file.created)>=threshold&&(index===0?file.mime==='application/pdf':index===1?file.mime.startsWith('image/'):file.mime!=='application/pdf'&&!file.mime.startsWith('image/'))).length}</dd></div>)}</dl></Panel></div><Panel><div className="panel-head"><h2>Activity & automation log</h2></div><Table headers={['Event','Details','Date']}>{data.activity.filter(a=>Date.parse(a.created)>=threshold&&match(search,a.kind,a.detail)).map(a=><tr key={a.id}><td>{a.kind}</td><td>{a.detail}</td><td>{stamp(a.created)}</td></tr>)}</Table></Panel></div>
}
