// quartz/components/semantic/loadStore.ts
export type DocCentroid = { slug: string; title: string; vec: number[]; n: number }
export type DocChunkMeta = { anchor: string; hPath: string[]; preview: string }
export type DocVectors = {
  rowAt: (i: number) => Float32Array
  rows: number
  idx: DocChunkMeta[]
}

let centroidsPromise: Promise<DocCentroid[]> | null = null
const docIndexCache = new Map<string, Promise<DocChunkMeta[]>>()
const docVectorsCache = new Map<string, Promise<DocVectors>>()

export function loadCentroids(): Promise<DocCentroid[]> {
  if (!centroidsPromise) {
    centroidsPromise = fetch("/static/sem/doc-centroids.json", { cache: "force-cache" }).then(
      async (response) => {
        if (!response.ok) {
          throw new Error(`Semantic index unavailable (${response.status})`)
        }
        return (await response.json()) as DocCentroid[]
      },
    )
  }
  return centroidsPromise
}

export function loadDocIndex(slug: string): Promise<DocChunkMeta[]> {
  const cached = docIndexCache.get(slug)
  if (cached) return cached

  const shard = slug.replaceAll("/", "__")
  const promise = fetch(`/static/sem/${shard}.idx.json`, { cache: "force-cache" }).then(
    async (response) => {
      if (!response.ok) throw new Error(`Semantic metadata unavailable for ${slug}`)
      return (await response.json()) as DocChunkMeta[]
    },
  )

  docIndexCache.set(slug, promise)
  promise.catch(() => docIndexCache.delete(slug))
  return promise
}

export function loadDocVectors(slug: string, dim = 384): Promise<DocVectors> {
  const cacheKey = `${slug}:${dim}`
  const cached = docVectorsCache.get(cacheKey)
  if (cached) return cached

  const promise = (async () => {
    const shard = slug.replaceAll("/", "__")
    const [binResponse, idx] = await Promise.all([
      fetch(`/static/sem/${shard}.bin`, { cache: "force-cache" }),
      loadDocIndex(slug),
    ])

    if (!binResponse.ok) {
      throw new Error(`Semantic vector shard unavailable for ${slug}`)
    }

    const binBuf = await binResponse.arrayBuffer()
    const vecs = new Float32Array(binBuf)
    if (vecs.length % dim !== 0) {
      throw new Error(`Corrupt semantic shard for ${slug}: ${vecs.length} values is not divisible by ${dim}`)
    }

    const rows = vecs.length / dim
    const rowAt = (i: number) => vecs.subarray(i * dim, (i + 1) * dim)
    return { rowAt, rows, idx }
  })()

  docVectorsCache.set(cacheKey, promise)
  promise.catch(() => docVectorsCache.delete(cacheKey))
  return promise
}
