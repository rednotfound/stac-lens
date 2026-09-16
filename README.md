<p align="center">
  <img src="src/assets/stac-lens-logo.svg" width="96" height="96" alt="STAC Lens">
</p>

<h1 align="center">STAC Lens</h1>

<p align="center">
  See the shape of your STAC data — structure, time, and space as one coordinated view.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-144E63"></a>
  <img alt="STAC 1.0 and 1.1" src="https://img.shields.io/badge/STAC-1.0%20%7C%201.1-0EB4AE">
  <img alt="Client-side only" src="https://img.shields.io/badge/backend-none-C4E2EF">
</p>

<p align="center">
  <img src="docs/images/screenshot-structure.png" alt="STAC Lens exploring Microsoft Planetary Computer: the Structure Lens tree, a Collection's Search and Results boxes, and the Inspector" width="1000">
</p>

STAC Lens is a client-side visual explorer for [STAC](https://stacspec.org/) (SpatioTemporal Asset Catalog) catalogs and APIs. A STAC dataset has several shapes at once — the hierarchy its publisher curated, a spatial footprint, a temporal extent, and a metadata vocabulary. Most tools show one of these at a time. STAC Lens treats them as coordinated views of the same data: select a node in one and the others follow.

It is deliberately **not another STAC Browser**. It does not try to be the canonical way to read every field of every object; it tries to make a dataset's shape legible before you commit to reading it.

Full design rationale, research notes, and the reasoning behind every non-obvious decision live in [`docs/DESIGN.md`](docs/DESIGN.md).

## Highlights

**Structure Lens** — a horizontal, curved node-link tree over the Catalog → Collection graph. Items are never tree nodes: a Collection with two million Items is one leaf, not a wall. Nothing loads until you expand it; the canvas pans and zooms by direct manipulation (drag, wheel), and nodes and panels can be rearranged by hand. Selecting an Item highlights the Collection it belongs to with a dashed ring, distinct from the solid ring of a direct selection.

**Item Set, embedded in the tree** — selecting a Collection opens its Items right at that node, in window-style panels (title bar as drag handle, corner resize) rather than in a separate page. Static catalogs and API-backed Collections get genuinely different UI, because they are different things:

- A static catalog's Item list is known up front, so it gets **real numbered pagination** with a per-page cache.
- An API-backed Collection gets two independent, connected boxes: a **Search** box (date range, an area drawn on a real map, sort where the API declares support) feeding a **Results** box that presents the cursor's accumulated buffer as numbered pages. API mode is **search-first** — nothing is fetched until you ask.

Both share a **List / Time & Space** switcher: the same page of Items as a scrollable list, or as a zoomable timeline stacked over an interactive map. Already-visited pages stay faintly visible behind the current one.

**Inspector** — one panel per selected object, with a colored identity (Catalog / Collection / Item) that matches the tree. A **Human** tab renders facts as their natural UI — the temporal extent as a timeline, the spatial extent as a map, extensions (`eo`, `view`, `proj`, `sat`, `sar`, `sci`, `processing`, `grid`, `s2`, …) as readable rows — and a **JSON** tab shows the untouched source. Every derived field is labeled as derived; a field that isn't in the source isn't shown. Where sources contradict themselves (a `rel:collection` that disagrees with `rel:parent`, two spatial bboxes where STAC 1.1 allows one meaning) the contradiction is surfaced, not resolved silently.

**Shareable URLs** — the address bar always encodes what you're looking at: `#<absolute STAC href>`, plus an applied API search as `?datetime=…&bbox=…&sortby=…` using STAC's own parameter names. Paste the link anywhere and it reopens the same catalog, selection, and search. Browser Back/Forward move between catalogs and the landing page, not out of the app.

**Landing page** — one field that does two jobs: paste any STAC URL to open it, or filter 102 verified public catalogs and APIs (sourced from [STAC Index](https://stacindex.org), each checked for CORS and real STAC content).

<p align="center">
  <img src="docs/images/screenshot-landing.png" alt="The landing page: one search field over a grid of 102 verified public STAC catalogs and APIs" width="1000">
</p>

## STAC support

STAC Lens reads STAC 1.0 and 1.1 static catalogs and STAC APIs, and follows the specifications rather than any one server's habits:

| Area | What is supported |
|---|---|
| Static catalogs | `rel:child` / `rel:item` traversal; relative links resolved against the document URL (self-contained, relative-published and absolute catalogs) |
| STAC API - Core | capabilities read from the landing page's `conformsTo`; UI controls appear only when the server declares the class they need |
| STAC API - Features | `rel:items`, `/collections` listing (`rel:data`) for roots without `child` links |
| STAC API - Item Search | `GET /search` scoped with `collections=`, `bbox`, `datetime`; Sort extension when declared |
| Pagination | `next` links followed exactly as advertised — `href`, and the spec's `method` / `headers` / `body` / `merge` (POST-paginating servers included); `context` and `numberMatched` both understood, a total count never assumed |
| Children extension | `rel:children` → `/children`, preferred over one fetch per `child` link when a server offers it |
| STAC 1.1 | common `bands` / `data_type` (with `raster:bands` fallback), Link `method`/`body`, deprecated `license` values and the two-bbox rule flagged in the Inspector |
| Real-world behavior | verified against live servers — Earth Search, Microsoft Planetary Computer, Copernicus Data Space, NASA CMR and others — and worked around only where a server contradicts the spec (documented in `docs/DESIGN.md`) |

Not yet: CQL2 filtering and free-text search, arbitrary-field sort, `overview`/`visual` asset rendering, authenticated APIs, and in-browser COG display. The current list is kept in the last section of `docs/DESIGN.md`.

## Principles

- **Never enumerate what can't be enumerated.** A 51-million-Item collection is browsed through the API's own cursor, one page at a time. There is no "load everything".
- **Never invent structure.** The tree shows the hierarchy the publisher made — flat where it is flat. No client-side grouping, no synthetic nodes, no counts the source didn't give.
- **Show a failure as a failure.** A rejected request is an error message with the server's own words, never an empty result.
- **Direct manipulation over controls.** Drag to pan, wheel to zoom, drag a divider to resize; windows have title bars; the map pans by default and draws only when a tool is armed.
- **Conformance-gated UI.** A control that depends on a server capability exists only when the server declares it.

## Getting started

```bash
npm install
npm run dev              # Vite dev server on http://localhost:5173 (add --host to expose on your LAN)
npm run build            # tsc -b && vite build → dist/
npm run lint             # oxlint
npm run verify:fixtures  # headless data-layer check against two reference catalogs
```

Requires Node 20.19+ or 22.12+ (Vite 8's own range).

## Deploying

STAC Lens is a static site with no backend; every request goes from the visitor's browser straight to the STAC server they're exploring. Any static host works. Routing is hash-based, so no rewrite rules are needed.

- **Build command:** `npm run build` · **Publish directory:** `dist`
- Serve from a domain root (asset paths are absolute). For a sub-path, set Vite's `base`.
- Serve over HTTPS; browsers block requests from an HTTPS page to `http://` catalogs.
- A catalog that doesn't allow cross-origin requests (CORS) can't be opened from any client-side app, STAC Lens included — it is reported as such in the UI.

## Stack

TypeScript, React 19, Vite 8. `zustand` for shared state; `d3-hierarchy` / `d3-shape` / `d3-zoom` / `d3-drag` / `d3-scale` for layout math and gesture composition (rendering is plain React + SVG); `leaflet` with OpenStreetMap tiles for maps. No UI component library — a small design-token layer (`src/design/tokens.css`) with light and dark themes. The three hierarchy colors are the STAC logo's own three squares — Catalog `#C4E2EF`, Collection `#0EB4AE`, Item `#144E63` — used as hues with per-theme luminance so each reads on both surfaces; the same squares, under a lens, are the app's mark.

## Project layout

```
src/
  stac/            framework-agnostic data layer
    types.ts         StacNode, TemporalShape, node-shape classification
    graph.ts         raw STAC JSON -> StacNode, link resolution/dedup; reads STAC 1.1 bands/data_type
                     as well as 1.0 raster:bands, keeps a Collection's declared bbox count
    loader.ts        href-keyed cache + in-flight dedup, lazy child/item fetch
    loaderInstance.ts shared StacLoader singleton
    temporal.ts      instant/interval normalization, temporal bounds for layout
    spatial.ts       bbox/geometry normalization, defensive invalid-geometry fallback
    namespaces.ts    known-extension-prefix registry, per-scope namespace scanning
    describe.ts      plain-text temporal rendering, approximate-area / hemisphere-labeled bbox text
    extensionFacts.ts standard-extension + Common Metadata human-readable interpreters
    itemSetSummary.ts common declared-extensions/namespaces across a set of Items
    apiSearch.ts     /search, rel:items, /collections and /children fetching; next links followed
                     with method/headers/body/merge; filterToParams() is the single source of truth
                     for both the real request and the shareable-URL encoding
    conformance.ts   a node's governing API root's conformsTo (sort gating); resolveSearchTarget()
                     picks the root's GET /search?collections=<id> over the Collection's rel:items
    searchQueryUrl.ts encode/decode an applied search into the URL hash's ?query suffix
  hooks/
    useStructureTree.ts        lazy expand/collapse state -> tree datum for d3
    useSelectedItems.ts        current selection -> what Inspector's Temporal/Spatial widgets plot
    useLinksPagedItemSet.ts    static catalogs: page-based browsing over a known href array
    useCursorQueriedItemSet.ts API Collections: cursor-following, search-first query state
    usePagedCursorResults.ts   the cursor buffer presented as numbered pages ("catch-up" on a far jump)
    useApiConformance.ts       reactive root-conformance resolution for gating UI
    useElementSize.ts          ResizeObserver -> real container size
    useShareableUrl.ts         URL hash <-> catalog / selection / applied search, both directions
  store/
    selection.ts     the shared selection (selected vs. browsed node)
    itemSet.ts       what Item Set has loaded/visible and its applied query
  components/
    LandingPage.tsx          URL input + verified catalog grid
    StructureTree.tsx        Structure Lens: SVG tree, pan/zoom, legend, tooltip, the embedded boxes
    DetailPanel.tsx          Inspector (Human/JSON), embeds TimeLens/SpaceLens
    TimeLens.tsx / SpaceLens.tsx      Inspector's inline temporal / spatial widgets
    ItemsTimeline.tsx / ItemsMap.tsx  the pure timeline and map renderers, shared everywhere
    ItemSetBrowser.tsx       shared Item Set pieces (rows, tabs, pager styles)
    LinksItemSetBrowser.tsx  static catalogs: one box over useLinksPagedItemSet
    CursorItemSetPanels.tsx  API Collections: one hook behind the Search and Results boxes
    ItemSetSearchPanel.tsx   Date / Sort / Area condition rows
    ItemSetResultsPanel.tsx  numbered-page results, List / Time & Space
    BboxPickerModal.tsx      full-size map dialog: pan by default, explicit Draw-box tool
    Logo.tsx / ProjectLinks.tsx  the mark; repo link, GitHub mark, landing footer
    EmptyState.tsx / LoadingState.tsx / Spinner.tsx / TabButton.tsx  shared primitives
  design/
    tokens.css       color/spacing/type tokens, light + dark
scripts/
  verify-fixtures.ts headless data-layer verification (no UI)
```

## Acknowledgements

Built on the [STAC specification](https://github.com/radiantearth/stac-spec) and [STAC API](https://github.com/radiantearth/stac-api-spec), maintained by the STAC community; the catalog list comes from [STAC Index](https://stacindex.org). Maps by [Leaflet](https://leafletjs.com/) with tiles © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.

## License

[Apache-2.0](LICENSE).
