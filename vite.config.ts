/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// `base: './'` makes the build work from any sub-path, e.g. GitHub Pages' /<repo>/.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: [
      // Smart search only runs on the CPU (WebAssembly). Using onnxruntime's WASM-only build keeps
      // GPU code and a second 27 MB engine out of the site; the engine itself is served from public/ort.
      {
        find: /^onnxruntime-web\/webgpu$/,
        replacement: fileURLToPath(new URL('./node_modules/onnxruntime-web/dist/ort.wasm.min.mjs', import.meta.url)),
      },
    ],
  },
  test: { environment: 'jsdom' },
});
