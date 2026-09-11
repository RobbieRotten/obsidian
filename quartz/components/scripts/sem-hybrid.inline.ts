import { rerankCandidates, semanticSearch } from "../semantic/searchClient"

const semanticClass = "semantic-result"

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
  let generation = 0

  const run = async () => {
    const query = input.value.trim()
    const myGeneration = ++generation

    const resultsContainer = document.querySelector<HTMLElement>("#results-container")
    if (!resultsContainer) return

    resultsContainer.querySelectorAll(`.${semanticClass}`).forEach((el) => el.remove())

    if (query.length < 2 || query.startsWith("#")) return

    try {
      const nativeCards = Array.from(
        resultsContainer.querySelectorAll<HTMLAnchorElement>("a.result-card:not(.no-match)"),
      )

      if (nativeCards.length > 1) {
        const ranked = await rerankCandidates(
          query,
          nativeCards.map((card) => ({ url: card.href, title: card.querySelector("h3")?.textContent ?? "" })),
        )

        if (myGeneration !== generation || input.value.trim() !== query) return

        const byUrl = new Map(nativeCards.map((card) => [card.href, card]))
        for (const result of ranked) {
          const card = byUrl.get(result.url)
          if (card) resultsContainer.appendChild(card)
        }
      }

      const semantic = await semanticSearch(query)
      if (myGeneration !== generation || input.value.trim() !== query) return

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

  const onInput = () => {
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(run, 220)
  }

  input.addEventListener("input", onInput)
  window.addCleanup(() => {
    input.removeEventListener("input", onInput)
    if (timer) window.clearTimeout(timer)
  })
})
