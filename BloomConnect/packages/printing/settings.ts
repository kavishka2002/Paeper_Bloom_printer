import {duplexModes} from './duplex';
import {z} from 'zod';
import {paperNames,paperDimensions} from './paper';
const mm=z.number().finite().min(0).max(150);
export const manualFeedProfileSchema=z.object({
  first:z.enum(['front','back']),reverseSecond:z.boolean(),rotateSecond:z.boolean(),
  instructions:z.string().trim().min(3).max(500)
});
export type ManualFeedProfile=z.output<typeof manualFeedProfileSchema>;
const basePrintSettingsSchema=z.object({
  printer:z.string().max(512),paper:z.enum(paperNames),customPaper:z.object({widthMm:z.number().min(20).max(2000),heightMm:z.number().min(20).max(2000)}).optional(),
  copies:z.number().int().min(1).max(100),colour:z.boolean(),landscape:z.boolean(),duplex:z.enum(duplexModes),
  range:z.string().max(2000),rotation:z.number().int().min(0).max(270).multipleOf(90),fit:z.enum(['contain','cover']),layout:z.enum(['single','four','passport']),
  nup:z.number().int().min(1).max(64).default(1),booklet:z.boolean().default(false),binding:z.enum(['left','right']).default('left'),marginMm:mm.default(0),gapMm:mm.default(0),borders:z.boolean().default(false),
  handoutNotes:z.boolean().default(false),
  signaturePages:z.number().int().min(4).max(128).multipleOf(4).optional(),
  bookletCreepMm:z.number().min(0).max(2).default(0),
  bookletFinish:z.enum(['fold','handStaple']).default('fold'),
  watermark:z.string().trim().max(100).default(''),sheetLabels:z.boolean().default(false),trimMarks:z.boolean().default(false),
  pageMode:z.enum(['all','current','range']).default('all'),currentPage:z.number().int().min(1).max(10000).default(1),pageFilter:z.enum(['all','odd','even']).default('all'),reverse:z.boolean().default(false),skipBlank:z.boolean().default(false),
  orientation:z.enum(['legacy','portrait','landscape','auto']).default('legacy'),
  grid:z.object({rows:z.number().int().min(1).max(8),columns:z.number().int().min(1).max(8)}).optional(),
  order:z.enum(['horizontal','vertical','rightToLeft','bottomToTop']).default('horizontal'),autoRotate:z.boolean().default(false),
  scaling:z.enum(['fit','printable','actual','shrink','fill','percent','stretch']).default('fit'),scalePercent:z.number().min(10).max(400).default(100),center:z.boolean().default(true),
  documentFrame:z.object({widthMm:z.number().min(5).max(2000),heightMm:z.number().min(5).max(2000),fit:z.enum(['fit','fill','stretch']).default('fit')}).optional(),
  scanSharpen:z.number().min(0).max(100).default(0),
  scanDenoise:z.number().min(0).max(100).default(0),
  scanDeskew:z.number().min(-10).max(10).default(0),
  margins:z.object({left:mm,right:mm,top:mm,bottom:mm}).optional(),gutterMm:mm.default(0),
  ink:z.enum(['legacy','auto','colour','mono','grayscale','mixed']).default('legacy'),colourRange:z.string().max(2000).default(''),analysisConfirmed:z.boolean().default(false),
  brightness:z.number().min(25).max(200).default(100),contrast:z.number().min(25).max(200).default(100),smoothing:z.boolean().default(true),
  renderDpi:z.number().int().min(72).max(600).default(150),driverDpi:z.object({x:z.number().int().min(1).max(9600),y:z.number().int().min(1).max(9600)}).optional(),
  collate:z.boolean().default(true),sideSelection:z.enum(['all','front','back']).default('all'),tray:z.number().int().min(0).max(65535).optional(),
  manualFirstSide:z.enum(['front','back']).optional(),manualFeedApplied:manualFeedProfileSchema.optional(),
  fileCopies:z.record(z.string(),z.number().int().min(1).max(100)).default({}),
  printable:z.object({left:mm,right:mm,top:mm,bottom:mm}).optional(),
  poster:z.object({enabled:z.boolean().default(false),scale:z.number().min(10).max(1000).default(100),overlapMm:z.number().min(0).max(40).default(5),marks:z.boolean().default(true),labels:z.boolean().default(true)}).optional(),
  fileSelection:z.array(z.string().min(1).max(256)).min(1).max(40).optional(),
  pdfSettings:z.object({copies:z.number().int().min(1).max(100),nup:z.number().int().min(1).max(64),duplex:z.enum(['simplex','longEdge','shortEdge']),colour:z.boolean(),printer:z.string().max(512).optional()}).optional(),
  photoAdjustments:z.object({charge:z.number().int().min(0).max(100000000),discount:z.number().int().min(0).max(100000000)}).optional(),
  photoMedia:z.string().trim().min(1).max(80).default('Default'),
  photoArrangement:z.enum(['auto','grid','rows','columns','manual']).default('auto'),
  photoGrid:z.object({rows:z.number().int().min(1).max(8),columns:z.number().int().min(1).max(8),capacity:z.number().int().min(1).max(64).optional()}).optional(),
  photoPositions:z.array(z.object({file:z.string().min(1).max(256),copy:z.number().int().min(0).max(99),sheet:z.number().int().min(0).max(199),x:z.number().min(0).max(2000),y:z.number().min(0).max(2000),frame:z.object({width:z.number().min(1).max(2000),height:z.number().min(1).max(2000),rotation:z.number().int().min(0).max(270).multipleOf(90)}).optional()})).max(1000).optional(),
  photoMaxPerSheet:z.number().int().min(1).max(64).optional(),
  photoBatch:z.boolean().default(false),
  photoItems:z.record(z.string(),z.object({widthMm:z.number().min(10).max(1000),heightMm:z.number().min(10).max(1000),quantity:z.number().int().min(1).max(100),rotation:z.number().int().min(0).max(270).multipleOf(90).default(0),fit:z.enum(['contain','cover']).default('contain'),brightness:z.number().min(25).max(200).default(100),contrast:z.number().min(25).max(200).default(100),saturation:z.number().min(0).max(200).default(100),sharpness:z.number().min(0).max(100).default(0),flipX:z.boolean().default(false),flipY:z.boolean().default(false),zoom:z.number().min(1).max(4).default(1),background:z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ffffff'),ink:z.enum(['inherit','colour','original','grayscale','mono','sepia','auto']).default('inherit'),detectedColour:z.boolean().optional(),documentLightening:z.number().min(0).max(100).default(0),autoContrast:z.boolean().default(false),exposure:z.number().min(-2).max(2).default(0),warmth:z.number().min(-100).max(100).default(0),shadows:z.number().min(-100).max(100).default(0),highlights:z.number().min(-100).max(100).default(0),denoise:z.number().min(0).max(100).default(0),crop:z.object({x:z.number().min(0).max(.99),y:z.number().min(0).max(.99),width:z.number().min(.01).max(1),height:z.number().min(.01).max(1)}).refine(c=>c.x+c.width<=1.000001&&c.y+c.height<=1.000001,'Crop must remain within the original image.').optional()})).default({}),
  photo:z.object({widthMm:z.number().min(10).max(1000),heightMm:z.number().min(10).max(1000),quantity:z.number().int().min(1).max(500),cutGuides:z.boolean().default(false),whiteBorderMm:z.number().min(0).max(20).default(0)}).optional()
});
export const batchPdfFileSchema=basePrintSettingsSchema.omit({
 printer:true,fileSelection:true,fileCopies:true,sideSelection:true,manualFeedApplied:true,
 photoItems:true,photo:true,photoBatch:true,photoGrid:true,photoArrangement:true,photoMedia:true,
 photoPositions:true,photoMaxPerSheet:true,photoAdjustments:true,pdfSettings:true
}).extend({
 rotation:basePrintSettingsSchema.shape.rotation.default(0),
 fit:basePrintSettingsSchema.shape.fit.default('contain'),
 layout:basePrintSettingsSchema.shape.layout.default('single')
});
export type BatchPdfFile=z.input<typeof batchPdfFileSchema>;
export const printSettingsSchema=basePrintSettingsSchema.extend({
 batchPdfFiles:z.record(z.string(),batchPdfFileSchema).optional(),
 orderAdjustments:z.object({charge:z.number().int().min(0).max(100000000),discount:z.number().int().min(0).max(100000000)}).optional()
});
export type PrintSettings=z.output<typeof printSettingsSchema>;
export type PrintSettingsInput=z.input<typeof printSettingsSchema>;
export function normalizedSettings(raw:PrintSettingsInput):PrintSettings{
  const s=printSettingsSchema.parse(raw);
  paperDimensions(s.paper,s.customPaper);
  if(s.scaling==='printable'&&s.orientation==='auto')throw new Error('Fit to printable area requires a fixed page orientation.');
  if(s.documentFrame&&(s.booklet||s.poster?.enabled||s.nup!==1))throw new Error('A custom PDF frame requires ordinary one-up layout.');
  if(s.booklet&&(s.nup!==2||s.duplex==='simplex'||s.poster?.enabled))throw new Error('Booklets require 2-up duplex and cannot use poster mode.');
  if(s.handoutNotes&&(s.nup!==3||s.booklet||s.poster?.enabled||s.grid))throw new Error('Lined handouts require the dedicated three-slide layout.');
  if(s.grid&&s.grid.rows*s.grid.columns!==s.nup)throw new Error('Custom grid rows times columns must equal pages per side.');
  if(s.poster?.enabled&&(s.booklet||s.nup!==1||s.duplex!=='simplex'))throw new Error('Poster printing requires one-sided 1-up with booklet disabled.');
  return s;
}
