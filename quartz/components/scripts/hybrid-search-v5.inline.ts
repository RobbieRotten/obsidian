import { ContentDetails } from "../../plugins/emitters/contentIndex"
import { FullSlug, resolveRelative } from "../../util/path"
import {
  createSemanticQuery,
  semanticSearch,
  warmSemanticSearch,
  type SemResult,
} from "../semantic/searchClient"
import {
  loadLexicalIndex,
  type LexicalChunk,
  type LexicalDocument,
} from "../semantic/loadStore"
import { registerEscapeHandler, removeAllChildren } from "./util"

type SearchType = "basic" | "tags"
type SearchData = { [key: FullSlug]: ContentDetails }

type QueryModel = {
  raw: string
  terms: string[]
  coreTerms: string[]
  discriminatorTerms: string[]
  section: string | null
  statutes: string[][]
  doctrine: string | null
  hasIntent: boolean
}

type Evidence = {
  tier: number
  score: number
  coverage: number
  coreCoverage: number
  discriminatorCoverage: number
  proximity: number
  citation: number
  phrase: number
}

type RankedHit = {
  slug: FullSlug
  title: string
  anchor: string
  hPath: string[]
  snippet: string
  evidence: Evidence
  semantic?: SemResult
}

type DisplayItem = {
  slug: FullSlug
  title: string
  anchor: string
  path: string
  snippet: string
  badge: string
}

const RESULT_LIMIT = 8
const TAG_LIMIT = 5
const INPUT_DEBOUNCE_MS = 80
const SEMANTIC_BUDGET_MS = 750
const FALLBACK_CHUNK_CHARS = 1250
const FALLBACK_OVERLAP = 180
const SNIPPET_CHARS = 620

const EMPTY_EVIDENCE: Evidence = {
  tier: 0,
  score: 0,
  coverage: 0,
  coreCoverage: 0,
  discriminatorCoverage: 0,
  proximity: 0,
  citation: 0,
  phrase: 0,
}

const stopWords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "by", "can", "could",
  "did", "do", "does", "even", "for", "from", "had", "has", "have", "how", "in", "is",
  "it", "may", "might", "must", "of", "on", "or", "should", "the", "to", "was", "were",
  "what", "when", "where", "which", "who", "why", "with", "would",
])

const intentWords = new Set([
  "element", "elements", "requirement", "requirements", "test", "tests", "rule", "rules",
  "definition", "define", "meaning", "criteria", "factor", "factors", "step", "steps",
  "checklist", "apply", "application",
])

const aliases: Record<string, string[]> = {
  cla: ["cla", "civil liability act"],
  bdsm: [
    "bdsm",
    "sado masochism",
    "sado masichism",
    "sado-masochism",
    "sadomasochism",
    "sadomasichism",
  ],
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function rawTokens(value: string): string[] {
  return normalizeText(value).match(/[\p{L}\p{N}]+/gu) ?? []
}

function meaningfulTerms(value: string): string[] {
  return [...new Set(rawTokens(value).filter((term) => term.length > 1 && !stopWords.has(term)))]
}

function termVariants(term: string): string[] {
  const out = new Set<string>(aliases[term] ?? [term])
  if (/^\d+[a-z]$/i.test(term)) {
    out.add(term)
    out.add(`s ${term}`)
    out.add(`s${term}`)
    out.add(`section ${term}`)
  }
  if (term.length > 4 && term.endsWith("s")) out.add(term.slice(0, -1))
  if (term.length > 5 && term.endsWith("ed")) {
    out.add(term.slice(0, -1))
    out.add(term.slice(0, -2))
  }
  if (term.length > 6 && term.endsWith("ing")) {
    out.add(term.slice(0, -3))
    out.add(`${term.slice(0, -3)}e`)
  }
  return [...out]
}

function parseSection(query: string): string | null {
  const explicit = query.match(/(?:^|\s)(?:s|ss|section)\s*([0-9]+[a-z]?(?:\([0-9a-z]+\))?)(?=\s|$)/i)
  if (explicit?.[1]) return explicit[1].toLowerCase()
  if (/\bcla\b/i.test(query) || /\b[a-z]+(?:\s+[a-z]+){0,2}\s+act\b/i.test(query)) {
    const bare = query.match(/(?:^|\s)([0-9]+[a-z])(?=\s|$)/i)
    if (bare?.[1]) return bare[1].toLowerCase()
  }
  return null
}

function parseStatutes(query: string): string[][] {
  const groups: string[][] = []
  if (/\bcla\b/i.test(query)) groups.push(["cla", "civil liability act"])
  const normalized = normalizeText(query)
  for (const match of normalized.matchAll(/\b([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2})\s+act\b/g)) {
    const words = match[1].split(" ").filter((word) => !stopWords.has(word))
    if (words.length === 0) continue
    const phrase = `${words.slice(-2).join(" ")} act`
    if (phrase === "civil liability act" && /\bcla\b/i.test(query)) continue
    if (!groups.some((group) => group.includes(phrase))) groups.push([phrase])
  }
  return groups
}

function queryModel(query: string): QueryModel {
  const terms = meaningfulTerms(query)
  const coreTerms = terms.filter((term) => !intentWords.has(term) && term !== "section" && term !== "ss")
  const hasIntent = terms.some((term) => intentWords.has(term))
  const statutes = parseStatutes(query)
  const section = parseSection(query)
  const statuteWords = new Set(
    statutes.flatMap((group) => group.flatMap((phrase) => rawTokens(phrase))),
  )
  if (/\bcla\b/i.test(query)) statuteWords.add("cla")
  statuteWords.add("act")

  const discriminatorTerms = coreTerms.filter(
    (term) => term !== section && !statuteWords.has(term),
  )
  const doctrineTerms = coreTerms.filter(
    (term) => term !== "cla" && term !== section && !/^\d+[a-z]?(?:\([0-9a-z]+\))?$/i.test(term),
  )

  return {
    raw: query,
    terms,
    coreTerms,
    discriminatorTerms,
    section,
    statutes,
    doctrine: hasIntent && doctrineTerms.length >= 1 ? doctrineTerms.join(" ") : null,
    hasIntent,
  }
}

function phrasePositions(text: string, phrase: string): number[] {
  const normalized = ` ${normalizeText(text)} `
  const needle = ` ${normalizeText(phrase)} `
  if (needle.trim().length === 0) return []
  const out: number[] = []
  let from = 0
  while (from < normalized.length) {
    const at = normalized.indexOf(needle, from)
    if (at < 0) break
    out.push(at)
    from = at + Math.max(1, needle.length)
    if (out.length >= 32) break
  }
  return out
}

function termPositions(text: string, term: string): number[] {
  const out = new Set<number>()
  for (const variant of termVariants(term)) {
    for (const at of phrasePositions(text, variant)) out.add(at)
  }
  return [...out].sort((a, b) => a - b)
}

function groupPositions(text: string, alternatives: string[]): number[] {
  const out = new Set<number>()
  for (const alternative of alternatives) {
    for (const at of phrasePositions(text, alternative)) out.add(at)
  }
  return [...out].sort((a, b) => a - b)
}

function minimumSpan(positionSets: number[][]): number | null {
  const populated = positionSets.filter((positions) => positions.length > 0)
  if (populated.length === 0) return null
  if (populated.length === 1) return 0
  const pointers = new Array(populated.length).fill(0)
  let best = Number.POSITIVE_INFINITY
  while (true) {
    const current = populated.map((positions, index) => positions[pointers[index]])
    best = Math.min(best, Math.max(...current) - Math.min(...current))
    let minIndex = 0
    for (let i = 1; i < current.length; i++) {
      if (current[i] < current[minIndex]) minIndex = i
    }
    pointers[minIndex]++
    if (pointers[minIndex] >= populated[minIndex].length) break
  }
  return Number.isFinite(best) ? best : null
}

function sectionPositions(text: string, section: string | null): number[] {
  if (!section) return []
  const normalized = normalizeText(text)
  const out = new Set<number>(termPositions(normalized, section))
  const compact = normalized.replace(/\s+/g, "")
  for (const needle of [`s${section}`, `section${section}`]) {
    const at = compact.indexOf(needle.replace(/\s+/g, ""))
    if (at >= 0) out.add(at)
  }
  return [...out].sort((a, b) => a - b)
}

function doctrineIntentRelation(text: string, model: QueryModel, doctrinePositions: number[], intentPositions: number[]): number {
  if (!model.doctrine || !model.hasIntent || doctrinePositions.length === 0 || intentPositions.length === 0) return 0

  const doctrine = normalizeText(model.doctrine)
  const directPhrases = [
    `${doctrine} elements`,
    `elements of ${doctrine}`,
    `${doctrine} requirements`,
    `requirements of ${doctrine}`,
    `${doctrine} test`,
    `test for ${doctrine}`,
    `${doctrine} criteria`,
    `criteria for ${doctrine}`,
  ]
  if (directPhrases.some((phrase) => phrasePositions(text, phrase).length > 0)) return 1

  const exclusions = [
    `elements other than ${doctrine}`,
    `requirements other than ${doctrine}`,
    `elements except ${doctrine}`,
    `requirements except ${doctrine}`,
    `excluding ${doctrine}`,
  ]
  if (exclusions.some((phrase) => normalizeText(text).includes(phrase))) return 0.1

  const relationSpan = minimumSpan([doctrinePositions, intentPositions])
  if (relationSpan === null) return 0
  if (relationSpan <= 55) return 0.94
  if (relationSpan <= 120) return 0.78
  if (relationSpan <= 240) return 0.52
  return 0.2
}

function passageEvidence(model: QueryModel, title: string, chunk: LexicalChunk): Evidence {
  if (model.terms.length === 0) return EMPTY_EVIDENCE
  const heading = chunk.hPath.filter(Boolean).join(" ")
  const text = normalizeText(`${title} ${heading} ${heading} ${chunk.text}`)
  const termSets = model.terms.map((term) => termPositions(text, term))
  const coreSets = model.coreTerms.map((term) => termPositions(text, term))
  const discriminatorSets = model.discriminatorTerms.map((term) => termPositions(text, term))
  const matched = termSets.filter((positions) => positions.length > 0).length
  const coreMatched = coreSets.filter((positions) => positions.length > 0).length
  const discriminatorMatched = discriminatorSets.filter((positions) => positions.length > 0).length
  const coverage = matched / model.terms.length
  const coreCoverage = model.coreTerms.length > 0 ? coreMatched / model.coreTerms.length : coverage
  const discriminatorCoverage = model.discriminatorTerms.length > 0
    ? discriminatorMatched / model.discriminatorTerms.length
    : 1

  const span = minimumSpan(coreSets.filter((positions) => positions.length > 0))
  let proximity = 0
  if (span !== null) {
    if (span <= 80) proximity = 1
    else if (span <= 220) proximity = 0.88
    else if (span <= 520) proximity = 0.62
    else if (span <= 1100) proximity = 0.32
    else proximity = 0.12
  }

  const exactPhrase = phrasePositions(text, model.raw).length > 0 ? 1 : 0
  const doctrinePositions = model.doctrine ? phrasePositions(text, model.doctrine) : []
  const doctrineSignal = doctrinePositions.length > 0 ? 1 : 0
  const intentTerms = model.terms.filter((term) => intentWords.has(term))
  const intentPositions = intentTerms.flatMap((term) => termPositions(text, term))
  const intentSignal = model.hasIntent && intentPositions.length > 0 ? 1 : 0
  const doctrineRelation = doctrineIntentRelation(text, model, doctrinePositions, intentPositions)

  const sectionHits = sectionPositions(text, model.section)
  const statuteHits = model.statutes.map((group) => groupPositions(text, group))
  const statuteMatched = statuteHits.filter((positions) => positions.length > 0).length
  const statuteSignal = model.statutes.length > 0 ? statuteMatched / model.statutes.length : 0
  let citation = 0
  if (model.section && sectionHits.length > 0 && statuteHits.some((positions) => positions.length > 0)) {
    const allStatutePositions = statuteHits.flatMap((positions) => positions)
    const citationSpan = minimumSpan([sectionHits, allStatutePositions])
    if (citationSpan !== null && citationSpan <= 220) citation = 1
    else if (citationSpan !== null && citationSpan <= 420) citation = 0.6
    else citation = 0.25
  }

  const phrase = Math.max(
    exactPhrase,
    doctrineRelation,
    doctrineSignal && intentSignal ? 0.45 : doctrineSignal ? 0.35 : 0,
  )
  const headingCoverage = model.coreTerms.length > 0
    ? model.coreTerms.filter((term) => termPositions(heading, term).length > 0).length / model.coreTerms.length
    : 0

  let tier = 0
  if (citation >= 0.95) tier = 10
  else if (model.doctrine && doctrineRelation >= 0.78) tier = 9
  else if (exactPhrase === 1) tier = 8
  else if (citation >= 0.6) tier = 6
  else if (
    model.statutes.length > 0 &&
    !model.section &&
    statuteSignal >= 0.99 &&
    (model.discriminatorTerms.length === 0 || discriminatorCoverage >= 0.99)
  ) tier = 7
  else if (coreCoverage === 1 && proximity >= 0.62) tier = 6
  else if (model.doctrine && doctrineSignal === 1 && doctrineRelation >= 0.5) tier = 5
  else if (coreCoverage >= 0.75 && proximity > 0) tier = 4
  else if (coreCoverage >= 0.5 && discriminatorCoverage >= 0.5) tier = 2
  else if (coverage > 0) tier = 1

  const score = Math.min(
    1,
    0.26 * coverage +
      0.22 * coreCoverage +
      0.12 * discriminatorCoverage +
      0.12 * proximity +
      0.13 * phrase +
      0.11 * citation +
      0.04 * headingCoverage,
  )
  return {
    tier,
    score,
    coverage,
    coreCoverage,
    discriminatorCoverage,
    proximity,
    citation,
    phrase,
  }
}

function documentCoverage(model: QueryModel, doc: LexicalDocument, terms = model.coreTerms): number {
  if (terms.length === 0) return 0
  const text = normalizeText(`${doc.title} ${doc.chunks.map((chunk) => chunk.text).join(" ")}`)
  const matched = terms.filter((term) => termPositions(text, term).length > 0).length
  return matched / terms.length
}

function centeredSnippet(query: string, text: string, maxChars = SNIPPET_CHARS): string {
  const clean = text.replace(/\s+/g, " ").trim()
  if (clean.length <= maxChars) return clean

  const normalized = normalizeText(clean)
  const positions = meaningfulTerms(query)
    .map((term) => termPositions(normalized, term)[0])
    .filter((position): position is number => typeof position === "number")
    .sort((a, b) => a - b)

  if (positions.length === 0 || normalized.length === 0) return `${clean.slice(0, maxChars).trim()}…`

  const median = positions[Math.floor(positions.length / 2)]
  const approximateRawCenter = Math.round((median / normalized.length) * clean.length)
  let start = Math.max(0, approximateRawCenter - Math.floor(maxChars * 0.38))
  start = Math.min(start, Math.max(0, clean.length - maxChars))
  let end = Math.min(clean.length, start + maxChars)

  if (start > 0) {
    const nextSpace = clean.indexOf(" ", start)
    if (nextSpace >= 0 && nextSpace - start < 50) start = nextSpace + 1
  }
  if (end < clean.length) {
    const previousSpace = clean.lastIndexOf(" ", end)
    if (previousSpace > start + Math.floor(maxChars * 0.7)) end = previousSpace
  }

  return `${start > 0 ? "…" : ""}${clean.slice(start, end).trim()}${end < clean.length ? "…" : ""}`
}

function pruneRankedHits(hits: RankedHit[]): RankedHit[] {
  if (hits.length === 0) return hits
  const sorted = [...hits].sort(
    (a, b) => b.evidence.tier - a.evidence.tier || b.evidence.score - a.evidence.score || a.title.localeCompare(b.title),
  )
  const topTier = sorted[0].evidence.tier
  const minimumTier = topTier >= 10 ? 7 : topTier >= 9 ? 6 : topTier >= 7 ? 4 : topTier >= 5 ? 2 : 1
  return sorted
    .filter((hit, index) => index === 0 || hit.evidence.tier >= minimumTier)
    .slice(0, RESULT_LIMIT)
}

function rankLexical(query: string, docs: LexicalDocument[]): RankedHit[] {
  const model = queryModel(query)
  const hits: RankedHit[] = []
  for (const doc of docs) {
    let best: RankedHit | null = null
    for (const chunk of doc.chunks) {
      const evidence = passageEvidence(model, doc.title, chunk)
      if (evidence.tier === 0 && evidence.score <= 0) continue
      const candidate: RankedHit = {
        slug: doc.slug as FullSlug,
        title: doc.title,
        anchor: chunk.anchor || "",
        hPath: chunk.hPath,
        snippet: centeredSnippet(query, chunk.text),
        evidence,
      }
      if (
        !best ||
        candidate.evidence.tier > best.evidence.tier ||
        (candidate.evidence.tier === best.evidence.tier && candidate.evidence.score > best.evidence.score)
      ) {
        best = candidate
      }
    }
    if (!best) continue

    const docCoverage = documentCoverage(model, doc)
    const discriminatorDocCoverage = documentCoverage(model, doc, model.discriminatorTerms)
    if (model.coreTerms.length >= 3 && docCoverage >= 0.75 && best.evidence.tier < 7) {
      const fullDiscriminatorMatch = model.discriminatorTerms.length > 0 && discriminatorDocCoverage >= 0.99
      best = {
        ...best,
        evidence: {
          ...best.evidence,
          tier: Math.max(
            best.evidence.tier,
            model.statutes.length > 0 && fullDiscriminatorMatch ? 7 : docCoverage === 1 ? 6 : 5,
          ),
          score: Math.min(1, best.evidence.score + 0.16 * docCoverage + 0.08 * discriminatorDocCoverage),
          coreCoverage: Math.max(best.evidence.coreCoverage, docCoverage),
          discriminatorCoverage: Math.max(best.evidence.discriminatorCoverage, discriminatorDocCoverage),
        },
      }
    }
    hits.push(best)
  }
  return pruneRankedHits(hits)
}

function splitFallbackText(text: string): LexicalChunk[] {
  const clean = text.replace(/\s+/g, " ").trim()
  if (!clean) return []
  const chunks: LexicalChunk[] = []
  let start = 0
  while (start < clean.length) {
    let end = Math.min(clean.length, start + FALLBACK_CHUNK_CHARS)
    if (end < clean.length) {
      const boundary = clean.lastIndexOf(" ", end)
      if (boundary > start + Math.floor(FALLBACK_CHUNK_CHARS * 0.65)) end = boundary
    }
    const piece = clean.slice(start, end).trim()
    if (piece) chunks.push({ anchor: "", hPath: [], text: piece })
    if (end >= clean.length) break
    start = Math.max(start + 1, end - FALLBACK_OVERLAP)
  }
  return chunks
}

function browserLexicalIndex(data: SearchData): LexicalDocument[] {
  return Object.entries(data).map(([slug, details]) => ({
    slug,
    title: details.title ?? slug,
    chunks: splitFallbackText(details.content ?? ""),
  }))
}

function normalizeSlug(value: string): string {
  let pathname = value
  try {
    pathname = new URL(value, window.location.origin).pathname
  } catch {
    // already a slug
  }
  return decodeURIComponent(pathname).replace(/^\/+|\/+$/g, "").replace(/\/index$/i, "")
}

function semanticByDocument(results: SemResult[]): Map<string, SemResult> {
  const best = new Map<string, SemResult>()
  for (const result of results) {
    const slug = normalizeSlug(result.url)
    const previous = best.get(slug)
    if (!previous || result.score > previous.score) best.set(slug, result)
  }
  return best
}

function semanticAnchor(result?: SemResult): string {
  if (!result) return ""
  try {
    return new URL(result.url, window.location.origin).hash
  } catch {
    return result.url.includes("#") ? `#${result.url.split("#")[1]}` : ""
  }
}

function evidenceBadge(evidence: Evidence, semanticOnly = false): string {
  if (semanticOnly) return "Related by meaning"
  if (evidence.tier >= 10) return "Exact citation match"
  if (evidence.tier >= 9) return "Doctrine / elements match"
  if (evidence.tier >= 7) return "Strong legal match"
  if (evidence.tier >= 5) return "Strong passage match"
  if (evidence.tier >= 3) return "Relevant passage"
  return "Possible match"
}

function escapeHTML(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function highlight(query: string, value: string): string {
  const terms = meaningfulTerms(query)
    .flatMap((term) => termVariants(term))
    .filter((term) => term.length >= 2 && !term.includes(" "))
    .sort((a, b) => b.length - a.length)
  if (terms.length === 0) return escapeHTML(value)
  const matcher = new RegExp(`(${[...new Set(terms)].map(escapeRegex).join("|")})`, "gi")
  let output = ""
  let last = 0
  for (const match of value.matchAll(matcher)) {
    const index = match.index ?? 0
    output += escapeHTML(value.slice(last, index))
    output += `<span class="highlight">${escapeHTML(match[0])}</span>`
    last = index + match[0].length
  }
  output += escapeHTML(value.slice(last))
  return output
}

function displayItem(hit: RankedHit, query: string, semanticOnly = false): DisplayItem {
  const semantic = hit.semantic
  const anchor = hit.evidence.tier >= 5 ? hit.anchor : semanticAnchor(semantic) || hit.anchor
  const semanticPath = semantic?.where?.filter(Boolean).join(" › ") ?? ""
  const path = hit.hPath.filter(Boolean).join(" › ") || semanticPath
  const snippet = hit.snippet || semantic?.snippet || ""
  return {
    slug: hit.slug,
    title: highlight(query, hit.title),
    anchor,
    path: escapeHTML(path),
    snippet: highlight(query, snippet),
    badge: evidenceBadge(hit.evidence, semanticOnly),
  }
}

document.addEventListener("nav", async (event: CustomEventMap["nav"]) => {
  const currentSlug = event.detail.url
  const data = (await fetchData) as SearchData
  const container = document.getElementById("search-container")
  const sidebar = container?.closest(".sidebar") as HTMLElement | null
  const searchButton = document.getElementById("search-button")
  const searchBar = document.getElementById("search-bar") as HTMLInputElement | null
  const searchLayout = document.getElementById("search-layout")
  if (!container || !searchButton || !searchBar || !searchLayout) return

  searchLayout.dataset.engine = "hybrid-v5"
  console.info("[Quartz search] hybrid-v5 passage ranking active")

  const results = document.createElement("div")
  results.id = "results-container"
  searchLayout.querySelector("#results-container")?.remove()
  searchLayout.querySelector("#preview-container")?.remove()
  searchLayout.appendChild(results)

  let currentSearchTerm = ""
  let currentFocus: HTMLElement | null = null
  let timer: number | undefined
  let generation = 0
  let warmStarted = false

  const fallbackDocs = browserLexicalIndex(data)
  const lexicalDocsPromise: Promise<LexicalDocument[]> = loadLexicalIndex()
    .then((docs) => {
      if (!Array.isArray(docs) || docs.length === 0) throw new Error("empty lexical index")
      console.info(`[Quartz search] loaded ${docs.length} indexed documents`)
      return docs
    })
    .catch((error) => {
      console.warn("[Quartz search] lexical index unavailable; using browser passage index", error)
      return fallbackDocs
    })

  const resolveUrl = (slug: FullSlug) => new URL(resolveRelative(currentSlug, slug), location.toString())
  const warm = () => {
    if (warmStarted) return
    warmStarted = true
    void warmSemanticSearch()
      .then(() => console.info("[Quartz search] semantic model ready"))
      .catch((error) => {
        console.warn("[Quartz search] semantic model unavailable; deterministic search remains active", error)
      })
  }
  const idleTimer = window.setTimeout(warm, 1100)
  searchButton.addEventListener("pointerenter", warm)
  searchBar.addEventListener("focus", warm)
  window.addCleanup(() => {
    window.clearTimeout(idleTimer)
    searchButton.removeEventListener("pointerenter", warm)
    searchBar.removeEventListener("focus", warm)
  })

  function hideSearch() {
    generation++
    if (timer) window.clearTimeout(timer)
    container.classList.remove("active")
    searchBar.value = ""
    searchLayout.classList.remove("display-results")
    if (sidebar) sidebar.style.zIndex = ""
    removeAllChildren(results)
    currentFocus = null
    searchButton.focus()
  }

  function showSearch(_type: SearchType) {
    if (sidebar) sidebar.style.zIndex = "1"
    container.classList.add("active")
    searchBar.focus()
    warm()
  }

  function resultToHTML(item: DisplayItem): HTMLAnchorElement {
    const card = document.createElement("a")
    card.className = "result-card search-result-detailed"
    card.id = item.slug
    const url = resolveUrl(item.slug)
    if (item.anchor) url.hash = item.anchor.replace(/^#/, "")
    card.href = url.toString()
    card.innerHTML = `
      <div class="search-result-header">
        <h3>${item.title}</h3>
        <span class="search-match-badge">${escapeHTML(item.badge)}</span>
      </div>
      ${item.path ? `<div class="search-match-path">${item.path}</div>` : ""}
      <p class="search-snippet">${item.snippet}</p>
    `
    const onClick = (click: MouseEvent) => {
      if (click.altKey || click.ctrlKey || click.metaKey || click.shiftKey) return
      hideSearch()
    }
    const onMouseEnter = () => {
      currentFocus?.classList.remove("focus")
      card.classList.add("focus")
      currentFocus = card
    }
    card.addEventListener("click", onClick)
    card.addEventListener("mouseenter", onMouseEnter)
    window.addCleanup(() => {
      card.removeEventListener("click", onClick)
      card.removeEventListener("mouseenter", onMouseEnter)
    })
    return card
  }

  function displayResults(items: DisplayItem[]) {
    removeAllChildren(results)
    if (items.length === 0) {
      results.innerHTML = `<div class="search-empty"><h3>No relevant passage found.</h3><p>Try a broader concept, case name, statute, or section.</p></div>`
      currentFocus = null
      return
    }
    results.append(...items.map(resultToHTML))
    currentFocus = results.firstElementChild as HTMLElement | null
    currentFocus?.classList.add("focus")
  }

  function displaySearching() {
    removeAllChildren(results)
    const status = document.createElement("div")
    status.className = "search-status"
    status.textContent = "Searching notes…"
    results.appendChild(status)
    currentFocus = null
  }

  async function mergeSemantic(query: string, lexical: RankedHit[], myGeneration: number, started: number) {
    try {
      const semanticQuery = await createSemanticQuery(query)
      const semanticResults = await semanticSearch(semanticQuery, 9, 2)
      if (myGeneration !== generation || searchBar.value.trim() !== query) return
      if (performance.now() - started > SEMANTIC_BUDGET_MS) return
      const semantic = semanticByDocument(semanticResults)
      const bySlug = new Map(lexical.map((hit) => [normalizeSlug(hit.slug), hit]))
      const slugLookup = new Map(Object.keys(data).map((slug) => [normalizeSlug(slug), slug as FullSlug]))
      const strongDeterministic = lexical[0]?.evidence.tier ?? 0

      for (const [normalized, sem] of semantic) {
        const slug = slugLookup.get(normalized)
        if (!slug) continue
        const existing = bySlug.get(normalized)
        if (existing) {
          existing.semantic = sem
          if (existing.evidence.tier < 5) {
            existing.evidence = {
              ...existing.evidence,
              score: Math.min(1, 0.62 * existing.evidence.score + 0.38 * sem.score),
            }
          }
        } else if (strongDeterministic < 7 || sem.score >= 0.72) {
          const details = data[slug]
          bySlug.set(normalized, {
            slug,
            title: details?.title ?? sem.title ?? slug,
            anchor: semanticAnchor(sem),
            hPath: sem.where ?? [],
            snippet: sem.snippet,
            evidence: { ...EMPTY_EVIDENCE, tier: 1, score: sem.score },
            semantic: sem,
          })
        }
      }

      const ranked = pruneRankedHits([...bySlug.values()])
      displayResults(ranked.map((hit) => displayItem(hit, query, hit.evidence.tier <= 1 && !!hit.semantic)))
    } catch (error) {
      console.warn("[Quartz search] semantic refinement skipped", error)
    }
  }

  async function runBasicSearch(query: string, myGeneration: number) {
    const started = performance.now()
    const docs = await lexicalDocsPromise
    if (myGeneration !== generation || searchBar.value.trim() !== query) return
    const lexical = rankLexical(query, docs)
    displayResults(lexical.map((hit) => displayItem(hit, query)))
    void mergeSemantic(query, lexical, myGeneration, started)
  }

  function runTagSearch(rawQuery: string) {
    const body = rawQuery.slice(1).trim()
    const firstSpace = body.indexOf(" ")
    const tagQuery = (firstSpace >= 0 ? body.slice(0, firstSpace) : body).toLowerCase()
    const textQuery = firstSpace >= 0 ? body.slice(firstSpace + 1).trim() : ""
    const ranked = Object.entries(data)
      .map(([slug, details]) => {
        const tags = (details.tags ?? []).filter((tag) => tag.toLowerCase().includes(tagQuery))
        if (tags.length === 0) return null
        const model = queryModel(textQuery)
        const text = normalizeText(`${details.title ?? ""} ${details.content ?? ""}`)
        const score = textQuery && model.coreTerms.length > 0
          ? model.coreTerms.filter((term) => termPositions(text, term).length > 0).length / model.coreTerms.length
          : 1
        return { slug: slug as FullSlug, details, tags, score }
      })
      .filter((item): item is { slug: FullSlug; details: ContentDetails; tags: string[]; score: number } => item !== null)
      .sort((a, b) => b.score - a.score || (a.details.title ?? "").localeCompare(b.details.title ?? ""))
      .slice(0, RESULT_LIMIT)
    displayResults(ranked.map(({ slug, details, tags }) => ({
      slug,
      title: highlight(textQuery || tagQuery, details.title ?? slug),
      anchor: "",
      path: tags.slice(0, TAG_LIMIT).map((tag) => `#${tag}`).join(" · "),
      snippet: highlight(textQuery, centeredSnippet(textQuery, details.content ?? "")),
      badge: "Tag match",
    })))
  }

  function onInput() {
    currentSearchTerm = searchBar.value
    searchLayout.classList.toggle("display-results", currentSearchTerm.trim().length > 0)
    generation++
    const myGeneration = generation
    if (timer) window.clearTimeout(timer)
    if (!currentSearchTerm.trim()) {
      removeAllChildren(results)
      currentFocus = null
      return
    }
    if (currentSearchTerm.startsWith("#")) {
      runTagSearch(currentSearchTerm)
      return
    }
    const query = currentSearchTerm.trim()
    if (query.length < 2) {
      removeAllChildren(results)
      return
    }
    displaySearching()
    timer = window.setTimeout(() => {
      void runBasicSearch(query, myGeneration)
    }, INPUT_DEBOUNCE_MS)
  }

  async function shortcutHandler(keyEvent: KeyboardEvent) {
    if (keyEvent.key.toLowerCase() === "k" && (keyEvent.ctrlKey || keyEvent.metaKey) && !keyEvent.shiftKey) {
      keyEvent.preventDefault()
      container.classList.contains("active") ? hideSearch() : showSearch("basic")
      return
    }
    if (keyEvent.key.toLowerCase() === "k" && (keyEvent.ctrlKey || keyEvent.metaKey) && keyEvent.shiftKey) {
      keyEvent.preventDefault()
      if (container.classList.contains("active")) hideSearch()
      else {
        showSearch("tags")
        searchBar.value = "#"
      }
      return
    }
    if (!container.classList.contains("active")) return
    const cards = [...results.querySelectorAll<HTMLElement>("a.result-card")]
    if (cards.length === 0) return
    if (keyEvent.key === "Enter") {
      keyEvent.preventDefault()
      ;(currentFocus ?? cards[0]).click()
      return
    }
    if (keyEvent.key === "ArrowDown" || keyEvent.key === "ArrowUp") {
      keyEvent.preventDefault()
      const currentIndex = currentFocus ? cards.indexOf(currentFocus) : -1
      const delta = keyEvent.key === "ArrowDown" ? 1 : -1
      const nextIndex = Math.min(cards.length - 1, Math.max(0, currentIndex + delta))
      currentFocus?.classList.remove("focus")
      currentFocus = cards[nextIndex]
      currentFocus.classList.add("focus")
      currentFocus.focus()
      currentFocus.scrollIntoView({ block: "nearest" })
    }
  }

  const onSearchButtonClick = () => showSearch("basic")
  document.addEventListener("keydown", shortcutHandler)
  searchButton.addEventListener("click", onSearchButtonClick)
  searchBar.addEventListener("input", onInput)
  window.addCleanup(() => {
    document.removeEventListener("keydown", shortcutHandler)
    searchButton.removeEventListener("click", onSearchButtonClick)
    searchBar.removeEventListener("input", onInput)
    if (timer) window.clearTimeout(timer)
  })
  registerEscapeHandler(container, hideSearch)
})
