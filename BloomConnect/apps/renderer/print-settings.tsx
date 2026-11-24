import {useEffect,useState} from 'react';
import type {Input,PrintPreset} from '../../packages/shared/contracts';
import type {PrinterCapabilities} from '../../packages/printing/windows';
import type {ManualFeedProfile,PrintSettingsInput} from '../../packages/printing/settings';
import {useQueryClient} from '@tanstack/react-query';
import {isVirtualPrinter} from '../../packages/printing/capabilities';
import {duplexEdge,isManualDuplex,type DuplexMode} from '../../packages/printing/duplex';
import type {PricingPolicy} from '../../packages/printing/calculation';
import {useData,Button,money} from './context';
import {DetailDrawer} from './design';

export function DuplexOptions({allowOff=true}:{allowOff?:boolean}){
 return <>
  <option value="simplex" disabled={!allowOff}>Off — Single-sided</option>
  <option value="auto">Auto — Recommended</option>
  <option value="longEdge">Flip on Long Edge</option>
  <option value="shortEdge">Flip on Short Edge</option>
  <option value="manualAuto">Manual Double-Sided</option>
  <option value="manualLongEdge">Manual — Long Edge</option>
  <option value="manualShortEdge">Manual — Short Edge</option>
 </>;
}

export function DuplexTest({settings,unavailable=false,onDone}:{settings:Pick<PrintSettingsInput,'printer'|'paper'|'customPaper'|'orientation'|'landscape'|'duplex'>;unavailable?:boolean;onDone?:()=>Promise<unknown>}){
 const {error}=useData();
 const [testing,setTesting]=useState(false);
 return <Button className="secondary" disabled={testing||unavailable||!settings.printer||settings.duplex==='simplex'||settings.orientation==='auto'||isVirtualPrinter(settings.printer)}
  onClick={async()=>{
   const {printer,paper,customPaper,orientation,landscape,duplex}=settings;
   setTesting(true);
   try{await window.bloom.call('testDuplex',{printer,paper,customPaper,orientation,landscape,duplex});await onDone?.()}
   catch(e){error(e)}finally{setTesting(false)}
  }}>{testing?'Testing duplex…':'Test Double-Sided Printing'}</Button>;
}

export function BookletWizard({document,settings,onClose,apply}:{document:string;settings:Input<'print'>;onClose:()=>void;apply:(value:Partial<PrintSettingsInput>)=>void}){
 const [paper,setPaper]=useState<'A3'|'A4'|'A5'|'Custom'>(settings.paper==='A3'||settings.paper==='A5'||settings.paper==='Custom'?settings.paper:'A4');
 const [width,setWidth]=useState(settings.customPaper?settings.customPaper.heightMm/2:148.5),[height,setHeight]=useState(settings.customPaper?.widthMm??210);
 const [binding,setBinding]=useState(settings.binding??'left'),[finish,setFinish]=useState(settings.bookletFinish??'fold');
 const [signature,setSignature]=useState(settings.signaturePages??0),[duplex,setDuplex]=useState<DuplexMode>(settings.duplex==='simplex'?'auto':settings.duplex);
 const [margin,setMargin]=useState(settings.marginMm??0),[gutter,setGutter]=useState(settings.gutterMm??0),[creep,setCreep]=useState(settings.bookletCreepMm??0);
 const valid=paper!=='Custom'||width>=10&&width<=1000&&height>=20&&height<=2000;
 const content=<div className="stack">
 <fieldset className="stack booklet-settings-group"><legend>Paper and finished size</legend><p>{document}</p><label>Finished size and printing paper<select value={paper} onChange={e=>setPaper(e.target.value as typeof paper)}><option value="A4">A5 with A4 paper</option><option value="A3">A4 with A3 paper</option><option value="A5">A6 with A5 paper</option><option value="Custom">Custom finished size</option></select></label>{paper==='Custom'&&<div className="form-grid"><label>Finished width (mm)<input type="number" min="10" max="1000" value={width} onChange={e=>setWidth(Number(e.target.value))}/></label><label>Finished height (mm)<input type="number" min="20" max="2000" value={height} onChange={e=>setHeight(Number(e.target.value))}/></label></div>}</fieldset>
 <fieldset className="form-grid booklet-settings-group"><legend>Binding and finishing</legend><label>Binding<select value={binding} onChange={e=>setBinding(e.target.value as typeof binding)}><option value="left">Left bound</option><option value="right">Right bound</option></select></label><label>Signature pages<select value={signature} onChange={e=>setSignature(Number(e.target.value))}><option value="0">Single signature</option>{Array.from({length:32},(_,i)=>(i+1)*4).map(size=><option key={size}>{size}</option>)}</select></label><label>Manual finishing<select value={finish} onChange={e=>setFinish(e.target.value as typeof finish)}><option value="fold">Fold only</option><option value="handStaple">Fold and staple by hand</option></select></label></fieldset>
 <fieldset className="stack booklet-settings-group"><legend>Double-sided printing</legend><label>Duplex<select value={duplex} onChange={e=>setDuplex(e.target.value as typeof duplex)}><DuplexOptions allowOff={false}/></select></label>{isManualDuplex(duplex)&&<small>Reload the sheets when prompted, using the printer?s tested feed instructions.</small>}</fieldset>
 <fieldset className="booklet-settings-group"><legend>Margins and creep</legend><div className="form-grid">{([['Margins',margin,setMargin,40],['Gutter',gutter,setGutter,40],['Creep per nested sheet',creep,setCreep,2]] as const).map(([label,value,set,max])=><label key={label}>{label} (mm)<input type="number" min="0" max={max} step=".1" value={value} onChange={e=>set(Math.max(0,Math.min(max,Number(e.target.value))))}/></label>)}</div></fieldset>

  <div className="booklet-cover-preview" role="img" aria-label="Fold the cover sheet between the front and back covers">
   <span>{binding==='left'?'Back cover':'Front cover'}</span><span>{binding==='left'?'Front cover':'Back cover'}</span>
  </div>
  <p>Fold at the centre line{finish==='handStaple'?' and staple through the fold':''}. Keep each group of folded sheets in order.</p>
 <div className="actions booklet-settings-actions"><Button className="secondary" onClick={onClose}>Cancel</Button><Button disabled={!valid} onClick={()=>{apply({paper,customPaper:paper==='Custom'?{widthMm:height,heightMm:width*2}:undefined,booklet:true,bookletFinish:finish,binding,signaturePages:signature||undefined,bookletCreepMm:creep,gutterMm:gutter,marginMm:margin,landscape:true,orientation:'landscape',duplex,nup:2,grid:undefined,poster:undefined,documentFrame:undefined,handoutNotes:false,margins:undefined});onClose()}}>Apply and preview</Button></div>
 </div>;
 return <DetailDrawer title="Booklet Wizard" presentation="center" onClose={onClose}>{content}</DetailDrawer>;
}

export function PrintEstimate({subtotal,total,adjustments,editable,label='Estimated total'}:{
 subtotal?:number;total?:number;adjustments?:{charge:number;discount:number};editable?:{charge:number;discount:number;setCharge:(value:number)=>void;setDiscount:(value:number)=>void;disabled?:boolean};label?:string;
}){
 return <div className="stack print-estimate">
  {subtotal!==undefined&&<div className="print-estimate-line"><span>Print subtotal</span><strong>{money(subtotal)}</strong></div>}
  {editable?<fieldset className="form-grid print-estimate-fields" disabled={editable.disabled}>
   <label>Additional charge (LKR)<input type="number" min="0" max="1000000" step=".01" value={editable.charge||''} placeholder="0.00" onChange={e=>editable.setCharge(Number(e.target.value))}/></label>
   <label>Discount (LKR)<input type="number" min="0" max="1000000" step=".01" value={editable.discount||''} placeholder="0.00" onChange={e=>editable.setDiscount(Number(e.target.value))}/></label>
  </fieldset>:adjustments&&<>
   <div className="print-estimate-line"><span>Additional charge</span><strong>{money(adjustments.charge)}</strong></div>
   <div className="print-estimate-line"><span>Discount</span><strong>{money(adjustments.discount)}</strong></div>
  </>}
  <div className="total"><span>{label}</span><strong>{total===undefined?'?':money(total)}</strong></div>
 </div>;
}

function ManualFeedSettings({settings,change}:{settings:Input<'print'>;change:(value:Partial<PrintSettingsInput>)=>void}){
 const {run,error}=useData();
 const [profile,setProfile]=useState<ManualFeedProfile>({first:'front',reverseSecond:false,rotateSecond:false,instructions:''});
 const [saved,setSaved]=useState(false),[verified,setVerified]=useState(false);
 const landscape=settings.booklet||settings.orientation==='landscape'||settings.orientation!=='portrait'&&settings.landscape;
 const edge=duplexEdge(settings.duplex,landscape);
 const enabled=!!settings.printer&&isManualDuplex(settings.duplex)&&settings.orientation!=='auto'&&!isVirtualPrinter(settings.printer);
 const context={printer:settings.printer,landscape,edge};
 useEffect(()=>{
  let current=true;setSaved(false);setVerified(false);
  setProfile({first:'front',reverseSecond:false,rotateSecond:false,instructions:''});
  if(enabled)void window.bloom.call('manualFeedProfile',context).then(result=>{if(current&&result){setProfile(result);setSaved(true)}}).catch(error);
  return()=>{current=false};
 },[context.printer,context.landscape,edge,enabled]);
 return <details><summary>Manual duplex feed</summary><div className="stack">
 <label>First pass<select value={settings.manualFirstSide??''} onChange={e=>change({manualFirstSide:e.target.value?(e.target.value as 'front'|'back'):undefined})}><option value="">Saved profile or front first</option><option value="front">Front sides first</option><option value="back">Back sides first</option></select></label>
 {enabled?<><small>{saved?'A tested feed profile is saved for this printer, orientation and flip edge.':'Test one sheet on this printer before saving instructions.'}</small>
 <label>Profile first pass<select value={profile.first} onChange={e=>setProfile({...profile,first:e.target.value as 'front'|'back'})}><option value="front">Front</option><option value="back">Back</option></select></label>
 <label>Paper reinsertion instructions<textarea maxLength={500} value={profile.instructions} onChange={e=>setProfile({...profile,instructions:e.target.value})}/></label>
 <label className="check"><input type="checkbox" checked={profile.reverseSecond} onChange={e=>setProfile({...profile,reverseSecond:e.target.checked})}/> Reverse second-pass order</label>
 <label className="check"><input type="checkbox" checked={profile.rotateSecond} onChange={e=>setProfile({...profile,rotateSecond:e.target.checked})}/> Rotate second pass 180 degrees</label>
 <label className="check"><input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)}/> I tested these settings on paper</label>
 <Button disabled={!verified||profile.instructions.trim().length<3} onClick={async()=>{if(await run('saveManualFeedProfile',{...context,profile,verified:true},'Manual duplex feed profile saved')){setSaved(true);setVerified(false)}}}>Save tested feed profile</Button></>:<small>Choose a physical printer, fixed orientation and manual duplex to save a feed profile.</small>}
 </div></details>;
}
export function DocumentPricingSettings({policy,paper,method,duplex,ruleId,onSaved}:{
 policy:PricingPolicy;paper:Input<'print'>['paper'];method:Exclude<Input<'savePricingRule'>['method'],'photo'>;duplex:boolean;ruleId?:string;onSaved:()=>Promise<void>
}){
 const {run,error}=useData();
 const fields=[['mono','Black & white per billing unit'],['colour','Colour per billing unit'],['paperPerSheet','Paper per physical sheet'],['setup','Setup fee'],['finishing','Finishing fee']] as const;
 const [draft,setDraft]=useState<Record<string,string>>({});
 const [basis,setBasis]=useState(policy.basis??'sheet');
 useEffect(()=>{setDraft({});setBasis(policy.basis??'sheet')},[paper,method,duplex,ruleId,policy.basis,policy.mono,policy.colour,policy.paperPerSheet,policy.setup,policy.finishing]);
 return <details><summary>Configure {paper} {method} {duplex?'two-sided':'one-sided'} pricing</summary>
 <div className="stack"><label>Billing unit<select value={basis} onChange={e=>setBasis(e.target.value as typeof basis)}>
 <option value="sheet">Physical sheet</option><option value="side">Printed side</option><option value="page">Selected page</option>{method==='booklet'&&<option value="booklet">Finished booklet</option>}
 </select></label>
 <div className="form-grid">{fields.map(([key,label])=><label key={key}>{label} (LKR)<input type="number" min="0" max="1000000" step=".01" value={draft[key]??String((policy[key]??0)/100)} onChange={e=>setDraft(previous=>({...previous,[key]:e.target.value}))}/></label>)}</div>
 <Button className="secondary" onClick={()=>void (async()=>{
  const price={...policy,...Object.fromEntries(fields.map(([key])=>[key,Math.round(Number(draft[key]??(policy[key]??0)/100)*100)])),basis};
  if(await run('savePricingRule',{id:ruleId,name:[paper,method,duplex?'two-sided':'one-sided'].join(' '),paper,method,duplex,policy:price},'Method pricing saved'))await onSaved();
 })().catch(error)}>Save method pricing</Button></div></details>;
}
export function ProfessionalSettings({settings,change,capabilities:cap,refresh}:{settings:Input<'print'>;change:(v:Partial<PrintSettingsInput>)=>void;capabilities?:PrinterCapabilities;refresh:()=>void}){
 const {error}=useData(),client=useQueryClient();
 const [presets,setPresets]=useState<PrintPreset[]>([]),[preset,setPreset]=useState(''),[title,setTitle]=useState('');
 const [defaultId,setDefaultId]=useState<string|null>(null);
 const [assignPrinter,setAssignPrinter]=useState(false);
 const native=!!cap&&!isVirtualPrinter(cap.driver)&&!isVirtualPrinter(cap.name);
 const load=()=>window.bloom.call('printPresets',null).then(value=>{setPresets(value.presets);setDefaultId(value.defaultId)});
 useEffect(()=>{void load().catch(error)},[]);
 const select=(label:string,key:keyof PrintSettingsInput,values:[string,string][],value:string)=><label>{label}<select value={value} onChange={e=>change({[key]:e.target.value})}>{values.map(([key,text])=><option key={key} value={key}>{text}</option>)}</select></label>;
 return <div className="professional-settings">
 <details><summary>Printer capabilities and driver</summary><div className="stack"><Button className="secondary" onClick={()=>{void client.invalidateQueries({queryKey:['printers']});refresh()}}>Refresh printers and capabilities</Button>{cap?<><strong>{cap.model}</strong><small>Driver: {cap.driver} · Port: {cap.port}</small><small>{cap.offline?'Offline':'Windows status '+cap.status} · Error {cap.error}</small><small>Automatic duplex: {cap.duplex?'Yes':'No'} · Colour: {cap.colour?'Yes':'No'}</small><small>{cap.papers.length} paper forms · {cap.trays.length} trays · {cap.resolutions.length} resolutions</small></>:<small>Select a printer to query actual driver capabilities.</small>}
 <div className="actions">{(['preferences','properties'] as const).map(kind=><Button key={kind} className="secondary" disabled={!settings.printer} onClick={()=>void window.bloom.call('printerDialog',{printer:settings.printer,kind}).then(refresh).catch(error)}>Open {kind}</Button>)}</div>
 <label>Paper source<select value={settings.tray??''} disabled={!native||!cap?.trays.length} onChange={e=>change({tray:e.target.value===''?undefined:Number(e.target.value)})}><option value="">Driver default</option>{cap?.trays.map(tray=><option key={tray.id} value={tray.id}>{tray.name}</option>)}</select></label>
 {(!native||!cap?.trays.length)&&<small>Direct tray selection requires a physical printer with advertised paper sources.</small>}
 {cap&&<details><summary>Supported paper forms and printable area</summary><ul>{cap.papers.map((paper,index)=><li key={index}>{paper.name} ({paper.widthMm} ? {paper.heightMm} mm)</li>)}</ul><small>Hard margins (mm): {Object.entries(cap.printable).map(([edge,value])=>edge+' '+value.toFixed(1)).join(', ')}. Borderless: {cap.borderless?'reported for this form':'unavailable for this form'}.</small></details>}
 <small>Use Printer Preferences for media, finishing, secure printing and vendor-specific options when the selected driver offers them.</small></div></details>
 <details><summary>Pages and copy order</summary><div className="stack">
 {select('Page selection','pageMode',[['all','All / entered range'],['current','Current page'],['range','Custom range']],settings.pageMode??'all')}
 <label>Current page number<input type="number" min={1} max={10000} value={settings.currentPage??1} onChange={e=>change({currentPage:Number(e.target.value)})}/></label>
 {select('Page filter','pageFilter',[['all','All selected pages'],['odd','Odd pages'],['even','Even pages']],settings.pageFilter??'all')}
 <label className="check"><input type="checkbox" checked={settings.reverse??false} onChange={e=>change({reverse:e.target.checked})}/> Reverse page order</label>
 <label className="check"><input type="checkbox" checked={settings.skipBlank??false} onChange={e=>change({skipBlank:e.target.checked})}/> Skip rendered blank pages</label>
 <label className="check"><input type="checkbox" checked={settings.collate??true} onChange={e=>change({collate:e.target.checked})}/> Collated copies (duplex sheet pairs stay together)</label>
 </div></details>
 <details><summary>Scaling, rotation and placement</summary><div className="stack">
 <label>Scaling<select value={settings.scaling??'fit'} onChange={e=>change({scaling:e.target.value as PrintSettingsInput['scaling']})}><option value="fit">Fit to paper / layout margins</option><option value="printable" disabled={!cap||settings.orientation==='auto'}>Fit to printer's printable area</option><option value="actual">Actual size</option><option value="shrink">Shrink oversized pages</option><option value="fill">Fill and crop</option><option value="percent">Custom percentage</option><option value="stretch">Stretch explicitly</option></select></label>
 {(!cap||settings.orientation==='auto')&&<small>Fit to printable area requires an advertised paper form and fixed orientation.</small>}
 <label>Scale percentage<input disabled={settings.scaling!=='percent'} type="number" min={10} max={400} value={settings.scalePercent??100} onChange={e=>change({scalePercent:Number(e.target.value)})}/></label>
 {select('Page order inside N-up','order',[['horizontal','Horizontal'],['vertical','Vertical'],['rightToLeft','Right to left'],['bottomToTop','Bottom to top']],settings.order??'horizontal')}
 <label>PDF / photo rotation<select value={settings.rotation} onChange={e=>change({rotation:Number(e.target.value)})}>{[0,90,180,270].map(n=><option key={n}>{n}</option>)}</select></label>
 <label className="check"><input type="checkbox" checked={settings.center??true} onChange={e=>change({center:e.target.checked})}/> Center</label><label className="check"><input type="checkbox" checked={settings.autoRotate??false} onChange={e=>change({autoRotate:e.target.checked})}/> Automatically rotate for a better fit</label>
 <small>Actual size and enlarged percentages can clip at cell or printer boundaries.</small>
 </div></details>
 <details><summary>Exact PDF frame and scan enhancement</summary><div className="stack">
 <Button className="secondary" disabled={settings.booklet||settings.poster?.enabled||settings.nup!==1} onClick={()=>change({documentFrame:{widthMm:148,heightMm:210,fit:'fit'}})}>Set A5-sized frame (half A4)</Button>
 <label className="check"><input type="checkbox" checked={!!settings.documentFrame} disabled={!settings.documentFrame&&(settings.booklet||settings.poster?.enabled||settings.nup!==1)} onChange={e=>change({documentFrame:e.target.checked?{widthMm:148,heightMm:210,fit:'fit'}:undefined})}/> Custom PDF frame</label>
 {settings.documentFrame&&<><div className="form-grid">{(['widthMm','heightMm'] as const).map(key=><label key={key}>{key==='widthMm'?'Frame width (mm)':'Frame height (mm)'}<input type="number" min="5" max="2000" step=".1" value={settings.documentFrame![key]} onChange={e=>change({documentFrame:{...settings.documentFrame!,[key]:Number(e.target.value)}})}/></label>)}</div>
 <label>Frame fit<select value={settings.documentFrame.fit} onChange={e=>change({documentFrame:{...settings.documentFrame!,fit:e.target.value as 'fit'|'fill'|'stretch'}})}><option value="fit">Fit whole page, preserve proportions</option><option value="fill">Fill frame and crop</option><option value="stretch">Stretch to exact width and height</option></select></label></>}
 <label>Scan sharpening (%)<input type="number" min="0" max="100" value={settings.scanSharpen??0} onChange={e=>change({scanSharpen:Number(e.target.value)})}/></label>
 <label>Scan noise reduction (%)<input type="number" min="0" max="100" value={settings.scanDenoise??0} onChange={e=>change({scanDenoise:Number(e.target.value)})}/></label>
 <label>Deskew correction (degrees)<input type="number" min="-10" max="10" step=".1" value={settings.scanDeskew??0} onChange={e=>change({scanDeskew:Number(e.target.value)})}/></label>
 <small>Compare Source and Final sheet before saving a prepared PDF.</small></div></details>
 <details><summary>Colour and quality</summary><div className="stack">
 {select('Colour processing','ink',[['legacy','Use basic ink choice'],['colour','Full colour'],['mono','Black and white'],['grayscale','Grayscale'],['auto','Detect colour from page content'],['mixed','Selected colour pages']],settings.ink??'legacy')}
 {(settings.ink==='auto'||settings.ink==='mixed')&&<><label>Colour pages<input value={settings.colourRange??''} placeholder="1-5, 8" onChange={e=>change({colourRange:e.target.value,analysisConfirmed:false})}/></label><small>Enter pages to override detection. Other pages will render in grayscale. Colour analysis is estimated from the source preview.</small><label className="check"><input type="checkbox" checked={!!settings.analysisConfirmed} onChange={e=>change({analysisConfirmed:e.target.checked})}/> Accept estimated colour on uncertain pages</label></>}
 {(['brightness','contrast'] as const).map(key=><label key={key}>{key} %<input type="number" min={25} max={200} value={settings[key]??100} onChange={e=>change({[key]:Number(e.target.value)})}/></label>)}
 <label>Document raster DPI<select value={settings.renderDpi??150} onChange={e=>change({renderDpi:Number(e.target.value)})}>{[72,96,150,200,300,600].map(n=><option key={n}>{n}</option>)}</select></label><small>Large paper/DPI combinations are rejected when they exceed safe memory limits. This is preprocessing DPI, not the printer resolution.</small>
 <label className="check"><input type="checkbox" checked={settings.smoothing??true} onChange={e=>change({smoothing:e.target.checked})}/> Image smoothing</label>
 <label>Native driver DPI<select disabled={!native||!cap?.resolutions.length} value={settings.driverDpi?settings.driverDpi.x+'x'+settings.driverDpi.y:''} onChange={e=>{const [x,y]=e.target.value.split('x').map(Number);change({driverDpi:e.target.value?{x,y}:undefined})}}><option value="">Driver default</option>{cap?.resolutions.map((dpi,i)=><option key={i} value={dpi.x+'x'+dpi.y}>{dpi.x} ? {dpi.y}</option>)}</select></label>
 {(!native||!cap?.resolutions.length)&&<small>Direct resolution selection requires a physical printer that advertises resolution choices.</small>}
 </div></details>
 <ManualFeedSettings settings={settings} change={change}/>
 <details><summary>Watermark and print marks</summary><div className="stack">
 <label>Watermark text<input maxLength={100} value={settings.watermark??''} onChange={e=>change({watermark:e.target.value})}/></label>
 <label className="check"><input type="checkbox" checked={!!settings.sheetLabels} onChange={e=>change({sheetLabels:e.target.checked})}/> Label each side with its source pages</label>
 <label className="check"><input type="checkbox" checked={!!settings.trimMarks} onChange={e=>change({trimMarks:e.target.checked})}/> Draw crop marks around page frames</label>
 </div></details>
 <details><summary>Print presets</summary><div className="stack"><select aria-label="Saved print preset" value={preset} onChange={e=> {const next=presets.find(p=>p.id===e.target.value);setPreset(e.target.value);setTitle(next?.name??'');setAssignPrinter(!!next?.settings.printer)}}><option value="">Choose a saved preset</option>{presets.map(p=><option key={p.id} value={p.id}>{p.name}{p.id===defaultId?' (default)':''}</option>)}</select><input aria-label="Preset name" placeholder="Preset name" value={title} onChange={e=>setTitle(e.target.value)}/><label className="check"><input type="checkbox" checked={assignPrinter} disabled={!settings.printer} onChange={e=>setAssignPrinter(e.target.checked)}/> Assign preset to this printer</label><div className="actions">
 <Button className="secondary" disabled={!preset} onClick={()=>{const value=presets.find(p=>p.id===preset);if(value)change({...value.settings,printer:value.settings.printer||settings.printer})}}>Apply</Button>
 <Button className="secondary" disabled={!title.trim()} onClick={()=>void window.bloom.call('savePrintPreset',{name:title,settings:{...settings,printer:assignPrinter?settings.printer:''}}).then(load).catch(error)}>Save new / duplicate</Button>
 <Button className="secondary" disabled={!preset||!title.trim()} onClick={()=>void window.bloom.call('savePrintPreset',{id:preset,name:title,settings:{...settings,printer:assignPrinter?settings.printer:''}}).then(load).catch(error)}>Update</Button>
 <Button className="secondary" disabled={!preset} onClick={()=>void window.bloom.call('deletePrintPreset',{id:preset}).then(()=>{setPreset('');return load()}).catch(error)}>Delete</Button>
 <Button className="secondary" disabled={!preset} onClick={()=>void window.bloom.call('setDefaultPrintPreset',{id:preset}).then(load).catch(error)}>Set default</Button>
 </div></div></details>
 </div>;
}
