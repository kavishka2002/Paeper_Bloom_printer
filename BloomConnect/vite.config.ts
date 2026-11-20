import { defineConfig } from 'vite';
import tailwind from '@tailwindcss/vite';
export default defineConfig({root:'apps/renderer',base:'./',plugins:[tailwind()],build:{outDir:'../../dist/ui',emptyOutDir:true}});