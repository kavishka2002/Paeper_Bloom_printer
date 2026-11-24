const {buildSync}=require('esbuild');
buildSync({entryPoints:{main:'apps/desktop/main.ts',preload:'apps/desktop/preload.ts',engine:'packages/automation-engine/index.ts','scan-worker':'packages/printing/scan-worker.ts'},bundle:true,platform:'node',target:'node22',external:['electron','electron-updater','sharp','whatsapp-web.js','puppeteer-core','drizzle-orm/*'],outdir:'dist',outExtension:{'.js':'.cjs'}});
const {copyFileSync,cpSync}=require('node:fs');
copyFileSync('packages/printing/windows.ps1','dist/windows.ps1');
copyFileSync('packages/printing/office.ps1','dist/office.ps1');
for(const folder of ['cmaps','standard_fonts','wasm','iccs']){
  cpSync('node_modules/pdfjs-dist/'+folder,'dist/ui/assets/pdfjs/'+folder,{recursive:true});
}
