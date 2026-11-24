export const duplexModes=['simplex','auto','longEdge','shortEdge','manualAuto','manualLongEdge','manualShortEdge'] as const;
export type DuplexMode=typeof duplexModes[number];
export const isManualDuplex=(mode:DuplexMode)=>mode.startsWith('manual');
export const isAutomaticDuplex=(mode:DuplexMode)=>mode!=='simplex'&&!isManualDuplex(mode);

export function resolveDuplex(mode:DuplexMode,landscape:boolean){
 if(mode==='auto')return landscape?'shortEdge':'longEdge';
 if(mode==='manualAuto')return landscape?'manualShortEdge':'manualLongEdge';
 return mode;
}

export function driverDuplex(mode:DuplexMode,landscape:boolean){
 const resolved=resolveDuplex(mode,landscape);
 return resolved==='longEdge'||resolved==='shortEdge'?resolved:'simplex';
}

export const duplexEdge=(mode:DuplexMode,landscape:boolean):'short'|'long'=>['shortEdge','manualShortEdge'].includes(resolveDuplex(mode,landscape))?'short':'long';
