import { ContentDetails } from "../../plugins/emitters/contentIndex"
import { FullSlug, normalizeRelativeURLs, resolveRelative } from "../../util/path"
import { createSemanticQuery, semanticSearch, warmSemanticSearch, type SemResult } from "../semantic/searchClient"
import { registerEscapeHandler, removeAllChildren } from "./util"

type SearchType = "basic" | "tags"

type DisplayItem = {
  slug: FullSlug
  title: string
  content: string
  tags: string[]
  anchor?: string
}

const p = new DOMParser()
const fetchContentCache = new Map<FullSlug, Element[]>()
const contextWindowWords = 30
const numSearchResults = 8
const numTagResults = 5
const semanticDebounceMs = 450

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

function meaningfulTerms(query: string): string[] {
  const terms = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return [...new Set(terms.filter((term) => term.length > 1 && !stopWords.has(term)))]
}

function termVariants(term: string): string[] {
  const out = new Set([term])
  if (term.length > 4 && term.endsWith("s")) out.add(term.slice(0, -1))
  if (term.length > 5 && term.endsWith("ed")) {
    out.add(term.slice(0, -1))
    out.add(term.slice(0, -2))
  }
  if (term.length > 6 && term.endsWith("ing")) {
    out.add(term.slice(0, -3))
    out.add(term.slice(0, -3) + "e")
  }
  return [...out].filter((variant) => variant.length >= 4 || variant === term)
}

function allTermPositions(text: string, term: string): number[] {
  const positions = new Set<number>()
  for (const variant of termVariants(term)) {
    let from = 0
    while (from < text.length) {
      const position = text.indexOf(variant, from)
      if (position < 0) break
      positions.add(position)
      from = position + Math.max(1, variant.length)
      if (positions.size >= 24) break
    }
  }
  return [...positions].sort((a, b) => a - b)
}

function minimumTermSpan(positionSets: number[][]): number | null {
  if (positionSets.length === 0 || positionSets.some((positions) => positions.length === 0)) return null

  let best = Number.POSITIVE_INFINITY
  const pointers = new Array(positionSets.length).fill(0)
  while (true) {
    const current = positionSets.map((positions, index) => positions[pointers[index]])
    best = Math.min(best, Math.max(...current) - Math.min(...current))
    let minIndex = 0
    for (let i = 1; i < current.length; i++) if (current[i] < current[minIndex]) minIndex = i
    pointers[minIndex]++
    if (pointers[minIndex] >= positionSets[minIndex].length) break
  }
  return Number.isFinite(best) ? best : null
}

function lexicalDocumentScore(query: string, details: ContentDetails): number {
  const terms = meaningfulTerms(query)
  if (terms.length === 0) return 0

  const title = (details.title ?? "").toLowerCase()
  const body = (details.content ?? "").toLowerCase()
  const combined = `${title}\n${body}`

  const positionSets = terms.map((term) => allTermPositions(combined, term))
  const matched = positionSets.filter((positions) => positions.length > 0).length
  const titleMatched = terms.filter((term) => allTermPositions(title, term).length > 0).length
  const coverage = matched / terms.length
  const titleCoverage = titleMatched / terms.length

  let proximity = 0
  const span = minimumTermSpan(positionSets)
  if (span !== null) {
    if (span <= 350) proximity = 1
    else if (span <= 1200) proximity = 0.7
    else if (span <= 3500) proximity = 0.35
    else proximity = 0.1
  }

  const rawQuery = query.trim().toLowerCase()
  const phrase = rawQuery.length >= 4 && combined.includes(rawQuery) ? 1 : 0
  return Math.min(1, 0.62 * coverage + 0.13 * titleCoverage + 0.2 * proximity + 0.05 * phrase)
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
      { result, normalizedScore: scores.length === 1 ? 1 : (result.score - min) / range },
    ]),
  )
}

const tokenizeTerm = (term: string) => {
  const tokens = term.split(/\s+/).filter((token) => token.trim() !== "")
  const tokenLen = tokens.length
  if (tokenLen > 1) {
    for (let i = 1; i < tokenLen; i++) tokens.push(tokens.slice(0, i + 1).join(" "))
  }
  return tokens.sort((a, b) => b.length - a.length)
}

function highlight(searchTerm: string, text: string, trim?: boolean) {
  const tokenizedTerms = tokenizeTerm(searchTerm)
  let tokenizedText = text.split(/\s+/).filter((token) => token !== "")

  let startIndex = 0
  let endIndex = tokenizedText.length - 1
  if (trim) {
    const includesCheck = (token: string) =>
      tokenizedTerms.some((term) => token.toLowerCase().startsWith(term.toLowerCase()))
    const occurrenceIndices = tokenizedText.map(includesCheck)

    let bestSum = 0
    let bestIndex = 0
    for (let i = 0; i < Math.max(tokenizedText.length - contextWindowWords, 0); i++) {
      const window = occurrenceIndices.slice(i, i + contextWindowWords)
      const windowSum = window.reduce((total, current) => total + (current ? 1 : 0), 0)
      if (windowSum >= bestSum) {
        bestSum = windowSum
        bestIndex = i
      }
    }

    startIndex = Math.max(bestIndex - contextWindowWords, 0)
    endIndex = Math.min(startIndex + 2 * contextWindowWords, tokenizedText.length - 1)
    tokenizedText = tokenizedText.slice(startIndex, endIndex)
  }

  const slice = tokenizedText
    .map((token) => {
      for (const searchToken of tokenizedTerms) {
        if (token.toLowerCase().includes(searchToken.toLowerCase())) {
          const regex = new RegExp(searchToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")
          return token.replace(regex, `<span class="highlight">$&</span>`)
        }
      }
      return token
    })
    .join(" ")

  return `${startIndex === 0 ? "" : "..."}${slice}${
    endIndex === tokenizedText.length - 1 ? "" : "..."
  }`
}

function highlightHTML(searchTerm: string, element: HTMLElement) {
  const tokenizedTerms = tokenizeTerm(searchTerm)
  const html = p.parseFromString(element.innerHTML, "text/html")

  const createHighlightSpan = (text: string) => {
    const span = document.createElement("span")
    span.className = "highlight"
    span.textContent = text
    return span
  }

  const highlightTextNodes = (node: Node, term: string) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const nodeText = node.nodeValue ?? ""
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const regex = new RegExp(escaped, "gi")
      const matches = nodeText.match(regex)
      if (!matches || matches.length === 0) return

      const spanContainer = document.createElement("span")
      let lastIndex = 0
      for (const match of matches) {
        const matchIndex = nodeText.toLowerCase().indexOf(match.toLowerCase(), lastIndex)
        spanContainer.appendChild(document.createTextNode(nodeText.slice(lastIndex, matchIndex)))
        spanContainer.appendChild(createHighlightSpan(match))
        lastIndex = matchIndex + match.length
      }
      spanContainer.appendChild(document.createTextNode(nodeText.slice(lastIndex)))
      node.parentNode?.replaceChild(spanContainer, node)
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if ((node as HTMLElement).classList.contains("highlight")) return
      Array.from(node.childNodes).forEach((child) => highlightTextNodes(child, term))
    }
  }

  for (const term of tokenizedTerms) highlightTextNodes(html.body, term)
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

  const resolveUrl = (slug: FullSlug) => new URL(resolveRelative(currentSlug, slug), location.toString())

  const warm = () => {
    void warmSemanticSearch().catch(() => {
      // Lexical fallback remains available if the model cannot warm.
    })
  }

  const idleTimer = window.setTimeout(warm, 1200)
  searchButton.addEventListener("pointerenter", warm)
  window.addCleanup(() => {
    window.clearTimeout(idleTimer)
    searchButton.removeEventListener("pointerenter", warm)
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

    const previewInner = document.createElement("div")
    previewInner.classList.add("preview-inner")
    previewInner.append(...highlighted)
    preview.replaceChildren(previewInner)

    if (anchor.startsWith("#")) {
      const targetId = decodeURIComponent(anchor.slice(1))
      const target = previewInner.querySelector<HTMLElement>(`#${CSS.escape(targetId)}`)
      if (target) {
        target.scrollIntoView({ block: "start" })
        return
      }
    }

    const highlights = [...preview.querySelectorAll(".highlight")].sort(
      (a, b) => (b.textContent?.length ?? 0) - (a.textContent?.length ?? 0),
    )
    highlights[0]?.scrollIntoView({ block: "start" })
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

    const onClick = (clickEvent: MouseEvent) => {
      if (clickEvent.altKey || clickEvent.ctrlKey || clickEvent.metaKey || clickEvent.shiftKey) return
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
      await displayPreview(first)
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

  function lexicalResults(query: string): Array<{ slug: FullSlug; lexical: number }> {
    return Object.entries(data)
      .map(([slug, details]) => ({ slug: slug as FullSlug, lexical: lexicalDocumentScore(query, details) }))
      .filter((item) => item.lexical > 0)
      .sort((a, b) => b.lexical - a.lexical)
  }

  function formatItem(slug: FullSlug, query: string, semantic?: SemResult): DisplayItem {
    const details = data[slug]
    const tags = (details.tags ?? []).slice(0, numTagResults).map((tag) => `<li><p>#${tag}</p></li>`)
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

  async function runBasicSearch(query: string, myGeneration: number) {
    const lexical = lexicalResults(query)

    try {
      const semanticQuery = await createSemanticQuery(query)
      const semanticResults = await semanticSearch(semanticQuery, 14, 1)
      if (myGeneration !== generation || searchBar.value.trim() !== query) return

      const semantic = semanticByDocument(semanticResults)
      const lexicalMap = new Map(lexical.map((item) => [normalizedSlug(item.slug), item.lexical]))
      const candidates = new Set<string>([
        ...lexical.map((item) => normalizedSlug(item.slug)),
        ...semantic.keys(),
      ])

      const slugByNormalized = new Map(
        Object.keys(data).map((slug) => [normalizedSlug(slug), slug as FullSlug]),
      )

      const ranked = [...candidates]
        .map((normalized) => {
          const slug = slugByNormalized.get(normalized)
          if (!slug) return null
          const lexicalScore = lexicalMap.get(normalized) ?? 0
          const semanticInfo = semantic.get(normalized)
          const semanticScore = semanticInfo?.normalizedScore ?? 0
          let score = 0.72 * semanticScore + 0.28 * lexicalScore
          if (!semanticInfo) score = 0.3 * lexicalScore
          if (lexicalScore >= 0.98) score += 0.12
          else if (lexicalScore >= 0.72) score += 0.05
          return { slug, score, semantic: semanticInfo?.result }
        })
        .filter((item): item is { slug: FullSlug; score: number; semantic?: SemResult } => item !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, numSearchResults)

      await displayResults(ranked.map((item) => formatItem(item.slug, query, item.semantic)))
    } catch (error) {
      if (myGeneration !== generation || searchBar.value.trim() !== query) return
      console.warn("Semantic search unavailable; using lexical search only", error)
      await displayResults(lexical.slice(0, numSearchResults).map((item) => formatItem(item.slug, query)))
    }
  }

  async function runTagSearch(rawQuery: string, myGeneration: number) {
    const body = rawQuery.slice(1).trim()
    const firstSpace = body.indexOf(" ")
    const tagQuery = (firstSpace >= 0 ? body.slice(0, firstSpace) : body).toLowerCase()
    const textQuery = firstSpace >= 0 ? body.slice(firstSpace + 1).trim() : ""

    const ranked = Object.entries(data)
      .map(([slug, details]) => {
        const tags = details.tags ?? []
        const matchingTags = tags.filter((tag) => tag.toLowerCase().includes(tagQuery))
        if (matchingTags.length === 0) return null
        const exact = matchingTags.some((tag) => tag.toLowerCase() === tagQuery) ? 1 : 0
        const lexical = textQuery ? lexicalDocumentScore(textQuery, details) : 1
        return { slug: slug as FullSlug, score: 0.7 * lexical + 0.3 * exact, matchingTags }
      })
      .filter((item): item is { slug: FullSlug; score: number; matchingTags: string[] } => item !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, numSearchResults)

    if (myGeneration !== generation) return
    const items = ranked.map(({ slug, matchingTags }) => {
      const details = data[slug]
      return {
        slug,
        title: details.title ?? "",
        content: textQuery ? highlight(textQuery, details.content ?? "", true) : "",
        tags: matchingTags.slice(0, numTagResults).map((tag) => `<li><p class="match-tag">#${tag}</p></li>`),
      } satisfies DisplayItem
    })
    await displayResults(items)
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
    }, semanticDebounceMs)
  }

  async function shortcutHandler(keyEvent: KeyboardEvent) {
    if (keyEvent.key === "k" && (keyEvent.ctrlKey || keyEvent.metaKey) && !keyEvent.shiftKey) {
      keyEvent.preventDefault()
      container.classList.contains("active") ? hideSearch() : showSearch("basic")
      return
    }
    if (keyEvent.shiftKey && (keyEvent.ctrlKey || keyEvent.metaKey) && keyEvent.key.toLowerCase() === "k") {
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
