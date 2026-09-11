// quartz/components/semantic/searchClient.ts
import { embed } from "./embed"
import { cosine } from "./cosine"
import { loadCentroids, loadDocVectors } from "./loadStore"

export type SemResult = {
  url: string
  title: string
  snippet: string
  score: number
  where: string[]
}

function byScoreDesc<T extends { score: number }>(a: T, b: T) {
  return b.score - a.score
}

function normalizeSlug(value: string): string {
  let pathname = value
  try {
    pathname = new URL(value, window.location.origin).pathname
  } catch {
    // value may already be a Quartz slug rather than a URL
  }

  return decodeURIComponent(pathname)
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/index$/i, "")
}

function slugUrl(slug: string, anchor = ""): string {
  const clean = slug.replace(/^\/+/, "")
  return `/${clean}${anchor}`
}

export async function semanticSearch(query: string, kDocs = 6, kChunks = 8): Promise<SemResult[]> {
  const q = await embed(query)
  const centroids = await loadCentroids()
  const rankedDocs = centroids
    .map((c) => ({ c, score: cosine(q, Float32Array.from(c.vec)) }))
    .sort(byScoreDesc)
    .slice(0, kDocs)

  const out: SemResult[] = []
  for (const { c, score: docScore } of rankedDocs) {
    const { rowAt, rows, idx } = await loadDocVectors(c.slug)
    const best: Array<{ score: number; i: number }> = []

    for (let i = 0; i < rows; i++) {
      const score = cosine(q, rowAt(i))
      if (best.length < kChunks) {
        best.push({ score, i })
        continue
      }

      let worst = 0
      for (let j = 1; j < best.length; j++) {
        if (best[j].score < best[worst].score) worst = j
      }
      if (score > best[worst].score) best[worst] = { score, i }
    }

    best.sort(byScoreDesc)
    for (const hit of best) {
      const meta = idx[hit.i]
      if (!meta) continue
      out.push({
        url: slugUrl(c.slug, meta.anchor || ""),
        title: c.title,
        snippet: meta.preview,
        score: 0.75 * hit.score + 0.25 * docScore,
        where: meta.hPath.filter(Boolean),
      })
    }
  }

  const seen = new Set<string>()
  const unique: SemResult[] = []
  for (const result of out.sort(byScoreDesc)) {
    if (seen.has(result.url)) continue
    seen.add(result.url)
    unique.push(result)
    if (unique.length >= 10) break
  }
  return unique
}

export async function rerankByCentroid(
  query: string,
  candidates: { url: string; title?: string }[],
): Promise<Array<{ url: string; title?: string; score: number }>> {
  const q = await embed(query)
  const centroids = await loadCentroids()
  const bySlug = new Map(centroids.map((c) => [normalizeSlug(c.slug), c]))

  return candidates
    .map((candidate) => {
      const centroid = bySlug.get(normalizeSlug(candidate.url))
      const score = centroid ? cosine(q, Float32Array.from(centroid.vec)) : -1
      return { ...candidate, score }
    })
    .sort(byScoreDesc)
}
