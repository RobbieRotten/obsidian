import { ContentDetails } from "../../plugins/emitters/contentIndex"
import { FullSlug, normalizeRelativeURLs, resolveRelative } from "../../util/path"
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
type DisplayItem = {
  slug: FullSlug
  title: string
  content: string
  tags: string[]
  anchor?: string
}
type Evidence = {
  hardTier: number
  score: number
  coverage: number
  proximity: number
  phrase: number
  anchor: number
}
type LexicalHit = {
  slug: FullSlug
  title: string
  anchor: string
  snippet: string
  hPath: string[]
  evidence: Evidence
}

const EMPTY_EVIDENCE: Evidence = {
  hardTier: 0,
  score: 0,
  coverage: 0,
  proximity: 0,
  phrase: 0,
  anchor: 0,
}

const p = new DOMParser()
const fetchContentCache = new Map<FullSlug, Element[]>()
const contextWindowWords = 30
const numSearchResults = 8
const numTagResults = 5
const lexicalDebounceMs = 90
const semanticRerenderBudgetMs = 900

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

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function tokens(value: string): string[] {
  return normalizeText(value).match(/[\p{L}\p{N}]+/gu) ?? []
}

function meaningfulTerms(value: string): string[] {
  return [...new Set(tokens(value).filter((term) => term.length > 1 && !stopWords.has(term)))]
}

function coreTerms(value: string): string[] {
  return meaningfulTerms(value).filter((term) => !intentWords.has(term))
}

function variants(term: string): string[] {
  const out = new Set([term])
  if (term === "cla") out.add("civil liability act")
  if (/^\d+[a-z]$/i.test(term)) {
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
  for (const variant of variants(term)) {
    for (const at of phrasePositions(text, variant)) out.add(at)
  }
  return [...out].sort((a, b) => a - b)
}

function minimumSpan(positionSets: number[][]): number | null {
  if (positionSets.length === 0 || positionSets.some((positions) => positions.length === 0)) return null
  if (positionSets.length === 1) return 0

  const pointers = new Array(positionSets.length).fill(0)
  let best = Number.POSITIVE_INFINITY
  while (true) {
    const current = positionSets.map((positions, index) => positions[pointers[index]])
    best = Math.min(best, Math.max(...current) - Math.min(...current))
    let minIndex = 0
    for (let i = 1; i < current.length; i++) {
      if (current[i] < current[minIndex]) minIndex = i
    }
    pointers[minIndex]++
    if (pointers[minIndex] >= positionSets[minIndex].length) break
  }
  return Number.isFinite(best) ? best : null
}

function sectionRef(query: string): string | null {
  const explicit = query.match(/(?:^|\s)(?:s|ss|section)\s*([0-9]+[a-z]?(?:\([0-9a-z]+\))?)(?=\s|$)/i)
  if (explicit?.[1]) return explicit[1].toLowerCase()

  if (/\bcla\b/i.test(query) || /\b[a-z]+(?:\s+[a-z]+){0,2}\s+act\b/i.test(query)) {
    const bare = query.match(/(?:^|\s)([0-9]+[a-z])(?=\s|$)/i)
    if (bare?.[1]) return bare[1].toLowerCase()
  }
  return null
}

function statuteGroups(query: string): string[][] {
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

function casePhrase(query: string): string | null {
  const normalized = normalizeText(query)
  const match = normalized.match(/\b([a-z][a-z-]+)\s+v\s+([a-z][a-z-]+(?:\s+[a-z][a-z-]+){0,2})\b/)
  return match ? `${match[1]} v ${match[2]}` : null
}

function doctrinePhrase(query: string): string | null {
  const terms = meaningfulTerms(query)
  if (!terms.some((term) => intentWords.has(term))) return null
  const core = terms.filter((term) => !intentWords.has(term) && term !== "cla" && !/^\d+[a-z]?$/i.test(term))
  if (core.length === 0) return null
  return core.join(" ")
}

function groupPositions(text: string, alternatives: string[]): number[] {
  const out = new Set<number>()
  for (const alternative of alternatives) {
    for (const at of phrasePositions(text, alternative)) out.add(at)
  }
  return [...out].sort((a, b) => a - b)
}

function sectionPositions(text: string, section: string | null): number[] {
  if (!section) return []
  const normalized = normalizeText(text)
  const out = new Set(termPositions(normalized, section))
  const compact = normalized.replace(/\s+/g, "")
  const compactNeedles = [`s${section}`.replace(/\s+/g, ""), `section${section}`.replace(/\s+/g, "")]
  for (const needle of compactNeedles) {
    const at = compact.indexOf(needle)
    if (at >= 0) out.add(at)
  }
  return [...out].sort((a, b) => a - b)
}

function chunkEvidence(query: string, docTitle: string, chunk: LexicalChunk): Evidence {
  const terms = meaningfulTerms(query)
  if (terms.length === 0) return EMPTY_EVIDENCE

  const heading = chunk.hPath.filter(Boolean).join(" ")
  const body = chunk.text
  const text = `${docTitle} ${heading} ${heading} ${body}`
  const normalized = normalizeText(text)
  const positionSets = terms.map((term) => termPositions(normalized, term))
  const matched = positionSets.filter((positions) => positions.length > 0).length
  const coverage = matched / terms.length

  const span = minimumSpan(positionSets)
  let proximity = 0
  if (span !== null) {
    if (span <= 70) proximity = 1
    else if (span <= 180) proximity = 0.9
    else if (span <= 420) proximity = 0.7
    else if (span <= 900) proximity = 0.4
    else proximity = 0.15
  }

  const exactPhrase = phrasePositions(normalized, query).length > 0 ? 1 : 0
  const doctrine = doctrinePhrase(query)
  const doctrineSignal = doctrine && phrasePositions(normalized, doctrine).length > 0 ? 1 : 0
  const hasIntent = meaningfulTerms(query).some((term) => intentWords.has(term))
  const intentSignal = hasIntent
    ? meaningfulTerms(query)
        .filter((term) => intentWords.has(term))
        .some((term) => termPositions(normalized, term).length > 0)
      ? 1
      : 0
    : 0

  const section = sectionRef(query)
  const sectionHits = sectionPositions(normalized, section)
  const statutes = statuteGroups(query)
  const statuteHits = statutes.map((group) => groupPositions(normalized, group))
  const statuteMatched = statuteHits.filter((positions) => positions.length > 0).length
  const statuteSignal = statutes.length > 0 ? statuteMatched / statutes.length : 0

  let statuteSectionSignal = 0
  if (section && sectionHits.length > 0 && statuteHits.some((positions) => positions.length > 0)) {
    const statutePositions = statuteHits.flatMap((positions) => positions)
    const citationSpan = minimumSpan([sectionHits, statutePositions])
    if (citationSpan !== null && citationSpan <= 260) statuteSectionSignal = 1
    else if (citationSpan !== null && citationSpan <= 900) statuteSectionSignal = 0.94
    else statuteSectionSignal = 0.82
  }

  const caseAnchor = casePhrase(query)
  const caseSignal = caseAnchor && phrasePositions(normalized, caseAnchor).length > 0 ? 1 : 0
  const doctrineIntentSignal = doctrineSignal && intentSignal ? 1 : doctrineSignal ? 0.72 : 0

  const anchor = Math.max(statuteSectionSignal, caseSignal, statuteSignal * 0.92, doctrineIntentSignal)
  const phrase = Math.max(exactPhrase, doctrineSignal, doctrineIntentSignal)
  const headingCoverage = terms.filter((term) => termPositions(heading, term).length > 0).length / terms.length
  const score = Math.min(
    1,
    0.31 * coverage + 0.18 * proximity + 0.12 * headingCoverage + 0.16 * phrase + 0.23 * anchor,
  )

  let hardTier = 0
  if (statuteSectionSignal >= 0.94 || caseSignal === 1) hardTier = 6
  else if (doctrineIntentSignal === 1) hardTier = 5
  else if (statuteSignal >= 0.99 || exactPhrase === 1) hardTier = 4
  else if (doctrineSignal === 1 || (coverage === 1 && proximity >= 0.7)) hardTier = 3
  else if (coverage >= 0.67 && proximity > 0) hardTier = 2

  return { hardTier, score, coverage, proximity, phrase, anchor }
}

function lexicalChunkResults(query: string, docs: LexicalDocument[]): LexicalHit[] {
  const bestBySlug = new Map<string, LexicalHit>()
  for (const doc of docs) {
    for (const chunk of doc.chunks) {
      const evidence = chunkEvidence(query, doc.title, chunk)
      if (evidence.score <= 0) continue
      const candidate: LexicalHit = {
        slug: doc.slug as FullSlug,
        title: doc.title,
        anchor: chunk.anchor || "",
        snippet: chunk.text.slice(0, 520),
        hPath: chunk.hPath,
        evidence,
      }
      const previous = bestBySlug.get(doc.slug)
      if (
        !previous ||
        evidence.hardTier > previous.evidence.hardTier ||
        (evidence.hardTier === previous.evidence.hardTier && evidence.score > previous.evidence.score)
      ) {
        bestBySlug.set(doc.slug, candidate)
      }
    }
  }
  return [...bestBySlug.values()].sort(
    (a, b) => b.evidence.hardTier - a.evidence.hardTier || b.evidence.score - a.evidence.score,
  )
}

function fallbackNoteResults(query: string, data: { [key: FullSlug]: ContentDetails }): LexicalHit[] {
  const terms = coreTerms(query)
  if (terms.length === 0) return []
  return Object.entries(data)
    .map(([slug, details]) => {
      const text = normalizeText(`${details.title ?? ""} ${details.content ?? ""}`)
      const matched = terms.filter((term) => termPositions(text, term).length > 0).length
      const coverage = matched / terms.length
      return {
        slug: slug as FullSlug,
        title: details.title ?? slug,
        anchor: "",
        snippet: details.content ?? "",
        hPath: [],
        evidence: { ...EMPTY_EVIDENCE, score: coverage * 0.3, coverage },
      } satisfies LexicalHit
    })
    .filter((hit) => hit.evidence.score > 0)
    .sort((a, b) => b.evidence.score - a.evidence.score)
}

function normalizedSlug(value: string): string {
  let pathname = value
  try {
    pathname = new URL(value, window.location.origin).pathname
  } catch {
    // already a slug
  }
  return decodeURIComponent(pathname).replace(/^\/+|\/+$/g, "").replace(/\/index$/i, "")
}

function semanticByDocument(results: SemResult[]) {
  const best = new Map<string, SemResult>()
  for (const result of results) {
    const slug = normalizedSlug(result.url)
    const previous = best.get(slug)
    if (!previous || result.score > previous.score) best.set(slug, result)
  }
  const scores = [...best.values()].map((result) => result.score)
  const min = scores.length > 0 ? Math.min(...scores) : 0
  const max = scores.length > 0 ? Math.max(...scores) : 1
  const range = Math.max(max - min, 1e-6)
  return new Map(
    [...best.entries()].map(([slug, result]) => [
      slug,
      { result, score: scores.length === 1 ? 1 : (result.score - min) / range },
    ]),
  )
}

function escapedRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function highlightTerms(searchTerm: string): string[] {
  return searchTerm.split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length)
}

function highlight(searchTerm: string, text: string, trim?: boolean) {
  const terms = highlightTerms(searchTerm)
  let words = text.split(/\s+/).filter(Boolean)
  const originalLength = words.length
  let startIndex = 0
  let endIndex = words.length - 1

  if (trim && words.length > 0) {
    const hit = words.map((word) => terms.some((term) => word.toLowerCase().includes(term.toLowerCase())))
    let bestSum = -1
    let bestIndex = 0
    for (let i = 0; i <= Math.max(words.length - contextWindowWords, 0); i++) {
      const sum = hit.slice(i, i + contextWindowWords).reduce((total, value) => total + (value ? 1 : 0), 0)
      if (sum > bestSum) {
        bestSum = sum
        bestIndex = i
      }
    }
    startIndex = Math.max(bestIndex - contextWindowWords, 0)
    endIndex = Math.min(startIndex + 2 * contextWindowWords, words.length - 1)
    words = words.slice(startIndex, endIndex + 1)
  }

  const rendered = words.map((word) => {
    for (const term of terms) {
      if (word.toLowerCase().includes(term.toLowerCase())) {
        return word.replace(new RegExp(escapedRegex(term), "gi"), `<span class="highlight">$&</span>`)
      }
    }
    return word
  }).join(" ")

  return `${startIndex === 0 ? "" : "..."}${rendered}${endIndex >= originalLength - 1 ? "" : "..."}`
}

function highlightHTML(searchTerm: string, element: HTMLElement) {
  const terms = highlightTerms(searchTerm)
  const html = p.parseFromString(element.innerHTML, "text/html")
  const visit = (node: Node, term: string) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue ?? ""
      const regex = new RegExp(escapedRegex(term), "gi")
      const matches = value.match(regex)
      if (!matches?.length) return
      const container = document.createElement("span")
      let last = 0
      for (const match of matches) {
        const at = value.toLowerCase().indexOf(match.toLowerCase(), last)
        container.appendChild(document.createTextNode(value.slice(last, at)))
        const mark = document.createElement("span")
        mark.className = "highlight"
        mark.textContent = match
        container.appendChild(mark)
        last = at + match.length
      }
      container.appendChild(document.createTextNode(value.slice(last)))
      node.parentNode?.replaceChild(container, node)
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if ((node as HTMLElement).classList.contains("highlight")) return
      Array.from(node.childNodes).forEach((child) => visit(child, term))
    }
  }
  for (const term of terms) visit(html.body, term)
  return html.body
}

document.addEventListener("nav", async (event: CustomEventMap["nav"]) => {
  const currentSlug = event.detail.url
  const data = (await fetchData) as { [key: FullSlug]: ContentDetails }
  const container = document.getElementById("search-container")
  const sidebar = container?.closest(".sidebar") as HTMLElement | null
  const searchButton = document.getElementById("search-button")
  const searchBar = document.getElementById("search-bar") as HTMLInputElement | null
  const searchLayout = document.getElementById("search-layout")
  if (!container || !searchButton || !searchBar || !searchLayout) return

  searchLayout.dataset.engine = "hybrid-v4"
  console.info("[Quartz search] hybrid-v4 chunk index active")

  const enablePreview = searchLayout.dataset.preview === "true"
  const results = document.createElement("div")
  results.id = "results-container"
  const preview = enablePreview ? document.createElement("div") : undefined
  if (preview) preview.id = "preview-container"
  searchLayout.querySelector("#results-container")?.remove()
  searchLayout.querySelector("#preview-container")?.remove()
  searchLayout.appendChild(results)
  if (preview) searchLayout.appendChild(preview)

  let currentSearchTerm = ""
  let currentHover: HTMLElement | null = null
  let timer: number | undefined
  let generation = 0
  let warmStarted = false

  const lexicalPromise = loadLexicalIndex()
  void lexicalPromise.catch((error) => console.warn("Chunk lexical index unavailable", error))

  const resolveUrl = (slug: FullSlug) => new URL(resolveRelative(currentSlug, slug), location.toString())
  const warm = () => {
    if (warmStarted) return
    warmStarted = true
    void Promise.all([lexicalPromise, warmSemanticSearch()]).catch(() => {
      warmStarted = false
    })
  }

  const idleTimer = window.setTimeout(warm, 900)
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
    if (sidebar) sidebar.style.zIndex = ""
    removeAllChildren(results)
    if (preview) removeAllChildren(preview)
    searchLayout.classList.remove("display-results")
    currentHover = null
    searchButton.focus()
  }

  function showSearch(type: SearchType) {
    if (sidebar) sidebar.style.zIndex = "1"
    container.classList.add("active")
    searchBar.focus()
    if (type === "basic") warm()
  }

  async function fetchContent(slug: FullSlug): Promise<Element[]> {
    const cached = fetchContentCache.get(slug)
    if (cached) return cached
    const targetUrl = resolveUrl(slug).toString()
    const contents = await fetch(targetUrl)
      .then((response) => response.text())
      .then((source) => {
        const html = p.parseFromString(source, "text/html")
        normalizeRelativeURLs(html, targetUrl)
        return [...html.getElementsByClassName("popover-hint")]
      })
    fetchContentCache.set(slug, contents)
    return contents
  }

  async function displayPreview(element: HTMLElement | null) {
    if (!preview || !element || element.classList.contains("no-match")) return
    const slug = element.id as FullSlug
    const anchor = element.dataset.searchAnchor ?? ""
    const contents = await fetchContent(slug)
    const highlighted = contents.flatMap((content) => [...highlightHTML(currentSearchTerm, content as HTMLElement).children])
    const inner = document.createElement("div")
    inner.classList.add("preview-inner")
    inner.append(...highlighted)
    preview.replaceChildren(inner)

    if (anchor.startsWith("#")) {
      const target = inner.querySelector<HTMLElement>(`#${CSS.escape(decodeURIComponent(anchor.slice(1)))}`)
      if (target) {
        target.scrollIntoView({ block: "start" })
        return
      }
    }
    const marks = [...preview.querySelectorAll(".highlight")].sort(
      (a, b) => (b.textContent?.length ?? 0) - (a.textContent?.length ?? 0),
    )
    marks[0]?.scrollIntoView({ block: "start" })
  }

  function resultToHTML(item: DisplayItem) {
    const card = document.createElement("a")
    card.classList.add("result-card")
    card.id = item.slug
    card.dataset.searchAnchor = item.anchor ?? ""
    const url = resolveUrl(item.slug)
    if (item.anchor) url.hash = item.anchor.slice(1)
    card.href = url.toString()
    const htmlTags = item.tags.length > 0 ? `<ul class="tags">${item.tags.join("")}</ul>` : ""
    card.innerHTML = `<h3>${item.title}</h3>${htmlTags}${
      enablePreview && window.innerWidth > 600 ? "" : `<p>${item.content}</p>`
    }`

    const onClick = (click: MouseEvent) => {
      if (click.altKey || click.ctrlKey || click.metaKey || click.shiftKey) return
      hideSearch()
    }
    const onMouseEnter = () => {
      currentHover?.classList.remove("focus")
      card.classList.add("focus")
      currentHover = card
      void displayPreview(card)
    }
    card.addEventListener("click", onClick)
    card.addEventListener("mouseenter", onMouseEnter)
    window.addCleanup(() => {
      card.removeEventListener("click", onClick)
      card.removeEventListener("mouseenter", onMouseEnter)
    })
    return card
  }

  async function displayResults(items: DisplayItem[]) {
    removeAllChildren(results)
    if (items.length === 0) {
      results.innerHTML = `<a class="result-card no-match"><h3>No results.</h3><p>Try another search term?</p></a>`
      if (preview) removeAllChildren(preview)
      currentHover = null
      return
    }
    results.append(...items.map(resultToHTML))
    const first = results.firstElementChild as HTMLElement | null
    if (first) {
      first.classList.add("focus")
      currentHover = first
      void displayPreview(first)
    }
  }

  function displaySearching(message = "Searching…") {
    removeAllChildren(results)
    const status = document.createElement("div")
    status.className = "search-status"
    status.textContent = message
    results.appendChild(status)
    if (preview) removeAllChildren(preview)
    currentHover = null
  }

  function semanticAnchor(result?: SemResult): string {
    if (!result) return ""
    try {
      return new URL(result.url, window.location.origin).hash
    } catch {
      return result.url.includes("#") ? `#${result.url.split("#")[1]}` : ""
    }
  }

  function formatItem(slug: FullSlug, query: string, lexical?: LexicalHit, semantic?: SemResult): DisplayItem {
    const details = data[slug]
    const tags = (details?.tags ?? []).slice(0, numTagResults).map((tag) => `<li><p>#${tag}</p></li>`)
    const strongLexical = (lexical?.evidence.hardTier ?? 0) >= 3
    const anchor = strongLexical ? lexical?.anchor ?? "" : semanticAnchor(semantic) || lexical?.anchor || ""
    const sourceText = lexical?.snippet || semantic?.snippet || details?.content || ""
    return {
      slug,
      title: highlight(query, details?.title ?? lexical?.title ?? slug),
      content: highlight(query, sourceText, true),
      tags,
      anchor,
    }
  }

  async function getLexical(query: string): Promise<LexicalHit[]> {
    try {
      return lexicalChunkResults(query, await lexicalPromise)
    } catch {
      return fallbackNoteResults(query, data)
    }
  }

  async function mergeSemantic(
    query: string,
    lexical: LexicalHit[],
    myGeneration: number,
    anchoredInitially: boolean,
    started: number,
  ) {
    try {
      const semanticQuery = await createSemanticQuery(query)
      const semanticResults = await semanticSearch(semanticQuery, anchoredInitially ? 5 : 8, 2)
      if (myGeneration !== generation || searchBar.value.trim() !== query) return
      if (anchoredInitially && performance.now() - started > semanticRerenderBudgetMs) return

      const semantic = semanticByDocument(semanticResults)
      const lexicalMap = new Map(lexical.map((hit) => [normalizedSlug(hit.slug), hit]))
      const slugByNormalized = new Map(Object.keys(data).map((slug) => [normalizedSlug(slug), slug as FullSlug]))
      const candidates = new Set<string>([...lexicalMap.keys(), ...semantic.keys()])
      const ranked = [...candidates]
        .map((normalized) => {
          const slug = slugByNormalized.get(normalized)
          if (!slug) return null
          const lexicalHit = lexicalMap.get(normalized)
          const evidence = lexicalHit?.evidence ?? EMPTY_EVIDENCE
          const semanticInfo = semantic.get(normalized)
          const semanticScore = semanticInfo?.score ?? 0
          let score = 0
          if (evidence.hardTier >= 5) score = 0.94 * evidence.score + 0.06 * semanticScore
          else if (evidence.hardTier >= 3) score = 0.8 * evidence.score + 0.2 * semanticScore
          else score = 0.34 * evidence.score + 0.66 * semanticScore
          return { slug, lexicalHit, semantic: semanticInfo?.result, hardTier: evidence.hardTier, score }
        })
        .filter((item): item is {
          slug: FullSlug
          lexicalHit?: LexicalHit
          semantic?: SemResult
          hardTier: number
          score: number
        } => item !== null)
        .sort((a, b) => b.hardTier - a.hardTier || b.score - a.score)
        .slice(0, numSearchResults)

      await displayResults(ranked.map((item) => formatItem(item.slug, query, item.lexicalHit, item.semantic)))
    } catch (error) {
      if (myGeneration !== generation || searchBar.value.trim() !== query) return
      console.warn("Semantic search unavailable; deterministic search retained", error)
      if (!anchoredInitially) {
        await displayResults(lexical.slice(0, numSearchResults).map((hit) => formatItem(hit.slug, query, hit)))
      }
    }
  }

  async function runBasicSearch(query: string, myGeneration: number) {
    const started = performance.now()
    const lexical = await getLexical(query)
    if (myGeneration !== generation || searchBar.value.trim() !== query) return

    const anchored = (lexical[0]?.evidence.hardTier ?? 0) >= 3
    if (anchored) {
      await displayResults(lexical.slice(0, numSearchResults).map((hit) => formatItem(hit.slug, query, hit)))
      void mergeSemantic(query, lexical, myGeneration, true, started)
    } else {
      displaySearching("Searching by meaning…")
      await mergeSemantic(query, lexical, myGeneration, false, started)
    }
  }

  async function runTagSearch(rawQuery: string, myGeneration: number) {
    const body = rawQuery.slice(1).trim()
    const firstSpace = body.indexOf(" ")
    const tagQuery = (firstSpace >= 0 ? body.slice(0, firstSpace) : body).toLowerCase()
    const textQuery = firstSpace >= 0 ? body.slice(firstSpace + 1).trim() : ""
    const ranked = Object.entries(data)
      .map(([slug, details]) => {
        const matchingTags = (details.tags ?? []).filter((tag) => tag.toLowerCase().includes(tagQuery))
        if (matchingTags.length === 0) return null
        const terms = coreTerms(textQuery)
        const normalized = normalizeText(`${details.title ?? ""} ${details.content ?? ""}`)
        const score = textQuery && terms.length > 0
          ? terms.filter((term) => termPositions(normalized, term).length > 0).length / terms.length
          : 1
        return { slug: slug as FullSlug, score, matchingTags }
      })
      .filter((item): item is { slug: FullSlug; score: number; matchingTags: string[] } => item !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, numSearchResults)
    if (myGeneration !== generation) return
    await displayResults(ranked.map(({ slug, matchingTags }) => ({
      slug,
      title: data[slug].title ?? "",
      content: textQuery ? highlight(textQuery, data[slug].content ?? "", true) : "",
      tags: matchingTags.slice(0, numTagResults).map((tag) => `<li><p class="match-tag">#${tag}</p></li>`),
    })))
  }

  function onInput() {
    currentSearchTerm = searchBar.value
    searchLayout.classList.toggle("display-results", currentSearchTerm !== "")
    generation++
    const myGeneration = generation
    if (timer) window.clearTimeout(timer)

    if (!currentSearchTerm.trim()) {
      removeAllChildren(results)
      if (preview) removeAllChildren(preview)
      currentHover = null
      return
    }
    if (currentSearchTerm.startsWith("#")) {
      void runTagSearch(currentSearchTerm, myGeneration)
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
    }, lexicalDebounceMs)
  }

  async function shortcutHandler(keyEvent: KeyboardEvent) {
    if (keyEvent.key === "k" && (keyEvent.ctrlKey || keyEvent.metaKey) && !keyEvent.shiftKey) {
      keyEvent.preventDefault()
      container.classList.contains("active") ? hideSearch() : showSearch("basic")
      return
    }
    if (keyEvent.shiftKey && (keyEvent.ctrlKey || keyEvent.metaKey) && keyEvent.key.toLowerCase() === "k") {
      keyEvent.preventDefault()
      if (container.classList.contains("active")) hideSearch()
      else {
        showSearch("tags")
        searchBar.value = "#"
      }
      return
    }

    if (!container.classList.contains("active")) return
    const cards = [...results.querySelectorAll<HTMLElement>("a.result-card:not(.no-match)")]
    if (cards.length === 0) return
    if (keyEvent.key === "Enter") {
      keyEvent.preventDefault()
      const active = cards.includes(document.activeElement as HTMLElement)
        ? (document.activeElement as HTMLElement)
        : currentHover ?? cards[0]
      active.click()
      return
    }
    if (keyEvent.key === "ArrowDown" || keyEvent.key === "ArrowUp") {
      keyEvent.preventDefault()
      const currentIndex = currentHover ? cards.indexOf(currentHover) : -1
      const delta = keyEvent.key === "ArrowDown" ? 1 : -1
      const nextIndex = Math.min(cards.length - 1, Math.max(0, currentIndex + delta))
      currentHover?.classList.remove("focus")
      currentHover = cards[nextIndex]
      currentHover.classList.add("focus")
      currentHover.focus()
      await displayPreview(currentHover)
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
