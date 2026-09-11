# STAC Lens

An experimental, client-side visual explorer for [STAC](https://stacspec.org/) (SpatioTemporal Asset Catalog) datasets — not another STAC Browser.

**Core idea:** make the shape of a STAC dataset visible. A STAC dataset has curated structure (how the publisher organized it), spatial structure, temporal structure, and semantic/metadata structure at the same time. STAC Lens treats these as coordinated views on the same underlying data rather than separate pages — selecting a node in one view highlights the corresponding data in the others.

See [`docs/DESIGN.md`](docs/DESIGN.md) for the full design rationale, research findings, and architecture notes.

## Status

Early prototype (v0.1). Working today:

- **Landing page** — one search box that does both jobs: paste a full URL to open it directly, or type anything else to filter 69 verified known catalogs live, laid out as a wide card grid (not a cramped single-column list). Free-text URL input is the real "browse any STAC catalog" capability, not just a convenience. Nothing else renders until you enter a catalog and select something — progressive disclosure, not several permanently-visible panels.
- **Structure Lens** — a horizontal, curved node-link tree (not a file-explorer list) over the STAC Catalog → Collection graph *only* — Items are deliberately never tree nodes, so a Collection holding thousands of them renders as a single labeled leaf ("N items" / "items via API search"), not a wall of children. Lazily fetches on expand and pans/zooms via drag + wheel (no sliders). Opens showing only the top level — a "Collapse to top level" / "Expand all catalogs" button pair lets you go back to that baseline or cascade every Catalog down to (but not into) Collection level on demand, instead of an unfamiliar deep catalog auto-loading more than you asked to see. Selecting an Item (from Item Set or Inspector's own Temporal/Spatial widgets) highlights the Collection it belongs to with a dashed ring, distinct from the solid ring around an exact Catalog/Collection selection; the tree's own layout pushes sibling nodes aside to make room rather than overlapping them. Selecting a Collection/Catalog with direct Items opens a rich **Item Set** browser right there, embedded inline in the tree at that node's position (not off in a separate panel) — an id/title filter box and a tall, scrollable list (sized to actually convey "this Collection holds thousands," not a 3-row glance) that auto-scrolls to whichever Item is currently selected, from wherever the selection came from. For an API-backed node, Item Set's first page is the API's own unfiltered default order, paged via scroll/"Load all remaining" — there's no bbox/datetime query UI today (see "Not yet built" below).
- **Inspector** — one panel per selected node, with its own recognizable identity: a colored left border and colored type label (Catalog/Collection/Item) reusing Structure Lens's own tree-node colors, so which kind of object you're looking at is never ambiguous. Two tabs: **Human** (derived, readable facts, the default) and **JSON** (the untouched source document). Under Human, every field is either a direct source fact or a clearly-labeled derived one — no silent interpretation:
  - **Temporal** and **Spatial** render as an actual Time UI (a Wayback-Machine-style availability timeline: instants/closed/open-ended intervals rendered distinctly, identical-timing Items grouped into one row, non-overlapping Items packed into minimum lanes, stated-vs-actual conflicts surfaced directly) and a real Space UI (a real interactive Leaflet map: item-footprint rectangles, automatic fly-to-bounds, dark mode via CSS filter) — not a number or a bbox array — right where those fields sit in the page, not off in a separate panel. Precisely scoped: selecting a Collection alone shows only its own *stated* extent; selecting *one* Item shows only that Item's own mark/footprint, never a sibling's or its Collection's stated extent leaking in; Item Set's currently browsed/filtered set is what would populate the full neighborhood of marks, opt-in (not built into any UI yet — see "Not yet built").
  - Collection/Catalog-level source fields: Description, License, Keywords, Providers (with clickable links), Created/Updated, and a "Containment (source)" field showing declared `rel:collection`/`rel:parent`/`rel:root` links as separate facts, flagging it when the first two disagree rather than silently picking one (confirmed to happen in the wild — Capella Open Data).
  - Item-level Common Metadata (platform/instruments/constellation/mission/gsd) and standard-extension facts (`eo`/`view`/`proj`/`sat`/`sar`/`sci`/`processing`/`grid`/`s2`/...), each only shown when actually present — never a placeholder for a missing field.
  - Declared extensions and observed property namespaces, each annotated with what's common across Item Set's currently browsed set when there is one.
  - A single header toggle (top right) shows/hides the whole Inspector column, giving Structure Lens the full window back without losing the current selection.

**Shareable URLs, and a real Back button** — selecting anything updates the address bar to `#<that node's absolute href>` (e.g. `stac-lens.example/#https://.../item.json` — a raw hash fragment, not a percent-encoded query param, so it stays human-readable); pasting that URL fresh opens straight to the same catalog, selection, and highlighted state everywhere, no manual re-navigation. Works for any node (Catalog/Collection/Item) fetched from anywhere in the tree — the app finds its way back to the catalog root live via the node's own `rel:root`/`rel:parent` links, not from a path baked into the URL. Browsing within one catalog never grows the browser's history (selecting different nodes replaces the current entry, not a new one per click), but opening a different catalog — or clicking the "STAC Lens" title to return to the landing page, its only "back" control — does, so the browser's own Back/Forward buttons move between catalogs/the landing page the way they would on an ordinary multi-page site, not out of the app entirely.

**STAC API sources** — a Catalog/Collection can be a live query endpoint instead of (or alongside) a static link tree; detected per-node from its own `conformsTo`/`rel:search`/`rel:items` links, exactly as the spec allows (a whole API root can browse via `child` links down to Collection level while individual Collections are query-only, or vice versa — real, not hypothetical: confirmed directly against Earth Search and Microsoft Planetary Computer, neither of which has a single static `rel:item` link anywhere). Item Set transparently switches to real `/search`/OGC Features requests for such a node — same scroll-to-load-more, but each "page" is a live network request paginated via the response's own `rel:next` link (implementations disagree on whether they report a total match count at all, so Item Set never assumes one). A pure-API root can also have *no* static `rel:child` links at all down to Collection level either — Planetary Computer's is one, ~136 Collections deep with zero `child` links anywhere — discovered instead through its `rel:data` "Collections" listing endpoint (one request returns every Collection already fully formed, not a href needing a separate fetch each). "Earth Search (Element84)" and "Microsoft Planetary Computer" on the landing page are both live examples — Earth Search's Sentinel-2 collection alone reports 51+ million Items.

Not yet built (see `docs/DESIGN.md`'s own running deferred-list section for the full, current version of this list):

- An interactive bbox/datetime query UI for API-backed sources — an earlier version of this existed (draw a rectangle on the map, drag a range on the timeline, Search/Clear in Item Set) and was deliberately removed rather than kept alongside Inspector's inline Time/Space widgets, pending a broader rethink of what UI/navigation paradigm API-backed sources actually deserve (drawing/querying on a map or timeline doesn't fit the tree-structure navigation model the rest of the app is built around). Until that's designed, an API-backed Collection is browsable only via its own unfiltered default order.
- CQL2 property filtering / sort on an API-backed search.
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

The landing page offers 69 verified known catalogs (filterable by name/description), plus free-text input for any other STAC `catalog.json` URL (subject to the target server allowing cross-origin browser requests — see below):

- **Africa Agriculture Adaptation Atlas** — a real, messy, deeply-nested static catalog (climate hazard rasters, scenarios, known metadata inconsistencies). The primary stress-test fixture.
- **STAC spec example catalog** — the spec's own minimal example tree, used as the "floor" case (bare-minimum valid STAC, empty collections, no extensions).
- **Earth Search (Element84)** — a real STAC API, not a static catalog (see "STAC API sources" above); one collection alone reports 51+ million Items.
- The rest sourced from [STAC Index](https://stacindex.org) (the same public directory STAC Browser itself defers to, rather than maintaining its own list) — a broad mix spanning satellite/SAR imagery, elevation/LiDAR, climate and hazard data, vector/cadastral layers, planetary science, and more, across space agencies, national mapping agencies, and open-data programs. STAC Index's other ~60 STAC API entries haven't been individually vetted and added yet — Earth Search proves the pipeline works, but growing this list the same methodical way the static one was grown is still to do.

All are static catalogs fetched directly from the browser, individually checked for permissive CORS (a real GET request with an `Origin` header, not just reachability) and genuine STAC content before being added — never copied in from a directory listing blind. No backend — this is a pure frontend experiment, so a pasted URL that doesn't allow CORS, isn't valid STAC JSON, or is otherwise unreachable surfaces as a clear in-app error rather than a silent hang.

## Stack

TypeScript + React + Vite. `zustand` for shared state (selection, and what Item Set currently has loaded/visible). `d3-hierarchy` + `d3-shape` + `d3-zoom` + `d3-scale` for tree layout math, curved link paths, pan/zoom gestures, and the time axis; `d3-drag` (the standard, documented pairing with `d3-zoom`) for individually draggable nodes and the Item Set box, composed via `zoom.filter()` so the canvas's own pan never competes with a node/box being dragged — d3 owns only the math and gesture composition, all rendering is plain React/SVG. `leaflet` for Inspector's Spatial widget — a real interactive map (standard OSM tiles, no API key), the one real dependency exception to "no map library," adopted once a hand-rolled static projection turned out to have a genuine functional gap (island-sized bboxes need real zoom, not just a better picture; see `docs/DESIGN.md` §7–8). No UI component library; a small hand-written design-token layer (`src/design/tokens.css`) instead, deliberately avoiding an "enterprise dashboard" look.

## Project layout

```
src/
  stac/            framework-agnostic data layer
    types.ts         StacNode, TemporalShape, node-shape classification
    graph.ts         raw STAC JSON -> StacNode, link resolution/dedup
    loader.ts         href-keyed cache + in-flight dedup, lazy child/item fetch
    loaderInstance.ts  shared StacLoader singleton
    temporal.ts       instant/interval normalization, temporal bounds for layout
    spatial.ts        bbox/geometry normalization, defensive invalid-geometry fallback
    namespaces.ts     known-extension-prefix registry, per-scope namespace scanning
    describe.ts       plain-text temporal rendering helpers
    extensionFacts.ts standard-extension + Common Metadata human-readable interpreters
    itemSetSummary.ts common declared-extensions/namespaces across a set of Items
    apiSearch.ts      real STAC API /search + rel:items + rel:data (Collections listing) fetching (GET, no backend needed)
  hooks/
    useStructureTree.ts  lazy expand/collapse state -> nested tree datum for d3; opens to top
                         level only, expands ancestors of an external or deep-linked selection
    useSelectedItems.ts  resolves current selection -> the collection (own stated extent) + whichever
                         items Item Set currently has visible, for Inspector's Temporal/Spatial widgets
    useItemSet.ts        incrementally-loaded, scroll-paged view over a node's own direct items
    useElementSize.ts    ResizeObserver -> real container pixel size (for viewBox sizing)
    useShareableUrl.ts   URL hash <-> current catalog/selection, both directions
  store/
    selection.ts      the shared selection store (zustand)
    itemSet.ts        what Item Set currently has loaded + search-filtered
  components/
    LandingPage.tsx     URL input + known-catalog picker, the entry point before the explorer
    StructureTree.tsx  Structure Lens (SVG tree, pan/zoom, legend, tooltip, auto-pan-to-selection)
    TimeLens.tsx        Inspector's inline Temporal widget (SVG timeline, grouping + lane packing)
    SpaceLens.tsx       Inspector's inline Spatial widget (Leaflet map, fly-to-bounds on selection)
    DetailPanel.tsx     Inspector (Human/JSON tabs, source + derived facts, embeds TimeLens/SpaceLens)
    ItemSetBrowser.tsx  id/title filter + scroll-to-load-more list over a Collection's own items
    EmptyState.tsx      shared empty/loading placeholder
  design/
    tokens.css          color/spacing/type tokens, light+dark
scripts/
  verify-fixtures.ts  headless data-layer verification against both fixtures (no UI)
```
