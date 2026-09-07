# STAC Lens — design decisions and research notes

This is the "why" document. Code comments explain non-obvious local decisions;
this file explains the decisions that shaped the architecture and the real
data that drove them. Read this before making a structural change — several
choices here look arbitrary until you see the fixture data that forced them.

## 1. Product framing

STAC Lens is not a conventional STAC Browser. Traditional browsers expose the
authored Catalog → Collection → Item → Asset hierarchy plus maps/tables/filters.
STAC Lens instead treats a STAC dataset as something with several kinds of
structure at once — curated (publisher's information architecture), spatial,
temporal, and semantic/metadata — and renders them as coordinated **lenses**:
Structure, Time, Space, Detail. A selection in one eventually affects the
others. Time is a first-class visual object (Wayback-Machine-style
availability, not a date-picker form). Space is a discovery axis, not a
basemap widget. See the original product brief (conversation history) for the
full set of design principles; the ones with direct architectural
consequences are repeated below next to the decision they drove.

Design principles that show up directly in code, not just prose:
- Preserve publisher intent — the authored hierarchy is never flattened away.
- Items bridge curated structure and emergent spatiotemporal structure.
- Source / derived / enriched are distinct layers, always labeled, never merged.
- Unknown metadata must remain accessible; known extensions enrich, unknown
  extensions degrade gracefully — never crash the app.
- Never silently "fix" source metadata; surface inconsistencies instead.

## 2. Reference fixtures (why three, not one)

The first design pass researched only the **Africa Agriculture Adaptation
Atlas** (`https://digital-atlas.s3.amazonaws.com/stac/public_stac/catalog.json`)
and nearly baked its quirks into the core data model. That was flagged
explicitly: *don't design STAC Lens around this dataset*. Two more fixtures
were researched specifically to pull the architecture in different
directions before the model was finalized:

| Fixture | Role | What it forced |
|---|---|---|
| Africa Adaptation Atlas | messy static catalog | non-uniform tree depth, invalid geometry, undeclared custom namespace, stated-vs-actual conflicts, ID/property mismatches |
| Element84 Earth Search (`sentinel-2-l2a`) | dynamic STAC **API**, 51M items in one collection | loader-strategy abstraction (static links vs. `/search`), "items are a stream, never an enumerable array", `summaries`/`item_assets` as non-authoritative schema hints, open-ended temporal extents |
| STAC spec's own example catalog | minimal "floor" case | Catalogs legitimately have no extent; empty Collections are a genuine terminal state, not "unloaded"; an Item can have no Collection ancestor at all; unregistered custom fields can sit beside declared-extension fields in the same properties object; extension fields can live at Asset scope, overriding Item scope |

Only Atlas and the spec-minimal example are wired into the app today (both
are static, so both use the same loader strategy). Earth Search validated the
data model's shape but needs the API-search loader strategy (see §7) before
it can be added as a third selectable fixture — that's the natural on-ramp
for Space Lens becoming a real spatial query instead of a passive display.

**Rule of thumb going forward:** before changing `StacNode`, `TemporalShape`,
or the namespace/extension model, check whether the change holds across all
three fixtures' documented quirks above, not just Atlas.

## 3. Data model (`src/stac/types.ts`)

```ts
type NodeShape = 'branch-collections' | 'leaf-items' | 'mixed' | 'leaf-empty'
```

Deliberately *not* derived from tree depth or from `Catalog`/`Collection`/`Item`
type alone. Real STAC graphs are not uniform-depth trees: two sibling
Collections at the same nesting level in Atlas's `hazard_catalog` differ —
one is a flat bag of 51 Items, the other has zero direct Items and is itself
a bag of 11 sub-Collections. The spec-minimal fixture adds `mixed` (a Catalog
with both child Collections *and* a direct child Item) and `leaf-empty` as a
genuine terminal state (a Collection that will never have Items, not one
that's merely unloaded). `classifyNodeShape()` looks at actual `childHrefs`
vs. `items` link presence, at every level, generically.

```ts
type TemporalShape =
  | { kind: 'instant'; at: string }
  | { kind: 'interval'; start: string | null; end: string | null }
```

Both interval bounds are independently nullable. `datetime: null` +
`start_datetime`/`end_datetime` is the correct spec pattern for a bounded
interval (used consistently in Atlas's hazard branch). A *null bound within
an interval* is a different, real case — an "ongoing" open-ended extent
(Earth Search's collection extent is `[2015-06-27, null]`; the spec-minimal
`sentinel-2` collection uses the same pattern). Renderers must not guess a
date for a null bound — Time Lens clamps to the visible domain and marks it
with a dashed edge + arrow rather than inventing an end date.

```ts
interface SpatialExtent {
  bbox?: number[]
  geometry?: GeoJSON.Geometry
  geometryInvalid?: boolean
}
```

`geometryInvalid` exists because Atlas's entire hazard branch stores
`geometry` as a bare 4-element bbox array — a hard GeoJSON/STAC spec
violation, not an alternate valid form (confirmed by contrast with Earth
Search and MapSpam items in the same catalog, which use proper GeoJSON
Polygons). `normalizeSpatial()` (`src/stac/spatial.ts`) detects this and
falls back to bbox-only rather than crashing or pretending the geometry is
valid. This is exactly the kind of thing Detail Inspector surfaces to the
user (a visible ⚠ + explanation) instead of silently coping with it.

```ts
declaredExtensions: string[]      // stac_extensions, as published
propertyNamespaces: string[]      // every "prefix:" seen in properties/assets/summaries
```

These are tracked *separately* on purpose. `stac_extensions` is not a
reliable signal for "is this field known" in either direction: Atlas's
`atlas:*` fields are used pervasively with zero `stac_extensions` entry;
Earth Search's `item_assets` under-declares real asset keys (items have 3
more asset keys than `item_assets` lists); the spec-minimal fixture has an
unregistered `cs:*` field sitting in the same properties object as a
correctly-declared `view:sun_elevation`. The Extension Registry
(`src/stac/namespaces.ts`) classifies every observed prefix by matching it
against a small known-prefix table, independent of what's declared —
unknown prefixes are always kept and shown, never dropped or treated as an
error (see Detail Panel's namespace badges: green = known, red = unknown,
never a broken render either way).

`href` (not `id`) is the canonical key for a `StacNode`. STAC `id`s are not
guaranteed globally unique across a whole catalog tree; the fetched URL is.

## 4. Loader (`src/stac/loader.ts`, `src/stac/graph.ts`)

`StacLoader` is an href-keyed cache with in-flight request dedup (two nodes
linking to the same child href trigger one fetch, not two) and nothing else
— it never eagerly walks anything. That single rule is what keeps the app
alive against Earth Search's 51-million-item collection and Atlas's
2.4MB-inlined 16,000-item `nex-gddp-cmip6-hazards` collection: both were
measured directly (see conversation history's crawl results), not assumed.
`loadItems(node, limit)` always takes a bounded limit; Structure Lens uses 20
per expand, Time/Space Lens use 100 — both are arbitrary v0.1 caps, not
architectural limits (`ItemEnumeration`'s `cursor` variant exists in the type
for when an API-search source needs a token-paginated stream instead of a
finite `hrefs` array — not implemented yet, see §7).

`detectSourceKind()` distinguishes a static catalog from a STAC API root by
checking for `conformsTo` or a `rel=search` link — the sole reliable signal
(confirmed against Earth Search's actual root response). Only the
`static-links` strategy is implemented; this function exists so the
distinction is made once, in one place, rather than guessed ad hoc later.

## 5. Structure Lens — why a curved node-link tree, not a file-explorer list

The first working version was a plain indented list (correct, but explicitly
called out as visually flat and generic — "现在的UI也太惨了吧"). The brief's
own direction (§9 of the original spec) rules out a conventional
sidebar-tree-table GIS-dashboard look and points at Figma/node-editor/
Obsidian-graph-like visual thinking tools instead. The chosen direction,
picked from three sketched options (horizontal / vertical / radial), is a
**horizontal curved tree**: root on the left, branches curving rightward,
laid out with `d3-hierarchy`'s `tree()` and drawn with `d3-shape`'s
`linkHorizontal()` for the bezier paths. Horizontal was picked over vertical
and radial specifically because Atlas's `hazard_catalog` has 12 siblings at
one level — vertical stacking of that many equal-depth siblings gets
cramped fast, and radial layouts read poorly for strict parent-child order
at depth. d3 is used *only* for layout math (positions, curve paths) and
gesture math (`d3-zoom` for pan/wheel-zoom); every node and link is still
plain React/SVG, so click/hover/selection stay ordinary React state — no
imperative D3 DOM manipulation of content, only of the zoom transform.

Node encoding, deliberately generic across node *type* and *expand state*
rather than special-cased per Catalog/Collection/Item:
- Color = type (slate Catalog / teal Collection / amber Item) — a plain
  legend (collapsed to a small dot-pill by default, click to expand) exists
  because this isn't self-explanatory and the user asked directly.
- Filled vs. hollow = classic tidy-tree convention: filled = collapsed with
  more to reveal (click to expand), hollow = already expanded *or* a genuine
  dead end. This single bit reuses `classifyNodeShape` — no separate
  "expandable" flag needed.
- Labels truncate (currently 40 chars) because unbounded titles overlap the
  next column; a custom floating tooltip (not the native SVG `<title>`,
  which has a slow OS-level hover delay) shows the full name instantly on
  hover, because names matter and truncation must never be the only way to
  read one. This was explicit user feedback, not a guess.
- Root's own label always renders to its right (never left) regardless of
  expand state — it has nothing to its left to collide with; every other
  node's label goes left when expanded (nothing further needed) or right
  when collapsed (would run into the reveal-on-click circle otherwise).

**A real bug worth remembering:** pan/zoom silently did nothing on first
implementation. Root cause: the component returned a plain `<div>loading…</div>`
instead of the real `<svg>` on the very first render (before async root data
arrives), so the one-time `useEffect` that binds `d3-zoom` to the `<svg>` ref
ran while the ref was still `null` and never retried once the real `<svg>`
mounted later. Fix: the `<svg>` (and the zoom-binding ref) must always be in
the tree; only its *contents* are conditional on data being loaded. This
class of bug (a one-time effect binding to a ref that isn't populated yet
because of a conditional early return) is easy to reintroduce — watch for it
whenever a component's "loading" state swaps out its root element instead of
rendering a stable container with conditional children.

## 6. Time Lens

Scoped to the current Structure selection, never global — deliberately, both
because a global timeline is meaningless once a collection can hold tens of
thousands of items, and because "select a node, see its temporal shape" is
the interaction being tested, not "browse all time." `useSelectedItems`
resolves whatever's selected to "the collection whose items to show": a
selected Item resolves to its parent (`parentHref`) with itself flagged via
`highlightHref`, so selecting an Item shows it in temporal context among its
siblings rather than showing nothing.

Instant / closed-interval / open-ended interval render as visually distinct
marks (diamond / bar / bar-with-arrow) on one shared `d3-scale` `scaleUtc`
axis — never normalized to a single point. The Collection's *stated*
`extent.temporal` renders as its own reference row above the Item rows in a
neutral outline style; if the actual min/max of the loaded Items exceeds it,
the row switches to the warning color and a banner text appears. This isn't
a hypothetical feature: selecting Atlas's `hazard_timeseries_mean_annual`
collection reproduces the exact conflict found during research (stated
1995–2020, actual Items run to 2060) live, with the long-range aggregate
Item (`hazard_timeseries_mean_pq_annual`, spanning all 65 years across 3
bundled scenarios) visibly rendering as one bar far wider than its 20-year
siblings in the same collection — heterogeneous temporal grain within one
collection, made visible rather than averaged away.

## 7. Space Lens

Bbox footprints over lightweight static coastline outlines — still
explicitly not a real basemap (the brief states "space is not just a
basemap" as a standing principle: no tile layer, no pan/zoom map widget, no
layer switcher), but *some* geographic reference turned out to be necessary,
not optional. The first version drew footprints against a bare lon/lat
graticule with no landmass at all; asked directly after seeing it, "范围是不是
应该有个背景地图啊，不然真的就只有一个方框可见" (shouldn't there be a
background reference — otherwise it's really just a floating box) — a grid
with no coastline gives no way to tell Africa from South America from a
number. Fixed by rendering `world-atlas`'s bundled 110m-resolution land
topology (~56KB, a static asset, not a tile fetch) via `d3-geo`
(`geoEquirectangular` + `geoPath` + `geoGraticule`) and `topojson-client`.
This is the correct middle ground: real geographic legibility, still zero
interactivity/chrome that would make it read as a GIS dashboard widget.
`geoEquirectangular().fitSize([viewWidth, viewHeight], {type:'Sphere'})`
replaced the hand-rolled linear lon/lat→pixel function from the first
version — same 2:1-ratio requirement (§ below), computed correctly by d3
instead of by hand.

Uses the same `useSelectedItems` hook as Time Lens (refactored out of what
was originally Time-Lens-only code, once Space Lens needed the identical
"resolve selection → collection + items" logic) — both lenses stay in sync
off one fetch, and clicking a footprint / timeline bar / tree node all write
to the same `selection` store, so all three lenses and the Detail panel
update together.

Every Item's bbox renders as a low-opacity (`fillOpacity: 0.1`) filled rect
with a faint stroke, brought to full stroke when selected. This is a
deliberate choice, not a simplification skipped for later: most of Atlas's
Items in any one collection share a near-identical continent-wide bbox
(confirmed directly — several collections' bboxes differ only in the
4th–6th decimal place), so overlapping low-opacity fills accumulate into a
visibly darker stacked region, communicating density even when every
individual box is nearly identical, rather than hiding the overlap or
faking spatial variety that isn't in the data. The selected Item's footprint
is always drawn last (on top) with a solid selection-color stroke so it
stays identifiable regardless of how many siblings occupy the same pixels.

**Not yet real "Space" per the original brief:** this is display-only. The
brief's actual Space↔Time interaction pattern (select an area on the map →
see available dates; select a date → see footprints) needs a real spatial
query, which only Earth Search's fixture has (`/search` with `bbox`+
`datetime`, confirmed working during research) — Atlas has no query
capability at all, only whatever's already been loaded into the graph. This
is the concrete reason Space Lens's real interactive version and the
API-search loader strategy (§4, §2) are expected to land together rather
than independently.

## 8. Visual design system

No off-the-shelf component library (Ant Design / MUI / Chakra) — explicitly
rejected because their default visual language reads as "enterprise
dashboard," which the brief rules out twice (don't become a GIS dashboard,
don't become a generic STAC Browser). Instead: a small hand-written token
layer (`src/design/tokens.css`, CSS custom properties for color/spacing/
type, light + dark via `prefers-color-scheme`) that every component
references directly via inline `style` (no CSS-in-JS library, no Tailwind —
not needed yet at this scale). If/when accessible interactive primitives are
needed (tabs for a Human/JSON toggle, real dropdowns, popovers), the planned
choice is Radix UI primitives (unstyled, accessible, no visual opinion of
their own) rather than a skinned component kit — not yet added because
nothing in the app has needed one yet (the fixture `<select>` and the
Legend's plain `<button>` toggle have sufficed).

## 9. Verification method

Every UI change in this project has been verified by actually driving a
headless Chromium instance (Playwright, installed as a dev dependency) against
the live Vite dev server and inspecting real screenshots — not by reading the
code and asserting it should work. This caught two real bugs that code review
alone would have missed or misdiagnosed: the svg-ref-timing pan/zoom bug
(§5) and an apparent "Time Lens stuck loading forever" that turned out to be
genuine (if slow) network latency for 51 uncached parallel fetches, not a
hang — confirmed only by adding real render/effect trace logging rather than
guessing at the fix. Keep using this loop for future lens/interaction work;
a plain code-level "this should work" is not sufficient for anything touching
layout, timing, or gesture handling.

## 10. UX uplift pass — landing page, full bidirectional sync, timeline density

Three gaps surfaced only by actually using the tool for a while, not from
the original brief:

**Entry experience.** The app used to drop straight into the explorer with
a bare fixture `<select>`. Compared directly to what a STAC Browser gets
right first: a proper entry point. `LandingPage.tsx` now asks for a STAC
catalog URL (free text) or offers the two verified known catalogs, and only
then moves into Structure/Time/Space/Detail. Free-text URL input is the
actual "browse any STAC catalog" capability — the honest alternative to
fabricating a long curated list of unverified catalog URLs, which the
project's own rule against guessing URLs rules out. Since arbitrary,
unverified URLs fail far more often than the two hand-checked fixtures
(bad URL, dead link, CORS), this pass also added real error handling where
there was none before: `StacLoader.loadChildren`/`loadItems` moved from
`Promise.all` to `Promise.allSettled` (one dead link no longer takes down
its whole parent's expand), and `useStructureTree`'s `expand()` now catches
and surfaces a root-level load failure as a clear in-app message instead of
an infinite "loading…" or an unhandled rejection. Known limitation: a
non-root child's own fetch failure is silently dropped (robustness over
per-node error granularity) — see §11.

**Full bidirectional sync.** Selecting an Item from Time Lens or Space Lens
previously updated the shared `selection` store correctly, but Structure
Lens had no way to *show* that selection if the relevant Collection had
never been manually expanded — the Item simply didn't exist as a rendered
node. Fixed with two effects: `useStructureTree` now watches the selection
store directly and walks the selected node's `parentHref` chain, calling
`expand()` on every still-collapsed ancestor (cache-backed, so re-expanding
an already-expanded one is harmless) — root-to-leaf order, since each
level's children must be fetched before the next level's ancestor check
makes sense. `StructureTree.tsx` then watches for the selected node to
appear among the rendered `d3-hierarchy` nodes and imperatively re-centers
the pan/zoom transform on it (keeping the current zoom scale), gated by a
"last centered href" ref so it fires once per distinct selection rather
than fighting a manual pan on every unrelated re-render. Time Lens got the
matching half: a ref on the selected row calls `scrollIntoView` the same
way, plus an explicit "selected: `<item>`" line in the header so what's
selected and what's shown are never ambiguous — previously the header only
ever said the *collection's* name, even when what triggered the view was
clicking one specific Item.

**Timeline density.** Asked directly: "when a collection has many Items,
does Time Lens really need one row per Item, or is mapping them onto the
timeline enough?" One row per Item is a Gantt-chart pattern, not a
Wayback-Machine one — it defeats "see the shape at a glance" past a few
dozen rows. Fixed with two composable techniques, both in `TimeLens.tsx`:
(1) `groupByTemporalShape` collapses Items sharing an exact `[start, end]`
(or identical instant) into one row — this is not just a density trick,
it's a second, sharper instance of the stated-vs-actual conflict pattern:
grouping `hazard_timeseries_mean_annual`'s 56 Items live collapses 55 of
them into a single "55 items, identical timing" row, proving at scale (not
just by spot-check) that the copy-paste metadata bug found during initial
research affects nearly the whole collection. (2) `packLanes` is the
classic greedy "minimum meeting rooms" interval-packing algorithm — groups
that don't overlap in time share a lane, so even collections with no exact
duplicates still compress well below one-row-per-Item whenever Items aren't
all mutually overlapping. Multi-Item groups don't map to one node, so
clicking one selects its first member as a representative; the hover
tooltip always lists the actual members (truncated past 8) so nothing is
hidden, only compacted.

## 11. Growing the catalog list the right way, and a real scale bug it found

Asked directly to add more catalogs "like STAC Browser does," rather than
guess at a plausible-sounding list from memory: STAC Browser's own README
states it doesn't maintain one — *"By default, STAC Browser will let you
browse all catalogs on STAC Index... The catalog section of STAC Index is
also built on top of STAC Browser."* STAC Index (`stacindex.org`) is the
actual community directory, and it turns out to be a public, unauthenticated
JSON API (`GET https://stacindex.org/api/catalogs`) rather than a static
data file — 147 entries, split into static catalogs and dynamic STAC APIs.
Confirms this is the right source: the existing Africa Adaptation Atlas
fixture is entry `114` in that exact list. Six static entries were
individually fetched and CORS-checked (`curl -I -H "Origin: ..."`, same
method used on the original two fixtures) before being added to
`LandingPage.tsx` — Capella Space Open Data (SAR), Maxar Open Data (optical,
disaster response), NZ Imagery (aerial, 800+ links — see below), Overture
Maps Releases (vector), fiboa Field Boundaries (vector, agricultural), and
Polar Geospatial Center DEMs (elevation). STAC API entries from the same
directory are deliberately not added yet — they need the still-unbuilt
`ApiSearchSource` loader strategy (§7, §11) or they'll under-report Items
the same way Earth Search would.

Adding NZ Imagery immediately surfaced a real scale bug that Atlas's own
~30-node Catalog structure never could: its root has **833 direct `rel:child`
links at one level** — wide, not deep. `loader.loadChildren()` had no bound
at all (unlike `loadItems()`, which was bounded from the start), so a single
node's expand fetched all 833 children before the root would ever leave its
loading state — StructureTree showed "loading…" indefinitely, not because
anything hung, but because the definition of "done" required an 833-way
fetch to fully settle. Fixed the same way item overflow already was:
`loadChildren(node, limit = 100)`, with a matching synthetic "+N more
children (not loaded)" leaf (`TreeDatum.moreKind: 'children' | 'items'`
distinguishes the two overflow leaves, since they used to share one
generic label). Also added `AUTO_EXPAND_BUDGET` (60), a `useRef` counter
shared across one tree's entire auto-cascade (§10/§5's Catalog-to-Collection
auto-expand) — insurance against a catalog that's both wide *and*
Catalog-heavy several levels deep, which would otherwise auto-trigger an
unbounded fetch cascade rather than just one wide `loadChildren` call.
**Lesson reinforced**: a new, structurally different fixture is worth more
than re-testing the same two — this is the second time (after the original
three-fixture research round) that deliberately testing a differently-shaped
catalog found a real bug the existing fixtures structurally could not.

## 12. What's deliberately deferred (not forgotten)

- STAC API loader strategy (`ApiSearchSource`) and a live Earth-Search-backed
  fixture — the type (`StacSourceKind`, `ItemEnumeration.cursor`) already
  anticipates this; only the fetch implementation is missing.
- A real Human/JSON toggle with extension-specific interpreters (raster, eo,
  proj, etc. rendering as human-readable facts) — today Detail Panel shows
  derived facts (namespaces, spatial/temporal validity) plus raw JSON, not a
  full enrichment layer.
- Semantic zoom / virtualization once a collection's node count genuinely
  can't fit on screen even lazily (the 16k/51M-item collections are handled
  today only by never enumerating past the bounded page size — true
  semantic zoom, per the original brief's decades→years→months progression
  idea, is unbuilt).
- Point-cloud / vector / GeoParquet fixture as a fourth contrast case (asked
  about, not yet added).
- Per-child error surfacing: a Catalog/Collection child whose own fetch
  fails during a batched `loadChildren`/`loadItems` call is silently
  dropped (via `Promise.allSettled`) rather than shown as a visible broken
  node — chosen deliberately for robustness against unverified arbitrary
  catalogs, but it means a partially-broken catalog looks smaller than it
  is rather than flagging what's missing. Would need `loadChildren`/
  `loadItems` to return failures alongside successes, and a synthetic
  "failed to load" tree leaf similar to the existing "+N more" one.
- Growing the landing page's known-catalog list further — now at 8 (the
  original 2 plus 6 from STAC Index, §11); more candidates need the same
  CORS-check-then-add treatment, never padded in unverified. STAC Index
  itself lists 147, most not yet checked.
- The 44 STAC-API entries in STAC Index's directory are deliberately
  excluded from the landing page until `ApiSearchSource` (§7) exists —
  adding one now would silently under-report Items exactly as Earth Search
  would.
- `CHILD_PAGE_SIZE`/`AUTO_EXPAND_BUDGET` (§11) are untuned constants (100
  and 60) picked to fix NZ Imagery's 833-wide root without breaking Atlas's
  ~30-node cascade — no attempt yet to make them adaptive (e.g. lowering the
  page size for a node whose sibling count is already known to be huge).
