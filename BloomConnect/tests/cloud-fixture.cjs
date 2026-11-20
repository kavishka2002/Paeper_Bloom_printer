const realFetch=globalThis.fetch;let outgoing=0;
globalThis.fetch=async(target,options)=>{
 const url=new URL(target);
 if(url.hostname==='graph.facebook.com'){
  if(url.pathname.endsWith('/messages'))return Response.json({messages:[{id:'wamid.test-outbound-'+(++outgoing)}]});
  if(url.pathname.endsWith('/123456789'))return Response.json({url:'https://lookaside.fbsbx.com/test-pdf'});
  return Response.json({id:'1234567890',display_phone_number:'Meta fixture number'});
 }
 if(url.hostname==='lookaside.fbsbx.com')return new Response(Buffer.from('%PDF-1.7\n% deterministic media transport fixture\n'));
 return realFetch(target,options);
};
