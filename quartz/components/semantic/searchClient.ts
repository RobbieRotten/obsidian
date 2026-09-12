// quartz/components/semantic/searchClient.ts
import { embed, warmEmbeddingModel } from "./embed"
import { cosine } from "./cosine"
import { loadCentroids, loadDocIndex, loadDocVectors, type DocChunkMeta } from "./loadStore"

export type SemResult = {
  url: string
  title: string
  snippet: string
  score: number
  where: string[]
}

export type SemanticQuery = {
  text: string
  vector: Float32Array
  terms: string[]
}

const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "even",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "in",
  "is",
  "it",
  "may",
  "might",
  "must",
  "of",
  "on",
  "or",
  "should",
  "the",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "would",
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

function lexicalSignal(meta: DocChunkMeta | undefined, terms: string[]): number {
  if (!meta || terms.length === 0) return 0

  const heading = meta.hPath.join(" ").toLowerCase()
  const body = meta.preview.toLowerCase()
  const haystack = `${heading} ${body}`
  const matched = terms.filter((term) => haystack.includes(term)).length
  const headingMatched = terms.filter((term) => heading.includes(term)).length
  const coverage = matched / terms.length
  const headingCoverage = headingMatched / terms.length
  const completeMatch = matched === terms.length ? 1 : 0

  return Math.min(1, 0.7 * coverage + 0.2 * headingCoverage + 0.1 * completeMatch)
}

function bestLexicalSignal(idx: DocChunkMeta[], terms: string[]): number {
  let best = 0
  for (const meta of idx) best = Math.max(best, lexicalSignal(meta, terms))
  return best
}

async function bestChunkScore(
  query: SemanticQuery,
  slug: string,
): Promise<{ score: number; index: number }> {
  const { rowAt, rows, idx } = await loadDocVectors(slug)
  let bestScore = -1
  let bestIndex = -1

  for (let i = 0; i < rows; i++) {
    const semantic = cosine(query.vector, rowAt(i))
    const lexical = lexicalSignal(idx[i], query.terms)
    const score = 0.62 * semantic + 0.38 * lexical
    if (score > bestScore) {
      bestScore = score
      bestIndex = i
    }
  }

  return { score: bestScore, index: bestIndex }
}

export async function warmSemanticSearch(): Promise<void> {
  await Promise.all([warmEmbeddingModel(), loadCentroids()])
}

export async function createSemanticQuery(text: string): Promise<SemanticQuery> {
  return {
    text,
    vector: await embed(text),
    terms: meaningfulTerms(text),
  }
}

async function resolveQuery(query: string | SemanticQuery): Promise<SemanticQuery> {
  return typeof query === "string" ? createSemanticQuery(query) : query
}

export async function semanticSearch(
  queryInput: string | SemanticQuery,
  kDocs = 7,
  kChunks = 5,
): Promise<SemResult[]> {
  const query = await resolveQuery(queryInput)
  const centroids = await loadCentroids()
  const rankedDocs = centroids
    .map((c) => ({ c, score: cosine(query.vector, Float32Array.from(c.vec)) }))
    .sort(byScoreDesc)
    .slice(0, kDocs)

  const perDoc = await Promise.all(
    rankedDocs.map(async ({ c, score: docScore }) => {
      const { rowAt, rows, idx } = await loadDocVectors(c.slug)
      const best: Array<{ score: number; i: number }> = []

      for (let i = 0; i < rows; i++) {
        const semantic = cosine(query.vector, rowAt(i))
        const lexical = lexicalSignal(idx[i], query.terms)
        const score = 0.66 * semantic + 0.34 * lexical
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

      return best
        .sort(byScoreDesc)
        .map((hit) => {
          const meta = idx[hit.i]
          if (!meta) return null
          return {
            url: slugUrl(c.slug, meta.anchor || ""),
            title: c.title,
            snippet: meta.preview,
            score: 0.9 * hit.score + 0.1 * docScore,
            where: meta.hPath.filter(Boolean),
          } satisfies SemResult
        })
        .filter((result): result is SemResult => result !== null)
    }),
  )

  const seen = new Set<string>()
  const unique: SemResult[] = []
  for (const result of perDoc.flat().sort(byScoreDesc)) {
    if (seen.has(result.url)) continue
    seen.add(result.url)
    unique.push(result)
    if (unique.length >= 10) break
  }
  return unique
}

export async function rerankCandidates(
  queryInput: string | SemanticQuery,
  candidates: { url: string; title?: string }[],
): Promise<Array<{ url: string; title?: string; score: number }>> {
  const query = await resolveQuery(queryInput)
  const centroids = await loadCentroids()
  const bySlug = new Map(centroids.map((c) => [normalizeSlug(c.slug), c]))

  const cheap = await Promise.all(
    candidates.map(async (candidate, index) => {
      const centroid = bySlug.get(normalizeSlug(candidate.url))
      if (!centroid) return { ...candidate, score: -1, centroid: undefined, index }

      const docSemantic = cosine(query.vector, Float32Array.from(centroid.vec))
      let lexical = 0
      try {
        lexical = bestLexicalSignal(await loadDocIndex(centroid.slug), query.terms)
      } catch {
        // Missing metadata should not break native search.
      }

      const nativePrior = candidates.length > 1 ? 1 - index / (candidates.length - 1) : 1
      const score = 0.46 * docSemantic + 0.49 * lexical + 0.05 * nativePrior
      return { ...candidate, score, centroid, index }
    }),
  )

  const expensive = cheap
    .filter((item) => item.centroid !== undefined)
    .sort(byScoreDesc)
    .slice(0, Math.min(4, candidates.length))

  await Promise.all(
    expensive.map(async (item) => {
      const centroid = item.centroid!
      const docSemantic = cosine(query.vector, Float32Array.from(centroid.vec))
      const nativePrior = candidates.length > 1 ? 1 - item.index / (candidates.length - 1) : 1
      try {
        const chunk = await bestChunkScore(query, centroid.slug)
        item.score = 0.82 * chunk.score + 0.13 * docSemantic + 0.05 * nativePrior
      } catch {
        // Keep the cheap score if a vector shard cannot be loaded.
      }
    }),
  )

  return cheap
    .map(({ centroid: _centroid, index: _index, ...candidate }) => candidate)
    .sort(byScoreDesc)
}
