// quartz/components/semantic/embed.ts
import type { FeatureExtractionPipeline } from "@xenova/transformers"

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null
let warmPromise: Promise<void> | null = null
const embeddingCache = new Map<string, Float32Array>()
const MODEL_ID = "Xenova/all-MiniLM-L6-v2"
const DIM = 384
const MAX_CACHE_ENTRIES = 24

async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { env, pipeline } = await import("@xenova/transformers")

      env.allowLocalModels = false
      env.allowRemoteModels = true
      env.useBrowserCache = true

      // Do not override wasmPaths here. @xenova/transformers 2.17.2 pins
      // onnxruntime-web 1.14.0 and already supplies matching precompiled WASM
      // binaries from its CDN. Pointing the 1.14 runtime at 1.18 binaries causes
      // the browser backend to fail during initialisation ("no available backend").
      // We only choose the threading policy and let Transformers.js resolve its
      // own runtime assets.
      const hardwareThreads = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 1 : 1
      env.backends.onnx.wasm.numThreads =
        typeof crossOriginIsolated !== "undefined" && crossOriginIsolated
          ? Math.max(1, Math.min(4, hardwareThreads))
          : 1

      return pipeline("feature-extraction", MODEL_ID, {
        quantized: true,
      }) as Promise<FeatureExtractionPipeline>
    })()

    // A transient CDN/runtime failure should not poison semantic search for the
    // entire page lifetime. Let a later query retry model initialisation.
    pipelinePromise.catch(() => {
      pipelinePromise = null
    })
  }

  return pipelinePromise
}

function tensorVector(output: unknown): Float32Array {
  const data = (output as { data?: Float32Array | number[] }).data
  if (!data) throw new Error("Semantic embedding pipeline returned no vector data")

  const vector = data instanceof Float32Array ? data : Float32Array.from(data)
  if (vector.length !== DIM) {
    throw new Error(`Expected a ${DIM}-dimensional embedding, received ${vector.length}`)
  }
  return vector
}

export async function warmEmbeddingModel(): Promise<void> {
  if (!warmPromise) {
    warmPromise = (async () => {
      const extractor = await getPipeline()
      // Loading the pipeline alone does not pay ONNX's first-inference cost.
      // Run a tiny real inference so the first user query does not.
      const output = await extractor("semantic search warmup", {
        pooling: "mean",
        normalize: true,
      })
      tensorVector(output)
    })()

    warmPromise.catch(() => {
      warmPromise = null
    })
  }
  return warmPromise
}

export async function embed(text: string): Promise<Float32Array> {
  const key = text.trim().toLowerCase()
  const cached = embeddingCache.get(key)
  if (cached) return cached

  const extractor = await getPipeline()
  const output = await extractor(text, {
    pooling: "mean",
    normalize: true,
  })
  const vector = tensorVector(output)

  embeddingCache.set(key, vector)
  if (embeddingCache.size > MAX_CACHE_ENTRIES) {
    const oldest = embeddingCache.keys().next().value as string | undefined
    if (oldest) embeddingCache.delete(oldest)
  }
  return vector
}
