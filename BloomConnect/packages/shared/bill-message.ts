export function billMessage(shop:string,order:{id:string;total:number;paid:number},pdfNames?:string[]){
 const money=(amount:number)=>'LKR '+(amount/100).toLocaleString('en-LK',{minimumFractionDigits:2,maximumFractionDigits:2});
 const files=pdfNames?.length?`\n${pdfNames.length} PDFs\n${pdfNames.join('\n').slice(0,2500)}\n`:'';
 return `${shop} / Order ${order.id}${files}\nTotal ${money(order.total)}\nPaid ${money(order.paid)}\nBalance ${money(order.total-order.paid)}`;
}
