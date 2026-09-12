// quartz/components/semantic/loadStore.ts
export type DocCentroid = { slug: string; title: string; vec: number[]; n: number }
export type DocChunkMeta = { anchor: string; hPath: string[]; preview: string }
export type LexicalChunk = { anchor: string; hPath: string[]; text: string }
export type LexicalDocument = { slug: string; title: string; chunks: LexicalChunk[] }
export type DocVectors = {
  rowAt: (i: number) => Float32Array
  rows: number
  idx: DocChunkMeta[]
}

let centroidsPromise: Promise<DocCentroid[]> | null = null
let lexicalIndexPromise: Promise<LexicalDocument[]> | null = null
const docIndexCache = new Map<string, Promise<DocChunkMeta[]>>()
const docVectorsCache = new Map<string, Promise<DocVectors>>()

// Semantic filenames are stable between note rebuilds. A browser or reverse
// proxy can therefore hand a new search controller an old index/vector shard.
// Give every full page load a fresh asset namespace while preserving in-session
// caching through the promises/maps below.
const semanticAssetVersion = Date.now().toString(36)
const assetUrl = (path: string) => `${path}?v=${semanticAssetVersion}`

export function loadCentroids(): Promise<DocCentroid[]> {
  if (!centroidsPromise) {
    centroidsPromise = fetch(assetUrl("/static/sem/doc-centroids.json"), { cache: "no-cache" }).then(
      async (response) => {
        if (!response.ok) {
          throw new Error(`Semantic index unavailable (${response.status})`)
        }
        return (await response.json()) as DocCentroid[]
      },
    )
    centroidsPromise.catch(() => {
      centroidsPromise = null
    })
  }
  return centroidsPromise
}

export function loadLexicalIndex(): Promise<LexicalDocument[]> {
  if (!lexicalIndexPromise) {
    lexicalIndexPromise = fetch(assetUrl("/static/sem/lexical-index.json"), { cache: "no-cache" }).then(
      async (response) => {
        if (!response.ok) {
          throw new Error(`Lexical chunk index unavailable (${response.status})`)
        }
        return (await response.json()) as LexicalDocument[]
      },
    )
    lexicalIndexPromise.catch(() => {
      lexicalIndexPromise = null
    })
  }
  return lexicalIndexPromise
}

export function loadDocIndex(slug: string): Promise<DocChunkMeta[]> {
  const cached = docIndexCache.get(slug)
  if (cached) return cached

  const shard = slug.replaceAll("/", "__")
  const promise = fetch(assetUrl(`/static/sem/${shard}.idx.json`), { cache: "no-cache" }).then(
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
      fetch(assetUrl(`/static/sem/${shard}.bin`), { cache: "no-cache" }),
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
    if (idx.length !== rows) {
      throw new Error(`Semantic shard/index mismatch for ${slug}: ${rows} vectors vs ${idx.length} metadata rows`)
    }

    const rowAt = (i: number) => vecs.subarray(i * dim, (i + 1) * dim)
    return { rowAt, rows, idx }
  })()

  docVectorsCache.set(cacheKey, promise)
  promise.catch(() => docVectorsCache.delete(cacheKey))
  return promise
}
