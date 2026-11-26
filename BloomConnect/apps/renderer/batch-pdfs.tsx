import {SkipAutoMessages} from './print-settings';
import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {ArrowDown,ArrowUp,BookOpen,Printer} from 'lucide-react';
import {calculateBulk,documentPricing,type CalculationInput} from '../../packages/printing/calculation';
import {canPrintWithoutCapabilities,isFileOutputPrinter,isPdfPrinter,isVirtualPrinter,submissionDuplex,validateSubmissionPrinter} from '../../packages/printing/capabilities';
import {planDocument,type DocumentInfo} from '../../packages/printing/plan';
import {batchPdfFileSchema,normalizedSettings,type BatchPdfFile} from '../../packages/printing/settings';
import type {PricingRule} from '../../packages/shared/contracts';
import {Button,Panel,PrinterPropertiesButton,money,useData} from './context';
import {ImposedPreview,inspectDocument} from './pdf';
import {useWorkspace} from './state';
import {PageLayoutChoices} from './design';
import {paperNames} from '../../packages/printing/paper';
import {BookletWizard,DuplexOptions,DuplexTest,PrintEstimate} from './print-settings';
import {isManualDuplex} from '../../packages/printing/duplex';

const defaults:BatchPdfFile={paper:'A4',copies:1,nup:1,colour:false,landscape:false,duplex:'simplex',range:''};
const settingsFor=(printer:string,file:BatchPdfFile)=>normalizedSettings({
 rotation:0,fit:'contain',layout:'single',...file,printer
});

export type BatchPdfEditor={id:string;settings:ReturnType<typeof settingsFor>;apply:(settings:ReturnType<typeof settingsFor>)=>void};
export function BatchPdfStudio({initialFile,initialFiles,onSubmitted,renderEditor,renderBill}:{initialFile?:string;initialFiles?:string[];onSubmitted?:(id:string)=>void;renderEditor:(editor:BatchPdfEditor)=>ReactNode;renderBill:(id:string,onClose:()=>void)=>ReactNode}){
 const {data,refresh,error,printers}=useData(),workspace=useWorkspace();
 const queryClient=useQueryClient();
 const printerStatusId=useId();
 const initial=data.attachments.find(file=>file.id===initialFile);
 const active=initialFile?undefined:data.jobs.find(job=>job.id===workspace.job&&job.printSettings?.batchPdfFiles);
 const [orderId,setOrderId]=useState(active?.id??'');
 const [customer,setCustomer]=useState(active?active.customer_id??'walk-in':initial?initial.customer_id??'walk-in':workspace.customer);
 const [printerChoice,setPrinter]=useState(active?.printSettings?.printer??data.settings?.printer??'');
 const [selected,setSelected]=useState<string[]>(active?.files??(initialFiles?.length?initialFiles:(initialFile?[initialFile]:[])));
 const [fileSearch,setFileSearch]=useState('');
 const [fileSettings,setFileSettings]=useState<Record<string,BatchPdfFile>>(active?.printSettings?.batchPdfFiles??{});
 const [editing,setEditing]=useState(active?.files[0]??initialFile??'');
 const [editorOpen,setEditorOpen]=useState(false);
 const [bookletFile,setBookletFile]=useState('');
 const [charge,setCharge]=useState(0),[discount,setDiscount]=useState(0);
 const [infos,setInfos]=useState<Record<string,DocumentInfo>>({});
 const [rules,setRules]=useState<PricingRule[]>();
 const [loadProblem,setLoadProblem]=useState('');
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const submitting=useRef(false);
 const [billOpen,setBillOpen]=useState(false);
 const [refreshingPrinters,setRefreshingPrinters]=useState(false);
 const [submissions,setSubmissions]=useState<string[]>([]);
 const [exports,setExports]=useState<string[]>([]);
 const [pdfDrivers,setPdfDrivers]=useState<string[]>([]);
 const paperPrinters=printers.filter(item=>!isVirtualPrinter(item.name)&&!isVirtualPrinter(item.displayName));
 const preferred=printers.find(item=>item.name===printerChoice);
 const defaultPrinter=paperPrinters.find(item=>item.isDefault)?.name??paperPrinters[0]?.name??'';
 const printer=printerChoice?preferred?.name??'':defaultPrinter||printers.find(item=>item.isDefault)?.name||printers[0]?.name||'';
 const pdfDestination=isPdfPrinter(printer,preferred?.displayName)||pdfDrivers.includes(printer);
 const virtualPrinter=isVirtualPrinter(printer)||isVirtualPrinter(preferred?.displayName??'');
 const owner=customer==='walk-in'?null:customer;
 const [skipAutoMessages,setSkipAutoMessages]=useState(active?.skipAutoMessages??false);
 useEffect(()=>setSkipAutoMessages(active?.skipAutoMessages??false),[owner,active?.id,active?.skipAutoMessages]);
 const files=data.attachments.filter(file=>file.status==='Ready'&&file.mime==='application/pdf'&&file.customer_id===owner);
 const matchedFiles=files.filter(file=>orderId?selected.includes(file.id):file.name.toLowerCase().includes(fileSearch.trim().toLowerCase()));
 const visibleFiles=[...selected.flatMap(id=>matchedFiles.filter(file=>file.id===id)),...matchedFiles.filter(file=>!selected.includes(file.id))];
 const current=selected.includes(editing)?editing:selected[0];
 const currentFile=files.find(file=>file.id===current);
 const currentSettings=fileSettings[current]??defaults;
 const selectionKey=JSON.stringify(selected);
 const savedOrder=data.jobs.find(job=>job.id===orderId);
 useEffect(()=>{void window.bloom.call('pricingRules',null).then(setRules).catch(error)},[]);
 useEffect(()=>{void queryClient.invalidateQueries({queryKey:['printers']})},[queryClient]);
 useEffect(()=>{
  let live=true;
  setLoadProblem('');
  void (async()=>{
   const documents:Record<string,DocumentInfo>={};
   for(const id of JSON.parse(selectionKey) as string[])documents[id]=await inspectDocument(id);
   if(live)setInfos(documents);
  })().catch(e=>{if(live){setInfos({});setLoadProblem(e instanceof Error?e.message:String(e))}});
  return()=>{live=false};
 },[selectionKey]);
 const covered=new Set(submissions);
 for(const entry of data.queue){
  if(entry.job_id!==orderId||!['Printing','Submitted','Unconfirmed','Completed'].includes(entry.status))continue;
  const selection=JSON.parse(entry.settings??'{}').fileSelection??selected;
  for(const id of selection)covered.add(id);
 }
 const remaining=selected.filter(id=>!covered.has(id));
 const printerProblem=savedOrder?.status==='Cancelled'&&!pdfDestination?'Reopen the cancelled order before printing.':!printers.length?'Install or connect a printer in Windows, then click Refresh printers.':!printer?'Choose an available Windows printer.':'';
 const ready=rules!==undefined&&selected.length>0&&selected.every(id=>!!infos[id]);
 let problem=loadProblem,quote:ReturnType<typeof calculateBulk>|undefined;
 let calculations:{id:string;settings:CalculationInput}[]=[];
 try{
  if(savedOrder?.calculations?.length){
   quote=calculateBulk(savedOrder.calculations.map(item=>({...item,customer:savedOrder.customer_id})));
  }else if(ready){
   calculations=selected.map(id=>{
    const file=batchPdfFileSchema.parse(fileSettings[id]??defaults);
    const options=settingsFor(printer,file);
    const plan=planDocument(options,infos[id]);
    const method=options.booklet?'booklet':options.poster?.enabled?'poster':options.nup>1?'nup':'ordinary';
    const policy=rules.find(rule=>rule.method===method&&rule.paper===file.paper&&rule.duplex===(file.duplex!=='simplex')&&(!rule.media||rule.media==='Default'))?.policy??documentPricing(data.settings!,file.duplex,'sheet',file.paper);
    const mode=options.ink==='auto'||options.ink==='mixed'?'mixed':options.ink==='grayscale'?'grayscale':options.ink==='mono'?'mono':options.ink==='colour'||options.colour?'colour':'mono';
    const colourPages=[...new Set(plan.sides.flatMap(side=>side.placements.filter(p=>p.colour).map(p=>p.page)))];
    return {id,settings:{documentPages:infos[id].pages.length,selectedPages:plan.selected,copies:options.copies,paper:options.paper,
     customPaper:options.customPaper,mode,colourPages,uncertainPages:plan.needsConfirmation?plan.selected.filter(page=>infos[id].pages[page-1].ink==='uncertain'):[],
     pagesPerSide:options.nup,duplex:options.duplex,imposition:method==='booklet'||method==='poster'?method:'ordinary',
     signaturePages:options.signaturePages,binding:options.binding,posterTiles:method==='poster'?plan.sides.map(side=>side.placements[0].page):undefined,pricing:policy}};
   });
   quote=calculateBulk(calculations.map(item=>({...item,customer:owner})));
  }
 }catch(e){problem=e instanceof Error?e.message:String(e)}

 const adjustments={charge:Math.round(charge*100),discount:Math.round(discount*100)};
 const estimatedTotal=quote?quote.finalTotal+adjustments.charge-adjustments.discount:undefined;
 if(!orderId&&!problem){
  if(Object.values(adjustments).some(value=>!Number.isInteger(value)||value<0||value>100000000))problem='Enter a charge and discount between LKR 0 and LKR 1,000,000.';
  else if(estimatedTotal!==undefined&&estimatedTotal<0)problem='Discount cannot exceed the subtotal plus the additional charge.';
 }
 function toggle(id:string,checked:boolean){
  setEditorOpen(false);
  setSelected(previous=>checked?[...previous,id]:previous.filter(file=>file!==id));
  if(checked)setEditing(id);
 }
 function moveFile(id:string,offset:number){
  setSelected(previous=>{
   const from=previous.indexOf(id),to=from+offset;
   if(from<0||to<0||to>=previous.length)return previous;
   const next=[...previous];
   [next[from],next[to]]=[next[to],next[from]];
   return next;
  });
 }
 async function submit(action:'print'|'saveOrder'|'export'='print'){
  const exporting=action==='export'||action==='print'&&pdfDestination;
  const pendingFiles=exporting?selected.filter(id=>!exports.includes(id)):remaining;
  if(submitting.current||!quote||problem||(action==='print'&&(printerProblem||!pendingFiles.length))||(exporting&&!pendingFiles.length))return;
  submitting.current=true;
  setBusy(true);setNotice('');
  let submitted=0;
  let sending='';
  try{
   const settings=Object.fromEntries(selected.map(id=>[id,fileSettings[id]??defaults]));
   for(const id of action==='print'&&!exporting?remaining:[]){
    sending=files.find(file=>file.id===id)?.name??id;
    setNotice('Checking printer settings for '+sending+'…');
    const input=settingsFor(printer,settings[id]);
    const capabilities=await window.bloom.call('printerCapabilities',{printer,settings:input}).catch(error=>{
     if(!canPrintWithoutCapabilities({...input,duplex:submissionDuplex(input.duplex,virtualPrinter)}))throw error;
    });
    if(!capabilities)continue;
    if(isPdfPrinter(printer,capabilities.driver)){
     setPdfDrivers(previous=>[...previous,printer]);
     throw new Error('This device saves PDF files. Choose a physical printer to print on paper, or use Save PDF.');
    }
    validateSubmissionPrinter(input,capabilities,virtualPrinter||isVirtualPrinter(capabilities.driver)||isFileOutputPrinter(capabilities.port??''));
   }
   let id=orderId;
   if(!id){
    const base=settingsFor(printer,defaults);
    id=await window.bloom.call('order',{customer:owner,files:selected,copies:base.copies,paper:base.paper,colour:base.colour,price:0,...adjustments,calculations,skipAutoMessages,printSettings:{...base,batchPdfFiles:settings}});
    setOrderId(id);
    if(!initialFile)workspace.set({job:id});
   }
   if(action==='saveOrder'){setNotice('Order '+id+' saved.');return}
   const groups:string[][]=[];
   let lastKey='',sidesInGroup=0;
   for(const file of pendingFiles){
    const input=settingsFor(printer,settings[file]);
    const count=quote.files.find(item=>item.id===file)?.calculation;
    const sides=count?count.printedSides+count.blankSides:200;
    const key=JSON.stringify(input);
    const canGroup=!exporting&&input.orientation!=='auto'&&!isManualDuplex(input.duplex)&&input.ink!=='auto'&&input.ink!=='mixed';
    if(canGroup&&key===lastKey&&sidesInGroup+sides<=200){groups.at(-1)!.push(file);sidesInGroup+=sides}
    else{groups.push([file]);sidesInGroup=sides;lastKey=canGroup?key:''}
   }
   for(const group of groups){
    const [file]=group;
    sending=files.find(item=>item.id===file)?.name??file;
    const progress=group.length===1?String(submitted+1):(submitted+1)+'–'+(submitted+group.length);
    setNotice((exporting?'Preparing PDF ':'Sending to printer ')+progress+' of '+pendingFiles.length+' · '+sending);
    const request={id,...settingsFor(printer,settings[file]),fileSelection:group};
    if(exporting){
     if(!await window.bloom.call('savePrintPdf',request)){
      setNotice(submitted+' PDFs saved. You can resume saving the remaining files.');
      return;
     }
     setExports(previous=>[...previous,file]);
    }else{
     await window.bloom.call('print',{...request,skipAutoMessages});
     setSubmissions(previous=>[...previous,...group]);
     if(onSubmitted)group.forEach(onSubmitted);
    }
    submitted+=group.length;
   }
   setNotice(submitted+(exporting?' PDFs saved under order ':' PDFs sent to the print queue under order ')+id+'.');
  }catch(e){
   const reason=(e instanceof Error?e.message:String(e)).replace(/^Error invoking remote method 'bloom:call':\s*(?:Error:\s*)?/,'');
   setNotice((submitted?submitted+(exporting?' PDFs saved. ':' PDFs submitted. '):'')+(sending?sending+' — ':'')+reason);
  }finally{
   try{await refresh();setSubmissions([])}catch(e){error(e)}finally{submitting.current=false;setBusy(false)}
  }
 }
 function updateCurrent(changes:Partial<BatchPdfFile>){
  setFileSettings(previous=>({...previous,[current]:{...(previous[current]??defaults),...changes}}));
 }
 const outstanding=pdfDestination?selected.filter(id=>!exports.includes(id)).length:remaining.length;
 const canPrint=!!quote&&!problem&&!busy&&!editorOpen&&!printerProblem&&outstanding>0;
 return <div className="studio-workspace batch-pdf-workspace">
  <Panel className="stack"><h2>1. Select PDFs</h2>
   {orderId&&!initialFile&&<Button className="secondary" disabled={busy} onClick={()=>{
    setOrderId('');setCharge(0);setDiscount(0);setSelected([]);setEditing('');setFileSettings({});setFileSearch('');setNotice('');setSubmissions([]);setExports([]);
    workspace.set({job:''});
   }}>New PDF batch</Button>}
   <label>Customer<select value={customer} disabled={busy||!!orderId||!!initialFile} onChange={e=>{setCustomer(e.target.value);setCharge(0);setDiscount(0);setSelected([]);setEditing('');setFileSettings({});setFileSearch('');setEditorOpen(false)}}>
    <option value="">Choose customer</option><option value="walk-in">Walk-in</option>{data.customers.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
   </select></label>
   {!orderId&&customer&&<label>Find PDFs<input type="search" value={fileSearch} onChange={e=>setFileSearch(e.target.value)} placeholder="Search by filename"/></label>}
   {!orderId&&<div className="actions"><Button className="secondary" disabled={!customer||!files.length||files.length>40||busy} onClick={()=>{setSelected(files.map(file=>file.id));setEditing(files[0].id);setFileSearch('');setEditorOpen(false)}}>Select all PDFs</Button><Button className="quiet" disabled={busy||!selected.length} onClick={()=>{setSelected([]);setEditorOpen(false)}}>Clear selection</Button></div>}
   {customer&&files.length>40&&!orderId&&<small>Select up to 40 PDFs for one bill.</small>}
   <small role="status">{selected.length} selected. {orderId?'Choose a filename to preview it.':'Tick PDFs to add them. Untick to remove them.'}</small>
   <div className="studio-files">{customer&&visibleFiles.map(file=><div className="check batch-pdf-file" key={file.id}>
    <input id={printerStatusId+file.id} type="checkbox" aria-label={'Include '+file.name} checked={selected.includes(file.id)} disabled={busy||!!orderId||selected.length>=40&&!selected.includes(file.id)} onChange={e=>toggle(file.id,e.target.checked)}/>
    {selected.includes(file.id)?<Button className="quiet batch-pdf-file" aria-pressed={current===file.id} onClick={()=>{if(current!==file.id)setEditorOpen(false);setEditing(file.id)}}>{file.name}</Button>:<label htmlFor={printerStatusId+file.id}>{file.name}</label>}
    {!orderId&&selected.includes(file.id)&&selected.length>1&&<div className="batch-file-order">
     <Button className="quiet" disabled={busy||editorOpen||selected[0]===file.id} aria-label={'Move '+file.name+' earlier'} onClick={()=>moveFile(file.id,-1)}><ArrowUp size={13}/></Button>
     <Button className="quiet" disabled={busy||editorOpen||selected.at(-1)===file.id} aria-label={'Move '+file.name+' later'} onClick={()=>moveFile(file.id,1)}><ArrowDown size={13}/></Button>
    </div>}
   </div>)}</div>
   {customer&&!visibleFiles.length&&<small>{fileSearch?'No PDFs match the filename search.':'No ready PDFs for this customer.'}</small>}
  </Panel>
  <Panel className="stack"><h2>Print preview</h2>
   {currentFile&&<strong className="batch-pdf-file">{currentFile.name}</strong>}
   {currentFile&&infos[current]&&<ImposedPreview id={current} input={{id:orderId||'preview',...settingsFor(printer,currentSettings)}}/>}
   {quote&&<div className="table-wrap"><table><thead><tr><th>PDF</th><th>Paper</th><th>Copies</th><th>Sheets</th><th>Amount</th></tr></thead><tbody>{quote.files.map(item=><tr key={item.id}><td className="batch-pdf-file">{files.find(file=>file.id===item.id)?.name}</td><td>{(fileSettings[item.id]??defaults).paper}</td><td>{(fileSettings[item.id]??defaults).copies}</td><td>{item.calculation.totalPhysicalSheets}</td><td>{money(item.calculation.finalTotal)}</td></tr>)}</tbody></table></div>}
  </Panel>
  <Panel className="stack batch-pdf-actions"><h2>2. Print settings</h2>
   {currentFile&&!editorOpen&&<div className="actions batch-layout-actions">
    <Button className="secondary" disabled={busy||!!orderId} aria-pressed={!!currentSettings.booklet} onClick={()=>{
     const paper=['A3','A4','A5','Custom'].includes(currentSettings.paper)?currentSettings.paper:'A4';
     updateCurrent({paper,booklet:true,nup:2,landscape:true,orientation:'landscape',duplex:'shortEdge',grid:undefined,poster:undefined,documentFrame:undefined,handoutNotes:false});
    }}><BookOpen size={15}/> Booklet</Button>
    {currentSettings.booklet&&<>
     <Button className="quiet" disabled={busy||!!orderId} onClick={()=>setBookletFile(bookletFile===current?'':current)}>{bookletFile===current?'Close booklet settings':'Booklet settings'}</Button>
     <Button className="quiet" disabled={busy||!!orderId} onClick={()=>{setBookletFile('');updateCurrent({booklet:false,nup:1,duplex:'simplex',landscape:false,orientation:'portrait'})}}>Normal layout</Button>
    </>}
   </div>}
   {currentFile&&currentSettings.booklet&&bookletFile===current&&!orderId&&!editorOpen&&<BookletWizard key={current} document={currentFile.name}
    settings={{id:'preview',...settingsFor(printer,currentSettings)}} onClose={()=>setBookletFile('')} apply={updateCurrent}/>}
   <div className={editorOpen?'stack batch-setting-controls editing':'stack batch-setting-controls'}>
   {currentFile?<><strong className="batch-pdf-file">{currentFile.name}</strong>
   {!editorOpen&&<>
    <fieldset className="form-grid" disabled={busy||!!orderId}>
     <label>Paper size<select value={currentSettings.paper} onChange={e=>updateCurrent({paper:e.target.value as BatchPdfFile['paper']})}>{paperNames.filter(paper=>paper!=='Custom'||currentSettings.customPaper).map(paper=><option key={paper}>{paper}</option>)}</select></label>
     <label>Copies<input type="number" min={1} max={100} value={currentSettings.copies} onChange={e=>updateCurrent({copies:Math.min(100,Math.max(1,Math.trunc(e.target.valueAsNumber||1)))})}/></label>
     <label>Ink<select value={currentSettings.ink&&currentSettings.ink!=='legacy'?currentSettings.ink:currentSettings.colour?'colour':'mono'} onChange={e=>{const ink=e.target.value as BatchPdfFile['ink'];updateCurrent({ink,colour:ink==='colour'})}}>
      <option value="mono">Black &amp; white</option><option value="colour">Colour</option><option value="grayscale">Grayscale</option><option value="mixed">Mixed</option><option value="auto">Automatic</option>
     </select></label>
     <label>Print sides<select aria-label="Print sides" value={currentSettings.duplex} disabled={currentSettings.poster?.enabled} onChange={e=>updateCurrent({duplex:e.target.value as BatchPdfFile['duplex']})}>
      <DuplexOptions allowOff={!currentSettings.booklet}/>
     </select></label>
     <label>Orientation<select aria-label="Orientation" value={currentSettings.orientation==='auto'?'auto':currentSettings.landscape?'landscape':'portrait'} disabled={currentSettings.booklet} onChange={e=>{
      const orientation=e.target.value as BatchPdfFile['orientation'];
      updateCurrent({orientation,landscape:orientation==='landscape'});
     }}><option value="portrait">Portrait</option><option value="landscape">Landscape</option><option value="auto" disabled={currentSettings.scaling==='printable'}>Auto</option></select></label>
     <label>Pages to print<input maxLength={2000} value={currentSettings.pageMode==='current'?String(currentSettings.currentPage??1):currentSettings.range} placeholder="All pages, or 1-3, 5" onChange={e=>updateCurrent({range:e.target.value,pageMode:e.target.value.trim()?'range':'all'})}/></label>
    </fieldset>
    <fieldset className="stack" disabled={busy||!!orderId}>
     <legend>Pages per side</legend>
     <PageLayoutChoices value={currentSettings.booklet||currentSettings.poster?.enabled||currentSettings.grid?0:currentSettings.nup??1} landscape={currentSettings.landscape} change={nup=>updateCurrent({nup,booklet:false,grid:undefined,poster:undefined,documentFrame:undefined,handoutNotes:false})}/>
     <small>Example: Choose 4 pages to print four PDF pages on each side of the sheet.</small>
    </fieldset>
   </>}
    <div className="actions">
     <Button className="secondary" disabled={busy||!!orderId} aria-expanded={editorOpen} onClick={()=>setEditorOpen(!editorOpen)}>{editorOpen?'Cancel advanced edits':'Advanced settings'}</Button>
     <Button className="quiet" disabled={selected.length<2||editorOpen} onClick={()=>setEditing(selected[(selected.indexOf(current)+1)%selected.length])}>Next PDF</Button>
    </div>
    {editorOpen&&<div className="batch-inline-editor">{renderEditor({id:current,settings:settingsFor(printer,currentSettings),apply:settings=>{
     setFileSettings(previous=>({...previous,[current]:batchPdfFileSchema.parse(settings)}));
     setPrinter(settings.printer);setEditorOpen(false);
     void window.bloom.call('pricingRules',null).then(setRules).catch(error);
    }})}</div>}
   </>:<small>Select a PDF to see its preview and settings.</small>}</div>
   <h2>3. Print and bill</h2>
   <fieldset disabled={busy||editorOpen}><label>Output printer<select aria-label="Output printer" value={printer} onChange={e=>setPrinter(e.target.value)}>
    {!printer&&<option value="">{printers.length?'Select a printer':'No Windows printer available'}</option>}
    {printers.map(item=><option key={item.name} value={item.name}>{item.displayName||item.name}{item.isDefault?' (default)':''}{isVirtualPrinter(item.name)||isVirtualPrinter(item.displayName)||pdfDrivers.includes(item.name)?' (virtual)':''}</option>)}
   </select></label></fieldset>
   <div className="actions">
   {!paperPrinters.length&&<Button className="secondary" disabled={busy} onClick={()=>void window.bloom.call('openPrinterSettings',null).catch(error)}>Open Windows printer settings</Button>}
   <Button className="secondary" disabled={busy||refreshingPrinters} onClick={async()=>{
    setRefreshingPrinters(true);
    try{setPdfDrivers([]);await queryClient.invalidateQueries({queryKey:['printers']},{throwOnError:true})}catch(e){error(e)}finally{setRefreshingPrinters(false)}
   }}>{refreshingPrinters?'Refreshing printers…':'Refresh printers'}</Button>
   </div>
   {currentFile&&currentSettings.duplex!=='simplex'&&<DuplexTest settings={settingsFor(printer,currentSettings)} unavailable={busy||virtualPrinter||pdfDestination||!!printerProblem}/>}
   {printerProblem&&<small id={printerStatusId} role="status">{printerProblem}</small>}
   {!printerProblem&&pdfDestination&&<small id={printerStatusId}>Microsoft Print to PDF saves files. Select a physical printer for paper output.</small>}
   {!printerProblem&&virtualPrinter&&!pdfDestination&&<small id={printerStatusId}>This destination receives the prepared pages in order. Choose a physical printer for paper output.</small>}
   <PrintEstimate subtotal={quote?.finalTotal} total={savedOrder?.total??(problem?undefined:estimatedTotal)} label={orderId?'Order total':'Combined bill'}
    adjustments={savedOrder?.printSettings?.orderAdjustments} editable={!orderId?{charge,discount,setCharge,setDiscount,disabled:busy}:undefined}/>
   {notice&&<p role="status">{notice}</p>}
   {!pdfDestination&&owner&&<SkipAutoMessages value={skipAutoMessages} change={setSkipAutoMessages} disabled={busy||editorOpen}/>}
   <PrinterPropertiesButton printer={printer} disabled={busy||editorOpen}/>
   <Button disabled={!canPrint} aria-busy={busy} aria-describedby={printerProblem||pdfDestination||virtualPrinter?printerStatusId:undefined} onClick={()=>void submit()}><Printer size={17}/>{pdfDestination?'Save PDF':orderId&&remaining.length&&remaining.length<selected.length?'Print remaining PDFs':'Print Now'}</Button>
   {savedOrder&&<Button className="secondary" disabled={busy} onClick={()=>setBillOpen(true)}>View or send combined bill</Button>}
   {!orderId&&<Button className="quiet" disabled={!quote||!!problem||busy||editorOpen} onClick={()=>void submit('saveOrder')}>Save order for later</Button>}
   {orderId&&<small>Order {orderId} · {outstanding} PDFs remaining to {pdfDestination?'save':'print'}</small>}
   <details><summary>Export options</summary><Button className="quiet" disabled={!quote||!!problem||busy||editorOpen||selected.every(id=>exports.includes(id))} onClick={()=>void submit('export')}>Save prepared PDFs</Button></details>
   {problem&&<p role="alert">{problem}</p>}
   {!problem&&selected.length>0&&!ready&&<small role="status">Reading the selected PDFs and shop rates…</small>}
  </Panel>
  {billOpen&&savedOrder&&renderBill(savedOrder.id,()=>setBillOpen(false))}
 </div>;
}
