// quartz/components/scripts/sem-hybrid.inline.ts
// Reorders Quartz keyword results using semantic centroids.

import { rerankByCentroid } from "../semantic/searchClient"

export default function attachSemanticHybrid() {
  const input =
    document.querySelector<HTMLInputElement>("#search-bar") ||
    document.querySelector<HTMLInputElement>("input[type='search']")

  // Quartz renders results inside #results-container or similar
  const resultsContainer =
    document.querySelector<HTMLElement>("#results-container") ||
    document.querySelector<HTMLElement>("#search-container")

  if (!input || !resultsContainer) {
    console.warn("Semantic hybrid: could not find search input or results container")
    return
  }

  let timer: number | undefined

  const collectCandidates = () => {
    // Quartz uses <a class="result-card" href="...">...</a>
    const links = Array.from(
      resultsContainer.querySelectorAll<HTMLAnchorElement>("a.result-card"),
    )
    return links.map(a => ({
      url: a.href,
      title:
        a.querySelector("h3, h2, .title")?.textContent?.trim() ??
        a.textContent?.trim() ??
        "",
      element: a, // Keep reference to the element for reordering
    }))
  }

  const applyOrder = async () => {
    const q = input.value.trim()
    if (q.length < 2) return
    
    const candidates = collectCandidates()
    if (!candidates.length) return

    try {
      const ranked = await rerankByCentroid(q, candidates)

      // Reorder DOM to match ranked URLs
      const parent =
        resultsContainer.querySelector("div.results-container, ul, div") || resultsContainer

      // Build a map from URL -> node
      const nodeByUrl = new Map<string, HTMLElement>()
      for (const cand of candidates) {
        const node = cand.element.closest("li, div, a.result-card") as HTMLElement || cand.element
        nodeByUrl.set(cand.url, node)
      }

      const frag = document.createDocumentFragment()
      for (const r of ranked) {
        const node = nodeByUrl.get(r.url)
        if (node && node.parentNode) {
          frag.appendChild(node)
        }
      }

      // Only replace if we actually found nodes
      if (frag.childNodes.length) {
        parent.innerHTML = ""
        parent.appendChild(frag)
      }
    } catch (err) {
      console.error("Semantic reranking error:", err)
    }
  }

  const debounced = () => {
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(applyOrder, 150)
  }

  // Rerank when the user types
  input.addEventListener("input", debounced)

  // Rerank whenever Quartz redraws the results list
  const mo = new MutationObserver(() => {
    debounced()
  })
  mo.observe(resultsContainer, { childList: true, subtree: true })
}
