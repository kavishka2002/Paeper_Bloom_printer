const realFetch=globalThis.fetch;let outgoing=0;
globalThis.fetch=async(target,options)=>{
 const url=new URL(target);
 if(url.hostname==='graph.facebook.com'){
  if(url.pathname.endsWith('/messages'))return Response.json({messages:[{id:'wamid.test-outbound-'+(++outgoing)}]});
  if(url.pathname.endsWith('/123456789'))return Response.json({url:'https://lookaside.fbsbx.com/test-pdf'});
  return Response.json({id:'1234567890',display_phone_number:'Meta fixture number'});
 }
 if(url.hostname==='lookaside.fbsbx.com'){
  const chunks=process.env.BLOOMCONNECT_TEST_LARGE_CLOUD==='1'?34:0;
  if(!chunks)return new Response(Buffer.from('%PDF-1.7\n% deterministic media transport fixture\n'));
  const chunk=Buffer.alloc(1024**2,10);
  chunk.write('%PDF-1.7');
  let sent=0;
  return new Response(new ReadableStream({pull(controller){
   if(sent++<chunks)controller.enqueue(chunk);
   else controller.close();
  }}),{headers:{'content-length':String(chunks*chunk.length)}});
 }
 return realFetch(target,options);
};
