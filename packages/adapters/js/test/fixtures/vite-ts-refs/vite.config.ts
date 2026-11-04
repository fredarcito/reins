import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: { alias: { '~': fileURLToPath(new URL('./src/shared', import.meta.url)) } },
});
