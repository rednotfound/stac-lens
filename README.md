# STAC Lens

An experimental, client-side visual explorer for [STAC](https://stacspec.org/) (SpatioTemporal Asset Catalog) datasets — not another STAC Browser.

**Core idea:** make the shape of a STAC dataset visible. A STAC dataset has curated structure (how the publisher organized it), spatial structure, temporal structure, and semantic/metadata structure at the same time. STAC Lens treats these as coordinated **lenses** on the same underlying data rather than separate pages — selecting a node in one lens highlights the corresponding data in the others.

See [`docs/DESIGN.md`](docs/DESIGN.md) for the full design rationale, research findings, and architecture notes.

## Status

Early prototype (v0.1). Working today:

- **Landing page** — one search box that does both jobs: paste a full URL to open it directly, or type anything else to filter 68 verified known catalogs live, laid out as a wide card grid (not a cramped single-column list). Free-text URL input is the real "browse any STAC catalog" capability, not just a convenience. Nothing else renders until you enter a catalog and select something — progressive disclosure, not four permanently-visible panels.
- **Structure Lens** — a horizontal, curved node-link tree (not a file-explorer list) over the STAC Catalog → Collection graph *only* — Items are deliberately never tree nodes, so a Collection holding thousands of them renders as a single labeled leaf ("N items" / "items via API search"), not a wall of children. Lazily fetches on expand and pans/zooms via drag + wheel (no sliders). Opens showing only the top level — a "Collapse to top level" / "Expand all catalogs" button pair lets you go back to that baseline or cascade every Catalog down to (but not into) Collection level on demand, instead of an unfamiliar deep catalog auto-loading more than you asked to see. Selecting an Item (from Item Set, Time Lens, or Space Lens) highlights the Collection it belongs to with a dashed ring, distinct from the solid ring around an exact Catalog/Collection selection; the tree's own layout pushes sibling nodes aside to make room rather than overlapping them. Selecting a Collection/Catalog with direct Items opens a rich **Item Set** browser right there, embedded inline in the tree at that node's position (not off in a separate panel) — a search box, Space/Time-driven query controls for API-backed nodes (see below), and a tall, scrollable list (sized to actually convey "this Collection holds thousands," not a 3-row glance) that auto-scrolls to whichever Item is currently selected, from wherever the selection came from.
- **Time Lens** — a Wayback-Machine-style availability timeline scoped to whatever's selected — precisely scoped: selecting a Collection alone shows only its own *stated* temporal extent (no bulk fetch of its Items just to draw a timeline); selecting *one* Item shows only that Item's own mark, not its neighbors — comparing against siblings is Item Set's job, not Detail's; browsing/searching Item Set (below) without narrowing to one Item is what populates the full neighborhood of marks, live-narrowing as you type. Renders instants, closed intervals, and open-ended intervals distinctly (never normalized to one point); groups Items sharing an identical temporal signature into one row and packs the rest into the minimum number of non-overlapping lanes; overlays the stated extent against the *actual* range of visible Items, surfacing stated-vs-actual conflicts directly; narrows the axis around a specifically-selected Item instead of always showing the full (possibly decades-wide) Collection span; and, for an API-searched node, a "Select range" tool to drag out a datetime range as a real query input (see below).
- **Space Lens** — a real interactive map (Leaflet + standard OSM tiles), same scoping principle as Time Lens: a stated bbox rectangle by default, every visible Item's footprint while browsing Item Set, exactly one footprint once a specific Item is selected. Real pan/zoom and automatic fly-to-bounds on selection — a bbox the size of a small island is invisible at world scale no matter how good a static map is; only real zoom fixes that. Dark mode inverts the tiles via CSS rather than switching tile source. For an API-searched node, a "Draw area" tool lets you drag out a real bbox as a query input (see below).
- **Detail Inspector** — source STAC JSON always available, plus derived facts (namespace classification of known vs. unknown extension prefixes, geometry-validity fallback, schema hints) clearly labeled as derived, never merged into the source. A "Containment (source)" field shows a node's declared `rel:collection`/`rel:parent`/`rel:root` links as separate facts, flagging it when the first two disagree rather than silently picking one (confirmed to happen in the wild — Capella Open Data). Lives together with Time Lens and Space Lens in one scrollable column next to Structure Lens (see below) rather than a separate row — Item Set itself lives inline in the tree (see Structure Lens above), not here; this panel points at it rather than duplicating it. Item Set's current search-filtered results are what Time/Space Lens actually plot — fetched in slices as you scroll (or in one go via "Load all remaining" for an API-backed node) since real large catalogs enumerate items as one flat link array with no pagination of their own (see `docs/DESIGN.md` §19), and a STAC API's own `limit` bounds mean pagination itself can never fully go away, only how big each page is.

All four share one selection store, fully bidirectionally: selecting an Item (from Item Set, Time Lens, or Space Lens) pans Structure Lens to the Collection it belongs to and highlights it with a dashed ring, with a "selected: X" indicator and auto-scroll in Time Lens, and a fly-to-bounds zoom in Space Lens — not just shared state nobody can see manifested elsewhere. Detail, Time, and Space live together in one scrollable Inspector column next to Structure Lens (not a separate row below both), each toggleable off independently (header pill buttons); Structure Lens reclaims full width only once all three are off, and otherwise keeps its full height regardless of how much there is to show in that column.

**Shareable URLs** — selecting anything updates the address bar to `#<that node's absolute href>` (e.g. `stac-lens.example/#https://.../item.json` — a raw hash fragment, not a percent-encoded query param, so it stays human-readable); pasting that URL fresh opens straight to the same catalog, selection, and highlighted state everywhere, no manual re-navigation. Works for any node (Catalog/Collection/Item) fetched from anywhere in the tree — the app finds its way back to the catalog root live via the node's own `rel:root`/`rel:parent` links, not from a path baked into the URL.

**STAC API sources** — a Catalog/Collection can be a live query endpoint instead of (or alongside) a static link tree; detected per-node from its own `conformsTo`/`rel:search`/`rel:items` links, exactly as the spec allows (a whole API root can browse via `child` links down to Collection level while individual Collections are query-only, or vice versa — real, not hypothetical: confirmed directly against Earth Search and Microsoft Planetary Computer, neither of which has a single static `rel:item` link anywhere). Item Set transparently switches to real `/search`/OGC Features requests for such a node — same search box (relabeled to a secondary "filter loaded results" role here, not the primary way in — machine-generated ids/titles aren't a realistic search key at this scale), same scroll-to-load-more, but each "page" is a live network request paginated via the response's own `rel:next` link (implementations disagree on whether they report a total match count at all, so Item Set never assumes one). "Earth Search (Element84)" on the landing page is a live example — one of its collections alone reports 51+ million Items.

**The real Space↔Time query loop** — for an API-searched node, Space Lens gets a "Draw area" tool (drag a rectangle on the map; disables the map's own pan for the gesture) and Time Lens a parallel "Select range" tool (drag along the axis), both manual draw-then-release rather than live-as-you-drag (a query against a 51M-item collection firing on every mouse-move would be wasteful). A query summary plus Search/Clear buttons appears in Item Set; clicking Search re-runs the API request with the drawn bbox and/or dragged datetime range actually applied, replacing the unfiltered default. Verified against the real Earth Search API: drawing an area and a date range and searching produces a correctly-formed request (`bbox=west,south,east,north`, `datetime=start/end` in RFC 3339) with real, correctly-scoped results back.

Not yet built: a real Human/JSON toggle with extension-specific interpreters beyond namespace detection, DOM-row virtualization for the Item Set browser past what's been exercised so far, and CQL2 property filtering / Sort on an API-backed search (bbox and datetime are the only query dimensions today).

## Getting started

```bash
npm install
npm run dev          # Vite dev server, http://localhost:5173
npm run verify:fixtures  # headless data-layer check against two reference STAC catalogs, no UI
npm run lint
npm run build         # tsc -b && vite build
```

The landing page offers 68 verified known catalogs (filterable by name/description), plus free-text input for any other STAC `catalog.json` URL (subject to the target server allowing cross-origin browser requests — see below):

- **Africa Agriculture Adaptation Atlas** — a real, messy, deeply-nested static catalog (climate hazard rasters, scenarios, known metadata inconsistencies). The primary stress-test fixture.
- **STAC spec example catalog** — the spec's own minimal example tree, used as the "floor" case (bare-minimum valid STAC, empty collections, no extensions).
- **Earth Search (Element84)** — a real STAC API, not a static catalog (see "STAC API sources" above); one collection alone reports 51+ million Items.
- The rest sourced from [STAC Index](https://stacindex.org) (the same public directory STAC Browser itself defers to, rather than maintaining its own list) — a broad mix spanning satellite/SAR imagery, elevation/LiDAR, climate and hazard data, vector/cadastral layers, planetary science, and more, across space agencies, national mapping agencies, and open-data programs. STAC Index's other ~60 STAC API entries haven't been individually vetted and added yet — Earth Search proves the pipeline works, but growing this list the same methodical way §19 grew the static one is still to do.

All are static catalogs fetched directly from the browser, individually checked for permissive CORS (a real GET request with an `Origin` header, not just reachability) and genuine STAC content before being added — never copied in from a directory listing blind. No backend — this is a pure frontend experiment, so a pasted URL that doesn't allow CORS, isn't valid STAC JSON, or is otherwise unreachable surfaces as a clear in-app error rather than a silent hang.

## Stack

TypeScript + React + Vite. `zustand` for the one shared selection store. `d3-hierarchy` + `d3-shape` + `d3-zoom` + `d3-scale` for tree layout math, curved link paths, pan/zoom gestures, and the time axis; `d3-drag` (the standard, documented pairing with `d3-zoom`) for individually draggable nodes and the Item Set box, composed via `zoom.filter()` so the canvas's own pan never competes with a node/box being dragged — d3 owns only the math and gesture composition, all rendering is plain React/SVG. `leaflet` for Space Lens's real interactive map (standard OSM tiles, no API key) — the one real dependency exception to "no map library," adopted once a hand-rolled static projection turned out to have a genuine functional gap (island-sized bboxes need real zoom, not just a better picture; see `docs/DESIGN.md` §7–8). No UI component library; a small hand-written design-token layer (`src/design/tokens.css`) instead, deliberately avoiding an "enterprise dashboard" look.

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
    apiSearch.ts      real STAC API /search + rel:items page fetching (GET, no backend needed)
  hooks/
    useStructureTree.ts  lazy expand/collapse state -> nested tree datum for d3; opens to top
                         level only, expands ancestors of an external or deep-linked selection
    useSelectedItems.ts  resolves current selection -> the collection (own stated extent) + whichever
                         items Item Set currently has visible, for Time/Space Lens to show
    useItemSet.ts        incrementally-loaded, scroll-paged view over a node's own direct items
    useElementSize.ts    ResizeObserver -> real container pixel size (for viewBox sizing)
    useShareableUrl.ts   URL hash <-> current catalog/selection, both directions
  store/
    selection.ts      the one shared selection store (zustand)
    itemSet.ts        what Item Set currently has loaded + search-filtered, read by Time/Space Lens
    query.ts          draft bbox/datetime for an API search, drawn on Space/Time Lens, applied on "Search"
  components/
    LandingPage.tsx     URL input + known-catalog picker, the entry point before the explorer
    StructureTree.tsx  Structure Lens (SVG tree, pan/zoom, legend, tooltip, auto-pan-to-selection)
    TimeLens.tsx        Time Lens (SVG timeline, grouping + lane packing, auto-scroll-to-selection)
    SpaceLens.tsx       Space Lens (Leaflet map + bbox rectangles, fly-to-bounds on selection)
    DetailPanel.tsx     Detail Inspector
    ItemSetBrowser.tsx  search + scroll-to-load-more list over a Collection's own items
    EmptyState.tsx      shared empty/loading placeholder
  design/
    tokens.css          color/spacing/type tokens, light+dark
scripts/
  verify-fixtures.ts  headless data-layer verification against both fixtures (no UI)
```
