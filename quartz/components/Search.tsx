import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/search.scss"
// @ts-ignore inline scripts are bundled to strings by Quartz
import script from "./scripts/hybrid-search-v4.inline"
import { classNames } from "../util/lang"
import { i18n } from "../i18n"

export interface SearchOptions {
  enablePreview: boolean
}

const defaultOptions: SearchOptions = {
  enablePreview: true,
}

export default ((userOpts?: Partial<SearchOptions>) => {
  const opts = { ...defaultOptions, ...userOpts }

  const Search: QuartzComponent = ({ displayClass, cfg }: QuartzComponentProps) => {
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
            <input
              autocomplete="off"
              id="search-bar"
              name="search"
              type="text"
              aria-label={i18n(cfg.locale).components.search.searchBarPlaceholder}
              placeholder={i18n(cfg.locale).components.search.searchBarPlaceholder}
            />
            <div id="search-layout" data-preview={opts.enablePreview}></div>
          </div>
        </div>
      </div>
    )
  }

  Search.afterDOMLoaded = script
  Search.css = style
  return Search
}) satisfies QuartzComponentConstructor
