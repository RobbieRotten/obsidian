import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/search.scss"
// @ts-ignore inline scripts are bundled to strings by Quartz
import script from "./scripts/hybrid-search-v5.inline"
import { classNames } from "../util/lang"
import { i18n } from "../i18n"

export interface SearchOptions {
  enablePreview: boolean
}

const defaultOptions: SearchOptions = {
  enablePreview: false,
}

// Search results already know the matched chunk and render the useful passage in
// .search-snippet. Convert that visible passage into a native Text Fragment when
// a result is opened so the browser scrolls to and highlights the actual match,
// rather than merely opening the correct note. The existing H2/H3 hash is kept
// before the text directive as a graceful section-level fallback.
const passageJumpScript = String.raw`
(() => {
  const stateKey = "__quartzPassageJumpInstalled"
  if (window[stateKey]) return
  window[stateKey] = true

  const compact = (value) => (value || "").replace(/\s+/g, " ").trim()

  const targetFromSnippet = (card) => {
    const badge = compact(card.querySelector(".search-match-badge")?.textContent)
    if (badge === "Tag match") return ""

    const snippet = card.querySelector(".search-snippet")
    if (!snippet) return ""
    const text = compact(snippet.textContent)
    if (!text) return ""

    const highlighted = [...snippet.querySelectorAll(".highlight")]
      .map((node) => compact(node.textContent))
      .filter(Boolean)

    // Prefer a section/citation token when one was matched; otherwise use the
    // longest highlighted query term (usually the most discriminating term).
    const needle =
      highlighted.find((value) => /^\d+[a-z]?(?:\([0-9a-z]+\))?$/i.test(value)) ||
      [...highlighted].sort((a, b) => b.length - a.length)[0] ||
      ""

    const words = [...text.matchAll(/\S+/g)]
    if (words.length === 0) return ""

    if (!needle) {
      return words.slice(0, Math.min(12, words.length)).map((match) => match[0]).join(" ")
    }

    const at = text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase())
    if (at < 0) {
      return words.slice(0, Math.min(12, words.length)).map((match) => match[0]).join(" ")
    }

    let hit = words.findIndex((match) => {
      const start = match.index ?? 0
      return start <= at && at < start + match[0].length
    })
    if (hit < 0) hit = 0

    const start = Math.max(0, hit - 4)
    const end = Math.min(words.length, hit + 9)
    return words.slice(start, end).map((match) => match[0]).join(" ")
  }

  const passageHref = (card) => {
    if (card.dataset.passageHref === "1") return card.href

    const target = targetFromSnippet(card)
    if (!target) return card.href

    try {
      const url = new URL(card.href, window.location.href)
      const existingAnchor = url.hash
        .replace(/^#/, "")
        .split(":~:text=")[0]
      url.hash = existingAnchor + ":~:text=" + encodeURIComponent(target)
      card.href = url.toString()
      card.dataset.passageHref = "1"
      card.title = "Open and highlight this matched passage"
      return card.href
    } catch {
      return card.href
    }
  }

  const resultCard = (target) =>
    target instanceof Element ? target.closest("a.search-result-detailed") : null

  // Rewrite before a click so Ctrl/Cmd-click and context-menu/new-tab actions
  // receive the passage URL too.
  document.addEventListener(
    "pointerover",
    (event) => {
      const card = resultCard(event.target)
      if (card) passageHref(card)
    },
    true,
  )
  document.addEventListener(
    "focusin",
    (event) => {
      const card = resultCard(event.target)
      if (card) passageHref(card)
    },
    true,
  )
  document.addEventListener(
    "click",
    (event) => {
      const card = resultCard(event.target)
      if (!card) return
      const href = passageHref(card)
      if (
        event.button !== 0 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return
      }

      // Force a real navigation for normal clicks. Quartz's SPA navigation does
      // not invoke the browser's native Text Fragment highlighter reliably.
      event.preventDefault()
      window.location.assign(href)
    },
    true,
  )
})()
`

export default ((userOpts?: Partial<SearchOptions>) => {
  const opts = { ...defaultOptions, ...userOpts }

  const Search: QuartzComponent = ({ displayClass, cfg }: QuartzComponentProps) => {
    return (
      <div class={classNames(displayClass, "search")} data-search-component="hybrid-v5">
        <style data-search-style="hybrid-v5" dangerouslySetInnerHTML={{ __html: style }} />
        <button class="search-button" id="search-button">
          <p>{i18n(cfg.locale).components.search.title}</p>
          <svg role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 19.9 19.7">
            <title>Search</title>
            <g class="search-path" fill="none">
              <path stroke-linecap="square" d="M18.5 18.3l-5.4-5.4" />
              <circle cx="8" cy="8" r="7" />
            </g>
          </svg>
        </button>
        <div id="search-container">
          <div id="search-space">
            <input
              autocomplete="off"
              id="search-bar"
              name="search"
              type="text"
              aria-label={i18n(cfg.locale).components.search.searchBarPlaceholder}
              placeholder={i18n(cfg.locale).components.search.searchBarPlaceholder}
            />
            <div id="search-layout" data-preview={opts.enablePreview} data-search-version="v5"></div>
          </div>
        </div>
        <script
          type="module"
          data-search-script="hybrid-v5"
          dangerouslySetInnerHTML={{ __html: script }}
        />
        <script
          data-search-passage-jump="v1"
          dangerouslySetInnerHTML={{ __html: passageJumpScript }}
        />
      </div>
    )
  }

  // Search assets are deliberately embedded in the rendered component instead
  // of relying on ComponentResources. The bundled semantic client contains
  // import.meta references from ONNX/Transformers, so it must execute as an ES
  // module (Quartz's own postscript.js is also emitted as type="module").
  return Search
}) satisfies QuartzComponentConstructor
