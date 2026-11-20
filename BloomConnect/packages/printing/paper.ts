export const paperSizes={A0:[841,1189],A1:[594,841],A2:[420,594],A3:[297,420],A4:[210,297],A5:[148,210],A6:[105,148],B4:[250,353],B5:[176,250],Letter:[215.9,279.4],Legal:[215.9,355.6],Executive:[184.15,266.7],Tabloid:[279.4,431.8],Ledger:[431.8,279.4],EnvelopeDL:[110,220],EnvelopeC5:[162,229],Envelope10:[104.775,241.3],'4x6':[101.6,152.4]} as const;
export const paperNames=['A0','A1','A2','A3','A4','A5','A6','B4','B5','Letter','Legal','Executive','Tabloid','Ledger','EnvelopeDL','EnvelopeC5','Envelope10','4x6','Custom'] as const;
export type Paper=typeof paperNames[number];
export function paperDimensions(paper:Paper,custom?:{widthMm:number;heightMm:number}):[number,number]{
  if(paper==='Custom'){if(!custom)throw new Error('Enter custom paper dimensions.');return [custom.widthMm,custom.heightMm]}
  return [...paperSizes[paper]];
}
