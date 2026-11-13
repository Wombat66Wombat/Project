// Copies the ONNX Runtime WebAssembly engine into public/ort so Atlas serves it itself
// (no third-party CDN at runtime). Runs automatically before `dev` and `build`.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, sep } from 'node:path';

// Resolve the copy transformers.js itself uses, then take its dist/ folder.
const require = createRequire(createRequire(import.meta.url).resolve('@huggingface/transformers'));
const entry = require.resolve('onnxruntime-web');
const dist = entry.slice(0, entry.lastIndexOf(`${sep}dist${sep}`) + 5);
const out = new URL('../public/ort/', import.meta.url);
mkdirSync(out, { recursive: true });
// The plain (non-asyncify) build: half the size, and all Atlas needs for CPU inference.
for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  if (!join(dist, f).includes(`onnxruntime-web${sep}dist`)) throw new Error(`Unexpected ONNX Runtime path: ${dist}`);
  copyFileSync(join(dist, f), new URL(f, out));
}
console.log('Copied ONNX Runtime to public/ort/');
