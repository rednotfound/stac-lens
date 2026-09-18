import { describe, expect, it } from 'vitest'
import {
  homeJsonLd,
  renderCatalogsMarkdown,
  renderLlmsTxt,
  renderMarkdown,
  renderRobots,
  renderSitemap,
  rewriteHref,
  rewriteMarkdownLinks,
  sectionOf,
  slugify,
  type CatalogRecord,
  type SiteConfig,
} from '../render'
import { buildOutputs, buildPages, type SiteInputs } from '../site'

const catalogs: CatalogRecord[] = [
  {
    title: 'Earth Search',
    description: 'Sentinel-2, Landsat and more.',
    href: 'https://earth-search.aws.element84.com/v1/',
    kind: 'api',
    topics: ['eo-imagery'],
    regions: ['global'],
    publisher: 'commercial',
    addedOn: '2026-09-01',
    verifiedOn: '2026-09-17',
  },
  {
    title: 'Capella Open Data',
    description: 'SAR imagery.',
    href: 'https://capella-open-data.s3.us-west-2.amazonaws.com/stac/catalog.json',
    kind: 'static',
    topics: ['eo-imagery', 'disaster'],
    regions: [],
    publisher: 'commercial',
    addedOn: '2026-09-01',
  },
]

const inputs: SiteInputs = {
  docs: {
    about: {
      markdown: '# About STAC Lens\n\nSee the [rules](/health-rules/) and [CATALOGS.md](CATALOGS.md).',
      lastmod: '2026-09-18T00:00:00Z',
    },
    aboutZh: { markdown: '# 关于 STAC Lens\n\n见[规则](/health-rules/)。', lastmod: '2026-09-18T00:00:00Z' },
    healthRules: {
      markdown:
        '# Rules\n\n## Collection\n\n| ID | Tier | Rule |\n|---|---|---|\n| C-04 | Invalid | first bbox is the union |\n| C-05 | Invalid | not two |\n',
      lastmod: '2026-09-17T00:00:00Z',
    },
    deploy: { markdown: '# Deploying\n\nAny static host.', lastmod: '2026-09-17T00:00:00Z' },
    catalogsDoc: {
      markdown:
        '# The list\n\nintro\n\n## Tags\n\n| Value | Meaning |\n|---|---|\n| `eo-imagery` | Imagery |\n\n## Adding an entry\n\nsteps',
      lastmod: '2026-09-17T00:00:00Z',
    },
  },
  catalogs,
  catalogsLastmod: '2026-09-16T00:00:00Z',
  tokensCss:
    ':root {\n  --color-bg: #fff;\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n    --color-bg: #000;\n  }\n}\nbody { x: y }',
}

const hosted: SiteConfig = {
  base: '/',
  siteUrl: 'https://staclens.com',
  version: '0.1.0',
  buildDate: '2026-09-18T12:00:00Z',
}
const anonymous: SiteConfig = { base: '/', version: '0.1.0', buildDate: '2026-09-18T12:00:00Z' }
const subPath: SiteConfig = { base: '/lens/', version: '0.1.0', buildDate: '2026-09-18T12:00:00Z' }

describe('markdown rendering', () => {
  it('gives headings GitHub-style ids and rule ids table anchors', () => {
    const html = renderMarkdown(inputs.docs.healthRules.markdown, '/')
    expect(html).toContain('<h2 id="collection">')
    expect(html).toContain('<td id="C-04">C-04</td>')
    expect(html).toContain('<td id="C-05">C-05</td>')
    expect(html).not.toContain('id="Invalid"')
    expect(html).toContain('<div class="table-wrap"><table>')
  })

  it('slugifies like GitHub', () => {
    expect(slugify('Catalog health — the rule list')).toBe('catalog-health-the-rule-list')
    expect(slugify('API — behavior (a real request)')).toBe('api-behavior-a-real-request')
    expect(slugify('关于 STAC Lens')).toBe('关于-stac-lens')
  })

  it('rewrites root-relative and repository links', () => {
    expect(rewriteHref('/deploy/', '/')).toBe('/deploy/')
    expect(rewriteHref('/deploy/', '/lens/')).toBe('/lens/deploy/')
    expect(rewriteHref('HEALTH-RULES.md#collection', '/')).toBe('/health-rules/#collection')
    expect(rewriteHref('CATALOGS.md', '/')).toBe('https://github.com/rednotfound/stac-lens/blob/main/docs/CATALOGS.md')
    expect(rewriteHref('https://stacspec.org/', '/lens/')).toBe('https://stacspec.org/')
    expect(rewriteHref('#anchor', '/lens/')).toBe('#anchor')
  })

  it('rewrites links in the Markdown copies against an absolute base', () => {
    const md = rewriteMarkdownLinks(inputs.docs.about.markdown, 'https://staclens.com/')
    expect(md).toContain('(https://staclens.com/health-rules/)')
    expect(md).toContain('(https://github.com/rednotfound/stac-lens/blob/main/docs/CATALOGS.md)')
  })

  it('marks external links but not internal ones', () => {
    const html = renderMarkdown('[a](https://stacspec.org/) [b](/about/)', '/')
    expect(html).toContain('<a href="https://stacspec.org/" rel="noreferrer">a</a>')
    expect(html).toContain('<a href="/about/">b</a>')
  })

  it('extracts one section of a document', () => {
    const tags = sectionOf(inputs.docs.catalogsDoc.markdown, 'Tags')
    expect(tags.startsWith('## Tags')).toBe(true)
    expect(tags).toContain('eo-imagery')
    expect(tags).not.toContain('Adding an entry')
    expect(sectionOf('# x', 'Missing')).toBe('')
  })
})

describe('catalogs page', () => {
  it('lists every catalog with labels, its root and an Open link', () => {
    const md = renderCatalogsMarkdown(catalogs, '', '2026-09-17')
    expect(md).toContain('2 public STAC catalogs and STAC APIs — 1 APIs')
    expect(md).toContain('### Capella Open Data')
    expect(md).toContain('### Earth Search')
    expect(md.indexOf('Capella')).toBeLessThan(md.indexOf('### Earth Search'))
    expect(md).toContain('STAC API · Commercial · Global · Imagery · verified 2026-09-17')
    expect(md).toContain('Static catalog · Commercial · Imagery, Disasters & hazards')
    expect(md).toContain('[Open in STAC Lens](/#https://earth-search.aws.element84.com/v1/)')
    expect(md).toContain('- Root: <https://earth-search.aws.element84.com/v1/>')
  })
})

describe('crawler files', () => {
  it('writes a sitemap only when the site URL is known', () => {
    const pages = buildPages(inputs)
    const xml = renderSitemap(pages, hosted)!
    expect(xml.match(/<loc>/g)).toHaveLength(6)
    expect(xml).toContain('<loc>https://staclens.com/zh/about/</loc>')
    expect(xml).toContain('<lastmod>2026-09-17</lastmod>')
    expect(renderSitemap(buildPages(inputs), anonymous)).toBeUndefined()
  })

  it('robots allows everything and names the sitemap when it exists', () => {
    expect(renderRobots(hosted)).toBe('User-agent: *\nAllow: /\n\nSitemap: https://staclens.com/sitemap.xml\n')
    expect(renderRobots(anonymous)).toBe('User-agent: *\nAllow: /\n')
  })

  it('llms.txt follows the spec shape and links the Markdown copies', () => {
    const txt = renderLlmsTxt(buildPages(inputs), hosted)
    expect(txt.startsWith('# STAC Lens\n\n> ')).toBe(true)
    expect(txt).toContain('## Docs\n')
    expect(txt).toContain('](https://staclens.com/health-rules.md)')
    expect(txt).toContain('## Optional\n')
    expect(txt).toContain('](https://staclens.com/zh/about.md)')
  })

  it('home JSON-LD is valid JSON with the site, the app and its source', () => {
    const graph = JSON.parse(homeJsonLd(hosted))['@graph'] as { '@type': string; url?: string }[]
    expect(graph.map((n) => n['@type'])).toEqual(['WebSite', 'SoftwareApplication', 'SoftwareSourceCode'])
    expect(graph[1].url).toBe('https://staclens.com/')
    const anon = JSON.parse(homeJsonLd(anonymous))['@graph'] as { url?: string }[]
    expect(anon[0].url).toBeUndefined()
  })
})

describe('buildOutputs', () => {
  it('emits a page, a Markdown copy and the crawler files, with head metadata', () => {
    const out = buildOutputs(inputs, hosted)
    expect([...out.keys()].sort()).toEqual(
      [
        'about/index.html',
        'about.md',
        'catalogs/index.html',
        'catalogs.md',
        'deploy/index.html',
        'deploy.md',
        'health-rules/index.html',
        'health-rules.md',
        'llms-full.txt',
        'llms.txt',
        'robots.txt',
        'sitemap.xml',
        'zh/about/index.html',
        'zh/about.md',
      ].sort(),
    )
    const about = out.get('about/index.html')!
    expect(about).toContain('<title>About · STAC Lens</title>')
    expect(about).toContain('<link rel="canonical" href="https://staclens.com/about/" />')
    expect(about).toContain('<link rel="alternate" hreflang="zh-Hans" href="https://staclens.com/zh/about/" />')
    expect(about).toContain('<link rel="alternate" hreflang="x-default" href="https://staclens.com/about/" />')
    expect(about).toContain('<link rel="alternate" type="text/markdown" href="/about.md"')
    expect(about).toContain('"@type":"TechArticle"')
    expect(about).toContain('<html lang="en">')
    expect(out.get('zh/about/index.html')).toContain('<html lang="zh-Hans">')
    // The app's tokens, both themes, without its Leaflet rules.
    expect(about).toContain('--color-bg: #000')
    expect(about).not.toContain('x: y')
    expect(out.get('health-rules/index.html')).toContain('id="C-04"')
    expect(out.get('llms-full.txt')).toContain('<!-- https://staclens.com/health-rules/ -->')
    expect(out.get('catalogs.md')).toContain(
      '[Open in STAC Lens](https://staclens.com/#https://earth-search.aws.element84.com/v1/)',
    )
    expect(out.get('catalogs/index.html')).toContain('href="/#https://earth-search.aws.element84.com/v1/"')
  })

  it('omits everything absolute without a site URL', () => {
    const out = buildOutputs(inputs, anonymous)
    expect(out.has('sitemap.xml')).toBe(false)
    const about = out.get('about/index.html')!
    expect(about).not.toContain('rel="canonical"')
    expect(about).not.toContain('og:url')
    expect(about).not.toContain('<link rel="alternate" hreflang=')
    expect(about).toContain('lang="zh">中文</a>')
    expect(out.get('about.md')).toContain('](/health-rules/)')
  })

  it('keeps every internal link under a sub-path base', () => {
    const out = buildOutputs(inputs, subPath)
    const about = out.get('about/index.html')!
    expect(about).toContain('href="/lens/health-rules/"')
    expect(about).toContain('href="/lens/favicon.svg"')
    expect(about).toContain('href="/lens/about.md"')
    expect(about).not.toMatch(/href="\/(?!lens\/)/)
    expect(out.get('catalogs.md')).toContain('[Open in STAC Lens](/lens/#https://earth-search.aws.element84.com/v1/)')
  })
})
