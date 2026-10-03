# Architecture

This is the map of the code as it is today. The *why* behind each decision — including the ones that were tried and reversed — lives in [`DESIGN.md`](DESIGN.md), a chronological log; this document only describes the current shape. If the two disagree, this one is stale: fix it.

## In one paragraph

STAC Lens is a single-page React app with no backend. Every request goes from the browser to a STAC server. Three layers, each importing only from the one below:

```
src/stac/        pure data layer — fetch, normalize, cache; no React
src/hooks/       state and loading logic — React hooks over the data layer and the stores
src/components/  rendering and interaction — React + SVG + Leaflet
src/store/       two small zustand stores shared across hooks and components
```

A STAC catalog is a graph of JSON documents linked by `rel` links. The data layer turns each document into a `StacNode`; the hooks decide which nodes to load and when; the components draw the graph as a tree with time and space alongside it.

## Data layer — `src/stac/`

**`types.ts`** — the model. `StacNode` is the normalized form of any STAC object (Catalog, Collection, Item) with resolved absolute hrefs, `childHrefs`, an `items` enumeration, spatial and temporal extents, assets, and raw JSON kept for the Inspector. Two discriminated unions matter everywhere:

- `ItemEnumeration` — how a node's Items can be reached: `{ kind: 'links', hrefs }` (a static catalog's finite `rel:item` list) or `{ kind: 'cursor', endpoint }` (an API endpoint that only ever hands out the next page). The app never assumes a cursor is finite or countable.
- `StacSourceKind` — `static-links` or `api-search` (a landing page declaring `conformsTo` / `rel:search`).

`classifyNodeShape(node)` folds these into `branch-collections | leaf-items | mixed | leaf-empty`, which the tree uses for its node glyphs.

**`graph.ts`** — `buildNode(href, raw)`: one raw document in, one `StacNode` out. Resolves every link against the document's own URL (relative-published and self-contained catalogs both work), dedupes, detects the source kind, reads STAC 1.0 and 1.1 field variants (`raster:bands` and `bands`), and records what it finds without judging it (a Collection's declared bbox count, an invalid geometry as a flag). It never fetches.

**`loader.ts`** — `StacLoader`: an href-keyed cache with in-flight deduplication. `load(href)` fetches once per href for the app's lifetime; `cachePreFetched(node)` inserts nodes that arrived whole inside another response (search results, `/collections` listings) so they are never fetched again; `loadChildren` / `loadItems` are bounded, partial-failure-tolerant batch loads for static link lists; `resolveRoot` walks `rel:root` / `rel:parent` up to the catalog root. One instance, `loaderInstance.ts`.

**`apiSearch.ts`** — the HTTP side of STAC API. `fetchSearchPage` (Item Search `/search` or a Collection's `rel:items`), `fetchCollectionsPage` (`/collections`), `fetchChildrenPage` (Children extension `/children`). A `next` pagination link is modeled as `NextLink` and followed exactly as the server advertised it — `href`, `method`, `headers`, `body`, `merge` — never rebuilt. `SearchFilter` → `filterToParams` is the single source of truth for query parameter names; the shareable URL encodes the same params. Failures throw with the server's own response body attached.

**`conformance.ts`** — capabilities. `conformsTo` is only ever declared on an API's landing page, so `resolveApiConformance(node)` walks to the node's root to read it. `supportsSort` gates the Sort control. `resolveSearchTarget(node)` decides where a Collection's search goes: the root's `GET /search?collections=<id>` when the API has one, else the Collection's own `rel:items`.

**`searchQueryUrl.ts`** — the `?query` half of the URL hash: `encodeSearchQuery` / `decodeSearchQuery` (tolerant, never throws) and `splitHashFragment` / `joinHashFragment` (split on the *last* `?`, so an href with its own query string survives).

**`assetAccess.ts`, `access/`** — discovery and access kept apart. A `StacAsset` (`types.ts`) is the resource as the catalog declares it; an `AssetAccess` is how this browser can reach it at this moment (`href`, `originalHref`, `method`, `expiresAt?`, `failure?`). `accessAsset(href, source)` picks the first `AccessMethod` in a plain ordered list whose synchronous `appliesTo` matches, else returns direct access at once; method results are cached per href until a minute before expiry, concurrent calls share one request, failures fall back to the declared href and are not cached. Access is lazy — nothing calls it while browsing — and never writes back into the asset. Callers build the source per href with `accessSourceFor(node, entry, lookup)`: the node, plus what the catalog declares about that asset or alternate — its `auth:refs` (any declared credential stops every anonymous method) and its storage scheme. `schemes.ts` resolves `auth:schemes`/`storage:schemes` keys up the parent chain (cache only, like `body.ts`) and says them in words. Methods, in order: `access/planetaryComputer.ts`, which holds everything Planetary Computer-specific: the source test (the node's `rel: root` is PC's STAC API), the SDK's eligibility rules (Azure blob, not the public thumbnail account, not already signed) and the `/sign` call; then `access/awsS3.ts`, an `s3://` URI's public AWS HTTPS address when the declared storage is AWS and not requester-pays, or undeclared (the access link's `note` then says AWS was assumed). Consumers: `components/AssetList.tsx`, the Inspector's asset list (one line per asset; Open goes through access; Copy is always the declared href; an opened row shows the STAC href and the access link with its expiry side by side) and `components/AccessImage.tsx` (Inspector preview, hover card). The standards-based successor is the Authentication extension's `signedUrl` scheme (DESIGN §114).

**`markdown.ts`, `markdownLoader.ts`, `safeUrl.ts`** — descriptions are CommonMark (+ GFM tables). `markdown.ts` parses to an mdast tree and reads it as plain text; it is a chunk of its own, loaded by `markdownLoader.ts` when a catalog opens (`descriptionPlainText` falls back to a link-stripping regex until then). `safeUrl.ts` resolves a description's link or image URL against the node and keeps only allowed schemes. `components/Description.tsx` renders the tree as React elements (never an HTML string): block form with a clamp in the Inspector, inline form for asset, alternate and provider descriptions; the hover card uses the plain text.

**`temporal.ts`, `spatial.ts`, `describe.ts`, `assets.ts`, `namespaces.ts`, `extensionFacts.ts`, `itemSetSummary.ts`** — normalization and human-readable interpretation: instants vs. intervals with open ends, bbox/geometry with a defensive fallback for invalid geometry, approximate bbox area, which image a node can show as its preview (`previewImageHref`: a `thumbnail` or `overview` asset with a browser image type, else a `rel: preview` link), which extension prefixes appear in `properties`, and per-extension readable facts for the Inspector.

## State — `src/store/`

Three zustand stores and one plain session cache, deliberately small:

**`selection.ts`** — `selectedHref` (the exact object selected: Catalog, Collection, or Item) and `browsingHref` (the Catalog/Collection whose Item Set the Items window shows). They differ on purpose: selecting an Item inside a Collection's Item Set keeps `browsingHref` pinned to that Collection, even if the Item's own `rel:collection` points elsewhere. Everything that highlights "contains the selection" reads `browsingHref`. `selectSeq` counts every `select` call: a selection is an act, and the Items window reopens on the act (clicking the already-browsed Collection again), which the value alone cannot express.

**`itemSet.ts`** — what the Items window currently has in view (`forHref`, `visibleHrefs`), its applied API search (`appliedQuery`), a `pendingInitialQuery` handed from a restored URL to the panel (consumed at mount, and whenever a new one arrives while mounted), and the window itself: `windowOpen` (live) and `windowGeometry` (persisted per browser, written when a drag or resize ends). `setVisible` for a different `forHref` clears the applied query, so a search never leaks from one Collection into another's URL.

**`itemSetSessions.ts`** — not a store: a module `Map` keyed by Collection href (LRU of 20) holding what the Item Set hooks would otherwise lose when their panel unmounts — the cursor buffer and its opaque `next` link, `matched`, the applied query and its draft, page and page size, tab, the Search section's collapsed state; a static Collection's page cache and position. The hooks read a session at mount and write as they go; `sessionPage(node)` gives a view the page a Collection last showed. Cleared when a different catalog opens.

**`landingPrefs.ts`** — favorites and recently opened roots, persisted.

## Hooks — `src/hooks/`

**`useStructureTree(rootHref)`** — one instance per open catalog, created by `StructureProvider` and read by every view through `useStructure()` (`hooks/useStructure.ts`), so switching views keeps the expansion. It owns the expansion state (`Map<href, { expanded, loading, error, childHrefs }>`) and produces the nested datum d3 lays out. `expand(href)` loads a node's children through, in order of preference: the Children extension endpoint if advertised, static `child` links (bounded page, with a "+N more" leaf), or the `/collections` listing for a root without `child` links. The root opens one level deep; nothing deeper loads without a click. Items are never structural children; the Tree view adds the Items window's page as leaves at layout time (`tree/itemLeaves.ts`, pure: ten at most plus a "+N more" leaf, dimmed for a page last seen), drawn by `tree/ItemLeafView.tsx`.

**`useLinksPagedItemSet(node)`** — static catalogs: real numbered pages over a known href array, per-page cache, and the other cached pages exposed for the dimmed "still visible" treatment. Restores from and writes to `itemSetSessions`.

**`useCursorQueriedItemSet(node, initialQuery?)`** — API Collections: an append-only buffer fed by `loadMore()` following `next` links, plus the applied query. A Collection runs its default, unconditioned search on open (once per session); only an API root (a search across every Collection) waits in `idle` for `applyQuery`; a URL's query runs at once. Each request asks for one page (the results' page size, passed in as `fetchLimit`). A generation counter discards responses superseded by a newer query; only the current generation may touch the loading flags. Errors become `status: 'error'` with the message. Restores from and writes to `itemSetSessions`; a URL's `initialQuery` beats the session.

**`usePagedCursorResults(node, initialQuery?)`** — presents that buffer as numbered pages with the same shape `useLinksPagedItemSet` exposes. A page inside the buffer is a memoized slice; a page beyond it triggers catch-up `loadMore()` calls first (a cursor cannot be asked for page 7 directly). The memoization here matters: `ItemsMap` rebuilds Leaflet layers when its input array identity changes.

**`useSelectedItems()`** — resolves the selection to what the Inspector's Temporal/Spatial widgets plot: a Collection alone shows its own stated extent; a single Item shows only itself.

**`useApiConformance(node)`** — reactive wrapper over `resolveApiConformance`, for gating UI.

**`useShareableUrl.ts`** — three hooks: `useDeepLinkBootstrap` reads the hash once on load and resolves the named node's root; `usePopStateSync` does the same on Back/Forward; `useShareableUrlSync` writes `#<href>` (`?query` appended when a search is applied), pushing a history entry only when the catalog root changes and replacing otherwise.

**`useElementSize`** — a ResizeObserver, via a callback ref so late-mounted targets are still observed.

**`usePointerDrag`** — pointer-capture drag in screen pixels (mouse, touch, pen through one path; 4 px tap threshold; controls inside the handle excluded by DOM containment), for the Items window's title bar and its eight resize handles. The tree's own node drag stays on d3-drag, which needs the zoom container.

**`useItemWindow(node)`** — the phone outline's ten-at-a-time Item rows as a sliding window of at most a hundred; the desktop views show the Items window's page instead.

**`useDocumentTitle`**, **`useMediaQuery`** (`useIsNarrow`, the one 720 px breakpoint) — small and self-describing.

## Components — `src/components/`

**`src/data/catalogs.json`** — the landing page's known-catalog list, typed by `src/data/knownCatalogs.ts`. Data, not code: inclusion criteria, the removal log and the verifier (`npm run verify:catalogs`) are in `docs/CATALOGS.md`. `catalogTags.ts` holds the closed facet vocabularies (topic, region, publisher), `catalogFilters.ts` the pure filter and facet-count functions the landing page uses, both unit-tested. `store/landingPrefs.ts` is a zustand store persisted to `localStorage` for favorites and recently opened roots — per browser, no backend. `hooks/useStickySidebar.ts` keeps the landing sidebar in view with a single page scroll (bottom edge pins while scrolling down, top edge while scrolling up) instead of a nested scroll region. `hooks/useMediaQuery.ts` is the app's one breakpoint (`useIsNarrow`, 720 px): below it the landing page hides the sidebar behind a Filters button (`FiltersSheet`) and the explorer replaces the canvas with `components/OutlineView.tsx` (the same `useStructureTree` state as a document outline), with each Collection's first ten Items as rows (`hooks/useItemWindow.ts`, a ten-at-a-time sliding window that also publishes them as the visible set so the Inspector's widgets plot them), the Inspector with `components/BottomSheet.tsx` (peek / half / full, dragged by pointer events), and shows `CompactBanner.tsx` pointing to the desktop.

**`StructureProvider.tsx`** + `hooks/useStructure.ts` hold one `useStructureTree` instance per open catalog, shared by every structure view so switching views keeps the expansion. `views/explorerViews.ts` names the views (Tree · Outline · Icicle); `App.tsx` shows one at a time behind a `TabButton` row on the desktop, the phone keeps the outline. `views/IcicleView.tsx` is space-filling layers over the loaded tree (`d3-hierarchy` `partition`; width = share of loaded leaves, never an Item count; click a node with children to focus, breadcrumb back up; clicking a closed node opens it). `views/IcicleItems.tsx` draws the page the Items window is on as a row of cells under the browsed Collection (the outline's desktop rows do the same); the phone's outline keeps its own ten-at-a-time rows (`hooks/useItemWindow.ts`). Whatever a view draws under a Collection, the selected Item is drawn there too when it is not among those Items (opened by link, a reload, a page turned): `views/selectedItem.ts` decides it: `selectedItemUnder` (the selection is an Item, the Collection is the one browsed, and it is the Item's own parent) and `selectedItemOffPage` (… and the drawn Items do not include it), used by the outline and the icicle; the tree passes `selectedItemUnder`'s Item to its leaf builder (`tree/itemLeaves.ts`), which tests it against the leaves it actually draws. `views/OverviewBar.tsx` + `views/structureStats.ts` are the "N Collections in M Catalogs loaded · K not opened" line the icicle shows (pure counts over the datum tree); `views/StructureActions.tsx` is the shared "Collapse to top level" / "Expand all catalogs" pair in the view switcher's row, acting on the shared structure state; `views/StructureFallback.tsx` and `views/canvasButton.ts` are the shared loading/error states and pill-button style. `tree/treeGeometry.ts` also holds the node vocabulary every view reuses: `canExpandNode`, `nodeIsFilled`, `nodeColor`, `itemCountLabel`, `hoverInfoFor`.

**`ItemsWindow.tsx`** — the one floating, non-modal panel (`position: fixed`, portaled to `body`, z-index between the tooltips and the bbox modal) that shows the browsed Collection's Item Set in every view: `CursorItemSetPanels` (Search above Results, Search collapsible to a one-line summary) or `LinksItemSetBrowser`. Placement comes from `itemsWindowGeometry.ts` (pure: default inside the left column, clamp so the title bar stays on screen) and is remembered in `store/itemSet.ts` (`persist`, only the geometry); the title bar and the corner grip move and resize it through `hooks/usePointerDrag.ts` (pointer capture, taken from `BottomSheet`). It opens whenever `browsingHref` reaches a Collection with Items and closes with ×; the tab row grows an "Items ▸" button to reopen it. A Collection's window opens with its default, unconditioned search already run (one page, the results' page size per request); an API root waits for conditions (DESIGN §118). `store/itemSetSessions.ts` keeps each Collection's cursor buffer, `next` link, applied query and draft, page and tab, so the panel can unmount (window closed, another Collection browsed, a view switched) and come back as it was; the three hooks read it at mount and write as they go. `stac/queryDraft.ts` is the Search form's pure state and conversions.

**`App.tsx`** composes everything: the landing page until a root is chosen; then a header (mark, catalog title, source link), the view switcher and the current view (`StructureTree` by default) on the left with the Items window floating above, `DetailPanel` on the right, and a draggable divider between them (drag to resize, snap to collapse, double-click to toggle). It also owns the URL wiring: computes the query string for the current selection and hands restored queries to the store.

**`LandingPage.tsx`** — the entrance. One field with two jobs (typing filters the catalog list live, a pasted URL arms Open); below it a faceted catalog browser: a sidebar of collapsible facet groups with counts (`data/catalogTags.ts`, `data/catalogFilters.ts`), a "Yours" view switch for favorites and recently opened roots (`store/landingPrefs.ts`), and cards that carry their own clickable tags. The sidebar stays in view through `hooks/useStickySidebar.ts` — native `position: sticky` whose offset is switched only on a scroll-direction change, so there is one page scroll and no nested scroll region. Footer via `ProjectLinks.tsx`.

**`StructureTree.tsx`** — Structure Lens. d3-hierarchy lays out the tree; d3-zoom pans and zooms the canvas; d3-drag moves individual nodes and the boxes. The two gesture systems are composed with `zoom.filter()`: any element marked `data-block-pan` (a node's hit target, a box and everything inside it) is excluded from canvas panning, so a drag or a scroll inside a box never also moves the canvas. The file is the canvas only — layout, zoom/pan, node drag offsets, per-node box geometry state, auto-pan to a selection that is off-screen (leaving room for its box), and the `boxLayer`: a last-rendered `<g>` that every open box is portaled into so it always paints above other nodes. Everything else lives in `src/components/tree/`: Hand placement: a node drag writes the delta into its structural subtree's offsets; Item leaves never get offsets of their own — a Collection's leaves move as one group (`leafGroupOffsets`, keyed by the Collection) on top of their Collection's offset, so a new page appears where the last one was put (DESIGN §120). The wheel zooms anywhere, over nodes too; drags and double-clicks that start on a node never pan or zoom the canvas.

- `TreeNodeView.tsx` — one node: circle, label (the drag handle), badges, hover handling, and the node's box(es), portaled into the `boxLayer`.
- `treeGeometry.ts` — row and level spacing, label truncation and width estimate, the shared `linkGenerator`, the `data-block-pan` attribute name, and the hover/tooltip types.
- `NodeTooltip.tsx` — the hover card, viewport-clamped; rendered at the top level because a `position: fixed` element inside a transformed SVG ancestor is not fixed to the viewport.
- `Legend.tsx` — the bottom-left key, open state remembered in `localStorage`.


Boxes live in the tree's coordinate space; the tree never resizes or repositions a box on its own after its one-time default.

**`ItemsMap.tsx`** `gestures` — `greedy` (the map takes every gesture; the bbox picker, the Item Set's Time & Space view) or `cooperative` (one finger and a plain wheel scroll the page, two fingers and Ctrl/⌘+wheel drive the map, with a hint; the Inspector's inline map). The Google Maps API's vocabulary, implemented in ~60 lines rather than a plugin.

**`CursorItemSetPanels.tsx`** — the one hook instance behind an API Collection's Search and Results, rendered as one column inside the Items window (Search collapsible to a one-line summary). Also owns the `BboxPickerModal` (a `document.body`-portaled map dialog: pan by default, explicit Draw-box tool).

**`ItemSetSearchPanel.tsx`, `ItemSetResultsPanel.tsx`, `ItemSetBrowser.tsx`** — the Search box's condition rows; the shared numbered-page results UI (List / Time & Space tabs, pager, page size, dimmed already-visited pages); and the shared pieces (`ItemRow`, `TimeSpaceView`, `TabBar`, style helpers, the publish-to-store hooks).

**`DetailPanel.tsx`** — the Inspector: Human tab (source facts and clearly labeled derived facts, extension interpretations, warnings for contradictions) and JSON tab (the raw document). `TimeLens` / `SpaceLens` are its inline Temporal / Spatial widgets, thin wrappers that decide *what* to plot.

**`ItemsTimeline.tsx`, `ItemsMap.tsx`** — the pure renderers: given Items, draw their temporal shape (grouping identical timings, lane packing, zoom/pan) or their footprints (Leaflet rectangles, fit-to-bounds once per key, an optional draw-a-bbox mode). Shared by the Inspector widgets, the Results panel, and the bbox modal. Leaflet is imperative and not diffed, so these components are careful about input identity and about the React StrictMode double-mount (guards that belong to a map instance are reset when that instance is torn down).

## One interaction, end to end

Opening `https://staclens.com/#https://…/collections/3dep-lidar-returns?bbox=-75.5,39.5,-73.5,41.5`:

1. `useDeepLinkBootstrap` splits the hash, `loader.load`s the Collection, resolves its root, and decodes the query. `App` parks the query in `itemSet.pendingInitialQuery` for that Collection, sets the root, and selects the Collection.
2. `useStructureTree` expands the root one level (here via `/collections`, since Planetary Computer's root has no `child` links) and expands the ancestors of the selection so it is visible.
3. `App` sees `browsingHref` = the Collection and that it has items, so it opens the Items window, which mounts `CursorItemSetPanels`; it consumes the pending query once at mount, and also whenever a new one arrives while it is mounted.
4. `useCursorQueriedItemSet` starts with that query: `resolveSearchTarget` picks the root's `/search` scoped by `collections=`, `fetchSearchPage` sends `bbox`, `datetime` and `limit`, the response's Items are cached via `cachePreFetched`, and `next` is kept for later pages.
5. `usePagedCursorResults` slices page 1; `ItemSetResultsPanel` renders the list; `ItemsMap` fits the footprints once for this Collection.
6. `usePublishAppliedQuery` writes the applied query to the store; `App` encodes it; `useShareableUrlSync` sees the hash already matches and does nothing. Clicking a result selects the Item: `selectedHref` changes, `browsingHref` stays, the hash becomes `#<item href>?bbox=…`, the Inspector shows that Item, the tree marks its Collection with a dashed ring.

## Invariants

These are the rules the code is organized around. A change that breaks one is a design change, not a refactor — record it in `DESIGN.md` first.

- **Never enumerate what the source doesn't enumerate.** A cursor is followed one page at a time; there is no "load everything". Counts come from the server or are shown as unknown.
- **Follow links as given.** `next` links, `self` hrefs, `rel:items` — used verbatim, never reconstructed from a pattern.
- **Show the publisher's structure.** No client-derived grouping, no synthetic hierarchy, no smoothing of a flat or odd catalog.
- **Gate UI on declared capability.** A control that needs a server feature exists only when `conformsTo` declares it.
- **One default search, then the user's.** A Collection's API answers one unconditioned page on open, framed as a search with no conditions; nothing else is fetched until the user pages or searches, and an API root waits for conditions (DESIGN §118, revising §78).
- **A failure is a failure.** A rejected request renders as an error with the server's words, never as an empty result.
- **Selection scoping.** Selecting an object shows exactly that object; aggregates are their own explicit views.
- **One state, many renderings.** The loaded graph and its expansion, the selection, the Items window and its per-Collection sessions, the structure actions — each exists once, above the views, and every view (tree, outline, icicle, the phone's outline) is a rendering of it. Anything that acts on shared state lives in the shared row, not inside one view's canvas.
- **A selection is an act.** Some things answer the act of selecting (the Items window reopening on a re-click), not only the selected value; `selectSeq` exists for that.
- **A selection is always visible.** Selecting an object shows exactly that object, in every view — a selected Item is drawn under its Collection even when the Items window's page does not hold it.
- **No `stopPropagation`.** Three imperative listeners live outside React (d3-zoom, the timeline's window-level drag, Leaflet's document-level drag); React's synthetic `stopPropagation` also stops the native event. Use explicit DOM containment checks instead.
- **Verified in a browser, against real catalogs.** A UI change is done when Playwright has shown it working on a real catalog at real data density, not when the type-checker passes.

## Verification

- Type-check with `npx tsc -b` (the root `tsconfig.json` is a references-only shell — `tsc -p .` checks nothing). `npm run build` runs the same check and then Vite.
- `npm run lint` — oxlint, kept at zero findings; `npm run format:check` — Prettier over code and config.
- `npm test` — Vitest over the pure data layer (`src/stac/__tests__/`) and the catalog-list data (`src/data/__tests__/`: vocabulary integrity, filter semantics): every spec rule and server behavior the data layer encodes has a case there.
- `npm run test:e2e` — `tests/smoke.mjs`, an offline Playwright run against the app with every external request answered from `tests/fixtures/` (recorded real responses) or refused; CI runs it against the production build.
- `npm run verify:fixtures` — headless data-layer checks against two live reference catalogs.
- Anything else UI — Playwright against the dev server, driving real public catalogs at real data density; `page.route` with recorded responses where a behavior can't be triggered live.

CI runs all of the above except the live-catalog checks, on every push and pull request.

## Static pages — `scripts/pages/`

Not part of the app, but part of the build. A Vite plugin (`vitePlugin.ts`) turns `docs/ABOUT.md`, `docs/ABOUT.zh.md`, `docs/HEALTH-RULES.md`, `docs/DEPLOY.md` and `src/data/catalogs.json` into real pages under `dist/` (`/about/`, `/health-rules/`, `/catalogs/`, `/deploy/`), plus their Markdown copies, `llms.txt`, `sitemap.xml` and `robots.txt`; it also injects the home page's canonical URL and JSON-LD into `index.html`. `render.ts` is pure (Markdown → HTML with heading ids, rule-id anchors and link rewriting; the catalogs page; the crawler files), `layout.ts` is the HTML shell with a stylesheet built on `src/design/tokens.css`, `site.ts` names the pages and reads the inputs (git dates for `lastmod`), and the plugin writes them after `vite build` or serves them on the fly in `vite dev`. Tests in `scripts/pages/__tests__/`. Why the pages exist: `DISCOVERABILITY.md`.

`src/data/projectLinks.ts` holds the repository URL, the site's own page list and the STAC ecosystem links, read by both the React footer and the page generator.

## Where things go

- A design decision, a bug's root cause, a reversal: append a section to `DESIGN.md`. It is a log — never rewrite history there.
- A new health check: add its row to `HEALTH-RULES.md` first, with its source and tier.
- A new catalog on the landing page: verify CORS and real STAC content before adding it.
- Colors and spacing: `src/design/tokens.css` only; the three hierarchy colors are the STAC mark's own.
