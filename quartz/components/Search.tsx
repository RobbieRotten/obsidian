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
      </div>
    )
  }

  // Search assets are deliberately embedded in the rendered component instead
  // of relying on ComponentResources. The bundled semantic client contains
  // import.meta references from ONNX/Transformers, so it must execute as an ES
  // module (Quartz's own postscript.js is also emitted as type="module").
  return Search
}) satisfies QuartzComponentConstructor