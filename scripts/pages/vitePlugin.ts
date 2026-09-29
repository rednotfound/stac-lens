// The Vite plugin that puts the static pages into the site. Three jobs:
//
//   1. `closeBundle` — after `vite build`, write every page, its Markdown
//      copy and the crawler files into the output directory, so
//      `npm run build` is still the whole build on every host.
//   2. `configureServer` — in `vite dev`, answer the same paths on the fly
//      from the current Markdown, so a page can be checked without a build.
//   3. `transformIndexHtml` — give index.html the head tags that need the
//      absolute site URL (canonical, og:url, og:image) and the home page's
//      JSON-LD, so no URL is hard-coded in the source and a fork's build
//      does not claim to be staclens.com.
//
// VITE_SITE_URL is the one input: the absolute origin of the deployment.
// Without it the pages are still built, minus everything absolute.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'
import { absolute, homeJsonLd, type SiteConfig } from './render'
import { buildOutputs, contentTypeOf, loadSiteInputs, PAGE_PATHS } from './site'

export function sitePages({ version }: { version: string }): Plugin {
  let resolved: ResolvedConfig
  let site: SiteConfig

  function readConfig(base: string): SiteConfig {
    const raw = process.env.VITE_SITE_URL?.trim()
    return {
      base,
      siteUrl: raw ? raw.replace(/\/+$/, '') : undefined,
      version,
      buildDate: new Date().toISOString(),
    }
  }

  return {
    name: 'stac-lens:site-pages',

    configResolved(config) {
      resolved = config
      site = readConfig(config.base)
    },

    transformIndexHtml() {
      const tags: { tag: string; attrs?: Record<string, string>; children?: string; injectTo: 'head' }[] = []
      const home = absolute(site, '')
      const ogImage = absolute(site, 'og-image.png')
      if (home) {
        tags.push({ tag: 'link', attrs: { rel: 'canonical', href: home }, injectTo: 'head' })
        tags.push({ tag: 'meta', attrs: { property: 'og:url', content: home }, injectTo: 'head' })
      }
      if (ogImage) {
        tags.push({ tag: 'meta', attrs: { property: 'og:image', content: ogImage }, injectTo: 'head' })
        tags.push({ tag: 'meta', attrs: { property: 'og:image:width', content: '1200' }, injectTo: 'head' })
        tags.push({ tag: 'meta', attrs: { property: 'og:image:height', content: '630' }, injectTo: 'head' })
        tags.push({ tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' }, injectTo: 'head' })
        tags.push({ tag: 'meta', attrs: { name: 'twitter:image', content: ogImage }, injectTo: 'head' })
      } else {
        tags.push({ tag: 'meta', attrs: { name: 'twitter:card', content: 'summary' }, injectTo: 'head' })
      }
      tags.push({
        tag: 'script',
        attrs: { type: 'application/ld+json' },
        children: homeJsonLd(site).replace(/</g, '\\u003c'),
        injectTo: 'head',
      })
      return tags
    },

    configureServer(server) {
      const base = resolved.base
      // Only the paths this plugin owns are answered; everything else —
      // Vite's own `/@vite/client`, `/@react-refresh`, source modules —
      // falls through untouched. (An earlier version redirected every
      // extension-less path to a trailing slash and broke the dev client.)
      const pagePaths = new Set<string>(PAGE_PATHS)
      const filePaths = new Set([
        'robots.txt',
        'llms.txt',
        'llms-full.txt',
        'sitemap.xml',
        ...PAGE_PATHS.map((p) => p.replace(/\/$/, '.md')),
      ])
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '/').split('?')[0]
        if (!url.startsWith(base)) return next()
        const path = url.slice(base.length)
        if (pagePaths.has(`${path}/`)) {
          res.statusCode = 302
          res.setHeader('Location', `${url}/`)
          return res.end()
        }
        const file = pagePaths.has(path) ? `${path}index.html` : filePaths.has(path) ? path : undefined
        if (!file) return next()
        const body = buildOutputs(loadSiteInputs(resolved.root, site.buildDate), site).get(file)
        if (body === undefined) return next()
        res.setHeader('Content-Type', contentTypeOf(file))
        res.end(body)
      })
    },

    closeBundle() {
      if (resolved.command !== 'build') return
      const outDir = resolve(resolved.root, resolved.build.outDir)
      const outputs = buildOutputs(loadSiteInputs(resolved.root, site.buildDate), site)
      for (const [path, body] of outputs) {
        const file = join(outDir, path)
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, body)
      }
      const pages = [...outputs.keys()].filter((p) => p.endsWith('index.html')).length
      resolved.logger.info(`site pages: ${pages} pages, ${outputs.size} files written to ${resolved.build.outDir}/`)
      if (!site.siteUrl) {
        resolved.logger.warn(
          'site pages: VITE_SITE_URL is not set — no canonical URLs, Open Graph URL or sitemap.xml were emitted (docs/DEPLOY.md).',
        )
      }
    },
  }
}
