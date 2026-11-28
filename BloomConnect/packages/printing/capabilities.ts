import {isAutomaticDuplex,type DuplexMode} from './duplex';
import type {PrintSettings,PrintSettingsInput} from './settings';
import type {PrinterCapabilities} from './windows';
import {paperDimensions} from './paper';
export function isVirtualPrinter(name:string){
  return /OneNote|Microsoft Print to PDF|Microsoft XPS Document Writer/i.test(name);
}
export function isPdfPrinter(name:string,driver?:string){
  return /Microsoft Print to PDF/i.test(name)||/Microsoft Print to PDF/i.test(driver??'');
}
export function isFileOutputPrinter(port:string){
  return port.split(',').some(value=>/^\s*(?:FILE|PORTPROMPT):?\s*$/i.test(value));
}
export function submissionDuplex(mode:DuplexMode,virtual:boolean,automaticDuplexSupported?:boolean):DuplexMode{
  if(virtual)return 'simplex';
  if(automaticDuplexSupported!==false||!isAutomaticDuplex(mode))return mode;
  return mode==='longEdge'?'manualLongEdge':mode==='shortEdge'?'manualShortEdge':'manualAuto';
}
export function validateSubmissionPrinter(settings:PrintSettings,capabilities:PrinterCapabilities,virtual=
  isVirtualPrinter(settings.printer)||isVirtualPrinter(capabilities.driver)||isFileOutputPrinter(capabilities.port??'')){
  if(virtual&&(settings.tray!==undefined||settings.driverDpi))throw new Error('Explicit tray or resolution settings require a physical printer.');
  validatePrinter({...settings,duplex:submissionDuplex(settings.duplex,virtual,capabilities.duplex)},capabilities);
}
export function printerSupplyWarning(code:number){
  return code===3?'The printer reports low paper.':code===5?'The printer reports low toner.':'';
}
export function canPrintWithoutCapabilities(s:PrintSettingsInput){
  return s.paper!=='Custom'&&s.tray===undefined&&!s.driverDpi&&s.scaling!=='printable'&&!s.photoBatch&&!Object.keys(s.photoItems??{}).length;
}
export function validatePrinter(s:PrintSettings,c:PrinterCapabilities){
  if(c.name!==s.printer)throw new Error('Printer capability data does not match this printer.');
  if(c.offline||c.status===7)throw new Error('The selected printer is offline.');
  if(c.error>2&&!printerSupplyWarning(c.error))throw new Error('The selected printer reports an error (Windows code '+c.error+').');
  const [w,h]=paperDimensions(s.paper,s.customPaper);
  const defaultPaperAllowed=!c.papers.length&&canPrintWithoutCapabilities(s);
  if(!defaultPaperAllowed&&!c.papers.some(p=>Math.abs(p.widthMm-w)<1.1&&Math.abs(p.heightMm-h)<1.1))throw new Error('This paper size is not advertised by the driver. Choose a supported paper size or save as PDF.');
  if(isVirtualPrinter(c.driver)||isVirtualPrinter(c.name)){
    if(s.duplex!=='simplex')throw new Error('Choose a physical printer for two-sided printing, or export the prepared PDF.');
    if(s.tray!==undefined||s.driverDpi)throw new Error('Explicit tray or resolution settings require a physical printer.');
  }
  if(isAutomaticDuplex(s.duplex)&&!c.duplex)throw new Error('Automatic duplex is unavailable. Use manual duplex.');
  if((s.ink==='colour'||s.ink==='auto'||s.ink==='mixed'||s.ink==='legacy'&&s.colour)&&!c.colour)throw new Error('This printer does not advertise colour output.');
  if(s.tray!==undefined&&!c.trays.some(tray=>tray.id===s.tray))throw new Error('The selected paper tray is unavailable.');
  if(s.driverDpi&&!c.resolutions.some(d=>d.x===s.driverDpi!.x&&d.y===s.driverDpi!.y))throw new Error('The selected driver resolution is unavailable.');
}
