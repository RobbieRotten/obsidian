// quartz/components/semantic/searchClient.ts
//
// Runtime semantic refinement is intentionally disabled for now.
//
// The deterministic lexical/legal passage ranker remains the active search path.
// Loading MiniLM plus multiple .bin/.idx shards on the browser main thread caused
// multi-second tab stalls while typing/pasting queries. Keep these exports as
// compatibility shims so the active controller does not need to change shape.
// Semantic retrieval can be reintroduced later behind a worker/idle boundary.

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
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "by", "can", "could",
  "did", "do", "does", "even", "for", "from", "had", "has", "have", "how", "in", "is",
  "it", "may", "might", "must", "of", "on", "or", "should", "the", "to", "was", "were",
  "what", "when", "where", "which", "who", "why", "with", "would",
])

function meaningfulTerms(query: string): string[] {
  const terms = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return [...new Set(terms.filter((term) => term.length > 1 && !stopWords.has(term)))]
}

export async function warmSemanticSearch(): Promise<void> {
  // Deliberate no-op. Do not load the model or vector assets on the UI thread.
}

export async function createSemanticQuery(text: string): Promise<SemanticQuery> {
  // Preserve the controller contract without invoking ONNX/Transformers.
  return {
    text,
    vector: new Float32Array(0),
    terms: meaningfulTerms(text),
  }
}

export async function semanticSearch(
  _queryInput: string | SemanticQuery,
  _kDocs = 7,
  _kChunks = 5,
): Promise<SemResult[]> {
  // Deterministic passage ranking is authoritative until semantic work is moved
  // off the main thread. Returning [] also prevents .bin/.idx shard fan-out.
  return []
}

export async function rerankCandidates(
  _queryInput: string | SemanticQuery,
  candidates: { url: string; title?: string }[],
): Promise<Array<{ url: string; title?: string; score: number }>> {
  // Preserve native candidate order for any legacy caller without triggering
  // model/vector work. Higher earlier score keeps ordering deterministic.
  const denominator = Math.max(1, candidates.length - 1)
  return candidates.map((candidate, index) => ({
    ...candidate,
    score: candidates.length <= 1 ? 1 : 1 - index / denominator,
  }))
}
