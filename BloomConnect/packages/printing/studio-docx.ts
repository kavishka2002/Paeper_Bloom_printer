import {strToU8,zipSync} from 'fflate';

const encode=(value:string)=>value.replace(/[<>&\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,character=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[character]??''));

export function studioDocx(pages:string[][]){
 const content=pages.map(lines=>lines.map(line=>'<w:p><w:r><w:t xml:space="preserve">'+encode(line)+'</w:t></w:r></w:p>').join(''))
  .join('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
 const document='<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+content+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>';
 return zipSync({
  '[Content_Types].xml':strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
  '_rels/.rels':strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
  'word/document.xml':strToU8(document)
 });
}
