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

**`temporal.ts`, `spatial.ts`, `describe.ts`, `assets.ts`, `namespaces.ts`, `extensionFacts.ts`, `itemSetSummary.ts`** — normalization and human-readable interpretation: instants vs. intervals with open ends, bbox/geometry with a defensive fallback for invalid geometry, approximate bbox area, which asset is an inline-previewable thumbnail, which extension prefixes appear in `properties`, and per-extension readable facts for the Inspector.

## State — `src/store/`

Two zustand stores, deliberately small:

**`selection.ts`** — `selectedHref` (the exact object selected: Catalog, Collection, or Item) and `browsingHref` (the Catalog/Collection whose Item Set is open). They differ on purpose: selecting an Item inside a Collection's Item Set keeps `browsingHref` pinned to that Collection, even if the Item's own `rel:collection` points elsewhere. Everything that hosts a box or highlights "contains the selection" reads `browsingHref`.

**`itemSet.ts`** — what the open Item Set currently has in view (`forHref`, `visibleHrefs`), its applied API search (`appliedQuery`), and a one-shot `pendingInitialQuery` handed from a restored URL to the panel that will consume it. `setVisible` for a different `forHref` clears the applied query, so a search never leaks from one Collection into another's URL.

## Hooks — `src/hooks/`

**`useStructureTree(rootHref)`** — owns the tree's expansion state (`Map<href, { expanded, loading, error, childHrefs }>`) and produces the nested datum d3 lays out. `expand(href)` loads a node's children through, in order of preference: the Children extension endpoint if advertised, static `child` links (bounded page, with a "+N more" leaf), or the `/collections` listing for a root without `child` links. The root opens one level deep; nothing deeper loads without a click. Items are never tree nodes.

**`useLinksPagedItemSet(node)`** — static catalogs: real numbered pages over a known href array, per-page cache, and the other cached pages exposed for the dimmed "still visible" treatment.

**`useCursorQueriedItemSet(node, initialQuery?)`** — API Collections: an append-only buffer fed by `loadMore()` following `next` links, plus the applied query. Search-first: status is `idle` and nothing is fetched until `applyQuery` runs (or a URL restored one). A generation counter discards responses superseded by a newer query; only the current generation may touch the loading flags. Errors become `status: 'error'` with the message.

**`usePagedCursorResults(node, initialQuery?)`** — presents that buffer as numbered pages with the same shape `useLinksPagedItemSet` exposes. A page inside the buffer is a memoized slice; a page beyond it triggers catch-up `loadMore()` calls first (a cursor cannot be asked for page 7 directly). The memoization here matters: `ItemsMap` rebuilds Leaflet layers when its input array identity changes.

**`useSelectedItems()`** — resolves the selection to what the Inspector's Temporal/Spatial widgets plot: a Collection alone shows its own stated extent; a single Item shows only itself.

**`useApiConformance(node)`** — reactive wrapper over `resolveApiConformance`, for gating UI.

**`useShareableUrl.ts`** — three hooks: `useDeepLinkBootstrap` reads the hash once on load and resolves the named node's root; `usePopStateSync` does the same on Back/Forward; `useShareableUrlSync` writes `#<href>` (`?query` appended when a search is applied), pushing a history entry only when the catalog root changes and replacing otherwise.

**`useElementSize`** — a ResizeObserver, via a callback ref so late-mounted targets are still observed.

## Components — `src/components/`

**`App.tsx`** composes everything: the landing page until a root is chosen; then a header (mark, catalog title, source link), `StructureTree` on the left, `DetailPanel` on the right, and a draggable divider between them (drag to resize, snap to collapse, double-click to toggle). It also owns the URL wiring: computes the query string for the current selection and hands restored queries to the store.

**`LandingPage.tsx`** — one field that opens a pasted URL or filters the verified catalog list (each entry was checked for CORS and real STAC content when added); footer via `ProjectLinks.tsx`.

**`StructureTree.tsx`** — Structure Lens. d3-hierarchy lays out the tree; d3-zoom pans and zooms the canvas; d3-drag moves individual nodes and the boxes. The two gesture systems are composed with `zoom.filter()`: any element marked `data-block-pan` (a node's hit target, a box and everything inside it) is excluded from canvas panning, so a drag or a scroll inside a box never also moves the canvas. The file is the canvas only — layout, zoom/pan, node drag offsets, per-node box geometry state, auto-pan to a selection that is off-screen (leaving room for its box), and the `boxLayer`: a last-rendered `<g>` that every open box is portaled into so it always paints above other nodes. Everything else lives in `src/components/tree/`:

- `TreeNodeView.tsx` — one node: circle, label (the drag handle), badges, hover handling, and the node's box(es), portaled into the `boxLayer`.
- `ItemSetBox.tsx` — `renderBox`, one box: a connector path drawn with the same link generator as the tree, and a `<foreignObject>` holding a window-style panel: title bar (the drag handle), body, corner resize grip. Static catalogs get one box (`LinksItemSetBrowser`); API Collections get two independent boxes, Search and Results, connected by a line.
- `boxGeometry.ts` — box default sizes, minimums, gaps and connector inset, the `BoxGeometry` shape, and `makeBoxGeometry`, which builds one box's drag/resize callbacks over a per-node offset/size Map pair.
- `treeGeometry.ts` — row and level spacing, label truncation and width estimate, the shared `linkGenerator`, the `data-block-pan` attribute name, and the hover/tooltip types.
- `NodeTooltip.tsx` — the hover card, viewport-clamped; rendered at the top level because a `position: fixed` element inside a transformed SVG ancestor is not fixed to the viewport.
- `Legend.tsx` — the bottom-left key, open state remembered in `localStorage`.

`useBoxDragHandles` (in `src/hooks/`) is the d3-drag wiring for a box's move and resize handles.

Boxes live in the tree's coordinate space; the tree never resizes or repositions a box on its own after its one-time default.

**`CursorItemSetPanels.tsx`** — the one hook instance behind an API Collection's two boxes. `StructureTree` renders two `<foreignObject>`s with empty target `<div>`s; this component portals the Search controls into one and the Results panel into the other, so one piece of state backs two physically separate places. Also owns the `BboxPickerModal` (a `document.body`-portaled map dialog: pan by default, explicit Draw-box tool).

**`ItemSetSearchPanel.tsx`, `ItemSetResultsPanel.tsx`, `ItemSetBrowser.tsx`** — the Search box's condition rows; the shared numbered-page results UI (List / Time & Space tabs, pager, page size, dimmed already-visited pages); and the shared pieces (`ItemRow`, `TimeSpaceView`, `TabBar`, style helpers, the publish-to-store hooks).

**`DetailPanel.tsx`** — the Inspector: Human tab (source facts and clearly labeled derived facts, extension interpretations, warnings for contradictions) and JSON tab (the raw document). `TimeLens` / `SpaceLens` are its inline Temporal / Spatial widgets, thin wrappers that decide *what* to plot.

**`ItemsTimeline.tsx`, `ItemsMap.tsx`** — the pure renderers: given Items, draw their temporal shape (grouping identical timings, lane packing, zoom/pan) or their footprints (Leaflet rectangles, fit-to-bounds once per key, an optional draw-a-bbox mode). Shared by the Inspector widgets, the Results panel, and the bbox modal. Leaflet is imperative and not diffed, so these components are careful about input identity and about the React StrictMode double-mount (guards that belong to a map instance are reset when that instance is torn down).

## One interaction, end to end

Opening `https://staclens.com/#https://…/collections/3dep-lidar-returns?bbox=-75.5,39.5,-73.5,41.5`:

1. `useDeepLinkBootstrap` splits the hash, `loader.load`s the Collection, resolves its root, and decodes the query. `App` parks the query in `itemSet.pendingInitialQuery` for that Collection, sets the root, and selects the Collection.
2. `useStructureTree` expands the root one level (here via `/collections`, since Planetary Computer's root has no `child` links) and expands the ancestors of the selection so it is visible.
3. `StructureTree` sees `browsingHref` = the Collection and that it has items, so it renders the Search and Results `<foreignObject>`s and mounts `CursorItemSetPanels`, which consumes the pending query once.
4. `useCursorQueriedItemSet` starts with that query: `resolveSearchTarget` picks the root's `/search` scoped by `collections=`, `fetchSearchPage` sends `bbox`, `datetime` and `limit`, the response's Items are cached via `cachePreFetched`, and `next` is kept for later pages.
5. `usePagedCursorResults` slices page 1; `ItemSetResultsPanel` renders the list; `ItemsMap` fits the footprints once for this Collection.
6. `usePublishAppliedQuery` writes the applied query to the store; `App` encodes it; `useShareableUrlSync` sees the hash already matches and does nothing. Clicking a result selects the Item: `selectedHref` changes, `browsingHref` stays, the hash becomes `#<item href>?bbox=…`, the Inspector shows that Item, the tree marks its Collection with a dashed ring.

## Invariants

These are the rules the code is organized around. A change that breaks one is a design change, not a refactor — record it in `DESIGN.md` first.

- **Never enumerate what the source doesn't enumerate.** A cursor is followed one page at a time; there is no "load everything". Counts come from the server or are shown as unknown.
- **Follow links as given.** `next` links, `self` hrefs, `rel:items` — used verbatim, never reconstructed from a pattern.
- **Show the publisher's structure.** No client-derived grouping, no synthetic hierarchy, no smoothing of a flat or odd catalog.
- **Gate UI on declared capability.** A control that needs a server feature exists only when `conformsTo` declares it.
- **Search-first for APIs.** Nothing is fetched from a Collection's API until the user asks.
- **A failure is a failure.** A rejected request renders as an error with the server's words, never as an empty result.
- **Selection scoping.** Selecting an object shows exactly that object; aggregates are their own explicit views.
- **No `stopPropagation`.** Three imperative listeners live outside React (d3-zoom, the timeline's window-level drag, Leaflet's document-level drag); React's synthetic `stopPropagation` also stops the native event. Use explicit DOM containment checks instead.
- **Verified in a browser, against real catalogs.** A UI change is done when Playwright has shown it working on a real catalog at real data density, not when the type-checker passes.

## Verification

- Type-check with `npx tsc -b` (the root `tsconfig.json` is a references-only shell — `tsc -p .` checks nothing). `npm run build` runs the same check and then Vite.
- `npm run lint` — oxlint, kept at zero findings; `npm run format:check` — Prettier over code and config.
- `npm test` — Vitest over the pure data layer (`src/stac/__tests__/`): every spec rule and server behavior the data layer encodes has a case there.
- `npm run test:e2e` — `tests/smoke.mjs`, an offline Playwright run against the app with every external request answered from `tests/fixtures/` (recorded real responses) or refused; CI runs it against the production build.
- `npm run verify:fixtures` — headless data-layer checks against two live reference catalogs.
- Anything else UI — Playwright against the dev server, driving real public catalogs at real data density; `page.route` with recorded responses where a behavior can't be triggered live.

CI runs all of the above except the live-catalog checks, on every push and pull request.

## Where things go

- A design decision, a bug's root cause, a reversal: append a section to `DESIGN.md`. It is a log — never rewrite history there.
- A new health check: add its row to `HEALTH-RULES.md` first, with its source and tier.
- A new catalog on the landing page: verify CORS and real STAC content before adding it.
- Colors and spacing: `src/design/tokens.css` only; the three hierarchy colors are the STAC mark's own.
