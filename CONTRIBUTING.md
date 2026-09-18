# Contributing to STAC Lens

Thanks for looking under the hood. This document is about *how* to work on the project; what the project is for is in the [README](README.md), how the code is laid out is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), and why it is the way it is — including the ideas that were tried and dropped — is in [`docs/DESIGN.md`](docs/DESIGN.md).

## What kind of change fits

STAC Lens is a lens on a STAC catalog's **shape, health, and distance from the spec**. It is not a general-purpose STAC browser and does not compete with [STAC Browser](https://github.com/radiantearth/stac-browser). Changes that fit well:

- a new health check (see [`docs/HEALTH-RULES.md`](docs/HEALTH-RULES.md) — every check has a row there first, with its source and tier),
- support for a STAC / STAC API feature, gated on the server's declared `conformsTo`,
- a fix for how a real, public catalog or API renders or behaves,
- anything that makes structure, time, and space read more clearly together.

Changes that usually don't: rendering more fields of more objects for completeness (STAC Browser's job), inventing hierarchy or grouping the publisher didn't make, features that only work against one server's quirks, or UI that adds sliders, dialogs, or dashboards where direct manipulation would do. If you're unsure, open an issue first — a short "would this fit?" saves both of us a rewrite.

## Setup

```bash
nvm use            # Node 22 (see .nvmrc); Vite 8 needs 20.19+ or 22.12+
npm ci
npm run dev        # http://localhost:5173 — add --host to test from another device on your network
```

Other scripts:

```bash
npm run build            # tsc -b && vite build — the real type-check plus the production bundle
npm run lint             # oxlint
npm run format           # prettier --write (format:check is what CI runs)
npm test                 # vitest — unit tests for the data layer (src/stac/__tests__)
npm run test:e2e         # offline Playwright smoke suite against a running app (tests/smoke.mjs)
npm run verify:fixtures  # headless data-layer checks against two reference catalogs
npm run verify:catalogs  # live re-check of the landing-page catalog list (docs/CATALOGS.md); reports, never edits
```

CI runs `format:check`, `lint`, `test`, `build`, and then `test:e2e` against the production build.

## Verifying a change

This project has one hard rule about verification, learned the expensive way: **a change is done when it has been seen working, not when it compiles.**

1. **Type-check with `npx tsc -b`** (or `npm run build`). Do not use `npx tsc --noEmit -p .` — the root `tsconfig.json` is a project-references shell with no files, so that command reports success without checking anything. The dev server (esbuild) strips types without checking them either.
2. **Lint**: `npm run lint`. CI fails on errors; existing warnings are being cleared.
3. **UI or behavior changes: drive them in a real browser against a real catalog**, at realistic data density. Playwright is a dev dependency; a throwaway script against the dev server is the normal workflow:

   ```js
   // verify.mjs — run with: node verify.mjs (dev server running)
   import { chromium } from 'playwright'
   const browser = await chromium.launch()
   const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
   await page.goto('http://localhost:5173/#https://planetarycomputer.microsoft.com/api/stac/v1/collections/3dep-lidar-returns')
   await page.waitForTimeout(8000)
   await page.screenshot({ path: 'after.png' })
   await browser.close()
   ```

   Read DOM state and computed styles rather than eyeballing where you can; take a screenshot where you can't. For behavior a public server won't trigger on demand (a POST pagination link, a `/children` endpoint), intercept with `page.route` and serve a recorded response.
   The app has two layouts — desktop, and a phone layout below 720 px (`hooks/useMediaQuery.ts`: an outline instead of the tree, a bottom-sheet Inspector) — so a change to the landing page or the explorer is checked in both. Playwright's `devices['iPhone 13']` is the phone reference, and `tests/smoke.mjs` ends with three phone checks.

4. **Pin what you verified.** A fact about the data layer (a link rule, a parameter format, a server behavior you worked around) gets a Vitest case in `src/stac/__tests__/`; a user-visible path gets a check in `tests/smoke.mjs`, driven by recorded responses in `tests/fixtures/` so it runs offline. Record a fixture with `curl`, trim it, and keep it byte-for-byte otherwise — the point is that it is what a real server sent.
5. **Facts about servers come from requests, not memory.** Before writing code against how an API behaves, `curl` it. Several of this project's design decisions exist because a server did not do what its documentation or the spec said (see `DESIGN.md`).

To add a catalog to the landing page's list, or to understand why one was removed, see [`docs/CATALOGS.md`](docs/CATALOGS.md) — the list is data (`src/data/catalogs.json`) with written criteria and a verifier, not an ad-hoc array.

Catalogs that exercise specific paths:

| Catalog | Exercises |
|---|---|
| `https://planetarycomputer.microsoft.com/api/stac/v1/` | API root with no `child` links (`/collections` listing); Collections with `/search` scoped by `collections=`; a server that rejects cross-collection search (422) |
| `https://earth-search.aws.element84.com/v1/` | `numberMatched` reporting; very large Collections (51M+ Items); GET `next` pagination |
| `https://stac.dataspace.copernicus.eu/v1/` | a flat root of 400+ Collections; Collection Search conformance |
| `https://capella-open-data.s3.us-west-2.amazonaws.com/stac/catalog.json` | static catalog with thousands of `rel:item` links (real pagination); `rel:collection` vs `rel:parent` disagreements |
| `https://digital-atlas.s3.amazonaws.com/stac/public_stac/catalog.json` | deep, messy static catalog; invalid geometry in the wild |

## Principles that reviews check against

These are stated in the README and made concrete in `docs/ARCHITECTURE.md` → *Invariants*. In short: never enumerate what the source doesn't; follow links as given; show the publisher's structure; gate UI on declared capability; search-first for APIs; a failure renders as a failure; selection shows exactly the selected object; no `stopPropagation` (use DOM containment checks); verified in a browser against real data.

## Where to write things down

- **A decision, a root cause, a reversal** → append a numbered section to `docs/DESIGN.md`. It is a log: never edit history, and the last section ("What's deliberately deferred") keeps its place at the end — re-run `grep -n "^## " docs/DESIGN.md` after inserting to confirm the numbering is contiguous.
- **A new health check** → a row in `docs/HEALTH-RULES.md` first (source, tier, status), then the code.
- **Moved or split code** → update `docs/ARCHITECTURE.md` in the same PR.
- **User-visible behavior** → update the README if it describes the old behavior.
- **A new landing-page catalog** → verify CORS (a real `GET` with an `Origin` header) and real STAC content before adding it.

## Code conventions

- TypeScript, strict. Plain React + SVG for rendering; d3 for layout math and gesture composition only; Leaflet for maps. No UI component library.
- Comments explain **why**, in the present tense, in English. A comment that only restates the code, or narrates how the code used to be, should go; the history belongs in `DESIGN.md`. A comment that records a non-obvious constraint — a browser quirk, a server's real behavior, a React/Leaflet interaction — should stay.
- Colors, spacing, radii come from `src/design/tokens.css`. The three hierarchy colors are the STAC mark's own; don't add hues.
- Formatting is Prettier's job, not yours: `npm run format` before committing (`npm run format:check` is what CI runs). Config in `.prettierrc`; Markdown is deliberately excluded.
- Lint is oxlint (`npm run lint`), warning-free on `main`. If a rule is wrong for a specific, deliberate case, suppress it on that line with a one-line reason — never blanket-disable a rule.

## Commits and pull requests

- `main` deploys to [staclens.com](https://staclens.com) on every push, so `main` must always build. Work on a branch and open a pull request; CI runs lint and the real build.
- One logical change per commit. Subject line in the imperative, under ~70 characters; the body says why, not what (the diff says what). Reference the `DESIGN.md` section you added if there is one.
- The PR template asks which catalog(s) you tested against and, for UI changes, for a screenshot. Please fill it in — it is how reviews stay short.
- Half-finished or parked work stays on a branch (see `parked/*`), never on `main`.

## License

By contributing you agree that your contributions are licensed under the project's [Apache-2.0 license](LICENSE).
