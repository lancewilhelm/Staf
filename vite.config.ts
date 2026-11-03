import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';
export default defineConfig({root:resolve('web'),plugins:[vue()],build:{outDir:resolve('dist/web'),emptyOutDir:true}});
