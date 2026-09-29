// The site's pages as data: which Markdown files become which pages, how
// the inputs are read from the repository (with git dates), and the full
// set of files a build writes. `buildOutputs` is pure; the Vite plugin and
// the tests both call it.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { shell } from './layout'
import {
  absolute,
  homeJsonLd,
  pageJsonLd,
  renderCatalogsMarkdown,
  renderLlmsFull,
  renderLlmsTxt,
  renderMarkdown,
  renderRobots,
  renderSitemap,
  rewriteMarkdownLinks,
  sectionOf,
  type CatalogRecord,
  type PageSpec,
  type SiteConfig,
} from './render'

export interface SourceDoc {
  markdown: string
  /** ISO 8601 date of the last commit touching the file. */
  lastmod: string
}

export interface SiteInputs {
  docs: {
    about: SourceDoc
    aboutZh: SourceDoc
    healthRules: SourceDoc
    deploy: SourceDoc
    /** docs/CATALOGS.md — only its "Tags" section is published. */
    catalogsDoc: SourceDoc
  }
  catalogs: CatalogRecord[]
  catalogsLastmod: string
  tokensCss: string
}

/** The date of a file's last commit, or the fallback outside a checkout
 *  (a Docker build from a tarball, a CI job with a shallow clone that
 *  still answers, an export). */
export function gitLastmod(root: string, file: string, fallback: string): string {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', file], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return out || fallback
  } catch {
    return fallback
  }
}

export function loadSiteInputs(root: string, buildDate: string): SiteInputs {
  const doc = (rel: string): SourceDoc => ({
    markdown: readFileSync(join(root, rel), 'utf8'),
    lastmod: gitLastmod(root, rel, buildDate),
  })
  return {
    docs: {
      about: doc('docs/ABOUT.md'),
      aboutZh: doc('docs/ABOUT.zh.md'),
      healthRules: doc('docs/HEALTH-RULES.md'),
      deploy: doc('docs/DEPLOY.md'),
      catalogsDoc: doc('docs/CATALOGS.md'),
    },
    catalogs: JSON.parse(readFileSync(join(root, 'src/data/catalogs.json'), 'utf8')) as CatalogRecord[],
    catalogsLastmod: gitLastmod(root, 'src/data/catalogs.json', buildDate),
    tokensCss: readFileSync(join(root, 'src/design/tokens.css'), 'utf8'),
  }
}

/** Every page path under the base, for the dev middleware to recognize a
 *  request before it renders anything (a test pins this to `buildPages`). */
export const PAGE_PATHS = ['about/', 'zh/about/', 'health-rules/', 'catalogs/', 'deploy/'] as const

/** The pages, in the order llms-full.txt and the sitemap list them. */
export function buildPages(inputs: SiteInputs): PageSpec[] {
  const { docs } = inputs
  const lastVerified = inputs.catalogs.reduce((max, c) => (c.verifiedOn && c.verifiedOn > max ? c.verifiedOn : max), '')
  const catalogsMarkdown = renderCatalogsMarkdown(
    inputs.catalogs,
    sectionOf(docs.catalogsDoc.markdown, 'Tags'),
    lastVerified || 'not recorded',
  )
  const newest = (...dates: string[]) => dates.reduce((a, b) => (a > b ? a : b))
  return [
    {
      path: 'about/',
      lang: 'en',
      title: 'About',
      description:
        'What STAC Lens is: a free, open-source, browser-only viewer and health checker for STAC catalogs and APIs — shape, health and distance from the specification — and how it differs from STAC Browser.',
      markdown: docs.about.markdown,
      alternates: [{ lang: 'zh', path: 'zh/about/' }],
      lastmod: docs.about.lastmod,
    },
    {
      path: 'zh/about/',
      lang: 'zh',
      title: '关于',
      description:
        'STAC Lens 是一个开源、纯浏览器端的 STAC（时空资产目录）目录查看与健康检查工具：查看遥感影像、对地观测和开放地理数据目录的结构、时空范围和元数据质量。',
      markdown: docs.aboutZh.markdown,
      alternates: [{ lang: 'en', path: 'about/' }],
      lastmod: docs.aboutZh.lastmod,
    },
    {
      path: 'health-rules/',
      lang: 'en',
      title: 'Health rules',
      description:
        'Every check STAC Lens performs or could perform on a STAC Catalog, Collection, Item, Asset, Link or API — with the rule it comes from (STAC spec, best practices, stac-check, STAC API spec), its severity tier and whether it is built.',
      markdown: docs.healthRules.markdown,
      lastmod: docs.healthRules.lastmod,
    },
    {
      path: 'catalogs/',
      lang: 'en',
      title: 'Public STAC catalogs',
      description: `${inputs.catalogs.length} public STAC catalogs and APIs — Earth observation, remote sensing, elevation, climate, vector and open geospatial data from space agencies, governments and research groups — each verified live and openable in STAC Lens.`,
      markdown: catalogsMarkdown,
      lastmod: newest(inputs.catalogsLastmod, docs.catalogsDoc.lastmod),
    },
    {
      path: 'deploy/',
      lang: 'en',
      title: 'Deploying',
      description:
        'How to host your own STAC Lens: one static folder on any host, a Docker image, GitHub Pages or a sub-path, with the two headers worth setting.',
      markdown: docs.deploy.markdown,
      lastmod: docs.deploy.lastmod,
    },
  ]
}

/** Path of a page's Markdown copy under the base: `about/` → `about.md`. */
export function markdownPathOf(page: PageSpec): string {
  return page.path.replace(/\/$/, '.md')
}

/** Every file the build writes, keyed by path under the output directory. */
export function buildOutputs(inputs: SiteInputs, config: SiteConfig): Map<string, string> {
  const pages = buildPages(inputs)
  const out = new Map<string, string>()
  const mdBase = absolute(config, '') ?? config.base
  for (const page of pages) {
    const markdownPath = markdownPathOf(page)
    out.set(
      `${page.path}index.html`,
      shell({
        page,
        bodyHtml: renderMarkdown(page.markdown, config.base),
        config,
        tokensCss: inputs.tokensCss,
        jsonLd: pageJsonLd(page, config),
        markdownPath,
      }),
    )
    out.set(markdownPath, rewriteMarkdownLinks(page.markdown, mdBase))
  }
  const sitemap = renderSitemap(pages, config)
  if (sitemap) out.set('sitemap.xml', sitemap)
  out.set('robots.txt', renderRobots(config))
  out.set('llms.txt', renderLlmsTxt(pages, config))
  out.set(
    'llms-full.txt',
    renderLlmsFull(
      pages.map((p) => ({ ...p, markdown: rewriteMarkdownLinks(p.markdown, mdBase) })),
      config,
    ),
  )
  return out
}

/** Media types for the dev middleware and for hosts that ask. */
export function contentTypeOf(path: string): string {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8'
  if (path.endsWith('.md')) return 'text/markdown; charset=utf-8'
  if (path.endsWith('.xml')) return 'application/xml; charset=utf-8'
  return 'text/plain; charset=utf-8'
}

export { homeJsonLd }
