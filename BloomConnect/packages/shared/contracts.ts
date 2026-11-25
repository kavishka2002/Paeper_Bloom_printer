import {calculationSchema,paperDocumentRatesSchema,type PrintCalculation,type CalculationInput} from '../printing/calculation';
import { z } from 'zod';
import {manualFeedProfileSchema,printSettingsSchema,type ManualFeedProfile} from '../printing/settings';
import {paperNames} from '../printing/paper';
import type {PrinterCapabilities} from '../printing/windows';
import {supportActions} from './support';
import {scanSettingsSchema,type ScanPreview} from './scan';
const id = z.string().min(1).max(256);
const label = z.string().trim().min(1).max(160);
const cents = z.number().int().min(0).max(100000000);
export const stages = ['New','Awaiting Confirmation','Processing','Ready to Print','Printing','Ready for Pickup','Completed','Cancelled','Failed'] as const;
export const triggers = ['message','keyword','pdf','image','document','print-completed','payment-completed','pickup','files-received','order-created','printing-started','collected','ready-to-print','print-queued','price-confirmed'] as const;
export const actions = ['order','notify','label','reply'] as const;
export const schemas = {
  appInfo:z.null(),
  supportAction:z.object({action:z.enum(supportActions)}).strict(),
  scanPreview:z.object({id,token:id,settings:scanSettingsSchema}),
  saveScan:z.object({id,token:id,settings:scanSettingsSchema}),
  cancelScan:z.object({token:id}),
  combineScans:z.object({token:id,pages:z.array(z.object({id,rotation:z.union([z.literal(0),z.literal(90),z.literal(180),z.literal(270)])})).min(1).max(40),layout:z.enum(['a4','original']),marginMm:z.number().min(0).max(30)}),
  exportScannedPdf:z.object({id}),
  printEstimate:calculationSchema,
  printerCapabilities:z.object({printer:label,settings:printSettingsSchema.optional()}),
  printerDialog:z.object({printer:label,kind:z.enum(['preferences','properties'])}),
  testDuplex:printSettingsSchema.pick({printer:true,paper:true,customPaper:true,orientation:true,landscape:true,duplex:true}).refine(settings=>settings.duplex!=='simplex'&&settings.orientation!=='auto','Choose double-sided printing and a fixed orientation.'),
  openPrinterSettings:z.null(),
  manualFeedProfile:z.object({printer:label,landscape:z.boolean(),edge:z.enum(['long','short'])}),
  saveManualFeedProfile:z.object({printer:label,landscape:z.boolean(),edge:z.enum(['long','short']),profile:manualFeedProfileSchema,verified:z.literal(true)}),
  savePrintPdf:printSettingsSchema.extend({id}),
  manualContinue:z.object({token:id,reinserted:z.literal(true),reverseStack:z.boolean(),rotateBack:z.boolean()}),
  manualCancel:z.object({token:id}),
  printPresets:z.null(),savePrintPreset:z.object({id:id.optional(),name:label,settings:printSettingsSchema}),deletePrintPreset:z.object({id}),setDefaultPrintPreset:z.object({id:id.nullable()}),
  pricingRules:z.null(),savePricingRule:z.object({media:z.string().trim().min(1).max(80).optional(),id:id.optional(),name:label,paper:z.enum(paperNames),method:z.enum(['ordinary','nup','booklet','photo','poster']),duplex:z.boolean(),policy:calculationSchema.shape.pricing.unwrap()}),deletePricingRule:z.object({id}),
  notificationLog:z.null(),
  snapshot:z.null(), printers:z.null(), logout:z.null(), webConnect:z.null(),webSync:z.null(),webChatSync:z.object({id}), backup:z.null(),
  setup:z.object({shop:label,language:z.enum(['en','si']),printer:z.string().max(512),mono:cents,colour:cents,photo:cents,duplexMono:cents.optional(),duplexColour:cents.optional(),paperRates:paperDocumentRatesSchema.optional()}),
  connect:z.object({phoneId:z.string().regex(/^\d{5,30}$/),version:z.string().regex(/^v\d{1,2}\.0$/),token:z.string().min(20).max(4096),appSecret:z.string().min(16).max(256),verifyToken:z.string().min(16).max(256)}),
  customer:z.object({id:id.optional(),name:label,phone:z.string().regex(/^\+?[1-9]\d{6,14}$/).or(z.literal('')),notes:z.string().max(4000),tag:z.string().max(120)}),
  import:z.object({customer:id.nullable()}), preview:z.object({id,page:z.number().int().min(1).max(10000).optional(),compatibleImage:z.boolean().optional(),imageMaxSide:z.number().int().min(64).max(1800).optional()}),
  fileReference:z.object({id}), cancelMedia:z.object({id}), retryMedia:z.object({id}), read:z.object({id}),
  order:z.object({customer:id.nullable(),files:z.array(id).min(1).max(40),copies:z.number().int().min(1).max(100),paper:z.enum(paperNames),colour:z.boolean(),price:cents,discount:cents,charge:cents,calculations:z.array(z.object({id,settings:calculationSchema})).min(1).max(40).optional(),printSettings:printSettingsSchema.optional()}),
  updatePhotoOrder:z.object({id,files:z.array(id).min(1).max(40),printSettings:printSettingsSchema,total:cents,reason:z.string().trim().min(3).max(500)}),
  quote:z.object({id,total:cents,reason:z.string().trim().min(3).max(500)}),
  confirmPrice:z.object({id,total:cents}),
  convertDocument:z.object({id,mode:z.enum(['pages','notes','outline']).default('pages'),includeHidden:z.boolean().default(false)}),
  stage:z.object({id,status:z.enum(stages)}),
  payment:z.object({id,amount:cents.positive(),method:z.enum(['Cash','Bank Transfer','Other'])}),
  receipt:z.object({id}),bill:z.object({id}),saveAttachment:z.object({id}),
  print:printSettingsSchema.extend({id,printer:label}),
  saveStudioDocument:z.object({name:z.string().min(1).max(180),format:z.enum(['pdf','zip','png','jpg','txt','docx']),bytes:z.instanceof(Uint8Array).refine(bytes=>bytes.length>0&&bytes.length<=150*1024*1024,'The export must be between 1 byte and 150 MB.')}),
  cleanStudioScan:z.object({bytes:z.instanceof(Uint8Array).refine(bytes=>bytes.length>0&&bytes.length<=50*1024*1024),settings:scanSettingsSchema}),
  recognizeStudioScan:z.object({bytes:z.instanceof(Uint8Array).refine(bytes=>bytes.length>0&&bytes.length<=50*1024*1024),language:z.enum(['eng','sin','eng+sin'])}),
  convertStudioWord:z.object({bytes:z.instanceof(Uint8Array).refine(bytes=>bytes.length>0&&bytes.length<=100*1024*1024)}),
  importStudioPrint:z.object({name:z.string().min(1).max(180),bytes:z.instanceof(Uint8Array).refine(bytes=>bytes.length>0&&bytes.length<=32*1024*1024,'Print Studio accepts PDFs up to 32 MB.')}),
  revealStudioOutput:z.null(),
  secureStudioPdf:z.object({bytes:z.instanceof(Uint8Array).refine(bytes=>bytes.length>0&&bytes.length<=150*1024*1024),mode:z.enum(['protect','unlock']),password:z.string().max(120).regex(/^[^\r\n\u0000]*$/),owner:z.string().max(120).regex(/^[^\r\n\u0000]*$/),printing:z.enum(['full','low','none'])}),
  queue:z.object({id,status:z.enum(['Completed','Cancelled'])}),
  confirmPrintSubmissions:z.object({id,entries:z.array(id).min(1)}),
  reply:z.object({id,text:z.string().trim().min(1).max(4096)}),
  rule:z.object({debounceSeconds:z.number().int().min(0).max(300).default(0),id:id.optional(),name:label,trigger:z.enum(triggers),keyword:z.string().max(160),actions:z.array(z.enum(actions)).min(1).max(4),text:z.string().max(4096),enabled:z.boolean(),graph:z.string().max(50000)}),
  testRule:z.object({id})
};
export type Operation=keyof typeof schemas;
export type Input<K extends Operation>=z.input<(typeof schemas)[K]>;
export type Customer={id:string;name:string;phone:string;notes:string;tag:string;created:string;last:string};
export type Attachment={id:string;customer_id:string|null;message_id:string|null;name:string;mime:string;status:string;created:string;bytes:number;download?:{bytes:number;total?:number;error?:string}};
export type Message={id:string;customer_id:string;body:string;kind:string;direction:string;status:string;created:string;unread:number};
export type Job={id:string;customer_id:string|null;status:typeof stages[number];copies:number;paper:string;colour:number;total:number;paid:number;created:string;files:string[];printSettings?:Omit<Input<'print'>,'id'>;calculations?:{id:string;settings:CalculationInput;result:PrintCalculation}[]};
export type Payment={id:string;job_id:string;amount:number;method:string;created:string};
export type QueueEntry={id:string;job_id:string;printer:string;status:string;error:string;created:string;settings:string|null};
export type Rule=Input<'rule'>&{id:string};
export type Activity={id:number;kind:string;detail:string;created:string};
export type Snapshot={settings:Input<'setup'>|null;customers:Customer[];attachments:Attachment[];messages:Message[];jobs:Job[];payments:Payment[];queue:QueueEntry[];rules:Rule[];activity:Activity[];connection:{status:string;phone:string;webhook:boolean;mode?:'web';qr?:string;qrClientId?:string;qrGeneratedAt?:string;detail?:string;sync?:string}};
export type Printer={name:string;displayName:string;isDefault:boolean;status?:number;options?:Record<string,string>};
export type PrintPreset={id:string;name:string;settings:Input<'print'>;builtin?:boolean};
export type PricingRule=Input<'savePricingRule'>&{id:string};
export type Preview={mime:string;bytes:Uint8Array};
export type FileReference={url:string;mime:string;bytes:number};
export type Results={fileReference:FileReference;saveStudioDocument:boolean;importStudioPrint:string;convertStudioWord:Uint8Array;secureStudioPdf:Uint8Array;cleanStudioScan:ScanPreview;recognizeStudioScan:{text:string;pdf:Uint8Array};bill:boolean;saveAttachment:boolean;reply:string;scanPreview:ScanPreview;saveScan:string;combineScans:string;exportScannedPdf:boolean;appInfo:{version:string};convertDocument:string;manualFeedProfile:ManualFeedProfile|null;notificationLog:{sendAttempts:{attempted:string;result:string;error:string}[];delivery_status:string|null;id:string;rule_id:string;customer_id:string;event_key:string;status:string;attempts:number;error:string;created:string}[];print:{manualToken?:string;entry:string};manualContinue:{entry:string};savePrintPdf:boolean;printerCapabilities:PrinterCapabilities;printPresets:{presets:PrintPreset[];defaultId:string|null};pricingRules:PricingRule[];printEstimate:PrintCalculation;webChatSync:{messages:number;documents:number;partial:boolean};snapshot:Snapshot;printers:Printer[];preview:Preview;import:number;order:string;backup:boolean;receipt:boolean};
export type Bridge={importDropped:(files:File[],customer:string|null)=>Promise<number>;call:<K extends Operation>(operation:K,input:Input<K>)=>Promise<K extends keyof Results?Results[K]:void>;subscribe:(listener:()=>void)=>()=>void};
