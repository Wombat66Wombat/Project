/// <reference lib="webworker" />
/**
 * Runs the embedding model off the main thread so typing never stutters.
 * Messages in:  init { modelId, ortBase } · embed { id, texts }
 * Messages out: progress { loaded, total } · ready · vectors { id, data } · error { id?, message }
 */
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

export type WorkerIn =
  | { type: 'init'; modelId: string; ortBase: string }
  | { type: 'embed'; id: number; texts: string[] };
export type WorkerOut =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'vectors'; id: number; data: Float32Array }
  | { type: 'error'; id?: number; message: string };

declare const self: DedicatedWorkerGlobalScope;
const post = (m: WorkerOut, transfer: Transferable[] = []) => self.postMessage(m, transfer);

let extractor: Promise<FeatureExtractionPipeline> | null = null;
// Work runs strictly in order, so a query never races with indexing.
let queue: Promise<void> = Promise.resolve();

function init(modelId: string, ortBase: string) {
  env.allowLocalModels = false;
  env.useBrowserCache = true; // the model downloads once, then loads from the browser cache
  const onnx = env.backends.onnx;
  if (onnx.wasm) {
    onnx.wasm.wasmPaths = { mjs: `${ortBase}ort-wasm-simd-threaded.mjs`, wasm: `${ortBase}ort-wasm-simd-threaded.wasm` };
    onnx.wasm.numThreads = 1; // GitHub Pages can't enable cross-origin isolation, which threads need
  }
  const files = new Map<string, { loaded: number; total: number }>();
  extractor = pipeline('feature-extraction', modelId, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== 'progress' || !p.file || !p.total) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      post({ type: 'progress', loaded, total });
    },
  }) as Promise<FeatureExtractionPipeline>;
  extractor.then(
    () => post({ type: 'ready' }),
    (e: unknown) => post({ type: 'error', message: describe(e) }),
  );
}

function describe(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/fetch|network|Failed to load/i.test(msg)) return "Couldn't download the search model. Check your internet connection and try again.";
  return msg;
}

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const m = e.data;
  if (m.type === 'init') return init(m.modelId, m.ortBase);
  queue = queue.then(async () => {
    try {
      if (!extractor) throw new Error('Model not loaded');
      const ext = await extractor;
      const out = await ext(m.texts, { pooling: 'mean', normalize: true });
      const data = out.data instanceof Float32Array ? out.data : Float32Array.from(out.data as ArrayLike<number>);
      post({ type: 'vectors', id: m.id, data }, [data.buffer]);
    } catch (err) {
      post({ type: 'error', id: m.id, message: describe(err) });
    }
  });
};
