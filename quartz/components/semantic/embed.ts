// quartz/components/semantic/embed.ts
import type { FeatureExtractionPipeline } from '@xenova/transformers'

let _pipeline: FeatureExtractionPipeline | null = null
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2' // 384-dim

export async function embed(text: string): Promise<Float32Array> {
  if (!_pipeline) {
    const { env, pipeline } = await import('@xenova/transformers')

    // Ensure we can fetch the onnxruntime wasm files from a CDN
    env.allowLocalModels = false
    env.useBrowserCache = true
    env.backends.onnx.wasm.wasmPaths =
      'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/'
    env.backends.onnx.wasm.numThreads = 1

    // The critical bit: force WASM (avoid WebGPU “No available adapters.”)
    _pipeline = await pipeline('feature-extraction', MODEL_ID, {
      quantized: true,
      device: 'wasm',
    })
  }

  const out = await _pipeline(text, { normalize: true })
  const arr = Array.isArray(out) ? (Array.isArray(out[0]) ? out[0] : out) : out
  return Float32Array.from(arr as number[])
}
