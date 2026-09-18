# Deploying STAC Lens

STAC Lens is a static site with no backend. Every request for STAC data goes
from the visitor's browser straight to the catalog they are exploring, so
hosting it means serving one folder of files. Any static host works.

## The two values every host needs

| | |
|---|---|
| Build command | `npm run build` (runs `tsc -b`, then `vite build`) |
| Publish directory | `dist` |

Node 20.19+ or 22.12+ (Vite 8's range); `.nvmrc` pins 22.

Routing is hash-based (`#<stac href>`), so every real URL path is a real
file and **no SPA fallback rewrite** (`/* → /index.html`) is needed.

The build also writes a handful of static pages generated from the
Markdown in `docs/` — `/about/`, `/health-rules/`, `/catalogs/`, `/deploy/`,
their `.md` copies, `llms.txt`, `robots.txt` — so a search engine or a
crawler that runs no JavaScript has something to read (`docs/DISCOVERABILITY.md`).
They are plain files under `dist/`; no host configuration is involved.

One optional build-time variable: **`VITE_SITE_URL`**, the absolute address
of your instance (`https://lens.example.org`, no trailing slash). When set,
the pages carry canonical URLs and Open Graph URLs, `sitemap.xml` is
written and `robots.txt` names it. When unset, the build still succeeds
and prints one warning; nothing absolute is emitted, so a build can never
claim to be a site it is not. `netlify.toml` sets it for staclens.com. The
link-preview image `public/og-image.png` names staclens.com; replace it
for your own instance (`scripts/og-image.html` is its source).

Two headers are worth setting wherever you can. Both are declared in
`netlify.toml` and `docker/nginx.conf`, so the two shipped configurations
already agree:

- `/assets/*` → `Cache-Control: public, max-age=31536000, immutable`.
  Vite gives every file under `assets/` a content hash, so these can be
  cached forever; `index.html` and the icons should stay revalidated so a
  deploy shows up at once.
- `/manifest.webmanifest` → `Content-Type: application/manifest+json`.
  Several hosts don't know the extension and serve it as
  `application/octet-stream`; browsers are lenient, but this is the
  registered type.

## Serving under a sub-path

By default the build assumes the domain root. For a sub-path — GitHub
Pages' `https://<user>.github.io/<repo>/`, or a reverse proxy that keeps
its prefix — set `VITE_BASE` at build time (leading and trailing slash):

```bash
VITE_BASE=/stac-lens/ npm run build
```

Nothing in the source refers to its own base; `index.html`, the manifest
and the bundle all pick it up from this one variable.

## Docker

The `Dockerfile` builds the site and serves it with an unprivileged nginx
(non-root, port 8080), using `docker/nginx.conf`:

```bash
docker build -t stac-lens .
docker run --rm -p 8080:8080 stac-lens     # http://localhost:8080
```

Behind a proxy that mounts the container at a prefix *and keeps it*, build
with the prefix baked in:

```bash
docker build --build-arg VITE_BASE=/stac-lens/ -t stac-lens .
```

If the proxy strips the prefix before forwarding, build normally.

## GitHub Pages

Build with `VITE_BASE=/<repo>/`, publish `dist`. A minimal workflow:

```yaml
on: { push: { branches: [main] } }
permissions: { contents: read, pages: write, id-token: write }
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: github-pages
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: VITE_BASE=/${{ github.event.repository.name }}/ npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
      - uses: actions/deploy-pages@v4
```

Enable Pages with "GitHub Actions" as the source. GitHub Pages sets no
custom headers, so the two above are simply absent there — the site still
works, it just caches less aggressively.

## Netlify (how staclens.com is deployed)

`netlify.toml` in the repository root holds the build command, publish
directory, Node version and the two headers, so "Import from Git" needs no
dashboard settings. It is one host's configuration, kept as the record of
the maintainers' own instance; nothing else in the repository depends on
it.

## Whatever you use

- Serve over **HTTPS**. Browsers block requests from an HTTPS page to
  `http://` catalogs (mixed content), so an HTTP-only deployment could open
  fewer catalogs than the hosted one, not more.
- A catalog that doesn't allow cross-origin requests (**CORS**) cannot be
  opened from any browser-side app, STAC Lens included. The app reports
  this in the UI; a deployment cannot work around it without adding a
  proxy of its own.
