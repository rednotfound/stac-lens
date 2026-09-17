import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

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

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
