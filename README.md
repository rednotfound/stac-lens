# STAC Lens

An experimental, client-side visual explorer for [STAC](https://stacspec.org/) (SpatioTemporal Asset Catalog) datasets — not another STAC Browser.

**Core idea:** make the shape of a STAC dataset visible. A STAC dataset has curated structure (how the publisher organized it), spatial structure, temporal structure, and semantic/metadata structure at the same time. STAC Lens treats these as coordinated **lenses** on the same underlying data rather than separate pages — selecting a node in one lens highlights the corresponding data in the others.

See [`docs/DESIGN.md`](docs/DESIGN.md) for the full design rationale, research findings, and architecture notes.

## Status

Early prototype (v0.1). Working today:

- **Landing page** — paste any STAC catalog URL, or pick one of 8 verified known catalogs, before entering the explorer. Free-text URL input is the real "browse any STAC catalog" capability, not just a convenience. Nothing else renders until you enter a catalog and select something — progressive disclosure, not four permanently-visible panels.
- **Structure Lens** — a horizontal, curved node-link tree (not a file-explorer list) over the STAC Catalog → Collection → Item graph. Lazily fetches on expand, classifies each node's real shape (flat collection of items / collection-of-collections / mixed / genuinely empty) rather than assuming a fixed depth, auto-expands every Catalog down to (but not into) each Collection on load, and pans/zooms via drag + wheel (no sliders).
- **Time Lens** — a Wayback-Machine-style availability timeline scoped to whatever's selected in Structure. Renders instants, closed intervals, and open-ended intervals distinctly (never normalized to one point); groups Items sharing an identical temporal signature into one row and packs the rest into the minimum number of non-overlapping lanes (not one row per Item — a collection's-worth of Items no longer means a collection's-worth of vertical scrolling); overlays a Collection's *stated* temporal extent against the *actual* range of its Items, surfacing stated-vs-actual conflicts directly; and — the same scale problem Space Lens has with tiny bboxes — narrows the axis around a specifically-selected Item instead of always showing the full (possibly decades-wide) Collection span.
- **Space Lens** — a real interactive map (Leaflet + standard OSM tiles), bbox footprints as rectangles, real pan/zoom, and automatic fly-to-bounds on selection — a bbox the size of a small island is invisible at world scale no matter how good a static map is; only real zoom fixes that. Dark mode inverts the tiles via CSS rather than switching tile source.
- **Detail Inspector** — source STAC JSON always available, plus derived facts (namespace classification of known vs. unknown extension prefixes, geometry-validity fallback, schema hints) clearly labeled as derived, never merged into the source.

All four share one selection store, fully bidirectionally: selecting an Item in Time Lens or Space Lens auto-expands its ancestors in Structure Lens and pans the tree to bring it into view, highlighted, with a "selected: X" indicator and auto-scroll in Time Lens, and a fly-to-bounds zoom in Space Lens — not just shared state nobody can see manifested elsewhere.

Not yet built: STAC API (dynamic search) source support, a real Human/JSON toggle with extension-specific interpreters beyond namespace detection, semantic zoom / virtualization for very large collections, and a genuine Space↔Time *query* loop (select an area → see available dates; select a date → see footprints) — Space Lens is a real map now, but still selection-driven only, not query-driven.

## Getting started

```bash
npm install
npm run dev          # Vite dev server, http://localhost:5173
npm run verify:fixtures  # headless data-layer check against two reference STAC catalogs, no UI
npm run lint
npm run build         # tsc -b && vite build
```

The landing page offers 8 verified known catalogs, plus free-text input for any other STAC `catalog.json` URL (subject to the target server allowing cross-origin browser requests — see below):

- **Africa Agriculture Adaptation Atlas** — a real, messy, deeply-nested static catalog (climate hazard rasters, scenarios, known metadata inconsistencies). The primary stress-test fixture.
- **STAC spec example catalog** — the spec's own minimal example tree, used as the "floor" case (bare-minimum valid STAC, empty collections, no extensions).
- Six more sourced from [STAC Index](https://stacindex.org) (the same public directory STAC Browser itself defers to, rather than maintaining its own list) — Capella Space Open Data (SAR), Maxar Open Data (optical/disaster response), NZ Imagery (aerial, 800+ links — a real wide-catalog scale test), Overture Maps Releases (vector), fiboa Field Boundaries (vector/agricultural), and Polar Geospatial Center DEMs (elevation).

All are static catalogs fetched directly from the browser, individually checked for permissive CORS before being added. No backend — this is a pure frontend experiment, so a pasted URL that doesn't allow CORS, isn't valid STAC JSON, or is otherwise unreachable surfaces as a clear in-app error rather than a silent hang.

## Stack

TypeScript + React + Vite. `zustand` for the one shared selection store. `d3-hierarchy` + `d3-shape` + `d3-zoom` + `d3-scale` for tree layout math, curved link paths, pan/zoom gestures, and the time axis — d3 owns only the math, all rendering is plain React/SVG. `leaflet` for Space Lens's real interactive map (standard OSM tiles, no API key) — the one real dependency exception to "no map library," adopted once a hand-rolled static projection turned out to have a genuine functional gap (island-sized bboxes need real zoom, not just a better picture; see `docs/DESIGN.md` §7–8). No UI component library; a small hand-written design-token layer (`src/design/tokens.css`) instead, deliberately avoiding an "enterprise dashboard" look.

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
  hooks/
    useStructureTree.ts  lazy expand/collapse state -> nested tree datum for d3; auto-expands
                         Catalogs to Collection depth, and ancestors of an external selection
    useSelectedItems.ts  resolves current selection -> the collection + items Time/Space Lens show
    useElementSize.ts    ResizeObserver -> real container pixel size (for viewBox sizing)
  store/
    selection.ts      the one shared selection store (zustand)
  components/
    LandingPage.tsx     URL input + known-catalog picker, the entry point before the explorer
    StructureTree.tsx  Structure Lens (SVG tree, pan/zoom, legend, tooltip, auto-pan-to-selection)
    TimeLens.tsx        Time Lens (SVG timeline, grouping + lane packing, auto-scroll-to-selection)
    SpaceLens.tsx       Space Lens (Leaflet map + bbox rectangles, fly-to-bounds on selection)
    DetailPanel.tsx     Detail Inspector
    EmptyState.tsx      shared empty/loading placeholder
  design/
    tokens.css          color/spacing/type tokens, light+dark
scripts/
  verify-fixtures.ts  headless data-layer verification against both fixtures (no UI)
```
