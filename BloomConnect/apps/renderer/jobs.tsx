import {defaultDocumentDpi} from '../../packages/printing/raster-budget';
import {isAutomaticDuplex,isManualDuplex} from '../../packages/printing/duplex';
import {useQueryClient} from '@tanstack/react-query';
import {PhotoStudio} from './photos';
import {BatchPdfStudio,type BatchPdfEditor} from './batch-pdfs';
import type {PrinterCapabilities} from '../../packages/printing/windows';
import {canPrintWithoutCapabilities,isFileOutputPrinter,isPdfPrinter,isVirtualPrinter,printerSupplyWarning,validateSubmissionPrinter} from '../../packages/printing/capabilities';
import {paperNames} from '../../packages/printing/paper';
import {BookletWizard,DocumentPricingSettings,DuplexOptions,DuplexTest,PrintEstimate,ProfessionalSettings,SkipAutoMessages} from './print-settings';
import {normalizedSettings,type PrintSettingsInput} from '../../packages/printing/settings';
import {packsPhotoCopies,planDocument,selectedPages,type DocumentInfo} from '../../packages/printing/plan';
import {inspectDocument,needsPixelAnalysis} from './pdf';
import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {BookOpen,Files,FileText,Plus,Printer,ShoppingBag,Wallet} from 'lucide-react';
import {colomboDay,DetailDrawer,PageLayoutChoices,RevenueChart,StatCard,Tabs} from './design';
import {schemas,stages,type Input,type Job,type PricingRule,type PrintPreset} from '../../packages/shared/contracts';
import {billMessage} from '../../packages/shared/bill-message';
import {useData,Button,Panel,Badge,Empty,Table,PrinterSelect,PrinterPropertiesButton,match,stamp,money,name,orderStatusLabels} from './context';
import {useWorkspace} from './state';
import {DocumentPreview,DocumentThumbnail,ImposedPreview} from './pdf';
import {calculateBulk,documentPricing,paperSizes,type CalculationInput} from '../../packages/printing/calculation';
export function Studio(){
 const {data}=useData(),state=useWorkspace();
 const active=data.jobs.find(j=>j.id===state.job);
 const [mode,setMode]=useState<'pdf'|'batch'|'photo'>(active?.printSettings?.batchPdfFiles?'batch':state.photoStudio?'photo':'pdf');
 useEffect(()=>{
  if(!active)return;
  if(active.printSettings?.batchPdfFiles){setMode('batch');return}
  setMode(Object.keys(active.printSettings?.photoItems??{}).length||active.files.some(id=>data.attachments.find(file=>file.id===id)?.mime.startsWith('image/'))?'photo':'pdf');
 },[active?.id]);
 return <><div className="actions">
  <Button className={mode==='pdf'?'':'secondary'} aria-pressed={mode==='pdf'} onClick={()=>{if(active?.printSettings?.batchPdfFiles)state.set({job:''});setMode('pdf')}}>Print documents</Button>
  <Button className={mode==='batch'?'':'secondary'} aria-pressed={mode==='batch'} onClick={()=>setMode('batch')}>PDF batch</Button>
  <Button className={mode==='photo'?'':'secondary'} aria-pressed={mode==='photo'} onClick={()=>{if(active?.printSettings?.batchPdfFiles)state.set({job:''});setMode('photo')}}>Print photos</Button>
 </div>{mode==='photo'?<PhotoStudio onBack={()=>{state.set({job:'',photoStudio:false});setMode('pdf')}}/>:mode==='batch'?<BatchPdfStudio renderEditor={renderBatchEditor} renderBill={renderBatchBill}/>:<PdfStudio/>}</>;
}
export function PdfPrintPopup(){
 const {data}=useData(),state=useWorkspace();
 const seen=useRef<Set<string> | null>(null);
 const pending=useRef<string[]>([]);
 const [batchFile,setBatchFile]=useState('');
 const [batchOpen,setBatchOpen]=useState(false);
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
 const explicitBatch=state.pdfBatchDraft.length>0;
 const batch=explicitBatch||batchOpen&&batchFile===file.id;
 return <DetailDrawer key={file.id} title={batch?'Customer PDF batch':'PDF Print Preview'} presentation="wide" onClose={()=>{setBatchFile('');setBatchOpen(false);state.set({pdfPrintAttachment:'',pdfBatchDraft:[]})}}>
  {!explicitBatch&&<Button className="secondary" onClick={()=>{setBatchFile(file.id);setBatchOpen(!batch)}}>{batch?'Back to single PDF':'Print several PDFs for this customer'}</Button>}
  {(explicitBatch||batchFile===file.id)&&<div hidden={!batch}><BatchPdfStudio initialFile={file.id} initialFiles={state.pdfBatchDraft} renderEditor={renderBatchEditor} renderBill={renderBatchBill} onSubmitted={id=>{pending.current=pending.current.filter(file=>file!==id)}}/></div>}
  {!explicitBatch&&<div hidden={batch}><PdfStudio attachmentId={file.id}/></div>}
 </DetailDrawer>;
}

function renderBatchEditor(editor:BatchPdfEditor){
 return <PdfStudio key={editor.id} attachmentId={editor.id} batchEditor={editor}/>;
}
function renderBatchBill(id:string,onClose:()=>void){
 return <BatchBill id={id} onClose={onClose}/>;
}
function BatchBill({id,onClose}:{id:string;onClose:()=>void}){
 const {data}=useData();
 const order=data.jobs.find(job=>job.id===id);
 return order?<BillDrawer order={order} onClose={onClose}/>:null;
}
function PdfStudio({attachmentId,batchEditor}:{attachmentId?:string;batchEditor?:BatchPdfEditor}={}){
 const {data,run,error,refresh,printers}=useData(),state=useWorkspace();
 const queryClient=useQueryClient();
 const [popupOrder,setPopupOrder]=useState('');
 const [popupError,setPopupError]=useState('');
 const printBlockId=useId();
 const [skipAutoMessages,setSkipAutoMessages]=useState(false);
 const [presets,setPresets]=useState<PrintPreset[]>([]);
 const [defaultPreset,setDefaultPreset]=useState<string|null>(null);
 const settingsTouched=useRef(false),submitInFlight=useRef(false);
 const active=data.jobs.find(j=>j.id===(attachmentId?popupOrder:state.job));
 const [wizard,setWizard]=useState(false);
 const [pricingRules,setPricingRules]=useState<PricingRule[]>([]);
 const [pricingReady,setPricingReady]=useState(false),[pricingError,setPricingError]=useState(false);
 const loadPricing=async()=>{
  setPricingReady(false);setPricingError(false);
  try{setPricingRules(await window.bloom.call('pricingRules',null));setPricingReady(true)}
  catch(e){setPricingError(true);error(e)}
 };
 useEffect(()=>{void loadPricing()},[]);
 const [capabilities,setCapabilities]=useState<PrinterCapabilities>();
 const [advanced,setAdvanced]=useState<Partial<PrintSettingsInput>>({});
 const [quote,setQuote]=useState(''),[quoteReason,setQuoteReason]=useState(''),[file,setFile]=useState(''),[copies,setCopies]=useState(1);
 const [matchPdfPaper,setMatchPdfPaper]=useState(false);
 const [manualPaper,setPaper]=useState<Input<'print'>['paper']>('A4'),[colour,setColour]=useState(false),[range,setRange]=useState('');
 const [selectedPrinter,setPrinter]=useState(data.settings?.printer||localStorage.getItem('lastDocumentPrinter')||''),[landscape,setLandscape]=useState(false),[selectedDuplex,setDuplex]=useState<Input<'print'>['duplex']>();
 const [rotation,setRotation]=useState(0),[fit,setFit]=useState<Input<'print'>['fit']>('contain'),[layout,setLayout]=useState<Input<'print'>['layout']>('single');
 const [nup,setNup]=useState<NonNullable<Input<'print'>['nup']>>(1),[booklet,setBooklet]=useState(false),[binding,setBinding]=useState<'left'|'right'>('left');
 const [marginMm,setMargin]=useState(0),[gapMm,setGap]=useState(0),[borders,setBorders]=useState(false);
 const [basis,setBasis]=useState<'page'|'sheet'|'side'>('sheet'),[discount,setDiscount]=useState(0),[charge,setCharge]=useState(0),[saving,setSaving]=useState(false);
 const [inspection,setInspection]=useState<{infos:Record<string,DocumentInfo>;analysed:boolean}>({infos:{},analysed:false});
 const infos=inspection.infos;
 const analyse=needsPixelAnalysis(advanced);
 const [counts,setCounts]=useState<Record<string,number>>({}),[countError,setCountError]=useState(''),[previewMode,setPreviewMode]=useState<'source'|'sheet'>('sheet');
 const docs=attachmentId?data.attachments.filter(a=>a.id===attachmentId):active?active.files.map(id=>data.attachments.find(a=>a.id===id)).filter((item):item is typeof data.attachments[number]=>!!item):data.attachments.filter(a=>a.status==='Ready');
 const preview=docs.find(a=>a.id===file)??(active||attachmentId?docs[0]:undefined);
 const files=active?docs:preview?[preview]:[];
 const defaultDuplex=files.length>0&&files.every(item=>item.mime==='application/pdf')?'auto':'simplex';
 const duplex=selectedDuplex??defaultDuplex;
 const fileKey=files.map(item=>item.id+':'+item.status).join('|');
 useEffect(()=>{
  let current=true;setCountError('');
  void (async()=>{
   const values:Record<string,number>={},metadata:Record<string,DocumentInfo>={};
   // Bound PDF decoding and IPC memory: load metadata in sequence, releasing each worker.
   for(const item of files){
    if(item.status!=='Ready')throw new Error(item.name+' is not downloaded yet.');
    if(!current)return;
    metadata[item.id]=await inspectDocument(item.id,analyse);values[item.id]=metadata[item.id].pages.length;
   }
   if(current){setCounts(values);setInspection({infos:metadata,analysed:analyse})}
  })().catch(e=>{if(current){setCounts({});setCountError(e.message??String(e))}});
  return()=>{current=false};
 },[fileKey,analyse]);
 useEffect(()=>{
  if(attachmentId){if(active)setQuote(String(active.total/100));return}
  const previous=data.queue.find(entry=>entry.job_id===active?.id&&entry.settings&&['Submitted','Completed','Unconfirmed'].includes(entry.status));
  let parsed:unknown=null;try{parsed=previous?.settings?JSON.parse(previous.settings):null}catch{}
  const saved=schemas.print.safeParse(parsed),options=saved.success?saved.data:active?.printSettings;
  setCopies(options?.copies??active?.copies??1);setPaper(options?.paper??(Object.hasOwn(paperSizes,active?.paper??'')?active!.paper as Input<'print'>['paper']:'A4'));
  setColour(options?.colour??!!active?.colour);setRange(options?.range??'');setFile('');setQuote(active?String(active.total/100):'');
  setPrinter(options?.printer??(data.settings!.printer||localStorage.getItem('lastDocumentPrinter')||''));setLandscape(options?.landscape??false);setDuplex(options?.duplex);
  setRotation(options?.rotation??0);setFit(options?.fit??'contain');setLayout(options?.layout??'single');
  setAdvanced(options??{});setNup(options?.nup??1);setBooklet(options?.booklet??false);setBinding(options?.binding??'left');setMargin(options?.marginMm??0);setGap(options?.gapMm??0);setBorders(options?.borders??false);
  const priorBasis=active?.calculations?.[0]?.result.pricing?.basis;
  setBasis(priorBasis==='page'||priorBasis==='side'?priorBasis:'sheet');setDiscount(0);setCharge(0);
 },[active?.id]);
 const orientation=advanced.orientation==='auto'?'auto':landscape?'landscape':'portrait';
 const applySettings=(value:Partial<PrintSettingsInput>)=>{setAdvanced(prior=>({...prior,...value,...(value.paper&&{customPaper:value.customPaper,grid:value.grid,poster:value.poster,documentFrame:value.documentFrame,handoutNotes:value.handoutNotes??false,signaturePages:value.signaturePages,margins:value.margins,driverDpi:value.driverDpi,tray:value.tray})}));if(value.paper)setPaper(value.paper);if(value.copies)setCopies(value.copies);if(value.colour!==undefined)setColour(value.colour);if(value.landscape!==undefined)setLandscape(value.landscape);if(value.fit)setFit(value.fit);if(value.layout)setLayout(value.layout);if(value.duplex)setDuplex(value.duplex);if(value.range!==undefined)setRange(value.range);if(value.nup)setNup(value.nup);if(value.booklet!==undefined)setBooklet(value.booklet);if(value.binding)setBinding(value.binding);if(value.marginMm!==undefined)setMargin(value.marginMm);if(value.gapMm!==undefined)setGap(value.gapMm);if(value.borders!==undefined)setBorders(value.borders);if(value.printer!==undefined)setPrinter(value.printer)};
 useEffect(()=>{
  if(batchEditor)applySettings(batchEditor.settings);
  let current=true;
  void window.bloom.call('printPresets',null).then(({presets,defaultId})=>{
   if(!current)return;
   setPresets(presets);setDefaultPreset(defaultId);
   const preset=presets.find(item=>item.id===defaultId);
   if(!batchEditor&&!active&&preset&&!settingsTouched.current)applySettings({...preset.settings,printer:preset.settings.printer||selectedPrinter});
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
 const options={...baseOptions,paper,renderDpi:advanced.renderDpi??defaultDocumentDpi(paper,matched?.customPaper??baseOptions.customPaper),orientation:matched&&orientation==='portrait'&&advanced.orientation===undefined?'auto' as const:orientation,...(matched&&{customPaper:matched.customPaper,tray:undefined})} as const;
 const paperWidth=options.customPaper?.widthMm,paperHeight=options.customPaper?.heightMm;
 const [capabilityError,setCapabilityError]=useState('');
 const [capabilityRefresh,refreshCapabilities]=useState(0);
 useEffect(()=>{
  let current=true;setCapabilities(undefined);setCapabilityError('');
  if(printer)void window.bloom.call('printerCapabilities',{printer,settings:{...options,printable:undefined}}).then(value=>{if(current)setCapabilities(value)}).catch(e=>{if(current)setCapabilityError(e.message)});
  return()=>{current=false};
 },[printer,paper,paperWidth,paperHeight,options.orientation,capabilityRefresh]);
 const twoSided=duplex!=='simplex';
 const manualDuplex=isManualDuplex(duplex);
 const pdfOutput=isPdfPrinter(printer,capabilities?.driver);
 const fileOutput=isFileOutputPrinter(capabilities?.port??'');
 const virtualPrinter=isVirtualPrinter(printer)||isVirtualPrinter(capabilities?.driver??'')||fileOutput;
 const quickHandling=booklet?'booklet':advanced.poster?.enabled?'poster':nup>1?'multiple':'size';
 const method=booklet?'booklet':options.poster?.enabled?'poster':nup>1?'nup':'ordinary';
 const rule=pricingRules.find(value=>value.method===method&&value.paper===paper&&value.duplex===twoSided&&(!value.media||value.media==='Default'));
 const policy=rule?.policy??documentPricing(data.settings!,duplex,basis,paper);
 const pricedBasis=policy.basis??'sheet';
 const automaticDuplex=isAutomaticDuplex(duplex);
 const manualFallback=!virtualPrinter&&automaticDuplex&&capabilities?.duplex===false;
 const inkMode=advanced.ink==='auto'||advanced.ink==='mixed'?'mixed':advanced.ink==='grayscale'?'grayscale':advanced.ink==='mono'?'mono':advanced.ink==='colour'||colour?'colour':'mono';
 const countsReady=files.length>0&&(!analyse||inspection.analysed)&&files.every(item=>counts[item.id]!==undefined);
 let calculation:ReturnType<typeof calculateBulk>|undefined,calculationError='';
 let calculations:{id:string;settings:CalculationInput}[]=[];
 try{
  if(countsReady){
   calculations=files.map(item=>{
    const image=item.mime.startsWith('image/');
    const packed=packsPhotoCopies(item.mime,options);
    const fileCopies=options.fileCopies?.[item.id]??copies;
    const plan=planDocument({...options,copies:fileCopies},infos[item.id]);
    const colourPages=[...new Set(plan.sides.flatMap(side=>side.placements.filter(p=>p.colour).map(p=>p.page)))];
    const packedPages=packed?Array.from({length:fileCopies},(_,index)=>index+1):undefined;
    const settings:CalculationInput={documentPages:packed?fileCopies:counts[item.id],selectedPages:packedPages??plan.selected,copies:plan.settings.copies,paper,customPaper:options.customPaper,
     mode:inkMode,colourPages:packedPages&&colourPages.length?packedPages:colourPages,
     uncertainPages:plan.needsConfirmation?(packedPages??plan.selected).filter(page=>infos[item.id].pages[(packed?1:page)-1].ink==='uncertain'):[],
     pagesPerSide:nup,duplex,signaturePages:options.signaturePages,imposition:method==='booklet'||method==='poster'?method:'ordinary',binding,
     posterTiles:method==='poster'?plan.sides.map(side=>side.placements[0].page):undefined,
     pricing:image?{basis:'sheet',mono:data.settings!.photo,colour:data.settings!.photo}:policy};
    return {id:item.id,settings};
   });
   calculation=calculateBulk(calculations.map(item=>({...item,customer:files.find(file=>file.id===item.id)!.customer_id})));
  }
  if(calculation?.needsConfirmation)calculationError='Review colour analysis under Colour and confirm the estimated colour pages before printing.';
  if(booklet&&!landscape)throw new Error('Booklet sheets require landscape orientation.');
 }catch(e){
  calculationError=e instanceof Error?e.message:'Invalid print settings';
  if(/page range|outside the document/i.test(calculationError)&&preview&&counts[preview.id])calculationError='Enter pages from 1 to '+counts[preview.id]+'. For example, enter a page number or a range such as 1-3.';
 }
 const extra=Math.round(charge*100),reduction=Math.round(discount*100);
 const estimatedTotal=calculation?calculation.finalTotal+extra-reduction:0;
 if(!active&&!batchEditor&&!calculationError){
  if([extra,reduction].some(value=>!Number.isInteger(value)||value<0||value>100000000))calculationError='Enter a charge and discount between LKR 0 and LKR 1,000,000.';
  else if(estimatedTotal<0)calculationError='Discount cannot exceed the subtotal plus the additional charge.';
 }
 const driverFallback=!!capabilityError&&canPrintWithoutCapabilities(options);
 const printerListed=printers.some(item=>item.name===printer);
 const supplyWarning=capabilities?printerSupplyWarning(capabilities.error):'';
 let driverBlock=capabilityError&&!driverFallback?'Could not read the selected printer’s settings. Check the connection and refresh printers.':'';
 if(capabilities){try{validateSubmissionPrinter(schemas.print.parse({id:active?.id??'preview',...options}),capabilities,virtualPrinter)}catch(e){driverBlock=e instanceof Error?e.message:String(e)}}
 const printerNotice=!printerListed?(printers.length?'Select an available Windows printer.':'Windows returned no printers. Add one under Windows Settings > Printers & scanners, then refresh.'):
  pdfOutput?'This printer creates a PDF file. Choose a physical printer to print on paper.':
  driverBlock||(driverFallback?'Windows could not read the printer settings. Standard printing is available. Two-sided jobs use manual paper reloading.':!capabilities?'Checking Windows printer capabilities.':supplyWarning||(virtualPrinter?'This virtual printer can open a Windows dialog or another app.':''));
 const printBlock=batchEditor?'':active?.status==='Cancelled'?'Reopen the cancelled order before printing.':!printerListed||!pdfOutput&&(driverBlock||!capabilities&&!driverFallback)?printerNotice:'';
 const messageCustomer=active?active.customer_id:preview?.customer_id;
 useEffect(()=>setSkipAutoMessages(active?.skipAutoMessages??false),[messageCustomer,active?.id,active?.skipAutoMessages]);
 const formReady=!!preview&&countsReady&&pricingReady&&!!calculation&&!calculationError&&!countError&&(!popupOrder||!!active);
 function resetDefaults(){
  const preset=presets.find(item=>item.id===defaultPreset);
  settingsTouched.current=true;
  setAdvanced({});setMatchPdfPaper(false);setRotation(0);
  setBasis('sheet');setDiscount(0);setCharge(0);
  applySettings({...normalizedSettings({printer,paper:'A4',copies:1,colour:false,landscape:false,duplex:defaultDuplex,range:'',rotation:0,fit:'contain',layout:'single'}),...preset?.settings,printer:preset?.settings.printer||printer});
 }
 function selectPagesPerSide(value:number){
  settingsTouched.current=true;setNup(value);setBooklet(false);
  setAdvanced(prior=>({...prior,grid:undefined,poster:undefined,documentFrame:undefined,handoutNotes:false}));
 }
 async function submit(e?:FormEvent,saveOnly=false){
  e?.preventDefault();
  if(!preview||!formReady||submitInFlight.current||!saveOnly&&printBlock)return;
  submitInFlight.current=true;setSaving(true);setPopupError('');
  let id=active?.id;
  try{
   if(batchEditor){batchEditor.apply(normalizedSettings(options));return}
   if(!id){
    id=await window.bloom.call('order',{customer:preview.customer_id,files:[preview.id],copies,paper,colour,price:0,discount:reduction,charge:extra,calculations,printSettings:options,skipAutoMessages});
    if(attachmentId)setPopupOrder(id);else state.set({job:id});
   }
   if(saveOnly){await refresh();return}
   if(pdfOutput){await window.bloom.call('savePrintPdf',{id,...options});await refresh();return}
   await window.bloom.call('print',{id,...options,skipAutoMessages});
   localStorage.setItem('lastDocumentPrinter',printer);
   state.set({pdfPrintAttachment:'',view:'Print Queue',job:id});
   await refresh();
  }catch(e){
   if(id&&!active)void refresh();
   const reason=(e instanceof Error?e.message:String(e)).replace(/^Error invoking remote method 'bloom:call':\s*(?:Error:\s*)?/,'');
   if(attachmentId)setPopupError(reason);else error(new Error(reason));
  }finally{submitInFlight.current=false;setSaving(false)}
 }
 return <div className={batchEditor?'batch-editor-content':"studio-workspace"+(attachmentId?" quick-pdf-workspace":"")}>{!attachmentId&&<Panel className="studio-list"><h2>Customer files</h2>
 <select aria-label="Order" value={active?.id??''} onChange={e=>state.set({job:e.target.value})}><option value="">New order</option>{data.jobs.map(j=><option key={j.id} value={j.id}>{j.id} - {name(data,j.customer_id)}</option>)}</select>
 <div className="studio-files">{docs.map(item=><button key={item.id} type="button" aria-pressed={preview?.id===item.id} onClick={()=>setFile(item.id)}><DocumentThumbnail id={item.id}/><span>{item.name}<small>{counts[item.id]!==undefined?counts[item.id]+' pages':'Select to inspect'}</small></span></button>)}</div>{!docs.length&&<small>No ready files</small>}
 {active&&<p className="subtle">Each file starts on a fresh physical sheet. The settings shown apply to every file in this submission.</p>}</Panel>}
 {!batchEditor&&<Panel><div className="panel-head"><h2>Print preview</h2>{preview&&<small>{preview.name}</small>}</div>{preview?<>
 {<Tabs label="Preview mode" values={['Final sheet','Source']} value={previewMode==='sheet'?'Final sheet':'Source'} onChange={value=>setPreviewMode(value==='Final sheet'?'sheet':'source')}/>}
 {previewMode==='sheet'?<ImposedPreview id={preview.id} input={{id:active?.id??'preview',...options}}/>:<DocumentPreview key={preview.id} id={preview.id}/>}
 </>:<Empty title="Choose a document"><p>Import files from Documents to prepare a print order.</p></Empty>}
 {calculation&&<div className="print-calculation-summary" aria-live="polite"><div><small>Selected pages</small><strong>{calculation.selectedPages}</strong></div><div><small>Printed sides</small><strong>{calculation.printedSides}</strong></div><div><small>Physical sheets</small><strong>{calculation.totalPhysicalSheets}</strong></div><div><small>Blank sides</small><strong>{calculation.blankSides}</strong></div><div><small>Colour sides</small><strong>{calculation.colourSides}</strong></div><div><small>Black &amp; white sides</small><strong>{calculation.blackAndWhiteSides}</strong></div><div><small>Estimate</small><strong>{money(estimatedTotal)}</strong></div></div>}
 {calculation&&files.length>1&&<Table headers={['File','Pages','Sheets','Estimate']}>{calculation.files.map(item=><tr key={item.id}><td>{files.find(file=>file.id===item.id)?.name}</td><td>{item.calculation.selectedPages}</td><td>{item.calculation.totalPhysicalSheets}</td><td>{money(item.calculation.finalTotal)}</td></tr>)}</Table>}
 </Panel>}
 <Panel className="document-print-settings"><form className="stack" onSubmit={submit} onChangeCapture={()=>{settingsTouched.current=true}}><div inert={saving} className={batchEditor?"stack":"stack document-print-settings-scroll"}>{!batchEditor&&<h2>Print settings</h2>}
 <div className="form-grid">
 <label>Paper<select value={paper} disabled={!!matched} onChange={e=>{const value=e.target.value as typeof paper;setPaper(value);if(value==='Custom'&&!advanced.customPaper)setAdvanced(prior=>({...prior,customPaper:{widthMm:210,heightMm:297}}))}}>{paperNames.map(value=><option key={value}>{value}</option>)}</select></label>
 <label>Copies<input type="number" min="1" max="100" required value={copies} onChange={e=>setCopies(Number(e.target.value))}/></label>
 <label>Ink<select value={advanced.ink==='grayscale'?'grayscale':colour?'colour':'mono'} onChange={e=>{const value=e.target.value;setColour(value==='colour');setAdvanced(prior=>({...prior,ink:value==='grayscale'?'grayscale':'legacy'}))}}><option value="mono">Black &amp; white</option><option value="grayscale">Grayscale</option><option value="colour">Colour</option></select></label>
</div>
 {manualPaper==='Custom'&&!matched&&<div className="form-grid">{(['widthMm','heightMm'] as const).map(key=><label key={key}>{key==='widthMm'?'Paper width (mm)':'Paper height (mm)'}<input type="number" min="20" max="2000" value={options.customPaper?.[key]??(key==='widthMm'?210:297)} onChange={e=>setAdvanced(prior=>({...prior,customPaper:{widthMm:210,heightMm:297,...prior.customPaper,[key]:Number(e.target.value)}}))}/></label>)}</div>}
 <label>Printer<PrinterSelect value={printer} change={value=>{
  if(value===printer)return;
  setCapabilities(undefined);setCapabilityError('');
  setAdvanced(prior=>({...prior,tray:undefined,driverDpi:undefined}));
  setPrinter(value);
 }} labelOutput/></label>
 {preview?.mime==='application/pdf'&&<div className="quick-print-types" role="group" aria-label="Print type">
  <Button className="secondary" aria-pressed={quickHandling==='size'&&!twoSided} onClick={()=>{selectPagesPerSide(1);setDuplex('simplex')}}><FileText size={15}/> Normal document</Button>
  <Button className="secondary" aria-pressed={quickHandling==='multiple'} onClick={()=>selectPagesPerSide(nup>1?nup:2)}><Files size={15}/> Multiple pages</Button>
  <Button className="secondary" aria-pressed={twoSided&&!booklet} onClick={()=>{selectPagesPerSide(1);if(duplex==='simplex')setDuplex('auto')}}><Files size={15}/> Double-sided</Button>
  <Button className="secondary" aria-pressed={booklet} onClick={()=>{settingsTouched.current=true;setWizard(true)}}><BookOpen size={15}/> Booklet</Button>
 </div>}
 {quickHandling==='multiple'&&<PageLayoutChoices value={nup} change={selectPagesPerSide} landscape={landscape} copies={preview?.mime.startsWith('image/')}/>}
 {booklet&&<small className="booklet-fold-preview"><BookOpen size={22}/> Fold each sheet in half after printing both sides.</small>}
 <div className="actions document-duplex-controls">
  <label>Orientation<select aria-label="Orientation" disabled={booklet} value={options.orientation} onChange={e=>{setLandscape(e.target.value==='landscape');setAdvanced(prior=>({...prior,orientation:e.target.value as typeof orientation}))}}><option value="portrait">Portrait</option><option value="landscape">Landscape</option><option value="auto" disabled={booklet||advanced.scaling==='printable'}>Auto by first selected page</option></select></label>
 <label>Double-Sided Printing<select aria-label="Double-Sided Printing" value={duplex} onChange={e=>{settingsTouched.current=true;setDuplex(e.target.value as typeof duplex)}}><DuplexOptions allowOff={!booklet}/></select></label>
 </div>

 {preview?.mime==='application/pdf'&&<div className="actions document-duplex-controls">
  <label>Pages to print<input value={range} onChange={e=>setRange(e.target.value)} placeholder="All pages, or 1-3, 5"/></label>
  {(quickHandling==='size'||quickHandling==='multiple')&&<label>Page scaling<select aria-label="Page scaling" value={advanced.scaling??'fit'} onChange={e=>setAdvanced(prior=>({...prior,scaling:e.target.value as PrintSettingsInput['scaling']}))}>
   <option value="fit">Fit to page</option><option value="actual">Actual size</option><option value="shrink">Shrink oversized pages</option><option value="percent">Custom scale</option>
   <option value="printable" disabled={options.orientation==='auto'}>Fit to printable area</option><option value="fill">Fill page</option><option value="stretch">Stretch to page</option>
  </select></label>}
  {(quickHandling==='size'||quickHandling==='multiple')&&advanced.scaling==='percent'&&<label>Scale (%)<input type="number" min={10} max={400} value={advanced.scalePercent??100} onChange={e=>setAdvanced(prior=>({...prior,scalePercent:Number(e.target.value)}))}/></label>}
 </div>}
 <div className="stack document-print-sections">
 <details><summary>Printer setup and saved presets</summary><div className="stack">
 {capabilityError&&<details><summary>Printer error details</summary><small>{capabilityError}</small></details>}
 <label>Apply print preset<select value="" onChange={e=>{
  const preset=presets.find(item=>item.id===e.target.value);
  if(preset){settingsTouched.current=true;setMatchPdfPaper(false);applySettings({...preset.settings,printer:preset.settings.printer||printer})}
 }}><option value="">Choose a saved preset</option>{presets.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
 <Button className="quiet" onClick={resetDefaults}>Reset to default</Button>
 {<div className="actions"><Button className="secondary" onClick={refreshPrinters}>Refresh printers</Button><Button className="secondary" disabled={!printer} onClick={()=>void window.bloom.call('printerDialog',{printer,kind:'preferences'}).then(()=>refreshCapabilities(value=>value+1)).catch(error)}>Printing preferences</Button></div>}{capabilities&&<small>{capabilities.model||capabilities.name} ? {capabilities.offline?'Offline':capabilities.error>2?(supplyWarning||'Driver error '+capabilities.error):'Windows status '+capabilities.status}</small>}
 {!batchEditor&&twoSided&&<DuplexTest settings={options} unavailable={virtualPrinter||!printerListed||automaticDuplex&&!capabilities?.duplex} onDone={()=>window.bloom.call('printPresets',null).then(({presets,defaultId})=>{setPresets(presets);setDefaultPreset(defaultId)})}/>}
 </div></details>
 {twoSided&&calculation&&<p role="status">{calculation.totalPhysicalSheets} physical sheets / {calculation.printedSides} printed sides</p>}
 {files.some(item=>item.mime==='application/pdf')&&<p>{inkMode==='mixed'?<>Black &amp; white {money(policy.mono)} / Colour {money(policy.colour)}</>:<>{inkMode==='colour'?'Colour':'Black & white'} {money(inkMode==='colour'?policy.colour:policy.mono)}</>} per {pricedBasis==='sheet'?'physical sheet':pricedBasis==='side'?'printed side':pricedBasis==='booklet'?'booklet':'selected page'}</p>}
 {manualFallback&&<p role="status">This printer will print the fronts first and ask you to reload the sheets for the backs.</p>}
 {manualDuplex&&!virtualPrinter&&<p>Print the fronts first. BloomConnect will prompt you to reload the sheets before printing the backs.</p>}
 {preview?.mime==='application/pdf'&&<details className="quick-pdf-sizing"><summary>Page handling and paper matching</summary><div className="stack">
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
  {quickHandling==='multiple'&&<label>Pages per side<select value={nup} onChange={e=>selectPagesPerSide(Number(e.target.value))}>{[...new Set([1,2,3,4,6,8,9,12,16,nup])].sort((a,b)=>a-b).map(value=><option key={value}>{value}</option>)}</select></label>}
  <label className="check"><input type="checkbox" checked={matchPdfPaper&&canMatch} disabled={!canMatch} onChange={event=>setMatchPdfPaper(event.target.checked)}/> Match paper to PDF page size</label>
  <small>{matchHint||'Available for one PDF at 1 page per side. Uses the default printer tray for the matched paper size.'}</small>
  <details><summary>Page Setup</summary><div className="stack">
   <small>Use Paper and Orientation above to set the sheet dimensions and direction.</small>
   <label>Layout margin (mm)<input type="number" min={0} max={40} step={.5} value={marginMm} onChange={event=>{setMargin(Number(event.target.value));setAdvanced(prior=>({...prior,margins:undefined}))}}/></label>
   <label>Paper source<select value={matched?'':advanced.tray??''} disabled={!!matched||virtualPrinter||!capabilities?.trays.length} onChange={event=>setAdvanced(prior=>({...prior,tray:event.target.value?Number(event.target.value):undefined}))}><option value="">Driver default</option>{capabilities?.trays.map(tray=><option key={tray.id} value={tray.id}>{tray.name}</option>)}</select></label>
  </div></details>
 </div></details>}
 {attachmentId&&<details className="quick-pdf-help"><summary>Print settings with examples</summary><ul>
  <li><strong>Paper and orientation.</strong> A4 Portrait is the usual size for a letter. Landscape turns the sheet sideways.</li>
  <li><strong>Page range.</strong> Enter 1–3 and 5 as <code>1-3, 5</code> to print four pages in each copy.</li>
  <li><strong>Copies.</strong> Enter 2 to print that selection twice.</li>
  <li><strong>Two-sided.</strong> Four pages at 1 page per side use 4 sheets one-sided or 2 sheets two-sided. Long edge usually flips a portrait document like a book.</li>
  <li><strong>Pages per side.</strong> Choose 2 to put four pages onto two printed sides. Scaling, margins, ink processing, and driver controls are available below.</li>
 </ul></details>}
 {preview?.mime.startsWith('image/')&&<Button className="secondary" onClick={()=>state.set({view:'Print Studio',job:active?.id??'',customer:preview.customer_id??'',photoStudio:true,photoDraft:[preview.id],pdfPrintAttachment:''})}>Set exact photo size on A4</Button>}
 {!attachmentId&&preview?.mime.startsWith('image/')&&<label>Copies per side<select value={nup} onChange={e=>selectPagesPerSide(Number(e.target.value))}>{[...new Set([1,2,3,4,6,8,9,12,16,nup])].sort((a,b)=>a-b).map(value=><option key={value}>{value}</option>)}</select></label>}

 <div>
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
 <details><summary>Price calculation</summary><div className="stack"><label>Document billing basis<select value={rule?pricedBasis:twoSided?'sheet':basis} disabled={!!batchEditor||twoSided||!!rule} onChange={e=>setBasis(e.target.value as typeof basis)}><option value="page">Per selected logical page</option><option value="sheet">Per physical sheet</option><option value="side">Per printed side</option>{method==='booklet'&&<option value="booklet">Per finished booklet</option>}</select></label><p className="subtle">Shop rates in Settings &gt; Pricing apply until a matching method rate is saved. Existing orders use their recorded total until the estimate is applied.</p><DocumentPricingSettings policy={policy} paper={paper} method={method} duplex={twoSided} ruleId={rule?.id} onSaved={loadPricing}/>{calculation&&<dl className="detail-list"><div><dt>Paper</dt><dd>{money(calculation.paperCost)}</dd></div><div><dt>Printing and setup</dt><dd>{money(calculation.estimatedPrintingCost)}</dd></div><div><dt>Finishing</dt><dd>{money(calculation.finishingCost)}</dd></div></dl>}
 {calculation?.files.map(item=><small key={item.id}>{files.find(file=>file.id===item.id)?.name}: {item.calculation.pricing?.units} billable units - {money(item.calculation.finalTotal)}</small>)}
</div></details>
 {active&&<div className="actions"><label>Adjust order total - LKR<input type="number" min={active.paid/100} step=".01" value={quote} onChange={e=>setQuote(e.target.value)}/></label><label>Reason for price adjustment<input value={quoteReason} maxLength={500} onChange={e=>setQuoteReason(e.target.value)}/></label><Button className="secondary" disabled={!quote||quoteReason.trim().length<3||Math.round(Number(quote)*100)===active.total} onClick={()=>void run('quote',{id:active.id,total:Math.round(Number(quote)*100),reason:quoteReason},'Order total updated')}>Save total</Button></div>}
 {active&&calculation&&estimatedTotal!==active.total&&<Button className="secondary" disabled={estimatedTotal<active.paid||!!calculationError} onClick={()=>{setQuote(String(estimatedTotal/100));setQuoteReason('Applied current '+policy.basis+' estimate');void run('quote',{id:active.id,total:estimatedTotal,reason:'Operator applied current '+policy.basis+' estimate'},'Order price updated')}}>Apply current estimate to order</Button>}
 <ProfessionalSettings capabilities={capabilities} refresh={()=>refreshCapabilities(value=>value+1)} settings={{id:active?.id??'preview',...options}} change={applySettings}/>
 </div>
 {wizard&&preview&&<BookletWizard document={files.length>1?files.length+' documents (separate booklets)':preview.name} settings={{id:active?.id??'preview',...options}} onClose={()=>setWizard(false)}
  apply={settings=>batchEditor?batchEditor.apply(normalizedSettings({...options,...settings})):applySettings(settings)}/>}
 {active&&<Button className="secondary" disabled={saving||!countsReady||!!calculationError} onClick={()=>void run('savePrintPdf',{id:active.id,...options},'Prepared PDF export finished')}>Save prepared PDF</Button>}
 <p className="subtle">Paper and duplex support depend on the Windows driver. Confirm physical completion in Print Queue.</p>
 {popupError&&<p role="alert">{popupError}</p>}
 </div><div className="print-sticky-actions">
 <div className="print-action-details">
 {attachmentId&&active&&<small role="status">Order {active.id} saved</small>}
 {!batchEditor&&<PrintEstimate subtotal={calculation?.finalTotal} total={active?.total??(calculation?estimatedTotal:undefined)} label={active?'Order total':'Estimated total'}
  adjustments={active?.printSettings?.orderAdjustments} editable={!active?{charge,discount,setCharge,setDiscount,disabled:saving}:undefined}/>}
 {countError&&<p role="alert">{countError}</p>}{calculationError&&<p role="alert">{calculationError}</p>}{files.length>0&&!countsReady&&!countError&&<p role="status">Reading each file's page count...</p>}
 {pricingError?<Button className="quiet" onClick={()=>void loadPricing()}>Retry loading prices</Button>:!pricingReady&&<small role="status">Loading shop prices...</small>}
 {!batchEditor&&(printBlock||printerNotice)&&<small role="status" id={printBlockId}>{printBlock||printerNotice}</small>}
 {printBlock&&<Button className="quiet" onClick={refreshPrinters}>Refresh printers</Button>}
 {!batchEditor&&!pdfOutput&&messageCustomer&&<SkipAutoMessages value={skipAutoMessages} change={setSkipAutoMessages} disabled={saving}/>}
 <PrinterPropertiesButton printer={printer} disabled={saving} onClose={()=>refreshCapabilities(value=>value+1)}/>
 {!active&&!batchEditor&&<Button className="quiet" disabled={!formReady||saving} onClick={()=>void submit(undefined,true)}>Save order for later</Button>}
 </div>
 <Button type="submit" aria-describedby={!batchEditor&&(printBlock||printerNotice)?printBlockId:undefined} aria-busy={saving} disabled={saving||!formReady||!!printBlock} title="දැන් Print කරන්න"><Printer size={17}/>{batchEditor?'Apply settings to this PDF':pdfOutput?'Save PDF':'Print Now'}</Button>
 </div>
 </form></Panel></div>;
}
function RecordPaymentForm({order,onSaved}:{order:Job;onSaved?:()=>void}){
 const {run}=useData();
 const [amount,setAmount]=useState(''),[method,setMethod]=useState<Input<'payment'>['method']>('Cash'),[saving,setSaving]=useState(false);
 const balance=order.total-order.paid;
 if(order.status==='Cancelled'||balance<=0)return null;
 return <form className="stack" onSubmit={async e=>{
  e.preventDefault();if(saving)return;setSaving(true);
  try{if(await run('payment',{id:order.id,amount:Math.round(Number(amount)*100),method},'Payment recorded')){setAmount('');onSaved?.()}}finally{setSaving(false)}
 }}>
  <div className="form-grid">
   <label>Amount (LKR)<input type="number" min=".01" max={balance/100} step=".01" required value={amount} onChange={e=>setAmount(e.target.value)}/></label>
   <label>Method<select value={method} onChange={e=>setMethod(e.target.value as typeof method)}>{['Cash','Bank Transfer','Other'].map(item=><option key={item}>{item}</option>)}</select></label>
  </div>
  <div className="actions"><Button type="submit" disabled={saving||!amount}>Record payment</Button><Button className="secondary" disabled={saving} onClick={()=>setAmount((balance/100).toFixed(2))}>Use full balance</Button></div>
 </form>;
}
function BillDrawer({order,onClose}:{order:Job;onClose:()=>void}){
 const {data,run,refresh}=useData();
 const [messageId,setMessageId]=useState(''),[sending,setSending]=useState(false),[failure,setFailure]=useState('');
 const [collect,setCollect]=useState(false);
 const delivery=data.messages.find(message=>message.id===messageId)?.status;
 const customer=name(data,order.customer_id);
 const fileNames=order.files.map(id=>data.attachments.find(file=>file.id===id)?.name??'Document');
 const batchOrder=!!order.printSettings?.batchPdfFiles;
 const text=billMessage(data.settings?.shop??'BloomConnect',order,batchOrder?fileNames:undefined);
 const [draft,setDraft]=useState(text);
 const [sharing,setSharing]=useState(false);
 const enabled=!!order.customer_id&&order.status!=='Cancelled'&&['Connected','API reachable'].includes(data.connection.status);
 const receipts=data.payments.filter(payment=>payment.job_id===order.id);
 async function sendBill(){
  if(!enabled||!order.customer_id||sending||!draft.trim())return;
  setSending(true);setFailure('');setMessageId('');
  try{setMessageId(await window.bloom.call('reply',{id:order.customer_id,text:draft}));await refresh()}
  catch(e){setFailure((e instanceof Error?e.message:String(e)).replace(/^Error invoking remote method 'bloom:call':\s*(?:Error:\s*)?/,''))}
  finally{setSending(false)}
 }
 return <DetailDrawer title={'Bill '+order.id} onClose={onClose}><div className="stack">
  <h3>{data.settings?.shop}</h3><p>{customer} / {orderStatusLabels[order.status]}</p>
  <ul>{order.files.map(id=><li key={id}>{data.attachments.find(file=>file.id===id)?.name??'Document'}</li>)}</ul>
  <dl className="detail-list"><div><dt>Total</dt><dd>{money(order.total)}</dd></div><div><dt>Paid</dt><dd>{money(order.paid)}</dd></div><div><dt>Balance</dt><dd>{money(order.total-order.paid)}</dd></div></dl>
  <div className="actions">
   <Button onClick={()=>void run('bill',{id:order.id},'Bill PDF saved')}>Save printable bill</Button>
   {order.status!=='Cancelled'&&order.paid<order.total&&<Button className="secondary" onClick={()=>setCollect(!collect)}>Record payment</Button>}
   {order.customer_id&&order.status!=='Cancelled'&&<Button className="secondary" onClick={()=>{if(!sharing&&!messageId)setDraft(text);setSharing(!sharing)}}>Send bill</Button>}
  </div>
  {collect&&<RecordPaymentForm order={order} onSaved={()=>setCollect(false)}/>}
  {receipts.length>0&&<details><summary>Payment receipts</summary><div className="stack">{receipts.map(item=><Button key={item.id} className="quiet" onClick={()=>void run('receipt',{id:item.id})}>Save receipt / {money(item.amount)} / {stamp(item.created)}</Button>)}</div></details>}
  {sharing&&<div className="stack">
   <label>WhatsApp message<textarea value={draft} maxLength={4096} onChange={e=>setDraft(e.target.value)}/></label>
   {!enabled&&<p>Connect WhatsApp before sending this bill.</p>}
   <Button disabled={!enabled||sending||!draft.trim()||!!messageId} onClick={()=>void sendBill()}>Send on WhatsApp</Button>
   {(sending||messageId)&&<p role="status">{sending?'Pending':delivery==='delivered'||delivery==='read'?'Delivered':delivery==='sent'?'Sent':delivery==='failed'?'Failed':'Submitted to WhatsApp'}</p>}
   {failure&&<p role="alert">{failure}</p>}
  </div>}
 </div></DetailDrawer>;
}
export function Queue({history=false}:{history?:boolean}){
 const {data,run}=useData(),s=useWorkspace(),[status,filter]=useState('All'),[view,setView]=useState('List'),[close,setClose]=useState('');
 const groups=['Pending','Needs attention','Closed'];
 const lane=(value:string)=>['Completed','Cancelled'].includes(value)?'Closed':['Printing','Submitted'].includes(value)?'Pending':'Needs attention';
 const queueStatus=(value:string)=>value==='Submitted'?'Pending confirmation':value==='Printing'?'Preparing':value;
 type Submission=typeof data.queue[number];
 const findJob=(id:string)=>data.jobs.find(job=>job.id===id);
 const filenames=new Map(data.attachments.map(file=>[file.id,file.name]));
 function submittedFiles(entry:Submission):string[]{
  try{
   const selection:unknown=JSON.parse(entry.settings??'null')?.fileSelection;
   if(Array.isArray(selection)&&selection.length&&selection.every(id=>typeof id==='string'))return selection;
  }catch{/* Older queue entries may lack readable settings. */}
  return findJob(entry.job_id)?.files??[];
 }
 const byOrder=new Map<string,Submission[]>();
 for(const entry of data.queue){
  if(history&&lane(entry.status)!=='Closed')continue;
  const order=byOrder.get(entry.job_id);
  if(order)order.push(entry);
  else byOrder.set(entry.job_id,[entry]);
 }
 const orders=[...byOrder].map(([id,submissions])=>{
  const job=findJob(id),customer=name(data,job?.customer_id??null);
  const latestByFile=new Map<string,string>();
  for(const entry of submissions){
   if(entry.status==='Cancelled')continue;
   for(const file of submittedFiles(entry)){
    if(!latestByFile.has(file))latestByFile.set(file,entry.status);
   }
  }
  const currentStatuses=latestByFile.size?[...latestByFile.values()]:submissions.map(entry=>entry.status);
  const priority=['Unconfirmed','Failed','Printing','Submitted','Completed','Cancelled'];
  const summary=priority.find(value=>currentStatuses.includes(value))??submissions[0].status;
  const statusLabel=summary==='Completed'&&job?.files.some(file=>latestByFile.get(file)!=='Completed')?'Partially completed':queueStatus(summary);
  const files=[...new Set(submissions.flatMap(submittedFiles))];
  const printers=[...new Set(submissions.map(entry=>entry.printer))];
  return {id,job,customer,submissions,summary,statusLabel,files,printers};
 }).filter(order=>(status==='All'||lane(order.summary)===status)&&match(s.search,order.id,order.customer,order.statusLabel,...order.files.map(id=>filenames.get(id)??''),...order.printers,...order.submissions.map(entry=>entry.status)));
 const [details,setDetails]=useState('');
 const detail=byOrder.get(details);
 const [bill,setBill]=useState('');
 const billed=findJob(bill);
 const [confirming,setConfirming]=useState('');
 const confirmable=(entry:Submission)=>entry.status==='Submitted'||entry.status==='Unconfirmed';
 async function confirmOrder(order:typeof orders[number]){
  if(confirming)return;
  const entries=order.submissions.filter(confirmable).map(entry=>entry.id);
  setConfirming(order.id);
  try{await run('confirmPrintSubmissions',{id:order.id,entries},entries.length+' print submissions confirmed.')}
  finally{setConfirming('')}
 }
 const [repeating,setRepeating]=useState('');
 async function repeat(q:Submission){
  if(repeating)return;
  let saved:unknown;
  try{saved=JSON.parse(q.settings??'null')}catch{s.set({view:'Print Studio',job:q.job_id});return}
  const request=schemas.print.safeParse(saved);
  if(!request.success){s.set({view:'Print Studio',job:q.job_id});return}
  setRepeating(q.id);
  try{await run('print',{...request.data,id:q.job_id},'Print sent to Windows. Check the physical output.')}finally{setRepeating('')}
 }
 const entryActions=(q:Submission)=><>
  {confirmable(q)&&<Button disabled={!!confirming} onClick={()=>void run('queue',{id:q.id,status:'Completed'},'Physical completion recorded')}>Confirm printed</Button>}
  {['Failed','Unconfirmed','Submitted'].includes(q.status)&&<Button className="secondary" onClick={()=>setClose(q.id)}>Close entry</Button>}
  {q.status==='Completed'&&findJob(q.job_id)?.status!=='Cancelled'&&q.settings&&<PrinterPropertiesButton printer={q.printer} disabled={!!repeating}/>}
  {q.status==='Completed'&&findJob(q.job_id)?.status!=='Cancelled'&&q.settings&&<Button className="secondary" disabled={!!repeating} onClick={()=>void repeat(q)}>Repeat this print</Button>}
 </>;
 const orderActions=(order:typeof orders[number])=><div className="actions queue-order-actions">
  {order.submissions.length>1&&order.submissions.some(confirmable)&&<Button disabled={!!confirming||order.submissions.some(entry=>entry.status==='Printing')} onClick={()=>void confirmOrder(order)}>{confirming===order.id?'Confirming...':'Confirm all printed'}</Button>}
  <Button className="quiet" onClick={()=>s.set({view:'Print Studio',job:order.id})}>{order.submissions.length===1&&order.summary==='Failed'?'Retry':'Open order'}</Button>
  {order.job&&<Button className="quiet" onClick={()=>setBill(order.id)}>Bill / payment</Button>}
  {order.submissions.length>1?<Button className="secondary" onClick={()=>setDetails(order.id)}>View {order.submissions.length} submissions</Button>:entryActions(order.submissions[0])}
 </div>;
 const fileLabel=(ids:string[])=>ids.length>1?ids.length+' files':filenames.get(ids[0])??'?';
 return <Panel className="print-queue-panel"><div className="panel-head"><div><h2>{history?'Closed print orders':'Print orders'}</h2><p>{orders.length} {orders.length===1?'order':'orders'}</p></div><Button onClick={()=>s.set({view:'Print Studio',job:''})}>Open Print Studio</Button></div>
 <div className="queue-toolbar">{!history&&<Tabs label="Queue status" values={['All',...groups]} value={status} onChange={filter}/>}<Tabs label="Queue view" values={['List','Board']} value={view} onChange={setView}/></div>
 {view==='List'?<div className="queue-order-table"><Table headers={['Order','Customer / files','Printer','Status','Date','Actions']}>{orders.map(order=><tr key={order.id} data-print-order={order.id}><td>{order.id}</td><td>{order.customer}<small>{fileLabel(order.files)}</small></td><td>{order.printers.join(', ')}</td><td><Badge>{order.statusLabel}</Badge>{order.submissions.length===1&&order.submissions[0].error&&<small>{order.submissions[0].error}</small>}</td><td className="queue-order-date">{stamp(order.submissions[0].created)}</td><td>{orderActions(order)}</td></tr>)}</Table></div>:
 <div className="queue-lanes">{(history?['Closed']:status==='All'?groups:[status]).map(group=><section className="queue-lane" key={group}><h3>{group}</h3>{orders.filter(order=>lane(order.summary)===group).map(order=><article className="print-job-card" key={order.id} data-print-order={order.id}><div className="panel-head"><strong>{order.id}</strong><Badge>{order.statusLabel}</Badge></div><p>{order.customer}</p><p>{fileLabel(order.files)}</p><small>{order.printers.join(', ')}</small>{orderActions(order)}</article>)}</section>)}</div>}
 {detail&&<DetailDrawer title={'Print submissions ? '+details} onClose={()=>setDetails('')}><div className="stack">{detail.map(entry=><article key={entry.id} className="print-job-card">
  <div className="panel-head"><strong>{submittedFiles(entry).map(id=>filenames.get(id)??'File unavailable').join(', ')||'Print submission'}</strong><Badge>{queueStatus(entry.status)}</Badge></div>
  <small>{entry.printer} ? {stamp(entry.created)}</small>
  {entry.error&&<p>{entry.error}</p>}
  <div className="actions">{entryActions(entry)}</div>
 </article>)}</div></DetailDrawer>}
 {billed&&<BillDrawer key={billed.id} order={billed} onClose={()=>setBill('')}/>}
 {!orders.length&&<Empty title={history?'No closed print orders':'No matching print orders'}/>}
 {close&&<DetailDrawer title="Close print entry" presentation="center" onClose={()=>setClose('')}><div className="stack"><p>This closes the BloomConnect entry. Any Windows spooler job needs to be managed separately.</p><div className="actions"><Button className="secondary" onClick={()=>setClose('')}>Keep entry</Button><Button onClick={async()=>{if(await run('queue',{id:close,status:'Cancelled'},'Queue entry closed'))setClose('')}}>Close entry</Button></div></div></DetailDrawer>}</Panel>;
}
export function Orders(){
 const {data,run}=useData(),s=useWorkspace(),[status,filter]=useState(s.orderScope==='open'?'Open':'All'),[date,setDate]=useState(''),[customer,setCustomer]=useState(''),[selected,setSelected]=useState('');
 const jobs=data.jobs.filter(j=>(status==='All'||(status==='Open'?!['Completed','Cancelled'].includes(j.status):j.status===status))&&(!date||colomboDay(j.created)===date)&&(!customer||j.customer_id===customer)&&match(s.search,j.id,name(data,j.customer_id),j.status,orderStatusLabels[j.status]));
 useEffect(()=>{if(s.orderScope==='open')s.set({orderScope:'all'})},[]);
 const detail=data.jobs.find(job=>job.id===selected);
 const [bill,setBill]=useState(''),[changing,setChanging]=useState('');
 const billed=data.jobs.find(job=>job.id===bill);
 async function changeStage(job:Job,status:Job['status']){
  if(changing||job.status===status)return;
  setChanging(job.id);try{await run('stage',{id:job.id,status},'Order status updated')}finally{setChanging('')}
 }
 const buttons=(job:Job)=><div className="actions"><Button className="quiet" onClick={()=>s.set({view:'Print Studio',job:job.id})}>Print</Button><Button className="quiet" onClick={()=>setBill(job.id)}>Bill / payment</Button>{['New','Awaiting Confirmation','Processing','Ready to Print','Printing'].includes(job.status)&&<Button className="secondary" disabled={!!changing} onClick={()=>void changeStage(job,'Ready for Pickup')}>Mark ready</Button>}{job.status==='Ready for Pickup'&&<Button className="secondary" disabled={!!changing} onClick={()=>void changeStage(job,'Completed')}>Mark completed</Button>}<Button className="quiet" disabled={job.status==='Cancelled'} onClick={()=>void run('confirmPrice',{id:job.id,total:job.total},'Order price confirmed')}>Confirm price</Button></div>;
 const stage=(job:Job)=><select aria-label={'Status '+job.id} value={job.status} disabled={!!changing} onChange={e=>void changeStage(job,e.target.value as Job['status'])}>{stages.map(value=><option key={value} value={value}>{orderStatusLabels[value]}</option>)}</select>;
 return <Panel><div className="panel-head"><h2>Shop orders</h2><Button onClick={()=>s.set({view:'Print Studio',job:''})}><Plus size={16}/> New order</Button></div>
 <div className="filter-bar"><select aria-label="Order status" value={status} onChange={e=>filter(e.target.value)}><option value="All">All statuses</option><option value="Open">Pending orders</option>{stages.map(value=><option key={value} value={value}>{orderStatusLabels[value]}</option>)}</select><input type="date" aria-label="Order date" value={date} onChange={e=>setDate(e.target.value)}/><select aria-label="Order customer" value={customer} onChange={e=>setCustomer(e.target.value)}><option value="">All customers</option>{data.customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
 <Table headers={['Order','Customer','Print details','Status','Total','Payment','Actions']}>{jobs.map(j=><tr key={j.id} className={s.job===j.id?'highlight':''}><td><button className="text-button" onClick={()=>setSelected(j.id)}>{j.id}</button><small>{stamp(j.created)}</small></td><td>{name(data,j.customer_id)}</td><td>{j.files.length} files · {j.copies} copies · {j.paper} · {j.colour?'Colour':'B&W'}</td><td>{stage(j)}</td><td>{money(j.total)}</td><td><Badge>{j.paid>=j.total?'Paid':j.paid?'Partially Paid':'Unpaid'}</Badge></td><td>{buttons(j)}</td></tr>)}</Table>
 {!jobs.length&&<Empty title="No matching orders"/>}{detail&&<DetailDrawer title={detail.id} onClose={()=>setSelected('')}><div className="stack"><p>{name(data,detail.customer_id)} · {stamp(detail.created)}</p><label>Status{stage(detail)}</label><dl className="detail-list"><div><dt>Order total</dt><dd>{money(detail.total)}</dd></div><div><dt>Paid</dt><dd>{money(detail.paid)}</dd></div><div><dt>Outstanding</dt><dd>{money(detail.total-detail.paid)}</dd></div></dl><h3>Documents</h3>{detail.files.map(id=><button className="file-link" key={id} onClick={()=>s.set({view:'Documents',attachment:id})}>{data.attachments.find(file=>file.id===id)?.name??'Document'}</button>)}{buttons(detail)}</div></DetailDrawer>}{billed&&<BillDrawer key={billed.id} order={billed} onClose={()=>setBill('')}/>}</Panel>;
}
export function Payments(){
 const {data,run}=useData(),s=useWorkspace();
 const selectedOrder=data.jobs.find(j=>j.id===s.job);
 const active=selectedOrder&&selectedOrder.status!=='Cancelled'&&selectedOrder.total>selectedOrder.paid?selectedOrder:undefined;
 const [receipt,setReceipt]=useState(''),[query,setQuery]=useState('');
 const item=data.payments.find(payment=>payment.id===receipt);
 const owing=data.jobs.filter(job=>job.status!=='Cancelled'&&job.paid<job.total);
 return <div className="stack"><div className="summary-grid"><StatCard label="Today's revenue" value={money(data.payments.filter(payment=>colomboDay(payment.created)===colomboDay(new Date())).reduce((sum,payment)=>sum+payment.amount,0))} icon={Wallet} tone="emerald"/><StatCard label="Payments recorded" value={data.payments.length} icon={Wallet}/><StatCard label="Orders awaiting payment" value={owing.length} icon={ShoppingBag} tone="amber"/><StatCard label="Outstanding" value={money(owing.reduce((sum,job)=>sum+job.total-job.paid,0))} icon={Wallet} tone="cyan"/></div>
 <div className="split"><Panel><div className="panel-head"><h2>Payment history</h2><input className="field-search" aria-label="Search payments" placeholder="Search payments" value={query} onChange={e=>setQuery(e.target.value)}/></div><Table headers={['Order','Amount','Method','Date','Receipt']}>{data.payments.filter(p=>match(s.search,p.job_id,p.method)&&match(query,p.job_id,p.method)).map(p=><tr key={p.id}><td>{p.job_id}</td><td>{money(p.amount)}</td><td>{p.method}</td><td>{stamp(p.created)}</td><td><div className="actions"><Button className="quiet" onClick={()=>setReceipt(p.id)}>Preview</Button><Button className="quiet" onClick={()=>void run('receipt',{id:p.id})}>Save PDF</Button></div></td></tr>)}</Table>{!data.payments.length&&<Empty title="No payments recorded"/>}</Panel><Panel className="stack">
 <h2>Record a payment</h2>
 <label>Order<select value={active?.id??''} onChange={e=>s.set({job:e.target.value})}><option value="">Choose an order</option>{owing.map(job=><option key={job.id} value={job.id}>{job.id} / {name(data,job.customer_id)}</option>)}</select></label>
 {selectedOrder&&!active&&<p role="status">{selectedOrder.status==='Cancelled'?'This order is cancelled.':'This order has no balance to collect.'}</p>}
 {active&&<><div className="total"><span>Balance</span><strong>{money(active.total-active.paid)}</strong></div><RecordPaymentForm key={active.id} order={active}/></>}
 </Panel></div>{item&&<DetailDrawer title="Payment receipt" onClose={()=>setReceipt('')}><div className="stack"><h3>{data.settings?.shop}</h3><dl className="detail-list"><div><dt>Order</dt><dd>{item.job_id}</dd></div><div><dt>Amount</dt><dd>{money(item.amount)}</dd></div><div><dt>Method</dt><dd>{item.method}</dd></div><div><dt>Date</dt><dd>{stamp(item.created)}</dd></div></dl><div className="actions"><Button onClick={()=>void run('receipt',{id:item.id})}>Save printable PDF</Button></div></div></DetailDrawer>}</div>
}
export function Reports(){
 const {data}=useData(),[period,setPeriod]=useState('30'),search=useWorkspace(s=>s.search);
 const threshold=Date.now()-Number(period)*86400000;
 const payments=data.payments.filter(p=>Date.parse(p.created)>=threshold),jobs=data.jobs.filter(j=>Date.parse(j.created)>=threshold);
 return <div className="stack"><Panel><div className="panel-head"><h2>Shop performance</h2><select aria-label="Report period" value={period} onChange={e=>setPeriod(e.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="365">Last 365 days</option></select></div><div className="report-metrics"><div><span>Collected</span><strong>{money(payments.reduce((n,p)=>n+p.amount,0))}</strong></div><div><span>Orders</span><strong>{jobs.length}</strong></div><div><span>Outstanding</span><strong>{money(jobs.filter(j=>j.status!=='Cancelled').reduce((n,j)=>n+j.total-j.paid,0))}</strong></div><div><span>Completed orders</span><strong>{jobs.filter(j=>j.status==='Completed').length}</strong></div><div><span>Print submissions</span><strong>{data.queue.filter(q=>Date.parse(q.created)>=threshold).length}</strong></div><div><span>New customers</span><strong>{data.customers.filter(c=>Date.parse(c.created)>=threshold).length}</strong></div></div></Panel><div className="dashboard-grid"><RevenueChart payments={payments} days={Math.min(Number(period),30)}/><Panel><div className="panel-head"><h2>Document types</h2></div><dl className="detail-list">{['PDF','Images','Other'].map((label,index)=><div key={label}><dt>{label}</dt><dd>{data.attachments.filter(file=>Date.parse(file.created)>=threshold&&(index===0?file.mime==='application/pdf':index===1?file.mime.startsWith('image/'):file.mime!=='application/pdf'&&!file.mime.startsWith('image/'))).length}</dd></div>)}</dl></Panel></div><Panel><div className="panel-head"><h2>Activity & automation log</h2></div><Table headers={['Event','Details','Date']}>{data.activity.filter(a=>Date.parse(a.created)>=threshold&&match(search,a.kind,a.detail)).map(a=><tr key={a.id}><td>{a.kind}</td><td>{a.detail}</td><td>{stamp(a.created)}</td></tr>)}</Table></Panel></div>
}
