// quartz/components/semantic/loadStore.ts
export type DocCentroid = { slug: string; title: string; vec: number[]; n: number }

let centroidsPromise: Promise<DocCentroid[]> | null = null

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

export async function loadDocVectors(slug: string, dim = 384) {
  const shard = slug.replaceAll("/", "__")
  const [binResponse, idxResponse] = await Promise.all([
    fetch(`/static/sem/${shard}.bin`, { cache: "force-cache" }),
    fetch(`/static/sem/${shard}.idx.json`, { cache: "force-cache" }),
  ])

  if (!binResponse.ok || !idxResponse.ok) {
    throw new Error(`Semantic shard unavailable for ${slug}`)
  }

  const [binBuf, idxJson] = await Promise.all([binResponse.arrayBuffer(), idxResponse.json()])
  const vecs = new Float32Array(binBuf)
  if (vecs.length % dim !== 0) {
    throw new Error(`Corrupt semantic shard for ${slug}: ${vecs.length} values is not divisible by ${dim}`)
  }

  const rows = vecs.length / dim
  const rowAt = (i: number) => vecs.subarray(i * dim, (i + 1) * dim)
  return {
    rowAt,
    rows,
    idx: idxJson as Array<{ anchor: string; hPath: string[]; preview: string }>,
  }
}
