// quartz/components/semantic/embed.ts
import type { FeatureExtractionPipeline } from "@xenova/transformers"

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null
const MODEL_ID = "Xenova/all-MiniLM-L6-v2"

async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { env, pipeline } = await import("@xenova/transformers")

      env.allowLocalModels = false
      env.useBrowserCache = true
      env.backends.onnx.wasm.wasmPaths =
        "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/"
      env.backends.onnx.wasm.numThreads = 1

      return pipeline("feature-extraction", MODEL_ID, {
        quantized: true,
      }) as Promise<FeatureExtractionPipeline>
    })()
  }

  return pipelinePromise
}

export async function warmEmbeddingModel(): Promise<void> {
  await getPipeline()
}

export async function embed(text: string): Promise<Float32Array> {
  const extractor = await getPipeline()
  const output = await extractor(text, {
    pooling: "mean",
    normalize: true,
  })

  const data = (output as { data?: Float32Array | number[] }).data
  if (!data) {
    throw new Error("Semantic embedding pipeline returned no vector data")
  }

  const vector = data instanceof Float32Array ? data : Float32Array.from(data)
  if (vector.length !== 384) {
    throw new Error(`Expected a 384-dimensional embedding, received ${vector.length}`)
  }

  return vector
}
