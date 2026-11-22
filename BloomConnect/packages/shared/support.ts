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

export async function openLicensePurchase(deviceId:string,shopName:string,openExternal:(url:string)=>Promise<void>){
 const url=new URL(externalLinks.whatsapp);
 const shop=shopName.trim().replace(/\s+/g,' ');
 if(!shop||shop.length>160)throw new Error('Enter a shop name of up to 160 characters.');
 url.searchParams.set('text',[
  'Hello BloomConnect Support,',
  'I would like to purchase or renew a 365-day BloomConnect license. Please share the price and payment instructions.',
  '',
  'ආයුබෝවන් BloomConnect සහාය කණ්ඩායම,',
  'BloomConnect දින 365 බලපත්‍රයක් මිලදී ගැනීමට හෝ අලුත් කිරීමට කැමැත්තෙමි. කරුණාකර මිල සහ ගෙවීමේ විස්තර දැනුම් දෙන්න.',
  '',
  'Shop name / වෙළඳසැලේ නම: '+shop,
  'Device ID: '+deviceId,
  '',
  'Thank you / ස්තූතියි.',
 ].join('\n'));
 try{await openExternal(url.toString())}
 catch{throw new Error('Windows could not open WhatsApp. Contact '+supportPhone+' and share your Device ID.')}
}
