import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@contract': r('./src/contract'),
      '@physics': r('./src/physics'),
      '@render': r('./src/render'),
      '@ui': r('./src/ui'),
      '@loader': r('./src/loader'),
    },
  },
  server: { host: true, port: 5173 },
  build: { outDir: 'build/out', target: 'es2022', sourcemap: true },
});
