import { PageLayout, SharedLayout } from "./quartz/cfg"
import * as Component from "./quartz/components"

// components shared across all pages
export const sharedPageComponents: SharedLayout = {
  head: Component.Head(),
  header: [],
  afterBody: [],
  footer: Component.Footer({
    links: {
      GitHub: "https://github.com/jackyzha0/quartz",
      "Discord Community": "https://discord.gg/cRFFHYye7t",
    },
  }),
}

export const defaultContentPageLayout: PageLayout = {
  beforeBody: [
    Component.Breadcrumbs(),
    Component.ArticleTitle(),
    Component.ContentMeta(),
    Component.TagList(),
  ],
  left: [
    Component.PageTitle(),
    Component.MobileOnly(Component.Spacer()),
    Component.Search({
      enableKeywordUI: false,   // <-- turn OFF legacy script
      enablePreview: true,      // keep the preview container if you want it
      maxResults: 20,
      minChars: 2,
    }),
    Component.Darkmode(),
    Component.Explorer(),
  ],
  right: [Component.Graph(), Component.TableOfContents(), Component.Backlinks()],
}

export const defaultListPageLayout: PageLayout = {
  beforeBody: [Component.Breadcrumbs(), Component.ArticleTitle(), Component.ContentMeta()],
  left: [
    Component.PageTitle(),
    Component.MobileOnly(Component.Spacer()),
    Component.Search({
      enableKeywordUI: false,   // <-- here too
      enablePreview: true,
      maxResults: 20,
      minChars: 2,
    }),
    Component.Darkmode(),
    Component.Explorer(),
  ],
  right: [],
}
