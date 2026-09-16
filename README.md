# STAC Lens

An experimental, client-side visual explorer for [STAC](https://stacspec.org/) (SpatioTemporal Asset Catalog) datasets — not another STAC Browser.

**Core idea:** make the shape of a STAC dataset visible. A STAC dataset has curated structure (how the publisher organized it), spatial structure, temporal structure, and semantic/metadata structure at the same time. STAC Lens treats these as coordinated views on the same underlying data rather than separate pages — selecting a node in one view highlights the corresponding data in the others.

See [`docs/DESIGN.md`](docs/DESIGN.md) for the full design rationale, research findings, and architecture notes.

## Status

Early prototype (v0.1). Working today:

- **Landing page** — one search box that does both jobs: paste a full URL to open it directly, or type anything else to filter 102 verified known catalogs live, laid out as a wide card grid (not a cramped single-column list). Each card shows an "API" badge when it's a real live-query STAC API rather than a static catalog. Free-text URL input is the real "browse any STAC catalog" capability, not just a convenience. Nothing else renders until you enter a catalog and select something — progressive disclosure, not several permanently-visible panels.
- **Structure Lens** — a horizontal, curved node-link tree (not a file-explorer list) over the STAC Catalog → Collection graph *only* — Items are deliberately never tree nodes, so a Collection holding thousands of them renders as a single labeled leaf ("N items" / "items via API search"), not a wall of children. Lazily fetches on expand and pans/zooms via drag + wheel (no sliders). Opens showing only the top level — a "Collapse to top level" / "Expand all catalogs" button pair lets you go back to that baseline or cascade every Catalog down to (but not into) Collection level on demand, instead of an unfamiliar deep catalog auto-loading more than you asked to see. Selecting an Item (from Item Set or Inspector's own Temporal/Spatial widgets) highlights the Collection it belongs to with a dashed ring, distinct from the solid ring around an exact Catalog/Collection selection; the tree's own layout pushes sibling nodes aside to make room rather than overlapping them. Selecting a Collection/Catalog with direct Items opens a rich **Item Set** browser right there, embedded inline in the tree at that node's position (not off in a separate panel) — a proper window-like panel with a title bar (title, a small glyph, the "API" tag when relevant) that is itself the drag handle, a body, a bottom bar for actions/status, and a corner grip to resize, with no automatic size/position adjustment at all beyond a one-time sensible default width (dragging is entirely up to you; the box never fights your own resize). Static catalogs and API-backed Collections get genuinely different UI here, not one generic panel with a badge — the two are different design philosophies, not just different data sources:
  - A static catalog's full item list is known up front and can never respond to a query, so it gets **real page-based pagination** (numbered "1 2 3 … 23 24 25" page buttons, an exact page count, a per-page cache so revisiting an already-seen page is instant) in a single embedded box.
  - An API-backed Collection can never support a numbered page jump directly (only an opaque, forward-only cursor) — so it gets **two genuinely independent boxes**, connected by a visible line: a **Search box** (date range, a sort direction shown only when the API's own capabilities actually declare support for it, and an "Area" condition) feeding a **Results box** (the same numbered-page presentation the static-catalog case uses, adapted over the cursor's own accumulated buffer — jumping to an already-loaded page is instant, jumping further triggers a brief "catching up" fetch first, since a STAC cursor can't be asked for "page 7" directly). API mode is **search-first**: nothing loads or renders until you actually click Search, and each condition shows its own real, informative value once set — the Area condition, drawn in a dedicated full-size map modal (reusing the exact same map component Inspector and the Results view already use, not a separate implementation — it opens framed on the Collection's own declared extent, pans and zooms normally, and an explicit "Draw box" tool arms one drag-to-draw gesture and disarms itself afterwards, the same pattern as Leaflet.draw or Copernicus Browser), displays its own approximate ground area and hemisphere-labeled coordinate bounds, not just "bbox set." Filtered searches go through the API root's own `GET /search?collections=<id>` rather than the Collection's `rel:items` link — a real upstream reason, not taste: Planetary Computer's `/items` endpoint serves a server-side cached response keyed without `bbox`/`datetime`, so a second search there silently returned the first search's results. Neither mode has an id/title text search box — nobody browsing a static catalog knows its opaque item ids up front, and the API mode's real query replaces that need entirely.

  Both modes share a **List / Time & Space view switcher** (the same batch of items, read as a scrollable list or as a combined real timeline + real map stacked together — time and space are just another way of looking at the same data); for a static catalog, paging through pages is reflected in both views together, and every already-visited page's Items stay visible — faint and non-clickable, but genuinely visible, not gone — behind whichever page is current (API mode shows the rest of its own loaded buffer the same way). The timeline itself is wheel-zoomable/drag-pannable, the same direct-manipulation language the tree's own canvas and the map already use. Clicking a mark/footprint in the Time & Space tab selects that Item the same way clicking a List row does.
- **Inspector** — one panel per selected node, with its own recognizable identity: a colored left border and colored type label (Catalog/Collection/Item) reusing Structure Lens's own tree-node colors, so which kind of object you're looking at is never ambiguous. Two tabs: **Human** (derived, readable facts, the default) and **JSON** (the untouched source document). Under Human, every field is either a direct source fact or a clearly-labeled derived one — no silent interpretation:
  - **Temporal** and **Spatial** render as an actual Time UI (a Wayback-Machine-style availability timeline: instants/closed/open-ended intervals rendered distinctly, identical-timing Items grouped into one row, non-overlapping Items packed into minimum lanes) and a real Space UI (a real interactive Leaflet map: item-footprint rectangles, automatic fly-to-bounds, dark mode via CSS filter) — not a number or a bbox array — right where those fields sit in the page, not off in a separate panel. Precisely scoped: selecting a Collection alone shows only its own *stated* extent; selecting *one* Item shows only that Item's own mark/footprint, never a sibling's or its Collection's stated extent leaking in. Seeing the whole neighborhood of marks at once — zoomable/pannable, with a hover tooltip standing in for a permanent label — is Item Set's own job now (its Time & Space tab, above), not something Inspector's single-object view tries to do too; that tab no longer repeats the Collection's own stated extent either, since Inspector already shows it at the same moment.
  - Collection/Catalog-level source fields: Description, License, Keywords, Providers (with clickable links), Created/Updated, and a "Containment (source)" field showing declared `rel:collection`/`rel:parent`/`rel:root` links as separate facts, flagging it when the first two disagree rather than silently picking one (confirmed to happen in the wild — Capella Open Data).
  - Item-level Common Metadata (platform/instruments/constellation/mission/gsd) and standard-extension facts (`eo`/`view`/`proj`/`sat`/`sar`/`sci`/`processing`/`grid`/`s2`/...), each only shown when actually present — never a placeholder for a missing field.
  - Declared extensions and observed property namespaces, each annotated with what's common across Item Set's currently browsed set when there is one.
  - The divider between Structure Lens and Inspector is directly draggable (continuous resize, snap-collapse near the low end, double-click to toggle collapse/restore) — not a separate header button — so reclaiming the full window for Structure Lens never loses the current selection.

**Shareable URLs, and a real Back button** — selecting anything updates the address bar to `#<that node's absolute href>` (e.g. `stac-lens.example/#https://.../item.json` — a raw hash fragment, not a percent-encoded query param, so it stays human-readable); pasting that URL fresh opens straight to the same catalog, selection, and highlighted state everywhere, no manual re-navigation. Works for any node (Catalog/Collection/Item) fetched from anywhere in the tree — the app finds its way back to the catalog root live via the node's own `rel:root`/`rel:parent` links, not from a path baked into the URL. Browsing within one catalog never grows the browser's history (selecting different nodes replaces the current entry, not a new one per click), but opening a different catalog — or clicking the "STAC Lens" title to return to the landing page, its only "back" control — does, so the browser's own Back/Forward buttons move between catalogs/the landing page the way they would on an ordinary multi-page site, not out of the app entirely. When an API-backed Collection's Search box has an applied query, the URL also carries it — `#<href>?<query>`, with the query half using STAC's own real parameter names (`datetime`, `bbox`, `sortby`) so it's a direct, legible mirror of the actual request — opening a link with one restores and replays that exact search, draft controls and all, before the first result even renders.

**STAC API sources** — a Catalog/Collection can be a live query endpoint instead of (or alongside) a static link tree; detected per-node from its own `conformsTo`/`rel:search`/`rel:items` links, exactly as the spec allows (a whole API root can browse via `child` links down to Collection level while individual Collections are query-only, or vice versa — real, not hypothetical: confirmed directly against Earth Search and Microsoft Planetary Computer, neither of which has a single static `rel:item` link anywhere). Item Set transparently switches to real `/search`/OGC Features requests for such a node — the query panel's datetime/sort/bbox filters (see above) apply only to a *fresh* request; every "page" after that is a live network request paginated via the response's own `rel:next` link, followed verbatim rather than reconstructed (implementations disagree on whether they report a total match count at all, so Item Set never assumes one — the "showing N of M" count reflects the current query, not the whole Collection). A pure-API root can also have *no* static `rel:child` links at all down to Collection level either — Planetary Computer's is one, ~136 Collections deep with zero `child` links anywhere — discovered instead through its `rel:data` "Collections" listing endpoint (one request returns every Collection already fully formed, not a href needing a separate fetch each). "Earth Search (Element84)" and "Microsoft Planetary Computer" on the landing page are both live examples — Earth Search's Sentinel-2 collection alone reports 51+ million Items.

Not yet built (see `docs/DESIGN.md`'s own running deferred-list section for the full, current version of this list):

- CQL2 arbitrary-property filtering on an API-backed search — sort is built, but scoped to `properties.datetime` only (no per-field sort UI yet).
- A real draggable-timeline range picker for the Search box's own Date condition (showing a Collection's own declared temporal extent as a background reference, two draggable handles for start/end) — the two plain `<input type="date">` fields are the interim interaction.
- A different navigation paradigm for API-backed sources was raised early on and is substantially further along now than a single embedded query panel: an API-backed Collection gets its own dedicated Search box feeding a Results box (see "Structure Lens" above) — but whether that's the final shape of "how do you browse-by-querying inside a tree-structured app" is still an open question, not a settled one.
- In-browser COG/GeoTIFF rendering — real Item assets are routinely COG, which no browser decodes natively; today these get a trustworthy copy-paste link, not a rendered preview.
- Semantic zoom / virtualization once a collection's node count genuinely can't fit on screen even lazily.
- A point-cloud / vector / GeoParquet fixture as a fourth contrast case.
- Per-child error surfacing for a partially-broken catalog (a failed fetch during a batched load is silently dropped today, not shown as a visible broken node).
- Growing the landing page's known-catalog list further, and STAC Index's ~61 other STAC-API entries specifically (Earth Search proves the detection/fetch pipeline works; the rest haven't been individually vetted and added yet).

## Getting started

```bash
npm install
npm run dev          # Vite dev server, http://localhost:5173
npm run verify:fixtures  # headless data-layer check against two reference STAC catalogs, no UI
npm run lint
npm run build         # tsc -b && vite build
```

The landing page offers 102 verified known catalogs (filterable by name/description), plus free-text input for any other STAC `catalog.json` URL (subject to the target server allowing cross-origin browser requests — see below):

- **Africa Agriculture Adaptation Atlas** — a real, messy, deeply-nested static catalog (climate hazard rasters, scenarios, known metadata inconsistencies). The primary stress-test fixture.
- **STAC spec example catalog** — the spec's own minimal example tree, used as the "floor" case (bare-minimum valid STAC, empty collections, no extensions).
- **Earth Search (Element84)** and **Microsoft Planetary Computer** — real STAC APIs, not static catalogs (see "STAC API sources" above); one Earth Search collection alone reports 51+ million Items, and Planetary Computer's ~136 Collections are discovered entirely through its OGC "Collections" listing endpoint, since it has no static `rel:child` links at all.
- 33 more STAC APIs (Copernicus Data Space Ecosystem, NASA CMR, USGS Landsat, WorldPop, and others), each individually checked for a working `conformsTo`/CORS-open endpoint before being added.
- The rest sourced from [STAC Index](https://stacindex.org) (the same public directory STAC Browser itself defers to, rather than maintaining its own list) — a broad mix spanning satellite/SAR imagery, elevation/LiDAR, climate and hazard data, vector/cadastral layers, planetary science, and more, across space agencies, national mapping agencies, and open-data programs. STAC Index's static (non-API) side has grown since this list was last swept (85 listed there vs. 67 here) — a known gap, not yet closed.

Every entry — API or static — is individually checked for permissive CORS (a real GET request with an `Origin` header, not just reachability) and genuine STAC content before being added — never copied in from a directory listing blind. No backend — this is a pure frontend experiment, so a pasted URL that doesn't allow CORS, isn't valid STAC JSON, or is otherwise unreachable surfaces as a clear in-app error rather than a silent hang.

## Stack

TypeScript + React + Vite. `zustand` for shared state (selection, and what Item Set currently has loaded/visible). `d3-hierarchy` + `d3-shape` + `d3-zoom` + `d3-scale` for tree layout math, curved link paths, pan/zoom gestures, and the time axis; `d3-drag` (the standard, documented pairing with `d3-zoom`) for individually draggable nodes and the Item Set box, composed via `zoom.filter()` so the canvas's own pan never competes with a node/box being dragged — d3 owns only the math and gesture composition, all rendering is plain React/SVG. `leaflet` for Inspector's Spatial widget — a real interactive map (standard OSM tiles, no API key), the one real dependency exception to "no map library," adopted once a hand-rolled static projection turned out to have a genuine functional gap (island-sized bboxes need real zoom, not just a better picture; see `docs/DESIGN.md` §7–8). No UI component library; a small hand-written design-token layer (`src/design/tokens.css`) instead, deliberately avoiding an "enterprise dashboard" look.

## Project layout

```
src/
  stac/            framework-agnostic data layer
    types.ts         StacNode, TemporalShape, node-shape classification
    graph.ts         raw STAC JSON -> StacNode, link resolution/dedup; reads STAC 1.1 `bands`/`data_type`
                     as well as 1.0 `raster:bands`, keeps a Collection's declared bbox count
    loader.ts         href-keyed cache + in-flight dedup, lazy child/item fetch
    loaderInstance.ts  shared StacLoader singleton
    temporal.ts       instant/interval normalization, temporal bounds for layout
    spatial.ts        bbox/geometry normalization, defensive invalid-geometry fallback
    namespaces.ts     known-extension-prefix registry, per-scope namespace scanning
    describe.ts       plain-text temporal rendering helpers, plus approximate-area/hemisphere-labeled
                      coordinate text for a drawn bbox (the Search box's own Area condition)
    extensionFacts.ts standard-extension + Common Metadata human-readable interpreters
    itemSetSummary.ts common declared-extensions/namespaces across a set of Items
    apiSearch.ts      real STAC API /search + rel:items + rel:data (Collections listing) + rel:children
                      (Children extension) fetching, no backend needed -- fresh requests are GET and
                      optionally carry a datetime/bbox/sortby filter; a `next` link is followed exactly
                      as advertised, including the spec's method/headers/body/merge (POST pagination),
                      not just its href; filterToParams() is the single source of truth both the real
                      request and the shareable-URL encoding (searchQueryUrl.ts) build their params from
    conformance.ts    resolves a node's *governing API root's* conformsTo (only ever declared on the root),
                      e.g. to gate the Sort control on whether the server actually supports it; also
                      resolveSearchTarget(): a Collection's searches go to the root's GET /search
                      scoped by collections=<id>, falling back to its own rel:items link (see why above)
    searchQueryUrl.ts encode/decode an applied API search into the shareable-URL hash's own `?query`
                      suffix (split on the last literal `?`)
  hooks/
    useStructureTree.ts  lazy expand/collapse state -> nested tree datum for d3; opens to top
                         level only, expands ancestors of an external or deep-linked selection
    useSelectedItems.ts  resolves current selection -> the collection (own stated extent) + whichever
                         items Item Set currently has visible, for Inspector's Temporal/Spatial widgets
    useLinksPagedItemSet.ts    static catalogs: real page-based browsing over a node's known href array,
                               with a per-page cache (instant back-navigation) and every other cached
                               page's items exposed for the dimmed "still visible" treatment
    useCursorQueriedItemSet.ts API-backed Collections: cursor-following load-more, plus a locally-scoped
                               datetime/sort/bbox query -- search-first (idle status, no auto-fetch)
                               until Search is actually clicked; applies only on a fresh request
    usePagedCursorResults.ts  adapts the above's append-only buffer into the same numbered-page shape
                              useLinksPagedItemSet exposes -- a page already in the buffer is an instant
                              memoized slice, a page beyond it triggers a "catch-up" load-more first
    useApiConformance.ts      reactive wrapper over conformance.ts's root-resolution, for gating UI
    useElementSize.ts    ResizeObserver -> real container pixel size (for viewBox sizing)
    useShareableUrl.ts   URL hash <-> current catalog/selection/applied-API-search, both directions
  store/
    selection.ts      the shared selection store (zustand)
    itemSet.ts        what Item Set currently has loaded/visible, and (for an API-backed Collection) its
                      currently-applied search query, scoped by forHref (see components/ItemSetBrowser.tsx)
  components/
    LandingPage.tsx     URL input + known-catalog picker, the entry point before the explorer
    StructureTree.tsx  Structure Lens (SVG tree, pan/zoom, legend, tooltip, auto-pan-to-selection)
    TimeLens.tsx        Inspector's inline Temporal widget — resolves what to plot, wraps ItemsTimeline
    SpaceLens.tsx       Inspector's inline Spatial widget — resolves what to plot, wraps ItemsMap
    ItemsTimeline.tsx   pure "given items, draw their temporal shape" (grouping, lane packing, axis, optional wheel-zoom/drag-pan) — shared by TimeLens and ItemSetResultsPanel
    ItemsMap.tsx        pure "given items, draw their footprints, optionally draw-a-bbox" (Leaflet tiles/rectangles/fit-bounds) — shared by SpaceLens, ItemSetResultsPanel, and BboxPickerModal
    DetailPanel.tsx     Inspector (Human/JSON tabs, source + derived facts, embeds TimeLens/SpaceLens)
    ItemSetBrowser.tsx  the genuinely shared bits (ItemRow, TimeSpaceView, TabBar, pager style helpers) --
                        StructureTree.tsx itself branches on node.items.kind and renders the right box(es)
    LinksItemSetBrowser.tsx   static catalogs: one box, mapping useLinksPagedItemSet onto ItemSetResultsPanel
    ItemSetSearchPanel.tsx    API mode's own Search box content -- Date/Sort/Area condition rows, each
                              showing its own real applied value (not just "set"), Search/Clear footer
    ItemSetResultsPanel.tsx   the numbered-page results UI shared by both modes -- List/Time & Space tabs,
                              pager, page-size select; no "load all" affordance (deliberately removed)
    CursorItemSetPanels.tsx   the one hook instance (via usePagedCursorResults) behind both API-mode
                              boxes -- portals its Search-controls JSX and its Results-panel JSX into the
                              two separate foreignObjects StructureTree.tsx renders for that node
    BboxPickerModal.tsx       a full-size, document.body-portaled dialog wrapping ItemsMap -- opened from
                              the Search box's own "Draw on map" button; navigate-by-default (pan/zoom),
                              an explicit Draw-box tool that disarms after one drawn box, framed on the
                              Collection's extent (or the box being re-edited) when it opens
    EmptyState.tsx      shared empty/error placeholder (no spinner)
    LoadingState.tsx    shared loading placeholder (EmptyState + Spinner)
    Spinner.tsx         the one spinner animation used everywhere the app is loading something
    TabButton.tsx       the one tab-button style, shared by Inspector's Human/JSON and Item Set's List/Time & Space
  design/
    tokens.css          color/spacing/type tokens, light+dark
scripts/
  verify-fixtures.ts  headless data-layer verification against both fixtures (no UI)
```
