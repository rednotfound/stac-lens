// Pure rendering for the site's static pages: Markdown → HTML with the
// anchors and link rewrites the pages need, the catalogs page from the
// landing list's data, and the crawler files (sitemap, robots, llms.txt,
// JSON-LD). No file system here — `site.ts` reads the inputs and
// `vitePlugin.ts` writes the outputs — so every function is testable with
// a string in and a string out. See docs/DESIGN.md, "SEO and AI
// discoverability" for why these pages exist.

import { Marked, type Tokens } from 'marked'
import { KINDS, PUBLISHERS, REGIONS, TOPICS } from '../../src/data/catalogTags'
import { ECOSYSTEM_LINKS, ISSUES_URL, LICENSE_URL, REPO_URL, SITE_NAME, TAGLINE } from '../../src/data/projectLinks'

/** What every page needs to know about the deployment. `siteUrl` is the
 *  absolute origin (+ base) when the build was told it (`VITE_SITE_URL`);
 *  without it the pages still render, but nothing absolute — canonical,
 *  Open Graph URL, sitemap — is emitted, because guessing a fork's
 *  address would point search engines at the wrong site. */
export interface SiteConfig {
  /** Vite's `base`: `/` or `/sub-path/`; always starts and ends with `/`. */
  base: string
  /** Absolute site URL without a trailing slash, e.g. `https://staclens.com`. */
  siteUrl?: string
  version: string
  /** ISO date of the build, the fallback for `lastmod`. */
  buildDate: string
}

export interface PageSpec {
  /** Path under the base, ending in `/`: `about/`, `zh/about/`. */
  path: string
  lang: 'en' | 'zh'
  /** The `<title>` head: "About" → "About · STAC Lens". */
  title: string
  description: string
  /** Source Markdown (its first H1 becomes the page's h1). */
  markdown: string
  /** Translations of this page, for hreflang. */
  alternates?: { lang: string; path: string }[]
  /** Last modification of the source, ISO 8601. */
  lastmod: string
}

export interface CatalogRecord {
  title: string
  description: string
  href: string
  kind: keyof typeof KINDS
  topics: (keyof typeof TOPICS)[]
  regions: (keyof typeof REGIONS)[]
  publisher: keyof typeof PUBLISHERS
  addedOn: string
  verifiedOn?: string
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** GitHub-style heading ids: lower-case, punctuation dropped, spaces to
 *  hyphens — so a link copied from the Markdown on GitHub resolves here. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
}

/** Resolves a link as the pages need it: root-relative (`/deploy/`) →
 *  under the base; `*.md` files that are published as pages → their
 *  page; other repository files → GitHub; everything else unchanged. */
export function rewriteHref(href: string, base: string): string {
  if (href.startsWith('/') && !href.startsWith('//')) return base + href.slice(1)
  const doc = href.match(/^(?:\.\/)?(?:docs\/)?([A-Z-]+\.md)(#.*)?$/)
  if (doc) {
    const page = PUBLISHED_DOCS[doc[1]]
    if (page) return base + page + (doc[2] ?? '')
    return `${REPO_URL}/blob/main/docs/${doc[1]}${doc[2] ?? ''}`
  }
  return href
}

/** The same rewrite for a Markdown copy: `](/deploy/)` and `](CATALOGS.md)`
 *  become links that resolve from wherever the copy is read. Only inline
 *  links are touched; autolinks and code stay as written. */
export function rewriteMarkdownLinks(markdown: string, base: string): string {
  return markdown.replace(/\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (_m, href: string, title: string) => {
    return `](${rewriteHref(href, base)}${title})`
  })
}

/** Markdown files that are pages on this site, by file name. */
export const PUBLISHED_DOCS: Record<string, string> = {
  'ABOUT.md': 'about/',
  'ABOUT.zh.md': 'zh/about/',
  'HEALTH-RULES.md': 'health-rules/',
  'DEPLOY.md': 'deploy/',
}

/** A health-rule id as the rule list writes them: a letter block and two
 *  digits (`C-04`, `S-01`). Each becomes an anchor on its table row so a
 *  finding can be cited as `/health-rules/#C-04`. */
const RULE_ID = /^[A-Z]{1,3}-\d{2}$/

function makeMarked(base: string): Marked {
  const marked = new Marked({ gfm: true })
  marked.use({
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const text = this.parser.parseInline(tokens)
        const id = slugify(text)
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true"></a>${text}</h${depth}>\n`
      },
      link({ href, title, tokens }: Tokens.Link) {
        const text = this.parser.parseInline(tokens)
        const target = rewriteHref(href, base)
        const external = /^https?:\/\//.test(target)
        const attrs = [`href="${escapeHtml(target)}"`]
        if (title) attrs.push(`title="${escapeHtml(title)}"`)
        if (external) attrs.push('rel="noreferrer"')
        return `<a ${attrs.join(' ')}>${text}</a>`
      },
      tablecell(token: Tokens.TableCell) {
        const text = this.parser.parseInline(token.tokens)
        const tag = token.header ? 'th' : 'td'
        const align = token.align ? ` align="${token.align}"` : ''
        const id = !token.header && RULE_ID.test(text) ? ` id="${text}"` : ''
        return `<${tag}${align}${id}>${text}</${tag}>\n`
      },
      table(token: Tokens.Table) {
        // Wide rule tables scroll sideways inside a wrapper on a phone
        // instead of forcing the whole page wider than the viewport.
        let header = ''
        for (const cell of token.header) header += this.tablecell(cell)
        let body = ''
        for (const row of token.rows) {
          let line = ''
          for (const cell of row) line += this.tablecell(cell)
          body += `<tr>\n${line}</tr>\n`
        }
        return `<div class="table-wrap"><table>\n<thead>\n<tr>\n${header}</tr>\n</thead>\n<tbody>\n${body}</tbody>\n</table></div>\n`
      },
    },
  })
  return marked
}

/** Markdown → HTML body. Synchronous: no async extensions are used. */
export function renderMarkdown(markdown: string, base: string): string {
  return makeMarked(base).parse(markdown, { async: false }) as string
}

/** The Markdown's first `# ` line, for titles and llms.txt. */
export function firstHeading(markdown: string): string | undefined {
  return markdown.match(/^# (.+)$/m)?.[1]?.trim()
}

/** The Markdown from one `## Heading` (inclusive) up to the next `## `. */
export function sectionOf(markdown: string, heading: string): string {
  const re = new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm')
  const start = markdown.search(re)
  if (start < 0) return ''
  const rest = markdown.slice(start)
  const next = rest.slice(3).search(/^## /m)
  return next < 0 ? rest : rest.slice(0, next + 3)
}

// ---------------------------------------------------------------------------
// The catalogs page — one dense page over the landing list's data.

function labelList<T extends string>(ids: readonly T[], vocab: Readonly<Record<string, string>>): string {
  return ids.map((id) => vocab[id] ?? id).join(', ')
}

/** The catalogs page as Markdown: the same content the HTML page shows,
 *  written once so `/catalogs.md` and `/catalogs/` cannot drift. `tagsDoc`
 *  is the "Tags" section of docs/CATALOGS.md (the vocabulary with
 *  definitions). "Open in STAC Lens" links are written root-relative
 *  (`/#<href>`) and resolved by the same link rewrite as every other
 *  internal link — under the base in HTML, absolute in the Markdown copy. */
export function renderCatalogsMarkdown(
  catalogs: readonly CatalogRecord[],
  tagsDoc: string,
  lastVerified: string,
): string {
  const sorted = [...catalogs].sort((a, b) => a.title.localeCompare(b.title, 'en'))
  const apis = sorted.filter((c) => c.kind === 'api').length
  const lines: string[] = []
  lines.push(`# Public STAC catalogs and APIs`)
  lines.push('')
  lines.push(
    `${sorted.length} public STAC catalogs and STAC APIs — ${apis} APIs with Item Search and ${sorted.length - apis} static catalogs — that open in STAC Lens from its landing page. Every entry is a real, live, cross-origin-readable STAC root, checked by a script against the server itself (reachable, CORS, \`stac_version\`, declared kind, something to show within three link hops) and re-checked every week; the last full pass was ${lastVerified}. This is the list of catalogs the maintainers verified, not a directory of all STAC in the world — [STAC Index](https://stacindex.org/) is that, and most entries here were taken from it. Criteria, tags and the removal log: [docs/CATALOGS.md](CATALOGS.md).`,
  )
  lines.push('')
  lines.push(
    `Each entry links to the catalog's own root URL and to the same catalog opened in STAC Lens, where its structure, extents and health findings are drawn. Tags (topic, region, publisher) are an editorial vocabulary defined below.`,
  )
  lines.push('')
  lines.push('## The list')
  lines.push('')
  for (const c of sorted) {
    lines.push(`### ${c.title}`)
    lines.push('')
    lines.push(c.description)
    lines.push('')
    const meta = [
      KINDS[c.kind],
      labelList([c.publisher], PUBLISHERS),
      c.regions.length ? labelList(c.regions, REGIONS) : undefined,
      labelList(c.topics, TOPICS),
      c.verifiedOn ? `verified ${c.verifiedOn}` : undefined,
    ].filter(Boolean)
    lines.push(`- ${meta.join(' · ')}`)
    lines.push(`- Root: <${c.href}>`)
    lines.push(`- [Open in STAC Lens](/#${c.href})`)
    lines.push('')
  }
  if (tagsDoc.trim()) {
    lines.push(tagsDoc.trim())
    lines.push('')
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Crawler files.

export function absolute(config: SiteConfig, path: string): string | undefined {
  return config.siteUrl ? `${config.siteUrl}${config.base}${path}` : undefined
}

export function renderSitemap(pages: readonly PageSpec[], config: SiteConfig): string | undefined {
  if (!config.siteUrl) return undefined
  const entries = [
    { loc: absolute(config, '')!, lastmod: config.buildDate },
    ...pages.map((p) => ({ loc: absolute(config, p.path)!, lastmod: p.lastmod })),
  ]
  const body = entries
    .map(
      (e) => `  <url>\n    <loc>${escapeHtml(e.loc)}</loc>\n    <lastmod>${e.lastmod.slice(0, 10)}</lastmod>\n  </url>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
}

/** Everything is allowed; the only decision recorded here is where the
 *  sitemap is. AI crawlers are not listed by name because the default
 *  already admits them and a name list is one more thing to maintain
 *  (docs/DISCOVERABILITY.md). */
export function renderRobots(config: SiteConfig): string {
  const lines = ['User-agent: *', 'Allow: /']
  const sitemap = absolute(config, 'sitemap.xml')
  if (sitemap) lines.push('', `Sitemap: ${sitemap}`)
  return lines.join('\n') + '\n'
}

/** llms.txt as https://llmstxt.org specifies: H1, a blockquote summary, a
 *  paragraph, H2 sections of links with one-line notes, `## Optional` for
 *  what a short-context reader can skip. Links point at the Markdown
 *  copies of the pages, not the HTML. */
export function renderLlmsTxt(pages: readonly PageSpec[], config: SiteConfig): string {
  const url = (path: string) => absolute(config, path) ?? `${config.base}${path}`
  const md = (p: PageSpec) => url(p.path.replace(/\/$/, '.md'))
  const byPath = (path: string) => pages.find((p) => p.path === path)
  const about = byPath('about/')
  const rules = byPath('health-rules/')
  const catalogs = byPath('catalogs/')
  const deploy = byPath('deploy/')
  const zh = byPath('zh/about/')
  const lines = [
    `# ${SITE_NAME}`,
    '',
    `> ${TAGLINE} A free, open-source, browser-only viewer and health checker for STAC (SpatioTemporal Asset Catalog) catalogs and APIs: paste a catalog URL and see how the publisher organized it, what it covers in time and space, where its metadata contradicts itself or the specification, and what its API really does when asked.`,
    '',
    `STAC Lens runs at ${config.siteUrl ?? 'this site'} and has no backend: every request goes from the visitor's browser to the catalog being explored. It is not a replacement for STAC Browser (which reads a catalog faithfully, one object per page); it is a lens on a catalog's shape, health and distance from the specification. "Health" is a list of findings traceable to rules in the STAC specification, its best practices, stac-check and the STAC API specification — never a score, and never a rule this project invented. Source: ${REPO_URL} (Apache-2.0).`,
    '',
    '## Docs',
    '',
  ]
  if (about)
    lines.push(
      `- [About STAC Lens](${md(about)}): what it is, who it is for, how it differs from STAC Browser, principles, vocabulary`,
    )
  if (rules)
    lines.push(
      `- [Health rules](${md(rules)}): every check the app performs or could perform, with source, severity tier and status; rule ids such as C-04 are citable anchors`,
    )
  if (catalogs)
    lines.push(
      `- [Public STAC catalogs](${md(catalogs)}): the verified list of public STAC catalogs and APIs on the landing page, with tags`,
    )
  if (deploy) lines.push(`- [Deploying](${md(deploy)}): self-hosting on any static host, Docker, sub-paths`)
  lines.push('', '## Source', '')
  lines.push(`- [README](${REPO_URL}/blob/main/README.md): overview, STAC support matrix, getting started`)
  lines.push(
    `- [Design log](${REPO_URL}/blob/main/docs/DESIGN.md): research notes, decisions and post-mortems, including observed behavior of real STAC servers`,
  )
  lines.push(`- [Architecture](${REPO_URL}/blob/main/docs/ARCHITECTURE.md): the code as it is`)
  lines.push(`- [Issues](${ISSUES_URL}): catalogs that render oddly, disagreements about what health should mean`)
  if (zh) lines.push('', '## Optional', '', `- [关于 STAC Lens（中文）](${md(zh)}): the About page in Chinese`)
  return lines.join('\n') + '\n'
}

export function renderLlmsFull(pages: readonly PageSpec[], config: SiteConfig): string {
  const parts = pages.map((p) => {
    const url = absolute(config, p.path) ?? `${config.base}${p.path}`
    return `<!-- ${url} -->\n\n${p.markdown.trim()}\n`
  })
  return `<!-- ${SITE_NAME}: every page of the site as Markdown, in reading order. Generated at build time. -->\n\n${parts.join('\n---\n\n')}`
}

// ---------------------------------------------------------------------------
// Structured data.

const KEYWORDS = [
  'STAC',
  'SpatioTemporal Asset Catalog',
  'STAC API',
  'STAC catalog viewer',
  'geospatial data catalog',
  'Earth observation',
  'remote sensing',
  'satellite imagery',
  'open data',
  'open geospatial data',
  'GIS',
  'metadata quality',
  'data visualization',
  '遥感',
  '对地观测',
  '开放数据',
  '地理信息',
  '时空资产目录',
]

export const SITE_DESCRIPTION =
  'STAC Lens is a free, open-source, browser-only viewer and health checker for STAC (SpatioTemporal Asset Catalog) catalogs and APIs. Paste a catalog URL to see its structure as a tree, its coverage in time and space, and where its metadata contradicts itself or the specification — for Earth observation, remote sensing and open geospatial data.'

function websiteNode(config: SiteConfig) {
  const url = absolute(config, '')
  return {
    '@type': 'WebSite',
    '@id': url ? `${url}#website` : undefined,
    name: SITE_NAME,
    url,
    description: SITE_DESCRIPTION,
    inLanguage: 'en',
  }
}

function softwareNode(config: SiteConfig) {
  const url = absolute(config, '')
  return {
    '@type': 'SoftwareApplication',
    '@id': url ? `${url}#app` : undefined,
    name: SITE_NAME,
    url,
    description: SITE_DESCRIPTION,
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'Geospatial data catalog viewer',
    operatingSystem: 'Any (web browser)',
    browserRequirements: 'Requires JavaScript',
    softwareVersion: config.version,
    license: LICENSE_URL,
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    keywords: KEYWORDS.join(', '),
    about: { '@type': 'Thing', name: 'SpatioTemporal Asset Catalog (STAC)', url: 'https://stacspec.org/' },
    image: absolute(config, 'og-image.png'),
    screenshot: absolute(config, 'og-image.png'),
  }
}

function sourceNode(config: SiteConfig) {
  return {
    '@type': 'SoftwareSourceCode',
    name: SITE_NAME,
    codeRepository: REPO_URL,
    programmingLanguage: 'TypeScript',
    runtimePlatform: 'Web browser',
    license: LICENSE_URL,
    version: config.version,
    keywords: KEYWORDS.join(', '),
    targetProduct: absolute(config, '') ? { '@id': `${absolute(config, '')}#app` } : undefined,
  }
}

function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** The home page's JSON-LD: the site, the application, its source. */
export function homeJsonLd(config: SiteConfig): string {
  return JSON.stringify(
    stripUndefined({
      '@context': 'https://schema.org',
      '@graph': [websiteNode(config), softwareNode(config), sourceNode(config)],
    }),
  )
}

/** A documentation page's JSON-LD: an article that is part of the site. */
export function pageJsonLd(page: PageSpec, config: SiteConfig): string {
  const url = absolute(config, page.path)
  const site = absolute(config, '')
  return JSON.stringify(
    stripUndefined({
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: firstHeading(page.markdown) ?? page.title,
      description: page.description,
      url,
      inLanguage: page.lang === 'zh' ? 'zh-Hans' : 'en',
      dateModified: page.lastmod,
      isPartOf: site ? { '@type': 'WebSite', '@id': `${site}#website`, name: SITE_NAME, url: site } : undefined,
      about: { '@type': 'SoftwareApplication', name: SITE_NAME, url: site },
      license: LICENSE_URL,
    }),
  )
}

export { ECOSYSTEM_LINKS, KEYWORDS }
