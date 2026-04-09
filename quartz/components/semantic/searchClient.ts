// quartz/components/semantic/searchClient.ts
import { embed } from './embed'
import { cosine } from './cosine'
import { loadCentroids, loadDocVectors } from './loadStore'

export type SemResult = {
  url: string
  title: string
  snippet: string
  score: number
  where: string[] // heading path
}

function byScoreDesc<T extends { score: number }>(a: T, b: T) { return b.score - a.score }

export async function semanticSearch(query: string, kDocs = 6, kChunks = 8): Promise<SemResult[]> {
  // 1) embed query
  const q = await embed(query) // Float32Array (384)

  // 2) rank docs by centroid
  const centroids = await loadCentroids()
  const rankedDocs = centroids
    .map(c => ({ c, score: cosine(q, Float32Array.from(c.vec)) }))
    .sort(byScoreDesc)
    .slice(0, kDocs)

  // 3) within each doc, rank chunks and collect top-k
  const out: SemResult[] = []
  for (const { c, score: docScore } of rankedDocs) {
    const { rowAt, rows, idx } = await loadDocVectors(c.slug)
    // quick scan; keep best few
    const heap: Array<{ score: number; i: number }> = []
    for (let i = 0; i < rows; i++) {
      const s = cosine(q, rowAt(i))
      if (heap.length < kChunks) heap.push({ score: s, i })
      else {
        // maintain min-heap by linear scan (k is tiny)
        let worst = 0
        for (let j = 1; j < heap.length; j++) if (heap[j].score < heap[worst].score) worst = j
        if (s > heap[worst].score) heap[worst] = { score: s, i }
      }
    }
    // emit
    heap.sort(byScoreDesc)
    for (const h of heap) {
      const meta = idx[h.i]
      out.push({
        url: `/${decodeURI(c.slug)}${meta.anchor || ''}`,
        title: c.title,
        snippet: meta.preview,
        score: 0.75 * h.score + 0.25 * docScore, // blend local + doc match
        where: meta.hPath.filter(Boolean),
      })
    }
  }

  // 4) global rank, uniq by URL, return top 10
  const seen = new Set<string>()
  const uniq: SemResult[] = []
  for (const r of out.sort(byScoreDesc)) {
    if (seen.has(r.url)) continue
    seen.add(r.url)
    uniq.push(r)
    if (uniq.length >= 10) break
  }
  return uniq
}

// Rerank keyword search results using semantic centroids
export async function rerankByCentroid(
  query: string,
  candidates: { url: string; title?: string }[],
): Promise<Array<{ url: string; title?: string; score: number }>> {
  const q = await embed(query) // Float32Array (384)
  const centroids = await loadCentroids()
  const bySlug = new Map(centroids.map(c => [c.slug, c]))

  // Normalize URL -> slug ("Admin-Law-Notes", etc.)
  const toSlug = (u: string) => {
    try {
      const p = new URL(u, window.location.origin)
      const last = decodeURIComponent(p.pathname).replace(/^\/+|\/+$/g, "").split("/").pop() || ""
      return last || u
    } catch {
      const last = decodeURIComponent(u).replace(/^\/+|\/+$/g, "").split("/").pop() || ""
      return last || u
    }
  }

  const scored = candidates.map(c => {
    const slug = toSlug(c.url)
    const ce = bySlug.get(slug)
    const score = ce ? cosine(q, Float32Array.from(ce.vec)) : -1e9
    return { ...c, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored
}
