# Discoverability — search engines, AI crawlers, and the STAC ecosystem

How the site is made findable and citable, what was deliberately not done,
and the off-site steps that only a maintainer can take. The reasoning is
in `DESIGN.md`, "SEO and AI discoverability".

## The problem this solves

The app is a hash-routed single page: every catalog opens as
`/#<stac href>`, which is one URL to a search engine, and the shipped
`index.html` used to be an empty `<div id="root">`. Google renders
JavaScript eventually; most AI crawlers (GPTBot, ClaudeBot,
PerplexityBot, Google-Extended) do not. To them the site was blank.

## What the build produces

`npm run build` runs a Vite plugin (`scripts/pages/vitePlugin.ts`) that
generates, from files that already exist in the repository:

| Output | Source | Purpose |
|---|---|---|
| `/about/`, `/zh/about/` | `docs/ABOUT.md`, `docs/ABOUT.zh.md` | the positioning, the principles, the vocabulary — the part meant to be quoted |
| `/health-rules/` | `docs/HEALTH-RULES.md` | every rule with a stable anchor (`/health-rules/#C-04`) |
| `/catalogs/` | `src/data/catalogs.json` + the "Tags" section of `docs/CATALOGS.md` | one dense page over the verified catalog list, each entry with an "Open in STAC Lens" link |
| `/deploy/` | `docs/DEPLOY.md` | self-hosting |
| `/<page>.md` | the same Markdown | a copy for readers that prefer Markdown (linked with `rel="alternate" type="text/markdown"`) |
| `/llms.txt`, `/llms-full.txt` | the pages | the [llms.txt](https://llmstxt.org/) convention: a summary and a link list, and the whole site as one Markdown file |
| `/sitemap.xml`, `/robots.txt` | the page list | only when `VITE_SITE_URL` is set (`robots.txt` is always written; the `Sitemap:` line needs the absolute URL) |
| `<head>` of every page | — | title, description, canonical, hreflang (About in two languages), Open Graph, Twitter card, JSON-LD (`TechArticle` on pages; `WebSite` + `SoftwareApplication` + `SoftwareSourceCode` on the home page) |

`index.html` itself now carries a description, Open Graph tags and a static
shell inside `#root`: the same words as the landing page, plus links to the
pages above, visible to a reader without JavaScript and replaced the
moment the app renders. At runtime `document.title` follows the open
catalog and selection, so a shared link has a name.

`public/og-image.png` (1200×630) is the link-preview image; its source is
`scripts/og-image.html`. Regenerate it with Playwright:

```bash
node -e "
const { chromium } = await import('playwright');
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto('file://' + process.cwd() + '/scripts/og-image.html'); await p.screenshot({ path: 'public/og-image.png' }); await b.close();"
```

Editing a page means editing its Markdown; there is no second copy. The
About pages are the only documents written for the site rather than for
the repository.

## Decisions

- **Real paths, generated at build time, no framework.** A static host
  serves `/about/index.html` as a file; nothing changes for Docker, GitHub
  Pages or a sub-path build. No history routing, no server-side rendering,
  no user-agent-based prerendering service.
- **One catalogs page, not one page per catalog.** A hundred pages of one
  or two sentences each is thin content by any search engine's rules and a
  maintenance surface; one page with every entry is dense, honest, and
  follows the data automatically.
- **No `meta keywords`.** Ignored by every major engine for years. The
  keyword list lives where it is read: JSON-LD `keywords`, `package.json`,
  `CITATION.cff`, and, once the repository is public, GitHub topics.
- **No crawler allow-list in `robots.txt`.** `User-agent: *` / `Allow: /`
  already admits every AI crawler; naming them would be a list to keep
  current.
- **No analytics, no third-party scripts.** Nothing leaves the browser
  applies to the pages too.
- **Absolute URLs come from `VITE_SITE_URL`**, never from source, so a
  fork's build cannot claim to be staclens.com. (The Open Graph image does
  name the site; a fork replaces the PNG.)

## Off-site checklist

Most of these need a public repository. In rough order of effect:

1. **GitHub repository: make it public; set topics.** Suggested topics:
   `stac`, `spatiotemporal-asset-catalog`, `stac-api`, `geospatial`,
   `earth-observation`, `remote-sensing`, `open-data`, `gis`,
   `data-catalog`, `metadata`, `visualization`, `react`, `typescript`.
   Set the repository description to the one in `package.json` and the
   website to `https://staclens.com`. GitHub then shows "Cite this
   repository" from `CITATION.cff`.
2. **STAC Index ecosystem** — the tool directory stacspec.org points to.
   Add at <https://stacindex.org/add> (Ecosystem):
   - Title: `STAC Lens`
   - URL: `https://github.com/rednotfound/stac-lens` (the directory's convention is the repository; the README's first line links the site)
   - Summary: `Browser-only viewer and health checker for any STAC catalog or API: structure as a tree, extents in time and space, metadata contradictions and deprecated forms flagged, declared vs. observed API behavior. No backend — paste a URL at staclens.com.`
   - Categories: `Visualization`, `Client`, `Validation`
   - Language: `TypeScript`
   The stacspec.org "Tools & resources" page defers to STAC Index; no separate submission.
3. **Awesome lists**: a pull request each to
   [awesome-stac](https://github.com/stac-utils/awesome-stac) and
   [awesome-earthobservation-code](https://github.com/acgeospatial/awesome-earthobservation-code)
   (one line, alphabetical, with the summary above shortened).
4. **Search consoles**: verify `staclens.com` in Google Search Console and
   Bing Webmaster Tools (DNS TXT record or the HTML-file method — the file
   goes in `public/`), then submit `https://staclens.com/sitemap.xml`.
   Netlify needs nothing else. Re-check after the first crawl that
   `/about/` and `/catalogs/` are indexed and that no page is reported
   "crawled, not indexed".
5. **Zenodo**: connect the GitHub repository, publish a release
   (`v0.1.0`), copy the DOI into `CITATION.cff` (`doi:`) and the README.
6. **Link checks after going live**: paste `https://staclens.com/` into a
   chat app or the [OpenGraph preview](https://www.opengraph.xyz/) to see
   the card; run the [Schema Markup Validator](https://validator.schema.org/)
   on the home page and one docs page; `curl -A GPTBot https://staclens.com/`
   and confirm the shell text is in the response.

## Keeping it honest

- The catalogs page repeats the landing list's claim that every entry is
  verified. The weekly `catalogs.yml` run is what keeps that claim true;
  a red run is a prompt to act, as `CATALOGS.md` says.
- The About pages state numbers ("more than a hundred catalogs", "51
  million Items"). If they stop being true, change the page, not the
  claim's confidence.
