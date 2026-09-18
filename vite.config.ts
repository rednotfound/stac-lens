import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { sitePages } from './scripts/pages/vitePlugin'

// The one place the app learns its own version — read from package.json at
// build time and inlined as a global, so the landing page's footer can't
// drift from what `npm version` actually set.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// Where the site is served from. `/` for a domain root (the default and
// the common case); a sub-path such as `/stac-lens/` for GitHub Pages or a
// reverse proxy that keeps its prefix. Read from the shell environment at
// build time (`VITE_BASE=/stac-lens/ npm run build`), never from source, so
// a fork never has to edit this file to deploy — see docs/DEPLOY.md.
const base = process.env.VITE_BASE ?? '/'

// The documentation pages (/about/, /health-rules/, /catalogs/, /deploy/)
// and the crawler files (sitemap, robots, llms.txt) are generated from
// docs/*.md and src/data/catalogs.json by a plugin, at build time and on
// the fly in dev. VITE_SITE_URL (the absolute origin) makes them emit
// canonical URLs and a sitemap — see docs/DEPLOY.md and
// scripts/pages/vitePlugin.ts.

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react(), sitePages({ version: pkg.version })],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
