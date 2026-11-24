const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const {spawnSync}=require('node:child_process');
const {strToU8,zipSync}=require('fflate');

test('Office conversion accepts web hyperlinks and rejects links to external document data',{skip:process.platform!=='win32'},async()=>{
 const folder=await mkdtemp(join(tmpdir(),'bloom-office-links-'));
 try{
  const request=join(folder,'request.json');
  const relation='http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  for(const {kind,file,target,ok} of [
   {kind:'hyperlink',file:'slides.pptx',target:'https://example.com/',ok:true},
   {kind:'hyperlink',file:'document.docx',target:'mailto:print@example.com',ok:true},
   {kind:'image',file:'linked.pptx',target:'https://example.com/photo.png',ok:false},
   {kind:'attachedTemplate',file:'template.docx',target:'file:///C:/other.dotm',ok:false},
   {kind:'hyperlink',file:'local.docx',target:'file:///C:/other.docx',ok:false}
  ]){
   const input=join(folder,file);
   const part=file.endsWith('.pptx')?'ppt/presentation.xml':'word/document.xml';
   const rels='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" TargetMode="External" Type="'+relation+kind+'" Target="'+target+'"/></Relationships>';
   await writeFile(input,zipSync({[part]:strToU8('<fixture/>'),'_rels/.rels':strToU8(rels)}));
   await writeFile(request,JSON.stringify({input,output:join(folder,'output.pdf'),mode:'pages'}));
   const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve('packages/printing/office.ps1'),'-InputFile',request,'-ValidateOnly'],{encoding:'utf8',timeout:15_000,windowsHide:true});
   if(ok)assert.equal(result.status,0,result.stderr);
   else{assert.notEqual(result.status,0);assert.match(result.stderr,/references linked files or data/)}
  }
 }finally{await rm(folder,{recursive:true,force:true})}
});
