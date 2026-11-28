if(new URLSearchParams(location.search).has('print')){
  void import('./pdf').then(({preparePrint})=>preparePrint()).catch(error=>{
    window.printView.done(error instanceof Error?error.message:'Could not load the print renderer.');
  });
}else{
  void import('./src');
}
