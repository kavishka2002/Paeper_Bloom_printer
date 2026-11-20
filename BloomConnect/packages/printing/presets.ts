import {printSettingsSchema} from './settings';
export function defaultPresets(){
 const base={printer:'',paper:'A4' as const,copies:1,colour:false,landscape:false,duplex:'simplex' as const,range:'',rotation:0,fit:'contain' as const,layout:'single' as const};
 const entries:[string,Record<string,unknown>][]=[['A4 B/W Single Side',{}],['A4 B/W Double Side',{duplex:'longEdge'}],['A4 Colour',{colour:true}],['A3 B/W',{paper:'A3'}],['A3 Colour',{paper:'A3',colour:true}],['A4 2-up',{nup:2}],['A4 4-up',{nup:4}],['A4 6-up',{nup:6}],['A4 Booklet',{booklet:true,nup:2,duplex:'shortEdge',landscape:true}],['A3 Booklet',{paper:'A3',booklet:true,nup:2,duplex:'shortEdge',landscape:true}],['Photo Print',{paper:'4x6',colour:true}],['Passport Photos',{layout:'passport',colour:true}],['Economy Raster',{renderDpi:96}],['High Quality Raster',{renderDpi:300}]];
 entries.push(['Poster Print',{poster:{enabled:true,scale:200}}]);
 entries.push(['PPT 3 Slides with Notes',{nup:3,handoutNotes:true,borders:true,marginMm:5,gapMm:4}],
  ['PPT 4 Slides per Side',{nup:4}],['PPT 6 Slides per Side',{nup:6}],['PPT 8 Slides per Side',{nup:8}],
  ['PPT 6 Slides Duplex',{nup:6,duplex:'longEdge'}],['PDF 8-up',{nup:8}],
  ['A5 to A6 Booklet',{paper:'A5',booklet:true,nup:2,duplex:'shortEdge',landscape:true}],
  ['Manual Duplex Booklet',{booklet:true,nup:2,duplex:'manualShortEdge',landscape:true}]);
 return entries.map(([name,settings],i)=>({id:'default-'+i,name,settings:printSettingsSchema.parse({...base,...settings})}));
}
