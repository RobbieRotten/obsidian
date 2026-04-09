// quartz/components/semantic/loadStore.ts
// Loads doc centroids and per-doc shard vectors from /static/sem
export type DocCentroid = { slug: string; title: string; vec: number[]; n: number }

export async function loadCentroids(): Promise<DocCentroid[]> {
  const url = '/static/sem/doc-centroids.json'
  const j = await fetch(url, { cache: 'force-cache' }).then(r => r.json())
  return j as DocCentroid[]
}

export async function loadDocVectors(slug: string, dim = 384) {
  const [binBuf, idxJson] = await Promise.all([
    fetch(`/static/sem/${slug}.bin`).then(r => r.arrayBuffer()),
    fetch(`/static/sem/${slug}.idx.json`).then(r => r.json()),
  ])
  const vecs = new Float32Array(binBuf)
  const rows = vecs.length / dim
  // Return a view per row without copying
  const rowAt = (i: number) => vecs.subarray(i * dim, (i + 1) * dim)
  return { rowAt, rows, idx: idxJson as Array<{ anchor: string; hPath: string[]; preview: string }> }
}
