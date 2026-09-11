// quartz/components/semantic/searchClient.ts
import { embed } from "./embed"
import { cosine } from "./cosine"
import { loadCentroids, loadDocVectors, type DocChunkMeta } from "./loadStore"

export type SemResult = {
  url: string
  title: string
  snippet: string
  score: number
  where: string[]
}

const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
])

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

function meaningfulTerms(query: string): string[] {
  const terms = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return [...new Set(terms.filter((term) => term.length > 1 && !stopWords.has(term)))]
}

function lexicalCoverage(meta: DocChunkMeta | undefined, terms: string[]): number {
  if (!meta || terms.length === 0) return 0
  const haystack = `${meta.hPath.join(" ")} ${meta.preview}`.toLowerCase()
  const matched = terms.filter((term) => haystack.includes(term)).length
  return matched / terms.length
}

async function bestChunkScore(
  q: Float32Array,
  slug: string,
  terms: string[],
): Promise<{ score: number; index: number }> {
  const { rowAt, rows, idx } = await loadDocVectors(slug)
  let bestScore = -1
  let bestIndex = -1

  for (let i = 0; i < rows; i++) {
    const semantic = cosine(q, rowAt(i))
    const lexical = lexicalCoverage(idx[i], terms)
    const score = 0.82 * semantic + 0.18 * lexical
    if (score > bestScore) {
      bestScore = score
      bestIndex = i
    }
  }

  return { score: bestScore, index: bestIndex }
}

export async function semanticSearch(query: string, kDocs = 10, kChunks = 8): Promise<SemResult[]> {
  const q = await embed(query)
  const terms = meaningfulTerms(query)
  const centroids = await loadCentroids()
  const rankedDocs = centroids
    .map((c) => ({ c, score: cosine(q, Float32Array.from(c.vec)) }))
    .sort(byScoreDesc)
    .slice(0, kDocs)

  const out: SemResult[] = []
  for (const { c, score: docScore } of rankedDocs) {
    const { rowAt, rows, idx } = await loadDocVectors(c.slug)
    const best: Array<{ score: number; semantic: number; i: number }> = []

    for (let i = 0; i < rows; i++) {
      const semantic = cosine(q, rowAt(i))
      const lexical = lexicalCoverage(idx[i], terms)
      const score = 0.82 * semantic + 0.18 * lexical
      if (best.length < kChunks) {
        best.push({ score, semantic, i })
        continue
      }

      let worst = 0
      for (let j = 1; j < best.length; j++) {
        if (best[j].score < best[worst].score) worst = j
      }
      if (score > best[worst].score) best[worst] = { score, semantic, i }
    }

    best.sort(byScoreDesc)
    for (const hit of best) {
      const meta = idx[hit.i]
      if (!meta) continue
      out.push({
        url: slugUrl(c.slug, meta.anchor || ""),
        title: c.title,
        snippet: meta.preview,
        score: 0.88 * hit.score + 0.12 * docScore,
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

export async function rerankCandidates(
  query: string,
  candidates: { url: string; title?: string }[],
): Promise<Array<{ url: string; title?: string; score: number }>> {
  const q = await embed(query)
  const terms = meaningfulTerms(query)
  const centroids = await loadCentroids()
  const bySlug = new Map(centroids.map((c) => [normalizeSlug(c.slug), c]))

  const scored = await Promise.all(
    candidates.map(async (candidate, index) => {
      const centroid = bySlug.get(normalizeSlug(candidate.url))
      if (!centroid) return { ...candidate, score: -1 }

      const docScore = cosine(q, Float32Array.from(centroid.vec))
      let chunkScore = docScore
      try {
        chunkScore = (await bestChunkScore(q, centroid.slug, terms)).score
      } catch {
        // A missing shard should not break the rest of hybrid search.
      }

      const nativePrior = candidates.length > 1 ? 1 - index / (candidates.length - 1) : 1
      const score = 0.84 * chunkScore + 0.12 * docScore + 0.04 * nativePrior
      return { ...candidate, score }
    }),
  )

  return scored.sort(byScoreDesc)
}
