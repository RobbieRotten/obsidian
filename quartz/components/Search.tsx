// quartz/components/Search.tsx
/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useMemo, useRef, useState } from "preact/hooks"
import { semanticSearch, type SemResult } from "./semantic/searchClient"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/search.scss"
// @ts-ignore – legacy keyword search script
import script from "./scripts/search.inline"
import hybridScript from "./scripts/sem-hybrid.inline"
import { classNames } from "../util/lang"
import { i18n } from "../i18n"

export interface SearchOptions {
  /** keep Quartz's built-in keyword UI behaviors */
  enableKeywordUI?: boolean
  /** show/allocate built-in preview area container */
  enablePreview: boolean
  /** max semantic results to render */
  maxResults?: number
  /** min chars before firing a semantic query */
  minChars?: number
}

const defaultOptions: SearchOptions = {
  enableKeywordUI: true,
  enablePreview: true,
  maxResults: 20,
  minChars: 2,
}

export default ((userOpts?: Partial<SearchOptions>) => {
  const Search: QuartzComponent = ({ displayClass, cfg }: QuartzComponentProps) => {
    const opts = { ...defaultOptions, ...userOpts }
    const placeholder = i18n(cfg.locale).components.search.searchBarPlaceholder || "Search notes…"

    const [q, setQ] = useState("")
    const [sem, setSem] = useState<SemResult[] | null>(null)
    const [loading, setLoading] = useState(false)
    const abortRef = useRef<AbortController | null>(null)
    const tokenRef = useRef(0)

    // abort in-flight fetch when unmounting
    useEffect(() => () => abortRef.current?.abort(), [])

    // optional: precompute the list to avoid re-map churn
    const renderedList = useMemo(() => {
      if (!sem || sem.length === 0) return null
      const items = sem.slice(0, opts.maxResults!)
      return (
        <ul class="search-results" id="sem-results" role="listbox" aria-label="Semantic results">
          {items.map((r, i) => (
            <li
              key={r.url}
              class="search-hit"
              role="option"
              aria-posinset={i + 1}
              aria-setsize={items.length}
            >
              <a href={r.url} class="hit-link">
                <div class="hit-title">{r.title}</div>
                {!!r.where?.length && <div class="hit-where">{r.where.join(" › ")}</div>}
                {!!r.snippet && <div class="hit-snippet">{r.snippet}</div>}
                {typeof r.score === "number" && (
                  <div class="hit-score" title="semantic score">{r.score.toFixed(3)}</div>
                )}
              </a>
            </li>
          ))}
        </ul>
      )
    }, [sem, opts.maxResults])

    return (
      <div class={classNames(displayClass, "search")}>
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
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (sem?.[0]) window.location.assign(sem[0].url)
              }}
            >
              <input
                id="search-bar"
                type="search"
                placeholder={placeholder}
                value={q}
                onInput={async (e) => {
                  const v = e.currentTarget.value
                  setQ(v)

                  if (!v.trim() || v.trim().length < (opts.minChars ?? 0)) {
                    setSem(null)
                    setLoading(false)
                    abortRef.current?.abort()
                    return
                  }

                  setLoading(true)

                  // cancel previous
                  if (abortRef.current) abortRef.current.abort()
                  const ac = new AbortController()
                  abortRef.current = ac
                  const myToken = ++tokenRef.current

                  try {
                    const results = await semanticSearch(v)
                    if (myToken === tokenRef.current && !ac.signal.aborted) {
                      setSem(results)
                    }
                  } catch (err) {
                    if (myToken === tokenRef.current && !ac.signal.aborted) {
                      console.error("Search error:", err)
                      setSem([])
                    }
                  } finally {
                    if (myToken === tokenRef.current && !ac.signal.aborted) {
                      setLoading(false)
                    }
                  }
                }}
              />
            </form>

            <div id="search-layout" data-preview={opts.enablePreview}></div>

            {loading && <div class="search-status">Searching…</div>}
            {sem && sem.length === 0 && !loading && (
              <div class="search-status">No semantic matches.</div>
            )}
            {renderedList}
          </div>
        </div>
      </div>
    )
  }

  // Combine keyword search with semantic hybrid reranking
  if (userOpts?.enableKeywordUI === false) {
    ;(Search as any).afterDOMLoaded = undefined
  } else {
    ;(Search as any).afterDOMLoaded = () => {
      script?.()
      hybridScript?.()
    }
  }

  ;(Search as any).css = style

  return Search
}) satisfies QuartzComponentConstructor
