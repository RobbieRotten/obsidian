import { createSemanticQuery, rerankCandidates, semanticSearch } from "../semantic/searchClient"

const semanticClass = "semantic-result"
const semanticDebounceMs = 700

function normalizePage(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin)
    return decodeURIComponent(parsed.pathname).replace(/\/$/, "") || "/"
  } catch {
    return url.split("#")[0]
  }
}

function semanticCard(result: Awaited<ReturnType<typeof semanticSearch>>[number]): HTMLAnchorElement {
  const card = document.createElement("a")
  card.classList.add("result-card", semanticClass)
  card.href = result.url
  card.id = decodeURIComponent(result.url.split("#")[0]).replace(/^\//, "")

  const title = document.createElement("h3")
  title.textContent = result.title

  const snippet = document.createElement("p")
  snippet.textContent = result.snippet

  const meta = document.createElement("p")
  meta.className = "semantic-match-label"
  meta.textContent = result.where.length > 0 ? `Related · ${result.where.join(" › ")}` : "Related by meaning"

  card.append(title, meta, snippet)
  card.addEventListener("click", () => document.getElementById("search-container")?.classList.remove("active"))
  return card
}

document.addEventListener("nav", () => {
  const input = document.querySelector<HTMLInputElement>("#search-bar")
  if (!input) return

  let timer: number | undefined
  let inputVersion = 0
  let running = false
  let rerunRequested = false

  const runQuery = async (query: string, version: number) => {
    const resultsContainer = document.querySelector<HTMLElement>("#results-container")
    if (!resultsContainer) return

    resultsContainer.querySelectorAll(`.${semanticClass}`).forEach((el) => el.remove())
    if (query.length < 2 || query.startsWith("#")) return

    try {
      const nativeCards = Array.from(
        resultsContainer.querySelectorAll<HTMLAnchorElement>("a.result-card:not(.no-match)"),
      )
      const candidates = nativeCards.map((card) => ({
        url: card.href,
        title: card.querySelector("h3")?.textContent ?? "",
      }))

      // Embed once, then reuse the vector for native reranking and semantic discovery.
      const semanticQuery = await createSemanticQuery(query)
      if (version !== inputVersion || input.value.trim() !== query) return

      const [ranked, semantic] = await Promise.all([
        nativeCards.length > 1 ? rerankCandidates(semanticQuery, candidates) : Promise.resolve([]),
        semanticSearch(semanticQuery),
      ])

      if (version !== inputVersion || input.value.trim() !== query) return

      if (ranked.length > 0) {
        const byUrl = new Map(nativeCards.map((card) => [card.href, card]))
        for (const result of ranked) {
          const card = byUrl.get(result.url)
          if (card) resultsContainer.appendChild(card)
        }
      }

      const existingPages = new Set(
        Array.from(resultsContainer.querySelectorAll<HTMLAnchorElement>("a.result-card:not(.no-match)"))
          .map((card) => normalizePage(card.href)),
      )

      const discoveries = semantic.filter((result) => !existingPages.has(normalizePage(result.url))).slice(0, 4)
      if (discoveries.length === 0) return

      resultsContainer.querySelector("a.no-match")?.remove()
      for (const result of discoveries) resultsContainer.appendChild(semanticCard(result))
    } catch (error) {
      // Keyword search remains fully usable if model/index loading fails.
      console.warn("Semantic search unavailable; using keyword search only", error)
    }
  }

  const executeLatest = async () => {
    if (running) {
      rerunRequested = true
      return
    }

    running = true
    try {
      do {
        rerunRequested = false
        const query = input.value.trim()
        const version = inputVersion
        await runQuery(query, version)
      } while (rerunRequested)
    } finally {
      running = false
    }
  }

  const onInput = () => {
    inputVersion++
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      void executeLatest()
    }, semanticDebounceMs)
  }

  input.addEventListener("input", onInput)
  window.addCleanup(() => {
    input.removeEventListener("input", onInput)
    if (timer) window.clearTimeout(timer)
  })
})
