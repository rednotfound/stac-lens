// The HTML shell around a documentation page: head metadata, the site's
// header and footer, and a stylesheet built on the app's own design
// tokens (read from src/design/tokens.css at build time, so the pages and
// the app share one palette and one dark mode). Plain string templates —
// these pages are documents, and a template is the whole of what they
// need.

import { ECOSYSTEM_LINKS, LICENSE_URL, REPO_URL, SITE_NAME, SITE_PAGES } from '../../src/data/projectLinks'
import { absolute, escapeHtml, type PageSpec, type SiteConfig } from './render'

/** The `:root` token blocks of tokens.css — the light palette and the dark
 *  override — without the app-only rules (spinner, scrollbars, Leaflet). */
export function tokenBlocks(tokensCss: string): string {
  const blocks: string[] = []
  const light = tokensCss.match(/:root\s*\{[^}]*\}/)
  if (light) blocks.push(light[0])
  const dark = tokensCss.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{[^}]*\}\s*\}/)
  if (dark) blocks.push(dark[0])
  return blocks.join('\n')
}

const PAGE_CSS = `
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--color-bg); color: var(--color-text); font-family: var(--font-sans); line-height: 1.55; font-size: 16px; }
a { color: var(--color-brand); text-decoration: none; border-bottom: 1px solid var(--color-border); }
a:hover { border-bottom-color: currentColor; }
/* Catalog root URLs are long and unbreakable; let them wrap anywhere rather than widen a phone page. */
a, code { overflow-wrap: anywhere; }
.site-header { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; padding: 12px 16px; border-bottom: 1px solid var(--color-border); background: var(--color-surface); }
.brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; color: var(--color-text); border: none; font-size: 15px; }
.brand img { display: block; width: 26px; height: 26px; }
.site-nav { display: flex; gap: 14px; flex-wrap: wrap; font-size: 14px; margin-left: auto; }
.site-nav a { color: var(--color-text-muted); border: none; padding: 2px 0; }
.site-nav a[aria-current="page"] { color: var(--color-text); border-bottom: 2px solid var(--color-brand); }
main { max-width: 780px; margin: 0 auto; padding: 24px 16px 48px; }
.lang-switch { font-size: 13px; color: var(--color-text-muted); margin: 0 0 8px; }
h1 { font-size: 30px; line-height: 1.2; margin: 8px 0 16px; letter-spacing: -0.01em; }
h2 { font-size: 21px; margin: 40px 0 12px; padding-top: 8px; border-top: 1px solid var(--color-border); }
h3 { font-size: 17px; margin: 28px 0 8px; }
h2 .anchor, h3 .anchor, h1 .anchor { border: none; }
p, ul, ol { margin: 0 0 14px; }
li { margin: 4px 0; }
code { font-family: var(--font-mono); font-size: 0.88em; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 1px 4px; }
pre { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 12px 14px; overflow-x: auto; font-size: 13px; line-height: 1.5; }
pre code { border: none; padding: 0; background: none; font-size: inherit; }
blockquote { margin: 0 0 14px; padding: 4px 14px; border-left: 3px solid var(--color-brand); color: var(--color-text-muted); }
.table-wrap { overflow-x: auto; margin: 0 0 18px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; vertical-align: top; padding: 7px 10px; border-bottom: 1px solid var(--color-border); }
th { color: var(--color-text-muted); font-weight: 600; background: var(--color-surface); white-space: nowrap; }
td[id] { font-family: var(--font-mono); white-space: nowrap; }
td[id]:target, tr:has(td[id]:target) td { background: var(--color-selection-bg); }
hr { border: none; border-top: 1px solid var(--color-border); margin: 28px 0; }
img { max-width: 100%; height: auto; }
.site-footer { border-top: 1px solid var(--color-border); padding: 28px 16px 40px; font-size: 12.5px; color: var(--color-text-muted); text-align: center; }
.site-footer p { margin: 0 0 8px; }
.site-footer a { color: inherit; }
.site-footer .eco { font-size: 11.5px; color: var(--color-text-faint); }
.site-footer .eco span { font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase; font-size: 10px; margin-right: 4px; }
@media (max-width: 720px) {
  h1 { font-size: 26px; }
  .site-nav { margin-left: 0; }
}
`

const LANG_NAMES: Record<string, string> = { en: 'English', zh: '中文' }

export interface ShellInput {
  page: PageSpec
  bodyHtml: string
  config: SiteConfig
  tokensCss: string
  jsonLd: string
  /** Path of the Markdown copy under the base: `about.md`. */
  markdownPath: string
}

export function shell({ page, bodyHtml, config, tokensCss, jsonLd, markdownPath }: ShellInput): string {
  const { base } = config
  const canonical = absolute(config, page.path)
  const title = `${page.title} · ${SITE_NAME}`
  const ogImage = absolute(config, 'og-image.png')
  const head: string[] = [
    `<meta charset="UTF-8" />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1.0" />`,
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(page.description)}" />`,
  ]
  if (canonical) head.push(`<link rel="canonical" href="${escapeHtml(canonical)}" />`)
  const alternates = page.alternates ?? []
  // hreflang must be fully qualified (Google's rule; Lighthouse fails a
  // relative one), so the pairs exist only when the site URL is known.
  // The visible language switch below does not depend on it.
  if (alternates.length && config.siteUrl) {
    const all = [{ lang: page.lang, path: page.path }, ...alternates]
    for (const a of all) {
      const href = escapeHtml(absolute(config, a.path)!)
      head.push(`<link rel="alternate" hreflang="${a.lang === 'zh' ? 'zh-Hans' : a.lang}" href="${href}" />`)
    }
    const en = all.find((a) => a.lang === 'en') ?? all[0]
    head.push(`<link rel="alternate" hreflang="x-default" href="${escapeHtml(absolute(config, en.path)!)}" />`)
  }
  head.push(
    `<link rel="alternate" type="text/markdown" href="${base}${markdownPath}" title="${escapeHtml(page.title)} (Markdown)" />`,
  )
  head.push(
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
    `<meta property="og:locale" content="${page.lang === 'zh' ? 'zh_CN' : 'en_US'}" />`,
  )
  if (canonical) head.push(`<meta property="og:url" content="${escapeHtml(canonical)}" />`)
  if (ogImage) {
    head.push(
      `<meta property="og:image" content="${escapeHtml(ogImage)}" />`,
      `<meta property="og:image:width" content="1200" />`,
      `<meta property="og:image:height" content="630" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<meta name="twitter:image" content="${escapeHtml(ogImage)}" />`,
    )
  } else {
    head.push(`<meta name="twitter:card" content="summary" />`)
  }
  head.push(
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(page.description)}" />`,
    `<link rel="icon" type="image/svg+xml" href="${base}favicon.svg" />`,
    `<link rel="icon" type="image/png" sizes="32x32" href="${base}favicon-32.png" />`,
    `<link rel="apple-touch-icon" sizes="180x180" href="${base}apple-touch-icon.png" />`,
    `<meta name="theme-color" content="#0EB4AE" />`,
    `<script type="application/ld+json">${jsonLd.replace(/</g, '\\u003c')}</script>`,
    `<style>${tokenBlocks(tokensCss)}${PAGE_CSS}</style>`,
  )

  const nav = SITE_PAGES.map((p) => {
    const current = page.path === p.path || (page.lang !== 'en' && page.path.endsWith(p.path))
    return `<a href="${base}${p.path}"${current ? ' aria-current="page"' : ''} title="${escapeHtml(p.title)}">${p.label}</a>`
  })
  nav.push(`<a href="${REPO_URL}" rel="noreferrer">GitHub</a>`)

  const langSwitch = alternates.length
    ? `<p class="lang-switch">${page.lang === 'zh' ? '其他语言：' : 'Also in: '}${alternates
        .map(
          (a) => `<a href="${base}${a.path}" hreflang="${a.lang}" lang="${a.lang}">${LANG_NAMES[a.lang] ?? a.lang}</a>`,
        )
        .join(' · ')}</p>`
    : ''

  const eco = ECOSYSTEM_LINKS.map(
    (l) => `<a href="${escapeHtml(l.href)}" rel="noreferrer" title="${escapeHtml(l.title)}">${escapeHtml(l.label)}</a>`,
  ).join(' · ')

  return `<!doctype html>
<html lang="${page.lang === 'zh' ? 'zh-Hans' : 'en'}">
  <head>
    ${head.join('\n    ')}
  </head>
  <body>
    <header class="site-header">
      <a class="brand" href="${base}"><img src="${base}favicon.svg" alt="" width="26" height="26" />${SITE_NAME}</a>
      <nav class="site-nav" aria-label="Site">${nav.join('\n        ')}</nav>
    </header>
    <main>
      ${langSwitch}
      <article>
${bodyHtml}
      </article>
    </main>
    <footer class="site-footer">
      <p>${SITE_NAME} v${escapeHtml(config.version)} · <a href="${LICENSE_URL}" rel="noreferrer">Apache-2.0 license</a> · <a href="${REPO_URL}" rel="noreferrer">Source on GitHub</a> · <a href="${base}${markdownPath}">This page as Markdown</a> · <a href="${base}llms.txt">llms.txt</a></p>
      <p class="eco"><span>STAC ecosystem</span> ${eco}</p>
    </footer>
  </body>
</html>
`
}
