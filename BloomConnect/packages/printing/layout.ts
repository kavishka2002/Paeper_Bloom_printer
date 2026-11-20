export function selectPages(range:string,count:number){
  if(!range.trim()){if(count>100)throw new Error('Select up to 100 pages per submission.');return Array.from({length:count},(_,i)=>i+1)}
  const result=new Set<number>();
  for(const section of range.split(',')){
    const match=/^(\d+)(?:\s*-\s*(\d+))?$/.exec(section.trim());
    if(!match)throw new Error('Enter page ranges such as 1-3, 5.');
    const first=Number(match[1]);const last=Number(match[2]??match[1]);
    if(first<1||last>count||first>last||last-first>=100)throw new Error('Page range is outside the document or exceeds 100 pages.');
    for(let i=first;i<=last;i++)result.add(i);
    if(result.size>100)throw new Error('Select up to 100 pages per submission.');
  }
  return [...result].sort((a,b)=>a-b);
}
