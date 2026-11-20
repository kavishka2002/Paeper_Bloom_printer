import {z} from 'zod';

export const scanModes=['bw','gray','color'] as const;
export const unitPoint=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1)});
export const scanSettingsSchema=z.object({
 mode:z.enum(scanModes),brightness:z.number().min(-40).max(40),contrast:z.number().min(-40).max(60),
 white:z.number().min(0).max(100),shadow:z.number().min(0).max(100),sharpness:z.number().min(0).max(60),
 denoise:z.number().min(0).max(50),threshold:z.number().min(0).max(100),
 rotation:z.union([z.literal(0),z.literal(90),z.literal(180),z.literal(270)]),
 skew:z.number().min(-15).max(15),autoStraighten:z.boolean().default(true),corners:z.array(unitPoint).length(4).optional()
});
export type ScanPoint=z.infer<typeof unitPoint>;
export type ScanSettings=z.infer<typeof scanSettingsSchema>;
export type ScanPreview={image:Uint8Array;original:Uint8Array;corners:ScanPoint[];detected:boolean;warnings:string[];width:number;height:number};

const base:ScanSettings={mode:'color',brightness:0,contrast:12,white:88,shadow:90,sharpness:16,denoise:12,threshold:50,rotation:0,skew:0,autoStraighten:true};
export const scanPresets=[
 {name:'Auto Scan',settings:base},
 {name:'Clean White Document',settings:{...base,white:100,contrast:25}},
 {name:'Black & White Scan',settings:{...base,mode:'bw',threshold:54}},
 {name:'Grayscale Scan',settings:{...base,mode:'gray',contrast:18}},
 {name:'Color Document Scan',settings:{...base,white:78,contrast:5}},
 {name:'Receipt Scan',settings:{...base,mode:'gray',white:90,contrast:35,sharpness:22}},
 {name:'Handwritten Notes',settings:{...base,white:75,contrast:8,denoise:5,sharpness:8}},
 {name:'Certificate / Official Document',settings:{...base,white:65,contrast:0,denoise:4,sharpness:8}}
] satisfies {name:string;settings:ScanSettings}[];

export const fullScanCorners:ScanPoint[]=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
