export const supportPhone='076 766 0922';
export const supportDigits='0767660922';
export const developerName='Kavishka Sandaruwan';
export const supportActions=['whatsapp','call','copy'] as const;
export type SupportAction=typeof supportActions[number];

const externalLinks={whatsapp:'https://wa.me/94767660922',call:'tel:+94767660922'} as const;
export async function performSupportAction(action:SupportAction,openExternal:(url:string)=>Promise<void>,copy:(value:string)=>void){
 if(action==='copy'){
  copy(supportDigits);
  return;
 }
 if(!Object.hasOwn(externalLinks,action))throw new Error('Unsupported contact action.');
 try{await openExternal(externalLinks[action])}
 catch{
  throw new Error(action==='call'
   ?'Windows could not open a calling app. Call '+supportPhone+' from your phone.'
   :'Windows could not open WhatsApp support. Use '+supportPhone+' to contact us.');
 }
}

export async function openLicensePurchase(deviceId:string,openExternal:(url:string)=>Promise<void>){
 const url=new URL(externalLinks.whatsapp);
 url.searchParams.set('text','Hi, I would like to buy a BloomConnect license.\nDevice ID: '+deviceId);
 try{await openExternal(url.toString())}
 catch{throw new Error('Windows could not open WhatsApp. Contact '+supportPhone+' and share your Device ID.')}
}
