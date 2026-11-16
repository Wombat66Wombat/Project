/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';
import { execSync } from 'node:child_process';

/** e.g. "2026-11-16 · 3f2a1bc": the build date and commit, shown in Settings. */
function appVersion(): string {
  const date = new Date().toISOString().slice(0, 10);
  try {
    return `${date} · ${execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()}`;
  } catch {
    return date;
  }
}

/**
 * Writes sw.js (from scripts/sw-template.js) into the build with the list of files to cache for
 * offline use. Everything the app needs is precached; the 14 MB smart-search engine (public/ort)
 * is cached only once someone turns smart search on.
 */
function serviceWorker(): Plugin {
  return {
    name: 'atlas-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const fromBundle = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const icons = readdirSync(new URL('./public/icons', import.meta.url)).map((f) => `icons/${f}`);
      const files = ['./', 'favicon.svg', 'manifest.webmanifest', ...icons, ...fromBundle.filter((f) => f !== 'index.html')].sort();
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      const template = readFileSync(new URL('./scripts/sw-template.js', import.meta.url), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(files, null, 2)),
      });
    },
  };
}

// `base: './'` makes the build work from any sub-path, e.g. GitHub Pages' /<repo>/.
export default defineConfig({
  base: './',
  plugins: [react(), serviceWorker()],
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
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
