import { ContentDetails } from "../../plugins/emitters/contentIndex"
import { FullSlug, normalizeRelativeURLs, resolveRelative } from "../../util/path"
import {
  createSemanticQuery,
  semanticSearch,
  warmSemanticSearch,
  type SemResult,
} from "../semantic/searchClient"
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
  score: number
  hardTier: number
  coverage: number
  proximity: number
  phrase: number
  anchor: number
}

type LexicalHit = {
  slug: FullSlug
  evidence: Evidence
}

const EMPTY_EVIDENCE: Evidence = {
  score: 0,
  hardTier: 0,
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
const semanticDebounceMs = 220
const lateAnchoredRerenderMs = 1400

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
  const out = new Set([term])

  // Vault shorthand: CLA and Civil Liability Act are equivalent search anchors.
  if (term === "cla") out.add("civil liability act")

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

function positionsForPhrase(text: string, phrase: string): number[] {
  const padded = ` ${text} `
  const needle = ` ${normalizeText(phrase)} `
  const positions: number[] = []
  let from = 0

  while (from < padded.length) {
    const at = padded.indexOf(needle, from)
    if (at < 0) break
    positions.push(at)
    from = at + Math.max(1, needle.length)
    if (positions.length >= 32) break
  }

  return positions
}

function termPositions(text: string, term: string): number[] {
  const positions = new Set<number>()
  for (const variant of termVariants(term)) {
    for (const position of positionsForPhrase(text, variant)) positions.add(position)
  }
  return [...positions].sort((a, b) => a - b)
}

function minimumSpan(positionSets: number[][]): number | null {
  const populated = positionSets.filter((positions) => positions.length > 0)
  if (populated.length < 2) return populated.length === 1 ? 0 : null

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

function sectionRef(query: string): string | null {
  const explicit = query.match(/(?:^|\s)(?:s|ss|section)\s*([0-9]+[a-z]?(?:\([0-9a-z]+\))?)(?=\s|$)/i)
  if (explicit?.[1]) return explicit[1].toLowerCase()

  // Legal shorthand often omits the "s" when the statute is also named:
  // "CLA 5B elements".
  if (/\bcla\b/i.test(query) || /\b[a-z]+(?:\s+[a-z]+){0,2}\s+act\b/i.test(query)) {
    const bare = query.match(/(?:^|\s)([0-9]+[a-z])(?=\s|$)/i)
    if (bare?.[1]) return bare[1].toLowerCase()
  }

  return null
}

function statuteGroups(query: string): string[][] {
  const groups: string[][] = []

  if (/\bcla\b/i.test(query)) {
    groups.push(["cla", "civil liability act"])
  }

  const normalized = normalizeText(query)
  const matches = normalized.matchAll(/\b([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2})\s+act\b/g)
  for (const match of matches) {
    const words = match[1].split(" ").filter((word) => !stopWords.has(word))
    if (words.length === 0) continue
    const phrase = `${words.slice(-2).join(" ")} act`

    // CLA is already represented as an alias group rather than two required anchors.
    if (phrase === "civil liability act" && /\bcla\b/i.test(query)) continue
    if (!groups.some((group) => group.includes(phrase))) groups.push([phrase])
  }

  return groups
}

function casePhrase(query: string): string | null {
  const normalized = normalizeText(query)
  const match = normalized.match(/\b([a-z][a-z-]+)\s+v\s+([a-z][a-z-]+(?:\s+[a-z][a-z-]+){0,2})\b/)
  if (!match) return null
  return `${match[1]} v ${match[2]}`
}

function groupPositions(text: string, alternatives: string[]): number[] {
  const positions = new Set<number>()
  for (const alternative of alternatives) {
    for (const position of positionsForPhrase(text, alternative)) positions.add(position)
  }
  return [...positions].sort((a, b) => a - b)
}

function sectionPositions(text: string, section: string | null): number[] {
  if (!section) return []
  return termPositions(text, section)
}

function adjacentPairSignal(text: string, terms: string[]): number {
  if (terms.length < 2) return 0
  let matched = 0
  for (let i = 0; i < terms.length - 1; i++) {
    if (positionsForPhrase(text, `${terms[i]} ${terms[i + 1]}`).length > 0) matched++
  }
  return matched / (terms.length - 1)
}

function lexicalEvidence(query: string, details: ContentDetails): Evidence {
  const terms = meaningfulTerms(query)
  if (terms.length === 0) return EMPTY_EVIDENCE

  const title = normalizeText(details.title ?? "")
  const body = normalizeText(details.content ?? "")
  const text = `${title} ${body}`.trim()

  const positionSets = terms.map((term) => termPositions(text, term))
  const matched = positionSets.filter((positions) => positions.length > 0).length
  const coverage = matched / terms.length

  const titleMatched = terms.filter((term) => termPositions(title, term).length > 0).length
  const titleCoverage = titleMatched / terms.length

  let proximity = 0
  const span = minimumSpan(positionSets)
  if (span !== null) {
    if (span <= 80) proximity = 1
    else if (span <= 220) proximity = 0.9
    else if (span <= 650) proximity = 0.65
    else if (span <= 1800) proximity = 0.35
    else proximity = 0.1
  }

  const normalizedQuery = normalizeText(query)
  const exactPhrase = normalizedQuery.length >= 4 && positionsForPhrase(text, normalizedQuery).length > 0 ? 1 : 0
  const meaningfulPhrase = terms.join(" ")
  const orderedMeaningful =
    meaningfulPhrase.length >= 4 && positionsForPhrase(text, meaningfulPhrase).length > 0 ? 1 : 0
  const pairSignal = adjacentPairSignal(text, terms)

  const section = sectionRef(query)
  const sectionHits = sectionPositions(text, section)
  const statutes = statuteGroups(query)
  const statuteHits = statutes.map((group) => groupPositions(text, group))
  const statuteMatched = statuteHits.filter((positions) => positions.length > 0).length
  const statuteSignal = statutes.length > 0 ? statuteMatched / statutes.length : 0

  let statuteSectionSignal = 0
  if (section && sectionHits.length > 0 && statuteHits.some((positions) => positions.length > 0)) {
    const nearest = minimumSpan([
      sectionHits,
      statuteHits.flatMap((positions) => positions),
    ])
    if (nearest !== null && nearest <= 1500) statuteSectionSignal = 1
    else statuteSectionSignal = 0.82
  }

  const caseAnchor = casePhrase(query)
  const caseSignal = caseAnchor && positionsForPhrase(text, caseAnchor).length > 0 ? 1 : 0

  const anchor = Math.max(
    statuteSectionSignal,
    caseSignal,
    statuteSignal >= 1 ? 0.92 : statuteSignal,
    section && sectionHits.length > 0 ? 0.72 : 0,
  )

  const phrase = Math.max(exactPhrase, orderedMeaningful, pairSignal * 0.75)
  const score = Math.min(
    1,
    0.37 * coverage +
      0.17 * proximity +
      0.1 * titleCoverage +
      0.13 * phrase +
      0.23 * anchor,
  )

  // Hard tiers are deliberately narrow. They protect identifiers that semantic
  // similarity must never overrule, while ordinary natural-language queries
  // remain free to be ranked semantically.
  let hardTier = 0
  if (statuteSectionSignal >= 0.99) hardTier = 5
  else if (caseSignal === 1 || statuteSignal >= 0.99) hardTier = 4
  else if (exactPhrase === 1 || orderedMeaningful === 1) hardTier = 3
  else if (terms.length <= 4 && coverage === 1 && proximity >= 0.9) hardTier = 2

  return {
    score,
    hardTier,
    coverage,
    proximity,
    phrase,
    anchor,
  }
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
      {
        result,
        score: scores.length === 1 ? 1 : (result.score - min) / range,
      },
    ]),
  )
}

function escapedRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function highlightTerms(searchTerm: string): string[] {
  return searchTerm
    .split(/\s+/)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
}

function highlight(searchTerm: string, text: string, trim?: boolean) {
  const terms = highlightTerms(searchTerm)
  let words = text.split(/\s+/).filter(Boolean)
  const originalLength = words.length
  let startIndex = 0
  let endIndex = words.length - 1

  if (trim) {
    const hit = words.map((word) =>
      terms.some((term) => word.toLowerCase().includes(term.toLowerCase())),
    )
    let bestSum = 0
    let bestIndex = 0
    for (let i = 0; i < Math.max(words.length - contextWindowWords, 0); i++) {
      const sum = hit
        .slice(i, i + contextWindowWords)
        .reduce((total, value) => total + (value ? 1 : 0), 0)
      if (sum >= bestSum) {
        bestSum = sum
        bestIndex = i
      }
    }
    startIndex = Math.max(bestIndex - contextWindowWords, 0)
    endIndex = Math.min(startIndex + 2 * contextWindowWords, words.length - 1)
    words = words.slice(startIndex, endIndex + 1)
  }

  const rendered = words
    .map((word) => {
      for (const term of terms) {
        if (word.toLowerCase().includes(term.toLowerCase())) {
          return word.replace(
            new RegExp(escapedRegex(term), "gi"),
            `<span class="highlight">$&</span>`,
          )
        }
      }
      return word
    })
    .join(" ")

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

  const resolveUrl = (slug: FullSlug) =>
    new URL(resolveRelative(currentSlug, slug), location.toString())

  const warm = () => {
    if (warmStarted) return
    warmStarted = true
    void warmSemanticSearch().catch(() => {
      warmStarted = false
    })
  }

  // Load the model and pay the first ONNX inference cost before search is used
  // whenever the browser gives us even a short idle window.
  const idleTimer = window.setTimeout(warm, 120)
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
    const anchor = element.dataset.semanticAnchor ?? ""
    const contents = await fetchContent(slug)
    const highlighted = contents.flatMap((content) => [
      ...highlightHTML(currentSearchTerm, content as HTMLElement).children,
    ])

    const inner = document.createElement("div")
    inner.classList.add("preview-inner")
    inner.append(...highlighted)
    preview.replaceChildren(inner)

    if (anchor.startsWith("#")) {
      const target = inner.querySelector<HTMLElement>(
        `#${CSS.escape(decodeURIComponent(anchor.slice(1)))}`,
      )
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
    card.dataset.semanticAnchor = item.anchor ?? ""

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

  function displaySearching() {
    removeAllChildren(results)
    const status = document.createElement("div")
    status.className = "search-status"
    status.textContent = "Searching by meaning…"
    results.appendChild(status)
    if (preview) removeAllChildren(preview)
    currentHover = null
  }

  function lexicalResults(query: string): LexicalHit[] {
    return Object.entries(data)
      .map(([slug, details]) => ({
        slug: slug as FullSlug,
        evidence: lexicalEvidence(query, details),
      }))
      .filter((hit) => hit.evidence.score > 0)
      .sort(
        (a, b) =>
          b.evidence.hardTier - a.evidence.hardTier ||
          b.evidence.score - a.evidence.score,
      )
  }

  function formatItem(slug: FullSlug, query: string, semantic?: SemResult): DisplayItem {
    const details = data[slug]
    const tags = (details.tags ?? [])
      .slice(0, numTagResults)
      .map((tag) => `<li><p>#${tag}</p></li>`)

    let anchor = ""
    if (semantic) {
      try {
        anchor = new URL(semantic.url, window.location.origin).hash
      } catch {
        anchor = semantic.url.includes("#") ? `#${semantic.url.split("#")[1]}` : ""
      }
    }

    return {
      slug,
      title: highlight(query, details.title ?? ""),
      content: highlight(query, details.content ?? "", true),
      tags,
      anchor,
    }
  }

  async function runBasicSearch(
    query: string,
    myGeneration: number,
    lexical: LexicalHit[],
    anchoredInitially: boolean,
  ) {
    const started = performance.now()

    try {
      const semanticQuery = await createSemanticQuery(query)
      const semanticResults = await semanticSearch(semanticQuery, anchoredInitially ? 4 : 6, 2)
      if (myGeneration !== generation || searchBar.value.trim() !== query) return

      const semantic = semanticByDocument(semanticResults)
      const lexicalMap = new Map(lexical.map((hit) => [normalizedSlug(hit.slug), hit]))
      const slugByNormalized = new Map(
        Object.keys(data).map((slug) => [normalizedSlug(slug), slug as FullSlug]),
      )
      const candidates = new Set<string>([...lexicalMap.keys(), ...semantic.keys()])

      const ranked = [...candidates]
        .map((normalized) => {
          const slug = slugByNormalized.get(normalized)
          if (!slug) return null

          const evidence = lexicalMap.get(normalized)?.evidence ?? EMPTY_EVIDENCE
          const semanticInfo = semantic.get(normalized)
          const semanticScore = semanticInfo?.score ?? 0

          let score: number
          if (evidence.hardTier >= 4) {
            score = 0.9 * evidence.score + 0.1 * semanticScore
          } else if (evidence.hardTier >= 2) {
            score = 0.78 * evidence.score + 0.22 * semanticScore
          } else {
            score = 0.35 * evidence.score + 0.65 * semanticScore
          }

          return {
            slug,
            hardTier: evidence.hardTier,
            score,
            semantic: semanticInfo?.result,
          }
        })
        .filter(
          (
            item,
          ): item is {
            slug: FullSlug
            hardTier: number
            score: number
            semantic?: SemResult
          } => item !== null,
        )
        .sort((a, b) => b.hardTier - a.hardTier || b.score - a.score)
        .slice(0, numSearchResults)

      // Never replace a fast, citation/phrase-protected answer with a result
      // that arrives many seconds later. The completed inference still warms
      // the model/cache for subsequent searches.
      if (anchoredInitially && performance.now() - started > lateAnchoredRerenderMs) return

      await displayResults(ranked.map((item) => formatItem(item.slug, query, item.semantic)))
    } catch (error) {
      if (myGeneration !== generation || searchBar.value.trim() !== query) return
      console.warn("Semantic search unavailable; using lexical search only", error)
      await displayResults(
        lexical.slice(0, numSearchResults).map((hit) => formatItem(hit.slug, query)),
      )
    }
  }

  async function runTagSearch(rawQuery: string, myGeneration: number) {
    const body = rawQuery.slice(1).trim()
    const firstSpace = body.indexOf(" ")
    const tagQuery = (firstSpace >= 0 ? body.slice(0, firstSpace) : body).toLowerCase()
    const textQuery = firstSpace >= 0 ? body.slice(firstSpace + 1).trim() : ""

    const ranked = Object.entries(data)
      .map(([slug, details]) => {
        const matchingTags = (details.tags ?? []).filter((tag) =>
          tag.toLowerCase().includes(tagQuery),
        )
        if (matchingTags.length === 0) return null
        const score = textQuery ? lexicalEvidence(textQuery, details).score : 1
        return { slug: slug as FullSlug, score, matchingTags }
      })
      .filter(
        (
          item,
        ): item is { slug: FullSlug; score: number; matchingTags: string[] } => item !== null,
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, numSearchResults)

    if (myGeneration !== generation) return

    await displayResults(
      ranked.map(({ slug, matchingTags }) => ({
        slug,
        title: data[slug].title ?? "",
        content: textQuery ? highlight(textQuery, data[slug].content ?? "", true) : "",
        tags: matchingTags
          .slice(0, numTagResults)
          .map((tag) => `<li><p class="match-tag">#${tag}</p></li>`),
      })),
    )
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

    const lexical = lexicalResults(query)
    const anchored = (lexical[0]?.evidence.hardTier ?? 0) >= 2

    if (anchored) {
      // Citation/phrase queries get a deterministic answer immediately.
      void displayResults(
        lexical.slice(0, numSearchResults).map((hit) => formatItem(hit.slug, query)),
      )
    } else {
      // Natural-language queries wait for the semantic result instead of
      // flashing a low-confidence lexical guess that will move later.
      displaySearching()
    }

    timer = window.setTimeout(() => {
      void runBasicSearch(query, myGeneration, lexical, anchored)
    }, semanticDebounceMs)
  }

  async function shortcutHandler(keyEvent: KeyboardEvent) {
    if (
      keyEvent.key === "k" &&
      (keyEvent.ctrlKey || keyEvent.metaKey) &&
      !keyEvent.shiftKey
    ) {
      keyEvent.preventDefault()
      container.classList.contains("active") ? hideSearch() : showSearch("basic")
      return
    }

    if (
      keyEvent.shiftKey &&
      (keyEvent.ctrlKey || keyEvent.metaKey) &&
      keyEvent.key.toLowerCase() === "k"
    ) {
      keyEvent.preventDefault()
      if (container.classList.contains("active")) {
        hideSearch()
      } else {
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
