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

The axis itself narrows around whatever's specifically selected rather than
always showing the full Collection span (§13) — the same scale problem
Space Lens had with tiny bboxes, applied to time.

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

Now a real interactive map — Leaflet, standard OSM raster tiles, real
pan/zoom — not the two static-rendering approaches that came before it,
each replaced for a concrete reason rather than personal preference:

1. **v1**: bbox footprints on a bare lon/lat graticule, no landmass at all.
   Explicitly not a real basemap, per the brief's "space is not just a
   basemap" principle. Asked directly after seeing it, "范围是不是应该有个
   背景地图啊，不然真的就只有一个方框可见" (shouldn't there be a background
   reference — otherwise it's really just a floating box) — a grid with no
   coastline gives no way to tell Africa from South America from a number.
2. **v2**: added a static 110m-resolution land topology (`world-atlas` +
   `d3-geo` + `topojson-client`, ~56KB) under the footprints — real
   geographic legibility, still zero interactivity.
3. **v3 (current)**: replaced entirely with Leaflet. v2's coastline data has
   no detail to zoom into — plenty of real STAC Items have a bbox the size
   of one small island (confirmed directly: NZ Imagery's per-survey
   collections are each a few km across), invisible at world scale no
   matter how good the *static* coastline data is. Raised directly: "很多
   数据它的 Bounding Box 范围是非常小的...在我们地图 View 里面仅仅是一两个
   像素" (a lot of data's bbox is tiny — in our map view it's just one or
   two pixels) — the fix has to be real zoom, not a better static picture.
   `d3-geo`/`topojson-client`/`world-atlas` were removed once Leaflet made
   them redundant (§8's "no map library" rule was revised along with this —
   Leaflet's own chrome, zoom control aside, is unobtrusive enough not to
   read as a GIS dashboard, and it's the only thing that actually solves
   the tiny-bbox problem).

Leaflet owns the map DOM entirely (same pattern as d3-zoom in Structure
Lens: the imperative library owns its own gesture/rendering internals,
React only decides *when* to call its imperative API, never renders its
content declaratively). Tiles are the standard OSM server
(`tile.openstreetmap.org`) — CARTO's Positron/Dark-Matter basemaps were
tried first and now watermark "API KEY REQUIRED" without one (a policy
change since they were last free-to-use; confirmed directly, not assumed).
No separate dark-tile source either, for the same reason — dark mode is a
CSS filter (`invert(1) hue-rotate(180deg) brightness(0.92) contrast(0.9)`)
on `.leaflet-tile-pane` toggled via a `.leaflet-dark` class, driven by a
small `useIsDark()` hook watching `prefers-color-scheme`. Every Item's bbox
is an `L.rectangle`; the selected one is redrawn last (on top, with a
thicker selection-color stroke) so it isn't buried under overlapping
siblings, same intent as the old fill-opacity-stacking trick from v1/v2
(kept: unselected rects are still low fill-opacity, so identical/near-
identical footprints — Atlas's continent-wide bboxes — still read as a
darker stacked region rather than hiding the overlap).

Two auto-navigation behaviors, both gated by a "last target/href" ref so
they fire once per distinct selection rather than fighting a manual
pan/zoom (same guard pattern as Structure Lens's auto-pan-to-selection,
§10): selecting a Collection calls `map.fitBounds()` on the union of all
its visible Items' bboxes; selecting a specific Item then calls
`map.flyToBounds()` on just that Item's own bbox with tight padding — this
is what actually makes an island-sized bbox visible, confirmed directly
against NZ Imagery's Auckland-region collections (a small area, real
street-level tiles, an 88-tile survey grid all become legible only once
zoomed to that level).

Every effect that needs `mapRef.current` guards on it being non-null and
the map container div is unconditionally rendered (a sibling status-label
div overlays it, never replaces it) — the same ref-timing rule as every
other lens (§5's postmortem still applies to any new `useRef`-to-imperative-
library pattern, not just d3-zoom).

Uses the same `useSelectedItems` hook as Time Lens (refactored out of what
was originally Time-Lens-only code, once Space Lens needed the identical
"resolve selection → collection + items" logic) — both lenses stay in sync
off one fetch, and clicking a footprint / timeline bar / tree node all write
to the same `selection` store, so all three lenses and the Detail panel
update together.

**Not yet real "Space" per the original brief:** this is still display-only,
unaffected by the Leaflet rewrite. The brief's actual Space↔Time interaction
pattern (select an area on the map → see available dates; select a date →
see footprints) needs a real spatial *query*, which only Earth Search's
fixture has (`/search` with `bbox`+`datetime`, confirmed working during
research) — Atlas and NZ Imagery have no query capability at all, only
whatever's already been loaded into the graph. This is the concrete reason
Space Lens's real interactive query version and the API-search loader
strategy (§4, §2) are expected to land together rather than independently.

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

The "no map library" half of this rule was deliberately revised for Space
Lens (§7) — Leaflet is now a real dependency. Not a contradiction: the
objection was always to *reading like a GIS dashboard* (heavy chrome, a
layer switcher, tool panels), not to interactivity itself, and a hand-rolled
static projection turned out to have a real functional gap (tiny bboxes are
invisible without real zoom) that no amount of visual restraint fixes. A
component library was rejected for a *taste* reason that a redesign
wouldn't change; Leaflet was adopted for a *capability* reason that only
Leaflet (or an equivalent) actually addresses — worth keeping these as
different categories of decision rather than treating "add a library" as
one uniform thing to resist.

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

**A second, distinct gap in the same sync** surfaced later, in a
larger-collection scenario: Structure Lens's own `expand()` only ever loads
the first `ITEM_PAGE_SIZE` (20) Items of a Collection, while Time Lens and
Space Lens each independently load up to 100 via `useSelectedItems`. Walking
the ancestor chain and re-calling `expand()` on an already-expanded parent
doesn't fix this — it just re-fetches the same first 20 again, so selecting
Item #45 of a 300-item Collection via a Space Lens footprint updated the
selection store correctly but the Item still didn't exist as a Structure
Lens node — "如果不显示出来的话，那这个在看什么呢...我选中一个 item，它怎么也
得在 tree 的 list 中显示出来吧" (if it doesn't show up, what am I even
looking at — selecting an Item has to show up in the tree's list, however
that happens). Fixed by patching the selected Item's href directly into its
parent's `itemHrefs` state when it's missing (`useStructureTree`'s
ancestor-expand effect, after the expand loop) — appended to the end of the
already-loaded list rather than re-fetched in original STAC order, so it
renders as the last visible Item, just before the "+N more" leaf, not in
its natural position. A real position/ordering trade-off, not a bug:
correctly loading it in-place would mean knowing its index within the
Collection's full item list ahead of time, which static link-following
doesn't give for free.

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

*Update, §17*: the auto-cascade this budget originally guarded — every
`expand()` call automatically recursing into any Catalog-typed children —
was later found to over-fire on deep, unfamiliar structures (Capella's
by-datetime facet nests Catalog→year→month→day) and was removed from
`expand()` entirely in favor of a manual, on-demand `expandAllCatalogs()`.
The budget constant survives under a new name (`EXPAND_ALL_BUDGET`),
scoped to that one manual action instead of implicitly firing on every
expand.

## 12. Progressive disclosure: start minimal, reveal on selection

Every lens used to render unconditionally, all four panels always on
screen even with nothing selected — three of them permanently showing
"Select a Collection or Item..." placeholder text. Raised directly:
"打开这个项目的树状结构图，其他东西都没出来...我们的设计哲学就是每次只给他
看他需要的东西" (opening a project should show just the Structure tree,
nothing else — the design philosophy is to only show what's needed each
time). `App.tsx` now renders Structure Lens alone, full width, until
`selectedHref` is set; Detail Panel and the Time/Space Lens row only mount
once there's something for them to show.

The two reveals are handled differently on purpose. Structure Lens's own
width animates via a CSS `transition` (it never unmounts, just resizes —
safe). The Time/Space row is a conditional *mount*, not a CSS height
collapse from 0 — Leaflet has a well-known gotcha where a map initialized
inside a zero-height container renders tiles incorrectly until an explicit
`invalidateSize()` call after it later expands, and getting that timing
right against a CSS transition is fiddlier than just not creating the
problem. Conditional mounting sidesteps it entirely: by the time Space
Lens's container first exists, `hasSelection` is already true and the
container already has its final real size, no invalidateSize dance needed.
This works cleanly because selection realistically never reverts to
"nothing" within a session short of leaving the catalog entirely (no UI
action currently clears it otherwise), so Leaflet only ever initializes
once per catalog session, not repeatedly.

## 13. Time Lens gets the same scale fix as Space Lens

Raised directly, drawing the analogy explicitly: "这个时间...它只在这个时间有用...
但是我们默认现在可能是跨越了五十年、六十年...它就永远就看那一小段。这个问题跟这个
地理范围是类似的" (this time [range] — the selected Item is only meaningful at
its own time, but the axis defaults to spanning 50-60 years, so it always
looks like a tiny sliver — this is the same problem as the geographic
range). Exactly right: a selected Item's own range can be a sliver of the
full Collection's stated-or-actual span the same way a small bbox is a
sliver of the world, and the axis always showing the full Collection range
regardless of what's selected has precisely the same failure mode Space
Lens had before its Leaflet rewrite (§7).

The fix is deliberately *not* a port of Space Lens's mechanism, though —
different problem shape. Space is 2D and open-ended (a real map you might
want to explore beyond any single bbox), which is why it got a real
interactive Leaflet map with manual pan/zoom plus `flyToBounds`. Time here
is 1D and the "full view" is always well-defined (the Collection's own
extent) — there's no equivalent open-ended exploration need, just "show the
full range by default, narrow around whatever's specifically selected."
So no d3-zoom, no manual gesture handling, no wheel/drag-conflict concerns
with the panel's own vertical scroll (which a d3-zoom-on-wheel setup would
have created, fighting the lane list's native scroll — a real trade-off
avoided by not needing it). Instead, `computeFocusDomain()` derives a
second, narrower `displayDomain` from the full `domain` whenever a specific
Item is selected: padded by whichever is larger, 40% of the Item's own
duration or 5% of the full Collection span (so a single-instant Item still
gets a sensible surrounding window, and an Item that already spans most of
the Collection — Atlas's 65-year aggregate rollup again — naturally ends up
close to the full view rather than an arbitrarily wider one), clamped to
never exceed the Collection's own extent. `displayDomain`, not `domain`,
feeds the `scaleUtc()` construction and every `TemporalMark`'s open-bound
clamping; `domain` itself stays the full extent and keeps doing what it
always did — lane packing and the stated-vs-actual conflict comparison are
both data questions independent of what's currently zoomed into view, not
display concerns.

Confirmed directly against Atlas's `hazard_timeseries_mean_annual` (stated
1995–2020, actual Items to 2060, per §11's finding): selecting the
Collection shows the full ~65-year span; selecting one of its 55
identically-timed Items (2041–2060) narrows the axis to roughly 2035–2060;
re-selecting the Collection snaps back to the full range. An explicit
"selected: `<item>` — showing a focused window around it, not the full
range" note accompanies the narrowed view so it's never ambiguous *why*
the axis suddenly looks different — the same "target and result should
visibly correspond" principle §10's Structure/Time sync work was built on.

## 14. Collection-level spatial extent: three candidate sources, and why we don't merge them

Raised as a direct question, prompted by a real dataset rather than a
hypothetical: does Space Lens's Collection-level range come from the
Collection's own declared extent, or from aggregating the Items underneath
it — given that some publishers attach a collection-level `assets` entry
pointing at a separate GeoJSON that may be *more* precise than either
("我在查看一份数据...在它的 collection level 的 asset 指向了一个 capture
area...那个范围是来自于 item 的呢,还是来自于这个 collection 它自己就带有
它下面那一层的数据呢?"). The concrete case: NZ Imagery
(`https://nz-imagery.s3.ap-southeast-2.amazonaws.com/catalog.json`).

**What Space Lens does today** (confirmed by direct code inspection, before
any change): it draws both existing sources at once, never one or the
other — the Collection's stated `extent.spatial.bbox` as a dashed, unfilled
outline, and every currently-loaded Item's own bbox as a filled rectangle,
then fits the map to their union. `graph.ts` only scans `assets` for
extension-namespace detection; it never looks at `assets` for spatial
content. So today there are two sources, already shown side by side
(stated vs. derived-from-loaded-Items), and a third, real one this
dataset surfaces that isn't looked at at all.

**The three sources, and what each actually is:**

1. **Stated `extent.spatial.bbox`** — a *required* Collection field, but
   the spec (`collection-spec.md`) only says it's "recommended to be as
   precise as possible," not guaranteed accurate. It's self-reported by
   the publisher and never validated against the actual Items.
2. **Derived, aggregated from loaded Items** — reflects only whatever's
   actually been fetched, bounded by our own pagination (100 Items in
   Time/Space Lens; see §11). Precise for what it covers, silently
   incomplete for what it doesn't.
3. **A collection-level geometry asset** (NZ Imagery's `capture_area`) —
   confirmed directly: the Auckland region's `collection.json` has
   `"assets": { "capture_area": { "href": "./capture-area.geojson", "type":
   "application/geo+json", "roles": ["metadata"], "title": "Capture area" }
   }`. Fetched the actual GeoJSON: a 150-vertex irregular polygon (the real
   flight-survey boundary), not a rectangle. Shoelace-formula area
   comparison against the stated bbox: the true polygon covers **~43%** of
   the bbox's area — the declared bbox overstates true coverage by more
   than 2×. Checked two more NZ Imagery collections (different regions/
   years) the same way — both also carry a `capture_area` asset, so this
   is systematic across the dataset, not a one-off.

**How common is this beyond NZ Imagery?** Checked all 8 landing-page
fixtures directly (not guessed): only NZ Imagery has it. The other 7 —
including fiboa, whose collection asset is the field-boundary Parquet data
itself (geometry embedded per-row via `table:primary_geometry`, not a
separate footprint sketch) — have no equivalent. Web search on the STAC
spec repo and extension registry turned up no formal convention for this
at all: STAC's core "Collection Assets" feature is documented for
collection-wide files that aren't Item duplicates (thumbnails, checksums,
etc.), with no named role or extension for "precise footprint asset."
`capture_area` is LINZ's own naming, not a spec term — a different
publisher doing the same thing might call it anything, or use a different
asset `type`.

**Recommendation (design only — not yet implemented):**

- **Detect structurally, not by name.** Never match on `capture_area`
  specifically — that's one publisher's word choice. Detect any
  Collection-level `assets` entry whose `type` is a GeoJSON media type
  (`application/geo+json`, or `application/json` with a `roles` hint), the
  same "trust structure over vocabulary" approach already used for
  namespace detection.
- **Fetch lazily, only for the selected Collection** — no eager fetch just
  to detect the asset's existence across a whole tree; the existence check
  reads `assets` already present in the Collection JSON we fetched anyway.
- **Show it, don't silently prefer it.** Render as a third, visually
  distinct layer (e.g. a solid polygon outline, between the dashed stated
  bbox and the filled Item rectangles) labeled with its own asset `title`
  ("Capture area"), not relabeled as if we'd defined the concept — same
  "never silently reconcile conflicting metadata" principle as Time Lens's
  stated-vs-actual overlay (§10, §11). Let the user see, not just trust,
  that the declared bbox is ~2× too generous here.
- **Prefer it for auto-fit when present**, since it's the most precise of
  the three, but keep drawing the stated bbox regardless — the gap between
  them is exactly the signal worth surfacing, not hiding.
- **Fail soft.** This is an ad hoc, non-standardized asset with no spec
  backing — a malformed or unreachable GeoJSON here must degrade to
  "just don't draw the third layer," never break the two layers that
  already work.

Deliberately not built yet — the open question was "is this worth doing at
all," not "how," per the user's framing ("我不确定这样做的数据多不多"). Given
1-of-8 confirmed and no ecosystem-wide convention found, this stays a
documented, ready-to-build option rather than committed work; revisit if a
future fixture shows the same pattern or the user decides the NZ Imagery
case alone justifies it.

## 15. An Item's parent is singular — per spec, not just per our data model

Raised from a second real dataset, Capella Space Open Data
(`https://capella-open-data.s3.us-west-2.amazonaws.com/stac/catalog.json`):
its root fans out into six *parallel classification catalogs* over the same
underlying Items — By Product Type, By Instrument Mode, By Use Case, By
Capital, By Datetime, plus a contest-specific Collection. The question,
almost identical in shape to §14 but about graph topology instead of
geometry: "STAC 官方甚至比较推荐...同一个 item 可以被不同归类到不同的
collection 里面去...那我们选中一个 item...它永远就指向我第一次打开的那个
collection...但是我其实是从第二个 collection 里面找到的" (STAC itself
arguably recommends this — the same Item classified into different
Collections — but our selection always resolves to whichever Collection it
happened to load through first, not the one the user actually found it in).

**What the spec actually says (verified against the raw spec text, not
recalled from memory):** `item-spec.md` line 201, quoted exactly: *"Multiple
collections can point to an Item, but an Item can only point back to a
single collection."* The many-to-one direction — several Collections
cross-referencing the same Item as a secondary index — is the explicitly
sanctioned flexible part, and is exactly what Capella's six facet catalogs
do. But an Item's own containment is deliberately singular: the `collection`
field plus its paired `rel:collection` link are spec-required to agree and
represent *the one* Collection an Item belongs to. `rel:parent` is a
different, weaker relation — the spec's own NOTE on it says dynamic
catalogs "can implement multiple parents through a dynamic browsing
interface... though only 1 parent at a time," i.e. even that is singular
per served document; it just isn't guaranteed to agree with `rel:collection`
by definition, since it's about physical/crawl containment (where you'd
walk up the file tree from here) rather than thematic ownership. So this
followed the same trajectory as §14: the user's initial framing (build a
`viaHref`/selection-provenance system to remember which Collection a
multi-membership Item was found through) was **superseded once the spec
research came back** — that system would have been solving a problem the
spec says doesn't exist. The user reached the same conclusion independently
before I'd finished presenting the research: "就算那个不高亮也没问题,反正
指向那个 item 都问题不大" (it's fine if the Collection I browsed from isn't
what highlights — landing correctly on the Item's true home is enough).

**Confirmed the disagreement is real, not hypothetical**, on the exact Item
above: its own `links` array has `rel:collection` → `.../capella-open-data-
by-use-case/capella-open-data-environmental/collection.json` (its declared
thematic home) and `rel:parent` → `../catalog.json`, i.e. the physical
day-folder under `capella-open-data-by-datetime/2026/2026-08/2026-08-24/`
where the file actually lives. Same Item, two different, both-truthful
answers to "what contains you," depending which relation you ask. Our old
`graph.ts` code picked between them with
`links.find((l) => l.rel === 'parent' || l.rel === 'collection')` — first
match by array order, which happened to return `collection` here purely
because it's listed before `parent` in this particular file. Accidentally
correct, not deliberately — a publisher (or even a different Capella Item)
listing them in the other order would have silently resolved to the wrong
one, no signal that anything was ambiguous.

**The fix** (small, surgical — no store/hooks rearchitecture needed, since
the spec confirms singular containment was the right model all along):
`StacNode` now carries `declaredCollectionHref` and `declaredParentHref` as
two separate source facts (never merged), plus `parentHref` as the resolved
value — `declaredCollectionHref ?? declaredParentHref`, matching the spec's
own precedence (an Item's `collection` link is spec-authoritative when
present; `rel:parent` is the correct fallback only for Items that aren't
part of any formal Collection at all). Every existing consumer of
`parentHref` (Structure Tree's ancestor auto-expand, `useSelectedItems`'s
target resolution) needed no change — they were already built around "one
canonical parent," which is exactly what the spec models; they just needed
that one value computed deliberately instead of by array-order luck.
Detail Panel gained a new "Containment (source)" field showing both
declared hrefs plainly, with an explicit warning when they disagree — same
"never silently reconcile conflicting metadata" principle as Time Lens's
stated-vs-actual overlay (§10, §11) and the capture-area discussion (§14):
a real, observed data inconsistency should be visible, not quietly resolved
behind a `.find()`. Verified end-to-end against the live Capella Item above
(screenshot-checked): Detail Panel shows both hrefs and the disagreement
warning; Structure Tree/Time/Space Lens all resolve to the Item's one true
Collection regardless of which secondary facet catalog it was discovered
through.

## 16. Time Lens's lane-packing breaks down on dense, near-daily data

Found on the same Capella Open Data dataset as §15, while looking at a real
Item's timeline instead of its graph position: "选择了一个具体的
item...你会看到密密麻麻的文件名挤压在一起...hover 这些点...pop-up 被右侧的
地图给盖掉了" (selecting a specific Item shows a dense mass of overlapping
file names; hovering a point's tooltip gets covered by the map on the
right). Two distinct, both confirmed directly in the browser against
Capella's GEO collection (near-daily SAR captures, mostly `instant`
datetimes) rather than assumed from reading the code.

**Bug 1 — the tooltip really was rendering behind the map.** Screenshot-
verified: the tooltip's dark bubble was visibly cut off exactly at the
Time/Space Lens panel boundary. The tooltip is `position: fixed` with
`z-index: 10`; Leaflet's own internal panes/controls use z-index up to 1000
and, since nothing in the layout traps `position: fixed` into a different
containing block (no transform/filter on an ancestor — checked `App.tsx`),
both compete in the same root stacking context, and Leaflet wins. Fixed by
raising the tooltip to `z-index: 2000` — simple and robust; no need to
fully untangle Leaflet's internal stacking to know 2000 clears it.

**Bug 2 — the label collision is `packLanes` doing exactly what it was
asked to, applied to data it wasn't designed around.** §10 built
`groupByTemporalShape`/`packLanes` so a collection's-worth of Items doesn't
mean a collection's-worth of vertical rows — non-overlapping groups share a
lane, which is correct and desired. But the greedy packer treats
*zero-duration* `instant` events as never conflicting with each other
regardless of how far apart in time they are (correctly — they truly don't
overlap), so a run of all-instant data — Capella's near-daily captures are
exactly this — packs the *entire* loaded set onto one or two lanes. That's
fine for the marks (each still sits at its own correct x position), but the
label is rendered in a fixed-x left gutter keyed only by *lane*, so every
group sharing that lane renders its distinct name at the identical pixel —
confirmed directly: a screenshot showed two different Item IDs fused into
one illegible string ("CAPELLA_C13_SB_GEO_HH_202…", a blend of two
different, overlapping labels). Separately, once an Item is selected and
the axis narrows (§13), the *lanes* still packed every loaded group
regardless of whether it was anywhere near the focused window — up to 100
Items' worth of irrelevant marks/labels rendered for a view meant to show
one Item's neighborhood.

Fixed both together in `TimeLens.tsx`, without touching `packLanes` itself
(it's still correct for the unfocused, whole-collection overview — that
density *is* the point there):

- **Focused re-pack.** When an Item is selected (`displayDomain` narrower
  than the full `domain`), filter groups to those actually intersecting
  `displayDomain` (`groupIntersectsDomain`) and re-run `packLanes` over just
  that subset, against `displayDomain` rather than the full range. A 100-
  Item collection narrows to whatever's actually nearby (confirmed: 19 of
  58 distinct timings for the Capella Item above) instead of always
  re-rendering the whole loaded set. The "selected: X" note now says how
  many ("...showing a focused window around it (19 nearby of 58 loaded)"),
  so the size change is explained, not just silently different — same
  "target and result should visibly correspond" principle as §10.
- **One label per lane, not one per group.** `laneLabelKey` picks a single
  representative group to label per lane — the one containing the current
  selection if there is one in that lane, else whichever group reaches that
  lane first. Every other group sharing the lane still renders its mark
  (still clickable, still shows its full name on hover via the existing
  tooltip) — it just doesn't fight for the same fixed-x label slot. This is
  a deliberate, narrower version of "full names always readable"
  (`feedback_visual_taste`): the name you're most likely to want is always
  static-labeled; everything else is one hover away rather than
  illegible.

Verified end-to-end against the live Capella GEO collection (screenshot-
checked both before and after): the fused-label collision is gone, the
tooltip renders fully on top of the map, and selecting an Item now shows a
legibly small, correctly-scoped neighborhood instead of the whole
collection's lane-packed density.

## 17. Manual controls: collapse the tree back down, and turn panels off

Raised directly, again off Capella's real structure: "像这个 Capella 的
数据,它的 catalog 层级非常高...因为我们默认的可以就第一层都打开了嘛...我需要
能够关闭...我也可以随时将其他窗口给关掉" (Capella's catalog hierarchy goes
very deep, and our default auto-expand opens up a lot of it — I need to be
able to close that back down, and also be able to turn the other panels off
whenever Structure is the main thing I'm looking at). Two small, independent
controls, both explicitly framed as "give me this now, layout/positioning
can wait" — no attempt made here to redesign panel placement, sizing, or a
persisted-preference story; both are first-pass, deliberately simple.

**Collapse to top level.** `useStructureTree` gained `collapseAll()`: flips
every node's `expanded` flag back to `false` except the root's own entry,
leaving just the root and its direct children visible — at the time this
was written, exactly what a freshly-opened catalog looked like before any
auto-cascade (§11's old `AUTO_EXPAND_BUDGET`) or manual clicking added more;
see the update below, where that auto-cascade was removed entirely and this
became the *only* state a catalog opens into. Doesn't touch the loader
cache or re-fetch anything, so re-expanding afterward is instant —
collapsing is purely a `uiState` visibility flip, not a data operation.
Wired to a small pill button in Structure Lens's top-left corner (mirroring
the existing Legend button's placement/style in the top-right). Confirmed
against Capella's real root (35 rendered labels → 9 after one click, i.e.
root + its 6 top-level facet catalogs plus 2 already-loading nodes).

**Per-panel visibility.** Three independent toggles (`showDetail`,
`showTime`, `showSpace`) in `App.tsx`, rendered as pill buttons in the
header once something's selected (`PanelToggle`). Turning Detail off gives
Structure Tree the full width back, same as the pre-selection state (§12);
turning Time and/or Space off collapses that row's height to nothing when
both are off, or gives the remaining one 100% of the row's width when only
one is on. All three default to on, preserving today's behavior unless the
user explicitly reaches for a toggle.

Each panel is still *conditionally mounted*, not CSS-hidden — consistent
with §12's reasoning for why Space Lens in particular needs this (Leaflet
initializing inside a 0×0 container). The trade-off this brings: toggling
Space off and back on remounts the map fresh, losing whatever pan/zoom/
fly-to state it had. Deliberately accepted for this first pass rather than
switching to `display: none` + `map.invalidateSize()` on re-show — the
user explicitly hasn't decided yet what the eventual layout/positioning
story should look like, so it's not worth building state-preservation
machinery for a panel arrangement that may itself change.

**Where this could go next** (offered, not yet requested): a persisted
layout (remember which panels were on/off per browser, `localStorage`-
backed, so re-opening a catalog doesn't reset to all-on); a keyboard
shortcut per panel; replacing the current fixed 55/45 and 62/38 splits with
draggable resize handles now that panels can also disappear entirely, which
changes what "the right default split" even means; and, if Space Lens's
remount-loses-state trade-off above turns out to matter in practice, a
`display:none` + `invalidateSize()` version instead of unmount/remount.

**Update — the direction reversed, on the very same complaint pushed
further.** Collapse-to-top-level made the *symptom* (an already-cascaded
tree) fixable, but the next message went at the *cause*: "很多时候它会...
我也不知道结构嘛,结构特别复杂,会一下子加载太多东西...所以进来以后只有 top
level 打开就可以" (a lot of the time it'll auto-load too much — I don't
know the structure yet, it can be very complex — so on entry, only the top
level should be open). Traced to `expand()` itself (§5/§11): every call —
including the very first one, on the root, on mount — auto-cascaded into
*every* `Catalog`-typed child recursively (stopping only at Collections),
because that cascade was unconditional, not something opening a catalog
merely made likely. For Capella's `By Datetime` facet (Catalog → year →
month → day, several levels deep) this meant a single click, or even just
opening the catalog, could fetch far more of an unfamiliar structure than
the user had actually asked to see.

Removed the cascade from `expand()` entirely — every expand, including the
initial root one, now surfaces exactly one level, unconditionally. In its
place, `expandAllCatalogs()`: the same cascade logic (walk every reachable
`Catalog` child, skip `Collection`s, cap at `EXPAND_ALL_BUDGET`), but as an
explicit, on-demand action a user reaches for — wired to an "Expand all
catalogs" button next to "Collapse to top level," so the two are now
genuine opposites of the same manual gesture rather than one automatic
default and one manual undo. Confirmed against Capella's real root: 7
labels immediately after opening (root + its 6 top-level facet catalogs,
nothing more, no network activity beyond that); clicking "Expand all
catalogs" reproduces the old cascade's full depth on demand (35 labels,
matching the previous auto-cascaded state exactly) and still correctly
stops at Collections (rendered filled/collapsed, ready for a deliberate
click into Items). The ancestor-auto-expand-on-selection effect (§10) is
untouched — a selection arriving from Time or Space Lens still walks up
and reveals its own ancestor chain regardless of this change; only the
*unprompted*, load-time cascade was the problem.

## 18. Shareable URLs — a hash-encoded deep link, adapted from STAC Browser's own scheme

Raised directly, holding up STAC Browser as the example to match: "它很优秀
...它允许你在 URL 里面把你的语言放进去...我选择了某一层一个 collection 或者
一个 item...我可以把这个给拷贝复制给另外一个人...他进来就可以看到,直接打开了
这个,到了这个结构里面选中了这个节点" (STAC Browser is excellent partly
because its URL encodes exactly what you're looking at — select an Item or
Collection, copy the URL, hand it to someone else, and they land directly on
that same selected node). Researched STAC Browser's actual implementation
before designing anything (source-verified, not recalled): it encodes only
the *leaf* node's own absolute URL as `/external/<host>/<path>` (real
History-API routing, needing a server-side rewrite rule — hash routing as
its documented fallback for GitHub Pages/S3), and rebuilds ancestor context
live after load by reading the fetched leaf's own `rel:root` link and
fetching that separately — it does not encode the whole breadcrumb chain.

That last part matters: it means this app was *already* most of the way
there before this section existed. `StacNode.href` is always the fully
resolved absolute URL (`resolveHref`), the loader can fetch any href in
isolation with no tree traversal first, and §15's containment work had
already given every node its own `declaredCollectionHref`/`declaredParentHref`
— exactly the chain-walking STAC Browser does live. Structure Lens's
ancestor-auto-expand effect (§10) already existed to reveal a selection that
arrived from Time/Space Lens; it just needed to also work for a selection
that arrives with *nothing else loaded yet*.

**What was added:**

- `declaredRootHref` (`types.ts`/`graph.ts`): parses `rel:root`, the fourth
  source-fact link alongside `declaredCollectionHref`/`declaredParentHref`.
  Per `commons/links.md` (verified verbatim): *"STAC entities SHALL have no
  more than one parent entity. As such, STAC entities also can have no more
  than one root entity... therefore usually just one link with root or
  parent relationship."* One hop to the catalog root when a publisher
  declares it, versus walking `parentHref` all the way up otherwise.
- `StacLoader.resolveRoot()`: given a node fetched in isolation, returns its
  catalog root — prefers `declaredRootHref`, falls back to walking
  `parentHref` upward (bounded at 50 hops against a malformed/cyclic chain
  in an arbitrary, unverified catalog).
- `useShareableUrl.ts` — small hooks, no router library:
  `useDeepLinkBootstrap()` reads the URL's hash fragment (`location.hash`)
  once on mount as the target node's raw absolute href, fetches that node,
  resolves its root, and hands back `{ rootHref, selectedHref }` for
  `App.tsx` to open into; `useShareableUrlSync()` keeps the hash matched to
  whatever's currently open, originally via `history.replaceState` always
  — deliberately not `pushState` for *every* click, which would turn one
  click into one browser-history entry (still true, still the right call
  within one catalog) — but at the time this meant no back/forward support
  at all, on purpose. §45 revisited that once real usage showed the actual
  cost of "on purpose": it now pushes only at a landing-page/catalog or
  catalog/catalog boundary, paired with a new `usePopStateSync` that
  actually reacts to Back/Forward instead of ignoring it.
- Chose a **raw hash fragment** over both STAC Browser's path-based
  `/external/...` and an initial version of this feature that used a
  `?node=<href>` query param through `URLSearchParams`. The query-param
  version worked but was genuinely hard to read: `URLSearchParams` applies
  `application/x-www-form-urlencoded` rules, which escape `:` and `/` too,
  turning every shared link into a `?node=https%3A%2F%2F...` wall of
  percent-encoding — flagged directly ("但是有一些奇怪的字符：%3A%2F%2F").
  `node.href` (built via `resolveHref`/`new URL(...).toString()`) is already
  a fully valid, correctly-escaped absolute URL, and `:`/`/` are legal,
  *unescaped* characters in a URL fragment per spec — writing it straight
  into `location.hash` round-trips byte-for-byte with no re-encoding on
  either end, producing a plain, readable `#https://.../item.json`. It also
  needs zero hosting config, more so than even STAC Browser's own history
  mode: a hash fragment is never sent to the server at all, so there's no
  rewrite rule to configure on any static host (GitHub Pages, S3, `vite
  preview`, anything) — one requirement STAC Browser's docs note its
  default routing mode cannot claim.
- `LandingPage` gained an `error` prop — a deep link that fails to resolve
  (dead link, CORS, invalid STAC JSON) surfaces as a banner there rather
  than hanging or silently falling through, since arriving via a broken
  shared link with no explanation would look like the app itself is
  broken.

**Two real bugs found and fixed via direct testing** (not just review —
this is exactly the kind of interaction bug that only shows up when you
actually load the URL fresh, not when reading the code):

1. `useShareableUrlSync`'s effect ran on the very first render, before the
   bootstrap's fetch had resolved — saw `rootHref` still `null` and
   stripped the hash immediately, out from under the in-flight fetch. In
   production this would have been a harmless flash (the fetch's own
   `nodeHref` was already captured in a local variable before the strip);
   in dev, React StrictMode's mount→cleanup→remount re-reads the hash on
   the kept invocation and found nothing — hanging every deep link on
   "Opening shared link…" forever. Fixed by gating the sync effect on a
   `booting` flag so it does nothing until the bootstrap has actually
   settled.
2. The ancestor-walk loop (§10's mechanism, extended to fetch each
   ancestor rather than only peek the cache — necessary since a
   deep-linked node arrives with *no* ancestors pre-loaded) had a copied-in
   cyclic-chain guard that compared `parent.href === cur` — always true,
   since `parent` is *by definition* the node fetched at href `cur`. This
   silently truncated every ancestor walk to exactly one hop, so a
   deep-linked Item would resolve and display correctly everywhere
   (Detail/Time/Space) but Structure Lens would never expand past its
   immediate parent — confirmed directly via a deep link into Capella's
   `Environmental` collection, three levels deep (`By Use Case` → `Environmental`
   → the Item): the tree stayed collapsed at the top level no matter how
   long the page was given to settle, until this was found and fixed (the
   guard needed to compare `parent.parentHref === cur` — whether stepping
   *one more hop* would loop back, not whether the node we just fetched is
   "itself"). Screenshot-verified afterward: a completely fresh page load
   from a shared hash-encoded URL alone now pans/expands Structure Lens all
   the way down to the Item, correctly highlighted, with Detail/Time/Space
   all showing the same context — no manual navigation at all.

**Not yet built** (update: `popstate` handling was built later, see §45 —
Back/Forward now do something useful): encoding panel visibility (§17) or
which Structure Lens nodes are expanded into the URL — a shared link
reproduces the *selection*,
not the exact expand/collapse state of the tree around it.

## 19. Growing the known-catalog list to match STAC Browser's breadth

Raised directly, after seeing STAC Browser's own catalog list: "之前研究到的...
各种数据也都想办法测试之后接进来试试看...做到跟 stac browser 一样的丰富" (test
and bring in the various catalogs found in earlier research too — get this
as rich as STAC Browser). §11 had only checked 6 of STAC Index's then-85
static entries before this; the other ~73 were flagged as a known gap but
deliberately left unchecked ("暂时不用,只是想搞清楚原因" — a prior message in
this same session, about why the list was small, explicitly deferred doing
this). This picked that back up.

Delegated the bulk verification to a background agent rather than doing 73
individual tool calls inline — same three checks as §11's original method,
scripted: reachable (`curl` 200), CORS-permissive against a *real GET with
an `Origin` header*, not just a bare `curl` succeeding (the agent was
explicitly told this distinction matters — a HEAD-only or Origin-less check
can pass while an actual browser `fetch()` would still be blocked), and
genuinely STAC (a `type`/`stac_version`, not an OGC API - Records response
that merely resembles one — 6 candidates from ArcGIS Hub/FGDC state
geoportals were exactly this, correctly excluded). 62 of 73 passed; 11
failed (3 missing CORS, 2 unreachable/redirecting, 6 not genuine STAC).

**Spot-checked a sample directly before trusting the batch result** — this
project's standing practice, not skipped just because the check was
automated rather than manual. Found one real discrepancy: **USGS
Astrogeology's catalog passed the agent's CORS check but is served over
plain `http://`**, not https. A `curl -I` (HEAD) against it showed no CORS
header at all, which looked like a false positive at first — but a `curl`
GET with an `Origin` header (matching the agent's actual methodology) does
return one; S3 static-website endpoints apparently only attach CORS headers
to GET, not HEAD. So the CORS check itself was correct — but plain-`http://`
is a separate, real problem this project doesn't have yet: fetching an
`http://` resource from an `https://`-served page is blocked by browsers
as mixed content (not merely a CORS question). This app is only ever
tested today on `http://localhost` (Vite dev), where that never bites, but
any real deployment (GitHub Pages, Netlify, anything) defaults to https —
so this one entry was excluded from the list rather than silently ship a
catalog that works in dev and breaks in production.

**Result**: 61 new entries added to `LandingPage.tsx`'s `KNOWN_CATALOGS`
(8 → 69), spanning satellite/SAR imagery, elevation/LiDAR, climate and
flood-hazard data, cadastral/vector layers, planetary science, and more —
across space agencies (ESA, NASA, CNES), national mapping agencies (New
Zealand, Argentina, Switzerland, Canada, Finland), and open-data programs
(source.coop, Radiant Earth, AWS/Google/Azure Open Data). At that scale, a
flat 340px scroll box stopped being browsable by eye, so the landing page
gained a simple client-side text filter (title + description substring
match) — the smallest fix proportionate to a problem this exact change
created, not scope creep. Verified in-browser: filtering "SAR" narrows 69
entries to the 3 actually relevant ones; opening a newly-added catalog
(Wyvern Open Data) works end-to-end, respecting §17's top-level-only
default.

**Update — the filter alone wasn't the actual fix.** Called out directly,
and rightly: "首页打开还是只要有看到4个,然后要滚动很久...明明有很宽的界面却
又只缩在中间" (the landing page still only shows ~4 entries before a lot of
scrolling, and despite a wide screen, everything's squeezed into the
middle). Correct — the layout itself was never redesigned for this list's
new scale, only patched with a search box on top of the same narrow
column: the whole page was a single vertically-*and*-horizontally-centered
flex column capped at `maxWidth: 560`, with the catalog list further boxed
into a fixed `maxHeight: 340` scroll area inside that — a layout sized for
8 cards, unchanged when the list grew to 69. Redesigned properly instead of
patching further: the page is now top-anchored (not vertically centered —
with a real list on it, it's a real page, not a small centered dialog);
the hero/URL-input stays a narrow single-decision column (that part was
fine); the known-catalogs section breaks out to a much wider container
(`maxWidth: 1400`) using a CSS grid (`repeat(auto-fill, minmax(260px, 1fr))`)
instead of a single-column list in a small fixed-height box, so a wide
screen actually shows more cards per screen (~30 visible at once at 1600px
instead of ~4) and the page scrolls normally instead of nesting a cramped
inner scrollbar. Screenshot-verified at both a wide (1600px, 5 columns)
and narrower (900px, 3 columns) viewport, and confirmed filtering and
opening a catalog both still work unchanged.

**Second update — merge the two search bars into one.** Immediate,
correct follow-on observation: "两个 search bar 可以合并成一个" — the "paste
a URL" box and the "filter known catalogs" box, stacked right on top of
each other, were doing overlapping jobs with no visible distinction between
them. Merged into a single input (`query` state, replacing separate `url`/
`filter` state): a `looksLikeUrl` check (`/^https?:\/\//i`) decides which
job the current text is doing — plain text always filters the grid live
(now also matching against `href`, not just title/description, so pasting
a URL that happens to already be a known entry surfaces that card rather
than showing a false "no matches"); text that parses as an absolute URL
additionally enables the "Explore" button (disabled otherwise, with a title
tooltip explaining why) and submitting opens it directly, same as before.
No mode toggle for the user to reason about — the same text simultaneously
filters *and*, when URL-shaped, becomes directly openable. Verified all
three cases in-browser: plain text filters with Explore staying disabled;
an unknown URL enables Explore and shows a "no known catalog matches — press
Explore to open it directly" hint; a URL matching a known entry's href
surfaces that exact card while Explore remains available too.

**Third update — two entries removed after real-data verification.** While
researching a future "Item Set" browsing feature (large-Collection
search/filter/pagination), a background research pass actually fetched a
sample of the known catalogs looking for real large-item-count Collections,
and surfaced two entries that don't belong on this list under its own
stated inclusion rule (genuinely static STAC, not a live API):
- **MSC GeoMet - GeoMet-OGC-API** (`api.weather.gc.ca/stac/?f=json`) is a
  live pygeoapi-backed service, not a static file — one sampled child path
  was literally date-stamped with the day it was fetched
  (`.../msc-datamart/20260909`), i.e. server-generated per request. It reads
  as Catalog/child link structure rather than a `/search` response, which is
  what let it slip past the earlier STAC-API exclusion pass undetected.
- **Overture Maps Releases** (`stac.overturemaps.org/catalog.json`) isn't
  Item-oriented at all — its collections list raw Parquet part files in a
  `registry.manifest` array, not STAC Items. A structural mismatch with the
  Item model this whole app (and the planned Item Set feature) assumes,
  independent of the static-vs-API question.

Both removed from `KNOWN_CATALOGS` (69 → 67). Lesson for §19's methodology:
CORS/reachability/genuine-STAC checks don't catch "is this actually
Item-shaped" or "is this actually static" — those require at least a
one-level-deeper look at a real child/collection response, not just the
root document.

## 20. Item Set — a browsable, searchable object for "all of a Collection's items"

A deeper product-philosophy conversation, not a bug report: Catalog/
Collection/Item are deliberately independent in STAC's own design (no
assumed cardinality, no assumed depth), and a Collection can hold anywhere
from zero to tens of thousands of Items. That freedom is exactly right at
the data-model level but was unhandled at the UI level — selecting a
Collection either fed Time/Space Lens a silently-bounded preview (§9's
`ITEM_LIMIT`) or meant drilling into Structure Lens's tree one node at a
time, with no way to browse/search "this Collection's items" as their own
object. Proposed as: treat the (potentially huge) set of Items under a
selected Collection as a first-class, derived (not a real STAC entity),
selectable/searchable UI object — an "Item Set" — separate from, but
feeding the same shared selection store as, Structure/Time/Space/Detail.

**Grounding research before implementing** (per the established pattern —
see the "research before design" habit noted elsewhere in this project):
two questions needed real answers, not assumption.

1. *Does the STAC ecosystem already have a pagination convention we should
   match?* Fetched `item-search/README.md`/`openapi.yaml` from
   `radiantearth/stac-api-spec` directly: `limit` is optional (spec default
   10, max 10000), and continuation is link-based only — a `rel:next` link
   in `links[]` if more pages exist, absent otherwise; the spec explicitly
   does not mandate a `page`/`next`/`token` param name, giving all three as
   equally valid examples. Also fetched `collection-spec.md`/
   `catalog-spec.md` from `radiantearth/stac-spec` directly and confirmed:
   static Catalogs/Collections have zero pagination concept at all — the
   spec simply expects a flat `item`/`child` link enumeration regardless of
   count.
2. *What does this look like in our own real data?* A background research
   pass fetched a sample of the (then-69) known catalogs looking for actual
   large Collections. Real, confirmed findings: Capella's SLC collection
   inlines **2285** `item` links in one collection.json; USGS 3DEP LiDAR
   inlines **2279** (and is typed `"Catalog"`, not `"Collection"` — another
   real instance of type labels not matching actual shape, same lesson as
   `classifyNodeShape`); EuroSAT MS inlines **3000** per class collection.
   A grep for `"rel":"next"` across every fetched response: zero hits,
   anywhere. So the STAC API's own pagination convention (link-relation,
   opaque or numeric param) turned out to be *not the relevant precedent*
   for this app today — every real Collection we have flatly enumerates
   everything in one file. The actual bottleneck is: each `item` link only
   names an href, not inline item data, so showing N items still costs N
   separate `item.json` fetches. "Big collection" here is a client-side
   incremental-fetch-and-render problem, not a server-pagination problem —
   worth designing for the latter (`ItemEnumeration`'s `cursor` variant
   already exists in `types.ts` for when `ApiSearchSource` lands) without
   pretending it's needed for what exists today.

**What got built**: `useItemSet(node)` (`src/hooks/useItemSet.ts`) —
fetches a node's own `item` hrefs in fixed-size slices (`PAGE_SIZE = 40`)
on demand via a `loadMore()` the caller triggers (not all upfront), tracked
by a generation counter so a stale in-flight slice fetch from a
just-abandoned node can't clobber state after the user re-selects
elsewhere (same class of race as §12's URL-sync bug — guarded the same
way, with a counter instead of a boolean). `ItemSetBrowser`
(`src/components/ItemSetBrowser.tsx`) renders this as a search box plus a
scrollable list inside Detail Panel, appearing only when
`node.items.kind === 'links' && node.items.hrefs.length > 0` — small
Collections (a handful of Items) get the same component, just never need
to scroll or search, no separate code path for "small" vs "large". Search
filters client-side, by id/title substring, over *only what's been
fetched so far* — surfaced honestly in the footer ("showing 40 of 2285
items loaded ... search covers loaded items only") rather than silently
missing unfetched matches. Reaching the bottom of the list (scroll-handler
threshold, not a "load more" button — matches "我可以用滚轮往下滚动加载")
fetches the next slice. Clicking any row calls the same `select()` the
other three lenses already share — no new wiring needed for Time/Space/
Detail to react, confirmed live (see below).

**Verified in-browser** (Playwright, headless, against the real Capella
SLC collection via a direct `#<href>` deep link — §18's mechanism doubling
as a test entry point): opens showing 40 of 2285 loaded; scrolling to the
bottom twice loads to 120; the search box filters the loaded 120 correctly
(and shows the honest "no match among N loaded" message for a query that
matches nothing); clicking a loaded row selects that Item everywhere —
Detail Panel switches to its own fields, Structure Lens auto-expands and
pans to it, and in the process surfaced a *real, previously-unseen*
`rel:collection`/`rel:parent` disagreement on that exact Item (its
`collection` link points to a "By Use Case → Environmental" grouping while
its `parent` link points to a "By Datetime → 2026-08-24" one) — §15's
containment-conflict warning fired correctly on real data neither of us
had looked at before, not just the fixture case it was originally written
against.

**Deliberately not yet done** (scoped down for a first pass, not
overlooked): the Item Set's currently-visible/filtered subset does not yet
feed Time/Space Lens (they still show their own independently-bounded
preview via `useSelectedItems`, unchanged) — wiring "what's filtered in
Item Set" into Time/Space as a live query loop is the natural next step,
and is the same gap already named in the README's "Not yet built" list as
"a genuine Space↔Time query loop," now with a concrete mechanism (Item
Set) to hang it off rather than a map-drag/timeline-drag interaction
invented from scratch. Also unbuilt:
virtualizing the DOM rows themselves (today's list is a plain scrollable
div — fine at the ~100s-of-loaded-rows scale exercised so far, untested
well past that), and any filtering beyond id/title substring (date range,
`properties` fields) — both natural extensions once this first pass is
validated in real use, not architectural blockers.

## 21. Items removed from Structure Lens entirely — a real bug traced to a conceptual conflict

A direct, blunt product-philosophy pushback, not a bug report at first:
"选中一个对象就局限在对象上" (selecting an object should stay scoped to that
object) — followed by a concrete, reproducible complaint: "我发现我关闭这个
collection之后,属于它的item还在tree view里面显示" (after closing this
Collection, its own items still show in the tree view). Traced to ground
truth rather than patched blind.

**Root cause.** Before Item Set (§20) existed, a leaf-items Collection
(e.g. Capella's SLC, 2285 Items) expanded directly into Item leaves in
Structure Lens's own tree — up to `ITEM_PAGE_SIZE` of them, fetched and
rendered as tree children on click. Separately, an "ancestor auto-expand"
effect (§10) walked up *any* newly-selected node's parent chain and called
`expand()` on every ancestor, including the node's own immediate parent
Collection, specifically so a selection arriving from Time/Space Lens
would render inside the tree. Once Item Set gave a second, better path to
reach an Item (search/scroll instead of tree-click), these two mechanisms
collided: selecting an Item via Item Set still ran the same ancestor walk,
which still called `expand()` on that Item's own parent Collection — silently
re-expanding a Collection the user had just manually collapsed, and, in
the old code, patching the newly-selected Item straight back into that
Collection's rendered `itemHrefs`. Confirmed by reading the effect, not
guessed at.

**The fix is conceptual, not a patch: Items are no longer part of
Structure Lens's tree at all.**
- `useStructureTree.ts`'s `expand()` only ever fetches `childHrefs`
  (sub-Catalogs/Collections) now — the old `needItems`/`loader.loadItems`
  call, `itemHrefs` state, and the "+N more items" synthetic leaf are gone.
  `TreeDatum` dropped `isItem`/`moreKind` entirely — nothing in the tree is
  ever an Item now, so there was nothing left for those fields to
  distinguish.
- The ancestor-auto-expand effect targets an Item's own *parent Collection*
  (never the Item itself, which never had a tree node to reveal) and
  expands only the ancestors **above** that Collection — never the
  Collection itself, since a leaf-items Collection has no tree children to
  reveal by expanding it. `StructureTree.tsx` highlights it directly
  instead: a dashed selection ring ("contains the current selection"),
  visually distinct from the solid ring for an exact match. A small "N
  items · see Detail Panel" label appears under any Collection with direct
  Items, replacing the click-to-expand affordance those nodes used to have
  (`canExpand` is now simply `childHrefs.length > 0` — a leaf-items node
  has none, so it renders hollow like a genuinely empty one, but the label
  makes the difference legible rather than indistinguishable).
- A second, related fix found while testing the first: the ancestor walk
  still re-ran on *every* Item selection, even consecutive ones inside the
  same Collection's Item Set (e.g., clicking through several Capella
  Items in a row) — which kept re-expanding that Collection's ancestor
  chain each time, undoing a manual collapse of an ancestor Catalog just
  as before, one level up. Fixed with a ref (`lastNavigatedTargetRef`)
  that skips the walk entirely when the resolved target Collection hasn't
  actually changed since the last time it ran — real navigation to a
  *different* Collection still expands its ancestors as before.

**Verified in-browser** (Playwright, against the real Capella catalog):
the tree now shows only Catalog/Collection structure, with item-bearing
Collections labeled "N items · see Detail Panel" instead of expanding;
clicking "Collapse to top level" (which doesn't touch selection) then
clicking through several different Items in the still-open Item Set and
Time Lens confirmed the collapsed ancestor Catalog stayed collapsed
throughout — the literal reported bug does not reproduce. One real,
unrelated discovery surfaced during this same testing: selecting a
Capella Item via Item Set sometimes jumps Detail/Time/Space to a
*different* Collection than the one you were browsing (e.g. selecting an
Item from SLC's Item Set lands on "Environmental," reachable via `rel:
collection`) — this is §15's containment-conflict logic working
correctly on real, previously-unexamined data (`rel:collection` and
`rel:parent` genuinely disagree for that Item), not a regression from
this change, though it's a legitimately disorienting UX moment worth
revisiting later.

**Update — "revisiting later" turned out to be immediately**, once the
embedded Item Set box (below) made this collection/parent-mismatch case
easy to hit by accident: "我选择了一个item之后,我就lost掉了...time 和区域显示
都丢了,tree里面也丢了" (after selecting an Item I got lost — Time and
Space's display both disappeared, and so did the tree). Reproduced and
confirmed directly: clicking a Capella Item from SLC's Item Set whose own
`rel:collection` points to "Environmental" made Time Lens read "Environmental
· showing 0 of 440 items", Space Lens show 0 footprints, the tree's dashed
ring jump off to a part of the hierarchy nowhere near where SLC's box still
should have been open, and the box itself vanish entirely (it only ever
rendered for the *exact* selected node, which was now the Item itself —
never a tree node at all).

**Root cause, and the actual fix**: `useSelectedItems`/`useStructureTree`/
`StructureTree` were all re-deriving "which Collection is this about" from
each newly-selected Item's own resolved `parentHref` — exactly the
`rel:collection`-vs-`rel:parent` disagreement §15 already knows can happen,
now actively driving navigation instead of just being flagged. Fixed by
introducing a second field on the shared selection store,
`browsingHref` (`store/selection.ts`) — the Collection/Catalog actually
being *browsed*, distinct from `selectedHref` which can drill into one
Item within it. `select()` only updates `browsingHref` when the newly
selected node is itself a Catalog/Collection; selecting an Item leaves it
pinned to whatever it already was (falling back to that Item's own
`parentHref` only if nothing was ever browsed at all, e.g. a fresh deep
link straight to an Item). `useSelectedItems`, the embedded box's
`boxHref`, the dashed "contains selection" ring, and the ancestor
auto-expand effect were all switched to target `browsingHref` instead of
re-deriving it per-Item. Detail Panel is intentionally untouched — it
still reads `selectedHref` directly and still shows the exact Item's own
declared `collection`/`parent` links and the disagreement warning, so the
underlying fact isn't hidden, it just no longer hijacks navigation.

Verified in-browser: selecting a Capella Item (the same "Environmental"-
mismatched one) from SLC's still-open Item Set now keeps the box open on
SLC, Time Lens reads "SLC · showing 40 of 2285 items ... selected: 
CAPELLA_..." with a focused window around it, Space Lens reads "SLC · 40
item footprints", and Detail Panel still shows the Item's own containment
warning unchanged — nothing jumps away, and the disagreement is visible
without being disorienting.

**Update — one further scoping question, asked directly: "既然我选中了一个
item,为什么还要显示所有item的时间和范围呢?"** (having selected one Item, why
still show every Item's time and extent?) Correct — comparing an Item
against its neighbors is Item Set's job (browsing a Collection, or a
search-filtered subset of it); once a specific Item is selected, Time/Space
Lens showing the other 39 loaded alongside it was the same "selecting an
object should stay scoped to that object" principle not yet carried all
the way through. Fixed in `useSelectedItems`: when the selection is
specifically an Item (not just its Collection), `items` is exactly
`[selectedNode]` — not filtered out of Item Set's loaded/visible set,
*replacing* it entirely — which also sidesteps needing the selected Item to
actually be a member of whatever Item Set happens to be open (relevant for
the `rel:collection`/`rel:parent`-mismatched Item above, which isn't
literally part of SLC's own item links). The Collection's own stated
extent/bbox still renders alongside it (via `node`, still resolved from
`browsingHref`) — full context on the axis/map, one precise mark within
it, not forty. Verified in-browser: selecting one Item now reads "SLC ·
showing 1 of 2285 items ... — scoped to just this Item, not its
neighbors" and "SLC · 1 item footprint".

**Update — pushback: hiding Items behind Detail Panel lost something a
search box can't replace.** "我觉得显示出子item是必须的,这是人思维模型导致的,
太多需要通过搜索则是为了解决太多的问题的衍生" (seeing sub-items directly is
essential — that's how human mental models work; requiring search was
really a fix for the *scale* problem, not a reason to hide items
entirely). Proposed concretely: render Item Set as a rich box embedded
directly in the tree, at the relevant Collection node, not only in a
separate panel — and explicitly floated switching the tree's rendering
approach entirely (a node-diagram library instead of hand-rolled SVG +
d3-zoom) if the current one couldn't support that.

**Spike, not yet a finished feature**: prototyped an embedded box via SVG
`foreignObject` — for the exact selected Collection only (never every
leaf-items node simultaneously; that would mean dozens of concurrent
Item Set fetches just because they're visible in the tree), rendering the
same `ItemSetBrowser` component inline at that node's position instead of
only in Detail Panel. Hit one real, non-obvious technical problem: a plain
React `onWheel`/`onMouseDown` with `stopPropagation()` on the foreignObject
did *not* stop d3-zoom from also zooming/panning the whole canvas while
scrolling/dragging inside the embedded list. Root cause, confirmed by
direct measurement (reading the canvas's own zoom transform before/after):
d3-zoom's wheel/drag listeners are attached natively directly on the
`<svg>` element, which sits *between* the foreignObject's content and
React's own delegated root listener in real DOM bubble order — the native
event bubbles through and past the `<svg>` (firing d3-zoom's handler)
*before* React's synthetic dispatch (which happens at the app root, higher
up) ever gets to run a React `onWheel` handler at all. Fixed by attaching
genuinely native listeners (`addEventListener`, via a ref + effect)
directly on the embedded box's own DOM node instead of relying on React's
synthetic event props — a native listener lower in the same real bubble
chain can call `stopPropagation()` early enough to actually pre-empt
d3-zoom's handler further up.

Verified in-browser after the fix: scrolling inside the embedded box
scrolls its own list (`scrollTop` changes) and leaves the canvas's zoom
transform completely unchanged; scrolling anywhere else on the canvas
still zooms normally; drag-to-pan elsewhere is unaffected; clicking a row
inside the box selects that Item and typing in its search input works
normally. **Conclusion: the current hand-rolled SVG + d3-zoom tree can
support this — no need to adopt a different diagramming library** (e.g.
React Flow), once this one native-listener gotcha is routed around.

**Update — layout collision, resolved.** "有可能么" — pull the box's
neighbors further away, keep the connecting link. d3-hierarchy's `tree()`
takes a `separation` function (relative gap between adjacent nodes, default
1 row-unit for siblings / 2 for cousins) — overridden so a node matching
`boxHref` (the node currently showing the box — see below) gets extra units
on both sides, computed from the box's actual pixel height
(`Math.ceil(ITEM_SET_BOX_HEIGHT / ROW_HEIGHT) + 1`), while every other node
keeps the default tight spacing. The link to its parent just becomes a
longer, more-curved path — no new rendering logic needed, d3 already draws
links from wherever nodes end up. Verified in-browser: selecting SLC now
visibly pushes GEO (its next sibling) down and out of the way instead of
overlapping it.

**Update — duplicate instance, resolved.** Detail Panel's own Item Set
section (a second, independent `ItemSetBrowser` — separate search state,
both writing to the same `itemSetStore`) is gone; that field now just
names the item count and points at the inline box ("browse and search them
inline in Structure Lens ... not duplicated here"). The inline box is the
single, canonical place items are browsed/searched now — Detail Panel goes
back to being purely about the exact selected node's own facts, which is
also what it was before Item Set existed at all.

**Still open**: only the exact `browsingHref` node gets the embedded box
today; whether that's the right scope (vs., say, a way to "pin" more than
one open at once) hasn't come up as a real need yet.

## 22. STAC API sources — a real STAC dataset has two faces, not one

Another product-philosophy reset, this time about the data model's other
long-anticipated gap: "任何一份数据,如果它支持 STAC 的话,它其实是有两副面孔" (any
STAC-conformant dataset genuinely has two faces) — a static, publisher-
organized link tree, or a live query API, or (per the spec, not assumed)
both at once, at whatever granularity the publisher chose. `types.ts` has
carried `StacSourceKind` (`static-links` | `api-search`) and
`ItemEnumeration`'s `cursor` variant since v0.1's very first data-model
comment ("a messy static climate catalog, a 51M-item dynamic STAC API, and
the STAC spec's own minimal example tree") — anticipated from day one,
never actually wired to a real fetch until now.

**Grounding research, three parallel passes, before touching code**
(per the established pattern):

1. **Spec** (`radiantearth/stac-api-spec`, primary source): `conformsTo`
   lives on the landing page only, by design — "STAC feels it is important
   for clients to understand conformance from a single request." Real
   conformance URIs quoted directly: Core, Item Search, Features,
   Collections, Filter (CQL2), Sort. Granularity is explicitly *not*
   all-or-nothing: "A STAC API Catalog may link to sub-catalogs within it
   via `child` links that declare different conformance classes... perhaps
   because it uses multiple databases to store items, but sub-catalogs
   whose items are all in one database can support search." And hybrid
   static+API isn't a theoretical edge case — the spec's own worked example
   landing page has both `child` links and a `search` link together,
   captioned exactly as "browse down through `child` objects, and also
   search across items in its collections."
2. **Real data** (direct probing, not documentation): fetched Element84
   Earth Search and Microsoft Planetary Computer's actual STAC API roots.
   Earth Search's root *does* have `rel:child` links down to Collection
   level — a real static tree, but it stops there. Planetary Computer's
   root has *no* `child`/`children` links at all — API-only from the very
   top. Decisively, for **both**: no Collection has a single `rel:item`
   link anywhere — only `rel:items` (an OGC API - Features query endpoint).
   Items themselves are never statically enumerable in either real,
   large-scale API — confirming the user's intuition sharper than even the
   spec states it: once a dataset is big enough to need an API at all, the
   static tree (if it exists) bottoms out above the Item level, every
   time. Also confirmed pagination shape is genuinely inconsistent:
   Earth Search reports `context.matched` (a real total); Planetary
   Computer's `/search` response has neither `context` nor `numberMatched`
   at all — only `rel:next` links. A client cannot assume a uniform
   contract here.
3. **STAC Browser** (real source, `radiantearth/stac-browser`, read
   directly — not inferred from behavior): detection lives in
   `src/store/index.js` (`state.conformsTo`, populated from the document's
   own `conformsTo` array or a fetched `rel:conformance` link as fallback)
   and `src/components/ApiCapabilitiesMixin.js` (regex-matches conformance
   URIs into flags like `canSort`/`canFilterExtents`/`cql`). Critically,
   the UI is a **genuinely separate view** (`src/views/ApiSearch.vue`),
   not the browsing UI with extra buttons bolted on — a real query-builder
   form (`SearchFilter.vue`: free-text tags, a date-range picker, a bbox
   checkbox revealing `MapSelect.vue` — a real OpenLayers drag-to-draw
   rectangle tool with manual N/S/E/W fallback fields, plus a dynamic
   CQL2 filter builder when supported), and mechanically different
   pagination (`Pagination.vue`, driven by API `first/prev/next/last`
   links) versus the static case's "show more" chunk button. No visible
   "this is API-backed" badge — the distinction is entirely structural
   (which view/controls appear), not a label.

**What got built, this pass — detection and real fetching, not yet a
query UI.** `graph.ts`'s `buildNode` now actually calls the
`detectSourceKind` function that already existed unused, and resolves each
node's `items` in this order: a flat `rel:item` array if present (static,
unchanged); else a `rel:items` link if present (the Collection-level
Features endpoint — the mechanism both real APIs above actually use); else,
only for a node that is itself an API root (`conformsTo`/`rel:search` on
its own landing page), a fallback to that root's own cross-collection
`/search` endpoint (a landing page has no items of its own to flatly list,
but the spec's own example shows exactly this "browse *and* search from
the same root" pattern). `apiSearch.ts` (new) does the actual fetching:
always GET (the spec documents GET as a first-class supported method for
`/search`, and a plain GET triggers no CORS preflight the way a POST with
a JSON body would — this app has no backend to route a preflight through),
following a `rel:next` link verbatim rather than reconstructing one (same
reasoning as §18's hash-URL finding, applied to a different endpoint), and
reading a total count from *either* `context.matched` *or* `numberMatched`
without assuming either is present — `hasMore` is judged solely from
whether a `rel:next` link exists. `StacLoader.cachePreFetched` inserts
Items returned by a search page directly into the shared cache with no
further network request — unlike a static catalog's `rel:item` links
(hrefs only, one fetch each), a search response already embeds full Item
JSON for every result.

`useItemSet` branches on `node.items.kind` transparently — `ItemSetBrowser`
itself, Detail Panel's pointer text, and Structure Lens's embedded box and
"N items" badge did not need new code paths, only to stop assuming
`items.kind === 'links'` everywhere (an assumption that had crept into
several places — the item badge, the box's visibility condition,
`useSelectedItems`'s total-count and empty-state logic — all fixed to use
`classifyNodeShape`'s existing `cursor`-aware "has items" check instead of
re-deriving it from `.hrefs.length`).

**Verified in-browser against the real, live Earth Search API** (added to
the landing page as a known catalog): opening its root renders a normal
Structure Lens tree — 9 real Collections under "Earth Search by Element
84" — with every single node, root included, labeled "items via API
search" instead of a numeric item count (correctly: none of them have any
`rel:item` links, exactly as the real-data research predicted). Selecting
"Sentinel-2 Level-2A" opens the same embedded Item Set box used for static
catalogs, showing real, live results — first item `S2B_..._L2A`, dated the
day of testing — with the footer honestly reporting "showing 40 of
51153048 items loaded" (Earth Search's real `context.matched`). Scrolling
the list triggers a real network request following the response's own
`rel:next` cursor (confirmed via request logging — the actual URL
Earth Search returned, containing an opaque `next` token, not one
reconstructed by this app) and appends 40 more real results. Selecting one
Item shows its real Sentinel-2 metadata, footprint, and a namespace never
seen before in this project (`earthsearch:`) correctly classified as
unknown/custom by the existing namespace-detection logic — built for three
fixtures, working unmodified on a fourth it had never seen.

**Deliberately not yet built**: no query UI at all yet — today's API
requests are unfiltered (`limit` + pagination only), so "browsing" a
51-million-item collection means scrolling through an arbitrary, unfiltered
slice of it, not a real search. The obvious next step is exactly the
"Space↔Time query loop" this project has had on its deferred list since
before Item Set existed: Space Lens's own map viewport as the `bbox`
input, Time Lens's own axis as the `datetime` range, feeding a real query
instead of a form bolted on the side the way STAC Browser does it — a
plausible differentiation from the reference implementation's own
approach, not just a port of it. Also deferred: growing the known-catalog
list with STAC Index's other ~60 STAC API entries the same methodical way
§19 grew the static list (Earth Search alone proves the pipeline, not the
breadth); CQL2/property filtering; and Sort.

**Update — called out directly, and correctly, as not actually solving the
problem it looks like it solves**: "让用户搜索id和title是不现实的,因为id和title
是没用的,用户看不懂这种由机器排列出来的id和title啊" (asking a user to search by
id/title is unrealistic — those are machine-generated strings nobody can
read) — and, pointedly, that scrolling only reveals the total count as you
go, so infinite-scroll-through-an-unfiltered-firehose isn't really
"browsing" a 51-million-item collection in any meaningful sense either.
Both true: the id/title search box and scroll-to-load-more UI built for
Item Set was designed against Capella's scale (thousands, with somewhat
legible ids), and porting it unchanged onto an API source with millions of
opaque, machine-generated ids is cosmetically functional but not
substantively useful — the "not yet built" query UI above isn't a nice-to-
have polish item, it's the actual point, without which this feature is
plumbing with no faucet. Confirmed as the very next thing to build, not
deferred further.

## 23. Layout: Time Lens and Space Lens no longer share one fixed-height row

Raised at the same moment, since the coming query UI needs a sane home in
both: "同时我们可以先把time和空间的UI位置等等先解决掉了...现在也是非常不合理"
(let's first fix Time/Space's UI layout — right now it's also very
unreasonable) — a complaint actually made much earlier in this project
(§17-era discussion) and deliberately deferred until Item Set's shape was
settled, since the two would affect each other's layout.

**The problem, precisely**: Time Lens and Space Lens were flex children of
one shared, fixed-height (280px) row. A real map benefits from a tall,
consistent area regardless of how much data there is; a timeline's natural
height is whatever its lane count actually needs — often much less. Forced
into the same box, either the map felt cramped or (the common case) Time
Lens's own content occupied a fraction of the row while the rest sat empty
underneath it — exactly the complaint. The `EmptyState` case made this
worse: a one-line "no data" message rendered inside a div forced to
`height: 100%` of that same fixed row, i.e. a large, mostly-blank panel for
any Catalog/Collection with no temporal or spatial facet at all (a common,
not rare, case).

**Fix**: stacked, not side-by-side. `App.tsx`'s bottom section is now
`flexDirection: 'column'` — Time Lens on top, full width, wrapped in a div
capped at `TIME_LENS_MAX_HEIGHT` (220px, scrolling past that for genuinely
dense multi-lane data) rather than stretched to fill a fixed slot; Space
Lens below, full width, at its own fixed `SPACE_LENS_HEIGHT` (340px),
completely decoupled from whatever height Time Lens ends up needing.
`TimeLens.tsx`'s own outer wrapper changed from `height: '100%'` to
`height: 'auto'` — the actual mechanism that makes it hug real content:
with no forced height, an `EmptyState` message collapses the whole
component down to one line, and a populated timeline sizes to exactly its
own lane count instead of an arbitrary fixed box. Space Lens's own
container couldn't get the same treatment — it always mounts a live
Leaflet map regardless of data state (§5's "container must always render"
rule, needed so the one-time mount effect never binds to a still-null
ref), so an empty Space Lens still shows a real, pannable blank map at its
full fixed height rather than collapsing — a lesser problem than Time
Lens's case since a live map isn't really "wasted" screen the way a blank
box under a short timeline was.

Verified in-browser: selecting a populated node (Capella's SLC) shows a
slim Time Lens strip (one visible lane) directly above a large, full-width
map — no gap between where the timeline's content ends and the map
begins; selecting a node with no temporal/spatial data at all (the Capella
root Catalog) collapses Time Lens to a single line of text, with Space
Lens still showing a real, usable (if dataless) world map underneath at
its normal height.

**Update — right the first fix immediately made worse: total footprint,
not just internal waste.** "我疯了,这不是占用了更多画面么?跟右侧的inspector组合
在一起不是最好么" (this takes up even more screen — wouldn't combining it
with the Inspector on the right be better). Correct: stacking Time above
Space fixed the *internal* waste (dead space below a short timeline) but
did so in a full-width row *below both* Structure Lens and the Inspector
column — meaning its combined height (up to `TIME_LENS_MAX_HEIGHT` +
`SPACE_LENS_HEIGHT`, potentially ~560px) came directly out of Structure
Lens's own vertical space, which is the one lens that's always shown and
arguably the most central view. Growing the total footprint to fix
internal waste was the wrong trade.

**Fix**: Time Lens and Space Lens moved *into* the Inspector column
(`App.tsx`), stacked below Detail's own facts, instead of a separate
full-width row beneath both columns. Their combined height now only
affects that one column's own scroll — Structure Lens keeps its full
height unconditionally, regardless of how much Detail/Time/Space content
there is below it. `DetailPanel.tsx`'s root div lost its own forced
`height: '100%'` for the same reason `TimeLens.tsx`'s did in the first
round: it's one section among several sharing a scrollable parent now, not
the sole occupant of its container — forcing full height there would have
claimed the whole column and left nothing for Time/Space stacked after it.
The three panel toggles (Detail/Time/Space) are unchanged in meaning, just
now govern sections *within* one column rather than a row plus a column;
Structure Lens still reclaims full width only when *all three* are off.

Verified in-browser: selecting SLC now shows Structure Lens's tree at full
height (siblings pushed apart by §21's `separation` fix now visibly fit
within it, unclipped); scrolling the Inspector column down past Detail's
JSON reveals Time Lens's compact strip directly followed by Space Lens's
map, both still full width *of that column* (45% of the screen, a real
trade against a timeline's own readability — noted, not solved here) but
costing Structure Lens nothing.

## 24. The real Space↔Time query loop — draw a bbox, drag a range, actually search

§22 shipped detection and fetching for API-backed Collections but no way
to filter them — "browsing" Earth Search's 51M-item Sentinel-2 collection
meant scrolling an arbitrary unfiltered slice of it. Called out directly,
and rightly, once that gap was felt in practice: "让用户搜索id和title是不现实
的,因为id和title是没用的,用户看不懂这种由机器排列出来的id和title啊" (asking a user
to search by id/title is unrealistic — those are opaque, machine-generated
strings nobody can read). The only two filters that actually mean anything
at this scale are spatial and temporal — which is exactly this project's
own "Space↔Time query loop" idea, sitting on the deferred list since
before Item Set existed, now built as the real fix rather than deferred
further.

**Design choice, made explicit rather than assumed**: manual, not
live-as-you-drag. Confirmed by asking directly rather than guessing —
the user's own reasoning matched the concern raised: a real API query
firing on every mouse-move while drawing a box would be wasteful, and
for a rate-limited or metered API, actually costly. So both tools follow
a draw-then-release-then-explicitly-search flow: drag out a shape, let go,
review the draft, click "Search" to actually apply it.

**What got built**:
- `store/query.ts` — the shared draft: `bbox`, `datetimeStart`/`datetimeEnd`,
  and a `searchNonce` that `useItemSet`'s cursor-mode branch watches
  (alongside node/kind changes) to know when to reset pagination and
  re-query with whatever's currently drafted. Deliberately not tied to
  `browsingHref` for reset — drawing a fresh area/range and hitting Clear
  is a manual action, not implied by navigation.
- `SpaceLens.tsx` — a "Draw area" toggle (shown only when the browsed
  node's items are `cursor`-kind — drawing a bbox does nothing for a
  static catalog). While active, disables Leaflet's own drag-to-pan and
  attaches raw `mousedown`/`mousemove`/`mouseup` handlers that grow a
  rectangle from the drag's start point to wherever the cursor currently
  is, finalizing into `store/query.ts` on release. Rendered as its own
  persistent layer (`queryLayerRef`), independent of `layerGroupRef` (item
  footprints, rebuilt on every visible-set change) so it survives those
  rebuilds.
- `TimeLens.tsx` — a parallel "Select range" toggle and drag-select
  directly on the axis, using plain React mouse events (no d3-zoom is
  involved in this component at all, unlike Structure Lens, so no
  propagation-stopping gotcha like §21's foreignObject one) — pixel
  positions convert to dates via the same `x` scale already driving the
  rest of the render, both for the live drag preview and for the
  persistent applied-range band.
- `apiSearch.ts`/`useItemSet.ts` — `fetchSearchPage` takes an optional
  `SearchQuery` (`bbox`, and an RFC 3339 `datetime` interval string built
  from separately-tracked start/end so either side can be open-ended),
  applied *only* when starting a fresh query (no `nextHref` yet) — a page
  reached via `rel:next` is still followed verbatim, never had params
  layered onto it, per §22's finding that a well-formed next-link already
  encodes whatever produced it.
- `ItemSetBrowser.tsx` — for a `cursor`-kind node, a query summary (current
  drawn area / selected range, or a hint pointing at the relevant tool) plus
  Search/Clear buttons appears above the id/title box, which itself is
  re-labeled "Filter loaded results by id/title (optional)" for this case
  — demoted to a secondary refinement of what's already been fetched, not
  presented as the primary way in.

**Verified in-browser against the real, live Earth Search API**: selected
Sentinel-2 Level-2A, drew a bbox over North Africa on the map, dragged a
~2014–2020 range on the timeline, and clicked Search. The actual request
fired:
```
.../collections/sentinel-2-l2a/items?limit=40
  &bbox=-13.0078125,-7.01366792756663,39.72656250000001,17.308687886770034
  &datetime=2014-08-02T19:28:41.910Z/2020-01-27T08:24:49.786Z
```
— correct spec shape on both params (bbox as west,south,east,north;
datetime as an RFC 3339 `start/end` interval), built entirely from the two
drag gestures, no manual coordinate entry. Real results came back
correctly scoped to the query: `S2A_36MUT_20200127_1_L2A`, dated exactly
at the range's end and geographically inside the drawn box (UTM zone 36 —
Sudan/Egypt); the drawn bbox rectangle persisted on the map through the
new search; the buttons correctly relabeled themselves "Redraw area" /
"Reselect range" once a query was active.

**Deliberately not yet built**: CQL2/property filtering and Sort (still on
§22's original deferred list); combining a drawn area with panning/zooming
the map afterward (the drawn rectangle is static once finalized, doesn't
follow further map interaction); clearing just one of bbox/datetime
independently (today "Clear" resets both at once).

**Update — two real bugs, same root cause, both reported directly and
immediately.** "地图盖在了所有UI的上面,导致地图框的header呀,按钮都看不见了" (the map
is covering all the UI — the header, the buttons, all invisible) and, in
the same breath, "我每次绘制之后出来的结果都不一样" (every time I draw, the
result comes out different). Both traced to the same cause: Space Lens now
lives nested inside a flex column inside a scrollable Inspector column
(§23), not a simple full-width row — a meaningfully different mounting
context than when this component was first built.

1. **Stale internal size, corrupting coordinates.** Leaflet measures its
   container's pixel size once at `L.map()` init and caches that
   internally for every subsequent pixel↔latlng conversion. That's fine
   when the container's size is already settled — not guaranteed now that
   Space Lens mounts inside a column whose total height still depends on
   Detail Panel's own content above it, which may not have finished laying
   out yet. Confirmed directly: drawing the identical on-screen rectangle
   three times in a row (same pixel coordinates each time) produced a
   *different* `bbox` on every draw, because Leaflet's cached notion of its
   own size/origin didn't match reality. Fixed with a `ResizeObserver` on the
   actual map container calling `map.invalidateSize()` whenever its real
   size changes, not relying on a single measurement at mount.
2. **No local stacking context, so nothing actually contained Leaflet's own
   z-index.** `position: relative` alone (Space Lens's outer div already
   had this) does **not** create a new CSS stacking context — only
   `position` combined with a non-`auto` `z-index` does. Without one
   anywhere between Space Lens and the document root (confirmed by tracing
   every ancestor: the Inspector column, App's flex containers, and the
   `<header>` all lacked one too), Leaflet's own internal panes (CSS
   z-index up to 700, for popups) and this component's own overlay buttons
   (z-index 10/11) were stacking directly in the *root* context — meaning
   any positive z-index element anywhere in Space Lens's subtree paints
   above ordinary in-flow content like the header, by CSS's own painting-
   order rules, regardless of DOM nesting. This was always theoretically
   true; it only became visible once Space Lens's actual on-screen
   rectangle started overlapping regions of the page (header, Structure
   Lens) that the old full-width-row layout never shared screen space
   with. Fixed by adding an explicit `zIndex: 0` alongside Space Lens's
   existing `position: relative` root — cheap, and now contains any future
   z-index used inside this component regardless of what layout changes
   happen above it later.

Verified in-browser: drawing the same rectangle three times in a row now
produces the identical bbox every time (`-47.46,-7.01 → 5.27,17.31`, all
three draws); the header, panel toggles, and Structure Lens all render
correctly with the map contained to its own area, scrolled or not.

**Update — the containment fix above was necessary but not sufficient.**
"地图z-index似乎还是盖住了UI" (the map's z-index still seems to be covering
the UI), reported again right after the fix above. Extensive
re-verification (Earth Search and Capella, multiple viewports, panel
toggling, scrolling) could not reproduce the *original* symptom (the map
covering the page header) — that part stayed fixed. But re-inspecting the
computed styles surfaced the real remaining gap: `.leaflet-container`
itself (the div Leaflet mounts into) has `position: relative` (Leaflet's
own CSS) but no `z-index` — so *it*, too, fails the "position **and**
non-auto z-index" test for creating a stacking context, exactly like
Space Lens's own outer div before the first fix. Once that outer div
started containing things properly, Leaflet's internal panes/controls
(the ones with real z-index — its control-container is 1000) were left
competing as direct stacking siblings against this component's *own*
overlay elements (the info bar and "Draw area" button, at z-index 10/11)
in that same now-locally-contained context — low enough that Leaflet's
own layers could still paint over them.

Fixed at the source rather than by chasing Leaflet's own maximum upward
by hand: gave `.leaflet-container` itself `position: relative` +
`zIndex: 0` (via inline style, alongside Leaflet's own class), so
everything Leaflet renders inside it is now bounded by *its own*
container's stacking context regardless of how high Leaflet's internal
values go — this component's overlay elements no longer need to
out-rank a specific number, they're simply siblings of that contained
box. Also bumped the overlay elements' own z-index to 1001/1002 as
defense in depth (matching Time Lens's tooltip, which already documented
clearing Leaflet's 1000 this same way). Re-verified: the info bar and
"Draw area" button render correctly above the map tiles and Leaflet's own
controls; draw-consistency (§24 above) still holds after this additional
wrapping.

**Update — reported as a hard cap, was actually a missing hint.** "然后我
用范围搜索之后,发现上限是40个item!" (after using the range search, I found
the cap is 40 items). Reproduced and diagnosed rather than assumed: the
pagination itself turned out to already be working correctly — scrolling
the Item Set list three times in a row against a real, large-matched-count
query fetched 40 → 80 → 120 → 160, each a genuine network request
following Earth Search's own `next` cursor. The actual bug was narrower —
the footer's "scroll the list to load more" hint only ever rendered when
the id/title text filter (`query`) was non-empty:
```
{query && state.hasMore && ' — search covers loaded items only; ...'}
```
An API search (drawing a bbox/range) never touches that text box at all,
so after a real search the footer read only "showing 40 of 916,261 items
loaded" with no indication 40 was just the first page rather than
everything — indistinguishable, from the UI alone, from an actual hard
limit. Confirmed directly by the user testing it: "是往下滚动才加载更多。那
这不就是我的问题么？我以为search是无视page的" (oh, scrolling loads more — so
was this just my own misunderstanding? I assumed search would ignore
pagination) — a reasonable assumption given the missing signal, not a
user error to wave off. Fixed by decoupling the hint from `query`: it now
shows whenever `hasMore` is true, with the wording only changing (not the
condition) based on whether a text filter is also active.

**Update — the deeper question underneath the hint bug.** "一个用户去绘制
范围搜索当然是想要拿到所有的数据,而不是带page啊" (someone who draws an area search
obviously wants all the data, not paginated) — "是不行对吧,是必须带page对吧"
(that's not possible, right — pagination is mandatory, right?), backed by
a real example: Sentinel-1 GRD over a specific area, scrolled repeatedly,
still climbing past 720 with clearly more to go. Answered precisely, not
just reassured: pagination genuinely cannot be eliminated — the Item
Search spec's own `limit` parameter caps at a hard maximum of 10000, and
there is no "return everything regardless of count" mode in the spec at
all — but **how large each page is, is entirely our own choice, not a
spec constraint**, and 40 (copied from the `links`-mode default, where
each Item is a separate fetch) was needlessly small for `cursor` mode,
where one request already returns full Item JSON for the whole page
regardless of size.

Two changes: `CURSOR_PAGE_SIZE` raised from 40 to 250 (comfortably inside
the spec's default-10/max-10000 range, still one request); and a "Load
all remaining" button (only for `cursor`-mode nodes, next to the "scroll
to load more" hint) that pages automatically until exhausted or
`LOAD_ALL_SAFETY_CAP` (5000) is hit — the explicit escape hatch for "I
want everything this search actually matched," distinct from incidentally
turning that into the default behavior (which would silently refetch a
genuinely unfiltered 51M-item search to exhaustion the instant someone
clicked it). `useItemSet`'s cursor-fetch logic was factored into a shared
`fetchOneCursorPage` helper so `loadMore` (one page) and `loadAll` (loops
it) don't duplicate the fetch/cache/state-update logic.

Verified in-browser against the real Sentinel-1 GRD collection, the
user's own example: drawing a small area over it and searching reported a
real `matched` count of 9442; clicking "Load all remaining" fired repeated
real requests (11 observed in ~8 seconds, 250 Items each) and kept
climbing past 2750 — genuinely paging through real data, not a simulated
progress bar, correctly stopping only at exhaustion or the safety cap.

## 25. Item Set's own box: too small to feel the data, and a real "can't find my selection" bug

Two complaints, same root cause (the embedded box was sized for a glance,
not for actually browsing): "从地图上选择了一个具体的item之后,inspector也许是
对的,但是在tree view里面没有看到选择到的item啊" (after selecting an Item from
the map, Inspector might be right, but I don't see the selected Item in
the tree view) and, immediately after — "我们现在每次选完一个collect,打开item
set,就在collect对象下面打开,然后就最多显示3个。我们明明可能加载到上千啊,一次性
只能看到3个我真的无语。我们这个项目也是需要让人感受到数据的体量和数量的啊"
(we can load up to thousands, but only ever see 3 at once — this project
needs to make people actually feel the scale of the data too).

**The "missing selection" turned out to be real, but not where expected.**
Diagnosed rather than assumed: the dashed "contains selection" ring (§21)
*was* rendering correctly on the right Collection when selecting an Item
from Space Lens — confirmed by cropping and zooming into a screenshot,
pixel by pixel. The actual gap was one level deeper: `ItemSetBrowser`'s own
list highlights the selected row (`background: selected ? ... : ...`) but
never scrolled it into view — with only ~3-4 rows visible out of
potentially thousands loaded, a correctly-highlighted row scrolled off
the bottom of a tiny box is indistinguishable from no selection at all.
Fixed by adding the same `scrollIntoView` pattern Time Lens's own selected
row already used, with a `lastScrolledRef` guard so it fires once per
distinct selection rather than fighting a manual scroll.

**The size complaint compounded it**: `LIST_MAX_HEIGHT` (260) and the
embedded box's own `ITEM_SET_BOX_HEIGHT` (220) were sized for "enough to
confirm the box works," not for actually conveying that a Collection can
hold thousands of Items — exactly the product goal this project has had
from the start. Raised to 560 and 760 respectively (with `overflow: auto`
added as a safety net on the box's outer wrapper, not the primary
mechanism — the list still scrolls on its own). The tree's `separation`
override (§21) already computes extra room from `ITEM_SET_BOX_HEIGHT`
directly, so neighboring nodes get pushed further apart automatically —
no separate change needed there.

Verified in-browser: the box now shows roughly 10 rows at once instead of
3; selecting an Item from a Space Lens footprint was checked precisely
(not just by eye) — reading the selected row's and the list's own
`getBoundingClientRect()` after the click confirmed the highlighted row's
box falls entirely inside the list's visible viewport.

## 26. Time Lens's "stated extent (source)" label, flush against the edge

"长久以来time的UI也是崩的,尤其是stated extent (source) 这几个字,顶头,都搞不懂
为什么会这样" (Time Lens's UI has been broken for a long time, especially
the "stated extent (source)" text — jammed at the edge, I can't figure out
why). Investigated thoroughly rather than guessed at: re-tested across
three real viewport widths (1024, 1280, 1400px) with real data (Capella
SLC), checked the SVG's actual `viewBox`/rendered size, the label's exact
`getBoundingClientRect()`, and the Inspector column's own scroll state —
found no clipping and no overlap with other elements at any of the three
widths (an initial "tated extent (source)" reading turned out to be this
session's own screenshot-crop boundary slicing through the first
character, not a real rendering defect — ruled out by re-shooting with a
generous margin).

What *is* real: the label's `x` coordinate was hardcoded to `0` — flush
against the SVG's own left edge with zero padding, the only label
anywhere in this view without one. Every Item row's own label (rendered
just below it) is right-aligned to `LABEL_WIDTH - 10`, giving it natural
breathing room; "stated extent (source)" never got the same treatment.
Fixed by aligning it the same way — right-anchored at `LABEL_WIDTH - 10`,
consistent with every row below it, instead of hard-left at the container
edge.

(Separately, WHILE testing at 1024px width specifically, the axis
rendered only a single date tick despite requesting 2 — that's d3's own
`scaleUtc().ticks(n)` treating `n` as a hint, not a guarantee, picking
whichever "nice" round date values fit a given domain; not the bug being
investigated here, and not changed, but noted in case it's what "崩"
partly referred to as well.)

## 27. A real edge back to Item Set — and the case for pulling complex filters into their own place

Two more product-direction points, raised together. First: "我其实没有懂
stated extent (source) 这一行的虚线数据指的是什么" led into "我其实更喜欢之前的
tree view从collection也能连接items,但是也想由一个框框住items set,让我可以选,
就跟现在一样" (I actually prefer how the old tree view visually connected
Collection to its Items, but I also still want a box that frames the Item
Set so I can select from it, same as now) — not a request to bring Items
back as tree nodes (§21's fix stands), just to restore the *visual*
language of "this Collection connects to something" that got lost when
the box started merely floating next to the node with no edge at all.

**Implemented**: a real `<path>`, drawn with the exact same `linkGenerator`
(and the same stroke) every other parent→child connection in this tree
already uses — just fed local coordinates (the node at its own origin, the
box's near edge as the target) instead of global hierarchy points, since
this connection lives entirely inside one node's own `<g>`, not the
outer shared link layer. Two real bugs surfaced while getting this right,
not assumed away:
1. First attempt targeted the box's *vertical center* — with the box
   mostly sitting *below* the node rather than to its side, the resulting
   bezier had almost no horizontal component and rendered as an
   invisible sliver hugging the boundary between node and box. Fixed by
   targeting a point near the box's *top* instead, reproducing the same
   proportions (short vertical span, comparable horizontal span) as an
   ordinary sibling-to-sibling link.
2. Even fixed, the box sat close enough to the node (a few px past the
   label) that the curve had barely any room to read as a curve at all.
   Added `ITEM_SET_BOX_GAP` (60px) between the label and the box's near
   edge specifically to give the connector real space to exist in.

Verified by reading the rendered `<path d="...">` directly and its
`getBoundingClientRect()` — confirmed a real, correctly-shaped cubic
bezier at the exact expected screen position, not just eyeballed; visually
it's intentionally the same thin, muted style as every other link in the
tree (not made more prominent), since the whole point was to make Item
Set read as *attached*, not to make it shout.

**Second point, not yet acted on**: "我不知道search的功能其实还有很多对吧,比如
云层覆盖度等等,这些复杂的条件等等完全也可以跳出来一个modal实现。现在都集中在
time和地图上,导致这里其实有点怪,一方面是呈现结果,一方面又要来选择,用户需要
跳来跳去" (there's a lot more to search than this — cloud cover etc. — and
those complex conditions could be a modal instead; right now everything's
concentrated on Time/Space Lens, which is odd, since they're simultaneously
showing results *and* being where you go to filter, so the user has to
jump back and forth). A real, sharp observation: bbox-via-draw and
datetime-via-drag work precisely because those two dimensions have an
obvious, direct spatial/temporal representation on the same surface that
already displays results — but CQL2 property filters (cloud cover %,
platform, instrument mode, arbitrary expressions) have no such natural
mapping onto a map or timeline; they're just form fields, and cramming
miscellaneous form fields onto a map/timeline doesn't make sense no matter
how the rest of the query UI is built.

Proposed synthesis (not yet built, discussed and to be confirmed before
starting): keep Space/Time Lens's draw/drag tools exactly as they are for
bbox/datetime specifically, where the dual result-view/input-tool role is
actually earned — and add a genuinely separate panel/modal for everything
else (property filters, once CQL2 support exists at all — still on §22's
deferred list), showing the current bbox/datetime as a read-only summary
alongside the new fields, with one unified Search action. Not started —
this is a real scope decision (which filter fields matter, CQL2 query
construction) that hasn't been made yet, not an oversight.

## 28. Real per-item nodes, restored — the fan-out redesign

§27's single trunk line turned out not to be what was actually being asked
for. Follow-up: "我就想说的是连线到每一个item，跟之前一样，但是有能够有一个
group的UI" (what I mean is: connect to each item, like before, but have a
group UI). Presented three concrete options (a dynamic fan of lines
matching the box's visible rows, a static bracket around the box with no
per-item lines, or real per-item nodes inside a grouped frame) — the user
picked the third, explicitly accepting it as "改动最大" (the biggest
change) and that it would need to re-solve the exact class of bug §21
already fixed once (closing a Collection, its Items still showing).

**Implemented**: `ItemFan`, a new component rendered only under the same
`showItemSetBox` condition the box itself already uses — no separate
expand/collapse state for Items at all, which is precisely what caused the
original bug (Item visibility tracked independently of the rest of the
tree's own expand/collapse machinery, so the two could drift out of sync).
One source of truth can't drift from itself.

Capped at `ITEM_FAN_MAX` (12) real nodes — not one per loaded Item, which
routinely runs into the thousands (§19/§22) — each with its own
`linkGenerator`-drawn curve fanning from the Collection's own origin,
inside a dashed rounded-rect "group" frame with a header ("Item Set — N")
and a "+N more — search/scroll below" trailing line when the loaded/
filtered set exceeds the cap. Reads `visibleHrefs` from
`useItemSetStore` — the same search-filtered set Time/Space Lens already
read (§21) — so the fan narrows along with a text filter exactly like the
box's own rows do, not a stale unfiltered sample. The box itself is
unchanged and still sits below the frame, still the actual mechanism for
searching/scrolling/selecting across everything loaded — the fan is a
representative, individually-connected preview, not a replacement.

A real bug surfaced immediately during verification, not caused by the
fan's own rendering logic: `useItemSetStore((s) => s.forHref === node.href
? s.visibleHrefs : [])` — returning a fresh `[]` literal on every call when
the condition is false looks like a changed value to zustand's equality
check on every render, which triggered React's "getSnapshot should be
cached" infinite-loop warning in the console. Fixed with a module-level
`EMPTY_HREFS` constant reused across calls instead of a fresh literal.

Verified against Capella's SLC collection (2286 items) via Playwright:
extracted the frame/box/circle `getBoundingClientRect()`s directly (the
tree's auto-pan-on-select fires once, before the fan/box finish loading and
shift sibling layout via `separation()`, so a screenshot taken too early
looks at a stale position — confirmed by re-reading positions after a
manual pan-to-settle rather than trusting the first auto-center), confirmed
12 real circles + 1 dashed frame rendered, confirmed each has a genuinely
distinct link path (not one shared/degenerate curve), and confirmed
clicking a fan node selects that exact Item (Detail Panel showed the
clicked Item's own id, not some other row).

## 29. Centralizing search into Item Set — and two real bugs it surfaced

Direct follow-up question: "我就想问，为什么不能将search bar 或者api 交互bar
放入item set里面 或者结合起来呢？一定要分两块？" (why can't the search bar or
API interaction bar live inside Item Set, or be combined — does it have to
be two separate places?). Item Set's own box already held the query
summary, Search/Clear, id/title filter, results list, and pagination — the
only thing genuinely missing from it was the *trigger* for the actual
draw-a-bbox / drag-a-range gesture, which lived as buttons on Space Lens
and Time Lens respectively. Presented the tradeoff (the drag gesture itself
needs a real map/timeline — shrinking one into the tree's box would be a
worse way to specify a bbox than drawing on an actual map) as three
options; the user picked centralizing the *trigger* into Item Set while
leaving the actual drag surface where it already made sense: "以item set
为主" (Item Set should be the primary/home surface).

**Implemented**: `store/query.ts` gained `drawRequest: 'bbox' | 'datetime'
| null` plus `requestDraw`/`clearDrawRequest` — the single source of truth
for "which draw tool is armed," replacing what used to be Space Lens's and
Time Lens's own separate local `useState`. Both Lenses now derive
`drawMode`/`rangeMode` from this shared field instead of owning it, so a
"Draw area" button click means the same thing regardless of which of the
(now three) places it's clicked from. `ItemSetBrowser`'s query section
gained matching `ToolButton`s ("Draw area"/"Redraw area"/"Drawing…" and
"Select range"/"Reselect range"/"Selecting…", styled identically to the
Lens's own) that call the same `requestDraw`. `App.tsx` watches
`drawRequest` and force-shows whichever panel (`showSpace`/`showTime`) it
targets — a panel toggled off is still off, so arming its tool has to
actually bring it back, not silently do nothing — and scrolls it into view
(deferred one `requestAnimationFrame` past the state update, since the
panel's own DOM element doesn't exist yet in the same tick the toggle
state change commits).

Two real, pre-existing bugs surfaced during verification, neither caused by
this change but both actively interfering with testing it:

1. **StrictMode double-fetch, duplicate Items.** `useItemSet`'s `loadMore`
   guarded re-entrancy with `loadingMore` *state* — but React StrictMode's
   dev-only double-invoke of a mount effect (mount, cleanup, mount again)
   runs both invocations before the first's `setLoadingMore(true)` has
   actually committed to a re-render, so both calls saw a stale `false` and
   both fetched+appended the same first page. Confirmed directly against
   Earth Search's Copernicus DEM collection via React's own "duplicate
   key" console warnings on repeated Item hrefs. Fixed with a `loadingRef`
   set/checked synchronously (not through React state) as the real guard,
   plus href-based de-dup on every `setItems` append as defense in depth
   (a live API could legitimately return an overlapping edge item across
   two real pages, independent of this specific bug).
2. **Item Set's box can render past the Structure/Inspector column
   boundary, silently unclickable there.** The tree's auto-recenter-on-
   select effect centers the *node* in the middle of the Structure Lens
   column — but the Item Set box (and now its fan) only extends *from* the
   node in one direction, needing up to ~400px of room on that side alone,
   which the column's other half doesn't reliably have. Confirmed directly
   via `elementFromPoint`: a "Draw area" button's own reported screen
   center resolved to Detail Panel's div, not the button, because part of
   the box had drifted past the column's own boundary into the Inspector
   column's screen area — a plain sibling box painted after it in DOM
   order, occluding it regardless of any overflow/clipping on the
   Structure Lens side (clipping the tree's own column only hides its
   overflow; it can't make a *different* sibling box's content disappear
   from underneath). Fixed at the actual source: the recenter effect now
   biases the node's screen position toward whichever edge is *away* from
   its own Item Set box (using the same `labelOnLeft` logic `TreeNodeView`
   already uses to decide which side the box renders on), leaving the
   box's side the column's full remaining width instead of only half.
   `overflow: hidden` was also added to the Structure Lens column as a
   second, independent line of defense — it doesn't fix clickability on
   its own (a clipped element and an occluded-but-unclipped element are
   equally unclickable), but it does stop any residual bleed-through into
   the Inspector column from being visible at all once a user manually
   pans/zooms somewhere the centering heuristic doesn't cover.

Verified end-to-end via Playwright against Earth Search (a real cursor-mode
API source): with the Space panel hidden, clicking "Draw area" inside Item
Set correctly armed the shared tool (`elementFromPoint` at the button's own
center resolved to the button itself, not Detail Panel), auto-revealed the
Space panel, and Space Lens's own map entered its "Drawing… (drag on map)"
state — confirming the same underlying store field, not just matching
visual copy. Repeated for Time Lens's "Select range" with the same result.

## 30. Research: is the "fan + separate panel" split a library limitation, or something deeper?

After §28's fan-out redesign shipped, a sharp follow-up question: is the
fact that we always seem to land on "node-link diagram on top, independent
scrollable panel below — glued together, never truly one thing" a limit of
d3 (the library drawing the tree), or something we could get past with a
different rendering stack entirely? Explicitly asked for broad research
before any more building, not an immediate implementation. Findings, with
sources:

**d3-hierarchy is not the limiter.** `d3.tree()` (the Reingold–Tilford
"tidy tree" algorithm we use) is pure layout math — it computes x/y
coordinates for a hierarchy and has no opinion at all about what renders
those coordinates. The exact same layout output can drive SVG, Canvas, or
WebGL rendering; nothing about our current "two glued panels" outcome
traces back to this library specifically.

**What *is* a real, measured limitation of our current stack: SVG element
count.** Real-DOM SVG rendering (one element per node/link, our current
approach) starts degrading noticeably past roughly 1,000–2,000 elements;
Canvas gives a 10–100x improvement over that; WebGL-based graph renderers
(Sigma.js) are proven out to 100,000–500,000 nodes. This is exactly why
§28's fan was hard-capped at 12 real nodes rather than showing a
Collection's actual full Item count as connected nodes — that cap is a
consequence of SVG's own ceiling, not a design preference.

**The deeper reason the two pieces never feel like one thing, though, has
nothing to do with SVG specifically — it would survive a rewrite onto any
of these other stacks.** PixiJS ships `DOMContainer` as its own official,
purpose-built answer to "embed real interactive HTML — something that
scrolls, something with its own text input — inside a WebGL scene that
itself pans and zooms." Even that official feature's own documentation
does not address the conflict between the embedded element's native
scroll/wheel gestures and the outer scene's own pan/zoom gestures — in
practice it needs the exact same manual `stopPropagation()` workaround we
already had to build for our own `foreignObject` + d3-zoom combination (see
§21). This is not a gap specific to our library choice; nesting a
*natively-scrolling* widget inside *anything* that interprets pan/zoom
gestures over the same input stream creates this seam, full stop.

**How Figma/Miro/tldraw actually avoid this seam**: they don't nest native
DOM scroll inside their canvas at all. These tools bypass HTML/CSS
rendering entirely for canvas content (WebAssembly/WebGL, C++ in Figma's
case) and interpret every gesture — including what looks like "scrolling a
list" — as their own camera/transform math, never delegating to the
browser's native scroll model. A real DOM element only ever appears
briefly, for something like live text editing, and is dismissed
immediately after — the same pattern our own `foreignObject` already uses,
just far more sparingly than an always-mounted scrollable list.

**What "make the seam disappear" would actually require**: treating
"search/scroll an Item Set" and "pan/zoom the tree" as the *same* gesture
vocabulary — semantic zoom. Zooming into a Collection reveals its Items as
more of the same canvas rather than opening a separate widget; what reads
as "scrolling a list" is just panning that region. This is a real
architectural shift, not a tweak: it means reimplementing the search input,
row hit-testing, and highlight/select behavior ourselves on a canvas/WebGL
scene graph instead of leaning on native DOM scroll/input elements.

**Tiered options, cheapest to most ambitious** (not decided, for future
reference when this comes up again):
- **Tier 0**: keep the current stack; animate the transition between a
  collapsed indicator and the expanded box (FLIP-style) instead of an
  instant swap. Improves perceived cohesion only; doesn't touch either the
  node-count ceiling or the native-scroll-vs-pan-gesture conflict.
- **Tier 1**: move only the Item layer's rendering to Canvas (tree stays
  SVG). Lifts the ~12-node cap to real thousands with individual
  connecting lines at scale; the scroll-vs-pan gesture conflict remains
  unless list scrolling is reimplemented as camera panning rather than
  native DOM scroll.
- **Tier 2**: rebuild Structure Lens's rendering on a canvas/WebGL scene
  graph (e.g. PixiJS + pixi-viewport), with Item Set search/scroll/select
  unified into the same pan/zoom gesture vocabulary as the rest of the
  tree — semantic zoom for real. `d3-hierarchy`'s layout math can still
  drive it; what changes is who renders it and who owns the gestures. The
  biggest bet, and the one actually capable of a genuinely novel
  interaction rather than a polished version of "two panels."

Decision after this research (see §31): not pursuing Tier 1/2 right now —
drop the per-item fan entirely and go back to just the box, but fix a real,
separate layout problem the fan's `separation()` hack had introduced.

Sources: [d3-hierarchy](https://github.com/d3/d3-hierarchy) ·
[Optimizing D3 Chart Performance for Large Data Sets](https://reintech.io/blog/optimizing-d3-chart-performance-large-data) ·
[React Flow: Performance](https://reactflow.dev/learn/advanced-use/performance) ·
[Cytoscape.js vs vis-network vs Sigma.js 2026](https://www.pkgpulse.com/blog/cytoscape-vs-vis-network-vs-sigma-graph-visualization-javascript-2026) ·
[DOMContainer — PixiJS docs](https://pixijs.download/dev/docs/scene.DOMContainer.html) ·
[Creating a Zoom UI — Steve Ruiz](https://www.steveruiz.me/posts/zoom-ui) ·
[How to Create a Figma / Miro Style Canvas with React and TypeScript](https://www.freecodecamp.org/news/how-to-create-a-figma-miro-style-canvas-with-react-and-typescript/)

## 31. Dropping the fan, and a real "stale empty space" layout bug

Direct follow-up after digesting §30's research: given the ambition of a
true semantic-zoom rebuild is a much bigger bet than warranted right now,
the decision was to stop pursuing "connect to every Item as a real node"
altogether — "那我就不需要再把整个像节点一样的那个item set全部拿出来了,不需要
了,就有一个那个panel在的那个UI是可以的" (I don't need to pull the whole Item
Set out as node-like things anymore — just having the panel UI there is
fine). §28's `ItemFan` component (the capped 12-node fan + dashed group
frame) was removed; Structure Lens is back to a single connecting line
(§27's original design) plus the box.

That surfaced a second, independent, real bug in the process — not about
the fan at all, but about how the box's presence affected the *rest of the
tree's* layout: "当我开另外一个collection了以后,上一个collection关闭以后,下
面留了一个巨大的空间在那里...这个就不够灵活" (after opening a different
collection, the previous one closes and leaves a huge empty space below —
not flexible). Root cause: the `layout` `useMemo`'s `tree().separation()`
override reserved `~41` extra row-units of vertical space around whichever
node currently showed the box (enough for the fan + box's combined
~1048px height) — since only one node ever shows the box at a time
(`browsingHref`-driven), switching from browsing Collection A to Collection
B didn't just relocate the box, it perturbed the *entire tree's* layout:
A's neighborhood lost ~1048px of reserved space right as B's neighborhood
gained the same amount elsewhere, all in one d3.tree() recompute with no
interpolation between the two states.

**Fix**: removed the `separation()` override entirely — the box (and now
just the box, with the fan gone) is a floating overlay positioned off its
node exactly as before, but no longer participates in the tree's own row
layout at all. Default d3-hierarchy separation (1 row-unit between
siblings, 2 between cousins, uniformly) is exactly right on its own now
that nothing needs extra room reserved for it. The box can, in principle,
visually sit near/over a neighboring node or link when it's open — an
accepted tradeoff given only one Collection is ever browsed at a time, the
same reasoning that made a floating overlay reasonable in the first place.

Verified directly, not just by inspection: recorded the vertical (`y`)
position gap between "SLC" (Capella's SLC collection, 2286 items) and its
real tree-sibling "GEO" in three states — before selecting SLC, while its
box is open, and after collapsing/re-expanding past it. All three showed
an identical 26px gap (exactly `ROW_HEIGHT`, the default single-row
separation) — previously, the "while open" state would have shown roughly
1,092px (26 + 41×26) between the same two nodes. Opening a Collection's
Item Set no longer reflows anyone else in the tree, and there is no longer
any stale reserved space left behind after switching away.

**Update — long titles overlapping the box.** Immediately after this
landed: "collection的文字比较长...导致所有的collection文字呢,就是这样子盖在了
这个items的panel上面" (my Collection titles are fairly long — they end up
covered by the Item Set panel). Root cause: `boxNearX` (the box's near
edge, and the connecting link's target) was computed as a fixed
`ITEM_SET_BOX_GAP` (60px) past the label's own *start* position — fine for
a short label, but a 40-character truncated title (`LABEL_MAX_CHARS`)
reaches roughly 280px past that same start point, which the box's fixed
60px gap never accounted for. Fixed by estimating the label's actual
rendered width (`text.length * fontSize * 0.6`, a rough but sufficient
average-character-width approximation for a proportional sans-serif font)
and placing the box that many pixels further out, plus the same
`ITEM_SET_BOX_GAP` beyond *that* — so the gap now scales with the title's
own length instead of being measured from a point the title itself might
extend well past. Verified against Earth Search's NAIP collection ("NAIP:
National Agriculture Imagery Prog…", one of the longest real titles in any
known catalog): confirmed via `getBoundingClientRect()` that the label's
right edge and the box's left edge no longer overlap (a clean ~106px gap),
and via screenshot that the full truncated title renders legibly with
clear space before the panel starts.

## 32. Free-form dragging — nodes, subtrees, and the Item Set box

Direct follow-up: "我更愿意用户可以具体地拖拽一些东西...我可以拖拽这个item的
panel...我也可以拖拽,比如说这个collection的这个节点呀之类的。然后我可以一键
全部整理到最初...这样子自由度,那就用户自己来探索的自由度" (I'd rather users
could specifically drag things around — the Item Set panel, a Collection's
own node — and reset everything back to the original layout with one
click; that kind of freedom, for the user to explore on their own, is the
effect I want). Unlike §30's semantic-zoom research, this doesn't need new
rendering technology — it's a bounded, well-understood interaction pattern
on top of the exact same SVG + `d3-hierarchy` + `d3-zoom` stack, just with
manual position overrides layered on top of the computed layout.

One real design fork needed a decision before building: when dragging a
Catalog/Collection that has children, does its whole subtree move with it,
or does only that node move (with links stretching to its still-anchored
children)? Asked directly, with mockups; chose "whole subtree moves
together" — feels like grabbing a real branch, and avoids a lone node's
links crossing back over its own children's links.

**Implementation**: `dragOffsets` (`Map<href, {x, y}>`, in `d3-hierarchy`'s
own vertical/horizontal convention, added on top of whatever `tree()`
computes) and a separate `boxOffsets` (`Map<href, {dxHoriz, dyVert}>`,
deliberately a *different* shape/naming — the box is positioned via plain
`foreignObject` x/y attributes, not the swapped hierarchy convention, and
giving it the same `{x, y}` shape as node offsets would invite exactly the
kind of swapped-axis bug this file already hit once with `linkGenerator`).
`effectiveXY(n)` adds a node's own offset to its computed position, used
for both rendering the node itself and for link endpoints (a link whose
source/target has an offset has to follow it, or it visually detaches from
whichever end was dragged). Dragging a node writes the same incremental
delta into *every descendant's own entry* at drag time (via
`n.descendants()`), not just the dragged node's — so each node's effective
position is a single direct lookup at render/link time, no ancestor-walk
needed.

Drag-vs-click disambiguation and defeating d3-zoom's own pan-to-drag use
the same native (non-React-synthetic) listener pattern already established
for the Item Set box (§21): a pointerdown handler stops propagation, then
tracks movement against a small threshold (4px) before committing to
"this is a drag" — under the threshold, pointerup fires the normal
select/toggle-expand behavior unchanged; over it, the threshold-crossing
and every subsequent move updates the offset instead. The "latest ref"
pattern (`viewTransformRef` one level up already uses this) keeps the
native listener's closure reading current prop values without
re-subscribing every render — updated via a plain `useEffect(() => {...})`
with no dependency array, not by writing to the ref during render itself
(oxlint's own `react(refs)` rule flagged the first attempt at this
directly: "Cannot access refs during render").

The box gained its own small drag handle (a thin grip bar, first child
inside its content) rather than making the whole card draggable — it's
already full of its own click/scroll/type targets (rows, a search input,
buttons), so a whole-card drag would fight all of them.

"Reset layout" (next to "Collapse to top level"/"Expand all catalogs",
shown only once anything has actually been dragged) clears both offset
Maps — snapping every manually-positioned node and box back to whatever
`tree()` currently computes, in one click.

Verified directly via Playwright, not just read from the code: dragging a
Catalog with children moved it and a child by the *exact* same delta
(confirming whole-subtree-together); "Reset layout" restored a dragged
node's transform to a byte-for-byte match of its pre-drag value; dragging
the box moved only the box (a sibling node's transform stayed provably
unchanged, ruling out an accidental canvas pan) by exactly the intended
screen delta at `k=1`, and the search input inside it still accepted
typing normally afterward. One test-methodology trap along the way: an
early box-drag check ran against a scenario (Capella's SLC, after "Expand
all catalogs") where the tree's own recenter effect had panned the view to
a screen position with a negative y-coordinate — Playwright still
happily computed a "bounding box" for the (genuinely off-screen) handle
there, and driving `page.mouse` to those coordinates produced a domino of
misleading results (an apparent direction *inversion*) that had nothing to
do with the drag feature itself. Re-run against a stable, on-screen,
`k=1` scenario confirmed the feature was correct all along; the first
result was the test's own artifact, not a real bug — a reminder to
distrust a screenshot/measurement taken from an off-screen or mid-pan
state before concluding a real feature bug exists.

**Update — the hand-rolled version had a real, confirmed conflict with
d3-zoom's own pan, and a hit-target too small to use.** Direct, sharp
feedback right after trying it: "我发现能够拖拽的范围非常小...而且我觉得这个是
某种程度上...很可能是由于我同时在移动画布,同时又在移动节点" (the draggable area
is really small — and I suspect this is because I'm moving the canvas and
the node at the same time), followed by an explicit ask to stop hand-
rolling and use "一套比较广泛的、比较泛用的一套逻辑...符合best practice...现成
的一套方法" (a widely-used, general, best-practice, off-the-shelf
approach) — including an open invitation to refactor the whole thing if
that's what it took.

Root cause, confirmed empirically before touching any code: the original
implementation's native `pointerdown` listener only called
`stopPropagation()` on the `pointerdown` event type. Nothing guarantees
that's the *only* event type d3-zoom's own internal drag-to-pan listens
to — if it (or a browser's own compatibility-event dispatch) also reacts
to a plain `mousedown` on the same physical gesture, the canvas pan and
the manual node-drag logic both engage from one gesture at once, and
their effects add together on screen: exactly "mouse moves a little, node
jumps a lot."

Researched the actual answer rather than patching the symptom: d3-zoom
and d3-drag are the two halves of one *documented, official* pairing for
this exact composition (a pannable/zoomable canvas with individually
draggable elements inside it) — `zoom.filter()` is d3-zoom's own,
purpose-built mechanism for excluding specific elements from ever
initiating a pan/zoom gesture, checked once at the point a gesture would
start, for whichever event type d3-zoom actually listens to internally
(not something the caller has to guess). `d3-drag` in turn computes
`event.dx`/`event.dy` as deltas already local to whatever `.container()`
is set to — i.e., already correctly divided by the current zoom scale —
removing an entire class of manual "divide by k" bugs at the source.

**Rewritten accordingly**: a single `BLOCK_PAN_ATTR` (`data-block-pan`)
convention, checked once inside the zoom behavior's own `.filter()`
(preserving d3-zoom's documented default filter — ignore ctrl+click and
non-primary buttons — and adding the exclusion on top), applied to every
element that has its own competing gesture: the node's hit-target, the
box's drag handle, and the box's whole content (covering scroll/click/type
inside it uniformly, replacing the old 3-event-type `stopPropagation` hack
there too). Each draggable element gets a real `d3.drag()` behavior bound
via `select(el).call(behavior)`, `.container()` pointing at the zoom-
transformed `<g>` so its coordinate math lines up with `tree()`'s own x/y
and `foreignObject`'s x/y attributes. The node's circle went back to a
plain React `onClick` for select/expand — d3-drag suppresses the
browser's own subsequent `click` event after a real drag on its own, no
manual click-vs-drag threshold logic needed.

Also fixed in the same pass: the draggable hit area was just the visible
dot's own radius (6–7px in local units) — confirmed directly as "范围非常
小...只有那个圆点的周围一点点". Added an invisible, larger (`radius + 10`)
transparent circle at the same center carrying the actual click/drag
handlers, with the small visible dot now purely decorative
(`pointerEvents: 'none'`) underneath it — the standard SVG pattern for "a
small visual mark, a bigger interactive target" (the same idea as a
thicker invisible stroke on a thin line for easier hovering).

Verified thoroughly via Playwright, having been burned twice already in
this same section by unverified assumptions: dragging from *off* the
visible dot (but within the new larger hit target) still drags the node;
an unrelated sibling node's transform stayed byte-for-byte unchanged
during another node's drag (proving the canvas genuinely does not pan at
the same time); a plain click with no movement still selects/expands
normally; and — the one that would have caught the original manual-`/k`
approach's own arithmetic — dragging a node *after* zooming out (to a
non-1 scale) produced a local delta matching `screenDelta / k` to within
floating-point precision, confirming d3-drag's own scale handling is
correct without this codebase doing any manual division at all. One
genuine test-authoring mistake surfaced along the way, not a product bug:
an early box-drag check computed its drag's end position without adding
back the handle's own center offset, driving the mouse in the opposite
direction from intended — caught by inspecting the raw `event.dx`/`event.dy`
values directly rather than trusting the higher-level assertion's verdict.

**Update — the drag handle moved from the circle to the label.** A sharp
follow-up: "那个圆圈有打开和关闭的那个作用在,对吧?但是字呢...其实是不是允许文字
本身可以被拖拽...你圆圈你挪上去了以后,你的这个光标自然是那个,那只手...但是其实
你也需要告诉用户这个是可以点击的...现在这个光标的这个操作还是让人非常的迷糊"
(the circle already has the open/close job, right? What about letting the
text itself be draggable — once the cursor over the circle becomes a grab
hand, it no longer tells the user it's also clickable to open the next
level; the cursor is genuinely confusing right now). Correct diagnosis:
the circle has a strong, frequent, pre-existing job — the classic tidy-
tree filled/hollow click-to-expand convention this project has used since
v0.1 — and layering a `grab` cursor on top of that for the newer drag
feature muddied its one clear signal. The label, by contrast, has never
had a competing job (it has only ever selected, never expanded/collapsed),
so giving it the drag behavior instead doesn't create the same conflict,
and it's already a comfortably large target on its own.

**Fix**: moved the `d3.drag()` binding (and `data-block-pan`) from the
circle's hit-target to the label `<text>` element; the circle goes back to
being purely click-to-select/expand, with a plain `pointer` cursor instead
of `grab`. The label keeps its existing `onClick` (select only, same as
before — expand/collapse still lives exclusively on the circle) and gains
a `grab` cursor. Verified directly: hovering the circle now computes to
`cursor: pointer` and the label to `cursor: grab`; dragging from the label
moves the node and its whole subtree by the exact dragged delta (same
subtree-together behavior as before, just relocated to a different hit
target); clicking the circle still both selects and expands (18 real
child nodes appeared after one click on a Catalog) while never recording
a drag (checked via the "Reset layout" button's presence, which only ever
appears once something has actually been dragged — it stayed absent
before and after the click).

## 33. A real, visible "API" tag — static vs. live-queried was never actually legible

Direct feedback: "打开的这个collection里面的数据是静态的,已经确定数量的数据,还是
这个动态API加载这个事情也是必须要搞得很明确才行...它得有一个标签也好,highlight
也好什么东西,因为你看这个Stack Browser里面,它就是有一个tag在" (whether an
opened Collection's data is static/fixed-count or dynamically API-loaded
has to be made unambiguous — it needs a tag or highlight, the way STAC
Browser has a tag for this). The information already existed (`itemBadgeText`
in the tree, `isApiSearched` gating the query section in Item Set, the
`node.items.kind === 'cursor'` text in Detail Panel — §22's `sourceKind`
detection was real, just never surfaced as anything more than small gray
subtext easy to skim past, not a genuine visual signal.

**Implemented**: a real, colored pill — a small blue "API" badge, not
plain text — shown consistently in all three places this matters:
Structure Lens's own tree (replacing the old "items via API search" gray
text on that node's badge line), the top of the Item Set panel once
opened, and Detail Panel's "Items in this collection" field label. New
`--color-badge-api-bg`/`--color-badge-api-text` tokens, deliberately
*aliased* to the existing `--color-selection`/`--color-selection-bg`
rather than a new hue — that blue already means "live API interaction"
everywhere else in the app (the Draw area/Select range/Search buttons,
§29), so the tag reads as the same established language, not a one-off
color choice.

Deliberately asymmetric, matching the STAC Browser convention that was
explicitly pointed to: only the *special* case (API-searched, count
unknown until queried) gets a tag. The default/static case — the vast
majority of nodes in most catalogs — keeps its plain "N items" text
unchanged; tagging the exception is what makes the signal meaningful, an
"everything has a badge" treatment would just be more chrome to skim past.

Verified precisely, not just eyeballed: an initial cropped screenshot
looked ambiguous — an "API" tag appeared to sit directly under a
*selected* node whose Item Set box was open, seemingly contradicting the
`!showItemSetBox` suppression the badge line is gated on (the tag should
disappear for whichever node's box is currently showing, same as the old
plain-text badge did). Resolved by querying the DOM directly rather than
trusting the screenshot: the selected node's own `<g>` genuinely has no
"API" tag child, while an adjacent sibling's does — the screenshot crop
had simply made a *different*, tightly-spaced row's own tag look like it
belonged to the row above it. Also confirmed directly against a fully
static catalog (Capella): zero "API" tags anywhere in the tree or Detail
Panel, as expected.

**Update — the crowded screenshot was a real, pre-existing bug, not a
misreading.** Direct follow-up, sharper this time: "我们现在的这个每个节点和
节点上下高度之间又隔得太近了,所以导致这个标签又彼此间压得有点厉害...如果你有什么
办法,这个把我们的UI提升提升" (the vertical spacing between nodes is too
tight, so the tags are visibly crowding into each other — is there any way
to raise the quality of our UI). Measured directly rather than eyeballing
it this time (the exact habit that resolved the false alarm above, applied
proactively instead of reactively): a node's label + its own badge/tag
line span ~31px top-to-bottom in real rendered pixels, but `ROW_HEIGHT`
(the sibling-to-sibling spacing `tree()` lays out at) was only 26 — every
adjacent pair of tagged nodes on Earth Search's own root (10 real
collections) measured exactly **-5px**, a genuine, consistent overlap, not
an artifact of any particular screenshot crop. This predates the tag
itself — 26px was already tight for label+text before, the plain gray
badge text just visually blended into the background enough not to read
as "crowded" the way a solid colored pill does. Fixed by raising
`ROW_HEIGHT` to 38 (31px of real content + ~7px of actual clearance, not
just the bare minimum to stop touching) — re-measured the identical Earth
Search scenario afterward and got a clean, consistent +7px gap between
every row, confirmed by both the raw numbers and a full, un-cropped
screenshot of the same dense view (not a calmer, cherry-picked one).

## 34. Inspector v2: a Human tab, standard-extension facts, and trustworthy asset links

Prompted by a genuine, direct question, not a feature request at first:
"这些信息...是你从这个stac json里面抽出来的吗?还是通过一个别的其他方法获得的信息
呢?" (this information — is it extracted from the STAC JSON, or obtained
some other way?). Answered by actually reading `DetailPanel.tsx` and every
file it depends on (`graph.ts`, `namespaces.ts`, `spatial.ts`, `temporal.ts`)
rather than from memory, field by field: everything is either a direct
source field (labeled "(source)"/"declared" in the UI) or an explicitly-
labeled derived one (Shape, the static/API distinction, "Property
namespaces observed") — nothing comes from anywhere outside the fetched
JSON itself. Confirmed correct by the user.

That opened into a real redesign ask: two tabs — "Human" (readable,
default) and "JSON" (untouched, always one click away — "很重要,因为整个
STAC都是base在这个逻辑里面的," important since the whole STAC spec's own
logic is based on it) — plus two concrete asks: render actual thumbnail
images for Items where a safe one exists, and make every asset link
trustworthy to copy-paste regardless of whether the source JSON wrote it as
a relative or absolute path. Explicit sequencing: standard/known extensions
get human-readable treatment in this pass; custom/unrecognized namespaces
stay exactly as they already were (a plain badge list), one at a time,
later.

**Researched before building** (not assumed): fetched the official STAC
extensions registry (stac-extensions.github.io, 93 extensions across four
maturity tiers) — our existing 13-prefix `KNOWN_EXTENSION_PREFIXES` list
already covers essentially all of the stable/candidate/pilot tier extensions
that actually show up in Item/Collection properties, a legitimate "standard
extensions, v1" scope (`datacube`/`version`/`timestamps`/`alternate-assets`/
`storage`/`label`/`render` are real but not yet covered). Also fetched the
Asset Object spec's own text and real assets from both Capella and Earth
Search: the `thumbnail` role is explicitly spec-defined as *"displayable in
a web browser without scripts or extensions"* — real data confirmed this is
the only reliably safe case (`role: thumbnail` + `image/png`/`image/jpeg`);
`overview`/`visual` assets look preview-like by name but are routinely COG
(`image/tiff; profile=cloud-optimized`), which no browser decodes natively.
Both fixtures' asset buckets serve `Access-Control-Allow-Origin: *`, so no
CORS blocker for an `<img>` tag against either.

**Href resolution — the user's own catch, not something already handled**:
"很多asset,它的路径是,有的是给完整路径,有的是给相对路径...这东西其实我们都要判别
一下,才能够保证用户粘贴的那个是可以直接使用的那个才行" (a lot of assets give a
relative path, not a full one — we have to account for that so whatever the
user pastes actually works). The Asset Object spec permits either form,
same as any `links` entry — but nothing in the codebase had ever resolved
an asset's `href` before, since nothing rendered them until now. Fixed at
the data layer, not the UI: `StacNode` gained a normalized `assets:
ResolvedAsset[]` field (`stac/types.ts`), built by `graph.ts`'s new
`buildAssets()` using the exact same `resolveHref(base, href)` already used
for every other link on a node — the UI only ever sees the already-
resolved absolute URL, never `raw.assets[key].href` directly.

**Implemented**:
- `stac/assets.ts` — `isInlinePreviewAsset()` (the spec-grounded rule above)
  and `describeAssetType()` (a short label: COG, GeoTIFF, JSON, Parquet,
  or the media type's own subtype).
- `stac/extensionFacts.ts` — one small interpreter per standard extension
  (`eo`, `view`, `proj`, `sat`, `sar`, `sci`, `processing` in this first
  pass), each reading directly from an Item's `properties` and returning
  only the facts it actually finds — a fixture with no `sar:*` fields shows
  no SAR section at all, not an empty one.
- `DetailPanel.tsx` rewritten with a Human/JSON tab switcher (Human
  default). Human tab: an inline thumbnail preview when a real one exists,
  the existing Temporal/Spatial/Containment/etc. fields, a new per-extension
  facts section, and a new compact Assets list — each row a title, a short
  type badge, a "Copy link" button (copies the resolved absolute URL,
  confirmed via `navigator.clipboard`), and an "Open" link. JSON tab: the
  exact same raw dump as before, just under its own tab now.

Verified against real data, not synthetic fixtures: selected a real
Sentinel-2 Item from Earth Search after a live API search — the thumbnail
rendered as a genuine loaded image (343×343, confirmed via `naturalWidth`/
`naturalHeight`, not a broken-image icon); extension facts showed real,
correct values (cloud cover 85.07%, sun elevation/azimuth, incidence angle,
`EPSG:32656`, processing software) with SAR/satellite sections correctly
absent (this is an optical Sentinel-2 Item, as expected); all 38 real
assets listed with correct COG/JP2/XML/JSON type labels; clicking "Copy
link" and reading the clipboard back confirmed a genuine absolute URL
(`https://sentinel-cogs.s3.us-west-2.amazonaws.com/.../AOT.tif`), not a
raw relative path; switching to the JSON tab showed the real source
unchanged. Also confirmed a static Catalog with no assets at all correctly
shows no "Assets" field rather than an empty one, and its unrecognized
`earthsearch` property-namespace prefix still surfaces in "Property
namespaces observed" exactly as before — the custom/unrecognized path is
untouched, exactly as scoped.

**Update — "Copy link" silently did nothing.** Reported directly: "点了
Copy link按钮好像也没反应,也不知道有没有复制成功,粘贴之后发现好像没有复制"
(clicking Copy link seemed to do nothing, no idea whether it actually
copied — pasting afterward showed nothing was copied). Root cause: the
original handler wrapped `navigator.clipboard.writeText()` in a `try {}
catch {}` with an *empty* catch — real STAC Lens usage includes testing
over this project's own LAN URL (`http://192.168.x.x:5173`, set up earlier
this session for exactly that), a plain-HTTP, non-`localhost` origin the
browser treats as an insecure context, where `navigator.clipboard` is
often `undefined` entirely — `navigator.clipboard.writeText` then throws
immediately on property access, silently swallowed, with the button never
changing state either way. Confirmed directly: `window.isSecureContext` is
`false` and `navigator.clipboard` doesn't exist at all when loaded via the
LAN URL, versus `true`/present on `localhost`.

Fixed with a real fallback chain (`copyToClipboard()`), not just better
error messages: try the modern Clipboard API first (works on `localhost`/
`https://`), then fall back to the legacy `document.execCommand('copy')`
technique (a temporary off-screen textarea, select, execute) — confirmed
directly that this fallback genuinely succeeds even over the insecure LAN
origin where the modern API is entirely absent. The button's own text now
reflects the *real* outcome ("Copied" / "Copy failed — select below"), and
on the rare case both methods fail, a real, focused, pre-selected
read-only input with the exact href appears so the user has a guaranteed
manual `Ctrl/Cmd+C` path — not a promise a button "did something."

Verified precisely, including a testing pitfall of its own: an initial
Playwright check re-queried a locator by button text ("Copy link") *after*
clicking it — once that specific button correctly updated to "Copied," the
live text-based query silently matched a *different*, still-unclicked
button instead, making it look like nothing had changed. Re-verified by
holding a stable element handle to the exact clicked button and reading
its own `textContent` afterward: confirmed it genuinely changed to
"Copied," on the LAN origin specifically, via the `execCommand` fallback
path — the same class of stale-reference testing mistake this project has
hit before, caught the same way: by re-checking with a more precise,
non-reactive reference rather than trusting the first read.

**Update — two more standard extensions, and per-asset facts.** Continuing
§34's deferred extension-coverage list, grounded in a real Earth Search
Sentinel-2 Item fetched directly (not assumed field names): `grid` (already
in `KNOWN_EXTENSION_PREFIXES`) reads `grid:code` — a single, complete tile
designator (e.g. `MGRS-13XDJ`) — deliberately *not* also decomposing the
separate `mgrs:utm_zone`/`mgrs:latitude_band`/`mgrs:grid_square` fields
into their own group, since real data confirmed they encode the exact same
tile a second time; showing both would repeat one fact twice, not add a
new one. `s2` (community extension) gets a curated subset of its ~20 real
fields — product type, processing baseline, and four scene-composition
percentages (vegetation/water/snow-ice/cloud-shadow) — skipping the rest
(datastrip/datatake IDs, generation timestamps, a bare sequence number) as
pipeline bookkeeping, not something worth surfacing to a person glancing
at this panel.

Also extended past Item-level `properties` for the first time: `gsd` and
`raster:bands[0].data_type` are *per-asset* fields (a real, confirmed case
— the same Sentinel-2 Item's own Blue band is 10m/uint16 while its SWIR
bands are 20m/uint16 and its Aerosol/Coastal bands are 60m/uint16),
captured on `ResolvedAsset` itself (`graph.ts`'s `buildAssets()`) and shown
as a compact "10m · uint16" badge next to each asset's existing type badge
— not a full band table, which would be far too much detail repeated
across a 38-asset list. Verified directly against the real Item: every
band's badge showed its own real, correct, *varying* resolution and dtype,
not a single value copy-pasted across all of them.

## 35. Item Set as a genuinely selectable object, not just a code-level one

A direct, pointed critique, worth quoting in full because it's the actual
design principle at stake: "用户选择什么,他应该看到什么。我选择了collection这个
节点,他就不应该看到collection下面所有的item...既然我们有一个items的一个list,
一个panel...就相当于是选中的,就是有一些全选状态的一个,给一个全选状态的一个。那么
点那个,那就可以...作为一个,这就是我提出这个item set那个概念...我觉得那个单独是
要,就是它得单独做一个对象可以去选它,为了UI。你懂我的意思吗?就是我之前我们聊过
这个事情,但是你并没有这么做。你在代码层面实现了单独的一个对象,但是在用户体验
层面其实并没有" (whatever the user selects, that's what they should see —
selecting the Collection node shouldn't show every Item under it. Since we
have an Item list/panel, give it a "select all" state — click it, and only
then does the aggregate show. That's the Item Set concept I proposed: it
needs to be its own separate, *selectable* object, for the UI's sake. We
talked about this before, but you didn't do it — you built it as a
separate object at the code level, but not at the user-experience level).

Verified against the actual code before responding, not from memory:
`store/itemSet.ts` genuinely was already a separate zustand store from
`store/selection.ts` — but `ItemSetBrowser`'s own effect published
`visibleHrefs` to it the instant its first page loaded, with zero action
of the user's own in between. Merely opening/browsing a Collection was
functionally indistinguishable, from the user's side, from "selecting its
Item Set" — the separate object existed in code but was never actually
something you *selected*.

**Fix**: `useItemSetStore` gained `aggregateSelected: boolean` (default
`false`) and `setAggregateSelected()`. `useSelectedItems` now gates the
aggregate Item list behind it — selecting/browsing a Collection alone
shows only its own stated temporal/spatial extent, same as before this
whole feature existed; `ItemSetBrowser` gained an explicit checkbox
("Show all N in Time/Space Lens") that's the actual, deliberate selection
gesture. A specific Item selected directly (from the list, the map, or the
timeline) still shows in isolation regardless of this toggle — that part
of "selecting an object stays scoped to that object" was already correct
and untouched.

A real second bug surfaced while making the toggle reset correctly when
switching Collections: resetting it inside `setVisible` (keyed on whether
`forHref` changed) missed the case where the *intermediate* Collection you
browse through has no direct items of its own — `ItemSetBrowser` never
mounts for it at all, `setVisible` never fires, and the store's `forHref`
never actually changes, so a stale `aggregateSelected: true` survived a
full round trip back to the same Item Set. Confirmed directly via
Playwright before fixing: browse a leaf-items Collection → check the box →
browse a different, items-less Collection → return to the first one → the
checkbox was still checked. Fixed by moving the reset to `ItemSetBrowser`'s
own mount effect instead (keyed on `node.href`) — this component fully
unmounts and remounts every time `browsingHref` changes to a different
target, regardless of whether anything in between had items, which is the
actual moment "you're looking at a different Item Set now" happens.

Verified end-to-end via Playwright against a real Collection (Capella's
"IEEE Data Contest 2026," 40 real items): selecting it alone produced zero
item marks in Time Lens; checking the box brought all 40; unchecking
dropped back to zero; selecting one specific Item while the box stayed
checked showed exactly one mark, not forty; switching to a different,
items-less Collection and back reset the checkbox to unchecked (the exact
scenario the second bug was found in) — re-run after the fix and confirmed
correct.

**Update — the checkbox changed Time/Space Lens, but Inspector gave zero
feedback that anything had changed.** Sharp follow-up, pushing the same
principle one level deeper: "你有一个Checkbox,然后Checked了以后,右侧的
Inspector仿佛还是在inspect一个Collection...用户操作跟它的反馈非常地不直观,不
了解,就是不吻合" (you have a checkbox, and once checked, Inspector on the
right still looks like it's inspecting a Collection — the action and its
feedback don't line up). Also raised, and rejected on its own terms: should
checking the box make Inspector show a literal per-field *intersection*
across every selected Item, the way a file manager's multi-select property
panel does? Discussed directly and agreed this doesn't transfer to STAC's
own field types as-is — a strict intersection of timestamps or bboxes
across a real Item Set is almost always empty (no real Items share an
identical instant or an identical footprint) and isn't the useful fact
anyway; what's actually wanted is *range* for temporal ("what span does
this whole set cover") and *union* for spatial ("what area does it cover
in total"). Intersection stays the right operation only for categorical
fields — declared extensions, observed namespaces — where "what do all of
them share" is a real, meaningful question.

**Implemented**: `stac/itemSetSummary.ts`'s `summarizeItemSet()` computes
count, temporal range (min start → max end across whatever bounds are
defined, flagging if any member is open-ended), spatial union bbox, and
true set-intersections of declared extensions and observed namespaces.
`DetailPanel.tsx` switches to a distinct `ItemSetSummaryView` whenever the
Item Set's "Show all N in Time/Space Lens" checkbox is checked *and* the
Collection itself (not a drilled-down Item within it) is what's currently
selected — selecting one specific Item still shows that Item's own facts
regardless of the checkbox, exactly like Time/Space Lens's own guard.
This view has no JSON tab at all: there is no single source document for a
computed aggregate across many Items, unlike everything else this panel
ever inspects, so keeping that tab would itself misrepresent what the view
is.

Verified against a real Collection (Capella's "IEEE Data Contest 2026," 40
real Items): unchecked, Inspector showed the Collection's own facts as
before; checked, it switched to "Item Set — 40 items" with a real computed
temporal range (`2025-10-27 → 2025-11-12`) and a real union bbox spanning
Hawaii to the western US mainland (not a copy-pasted placeholder — the
actual footprint bounds of 40 real Items); selecting one specific Item
while the box stayed checked correctly switched back to that Item's own
single-object view; unchecking and reselecting the Collection went back to
its own facts. The action (checking the box) and Inspector's own visible
state now agree at every step.

## 36. Retiring "Item Set" as a selectable object — three type-specific Inspectors instead

§35 made Item Set a genuinely selectable object specifically so that
selecting it (via a checkbox) would give Inspector something concrete to
reflect. Pushed one level deeper, that framing itself came apart: "我恰恰
关于这个选择checkbox这个问题,就是我再回到UI里面去讨论,我们为什么要有checkbox
呢?...这一套语言是整体性的...所以在这套完整的语言里面,那个checkbox...并没有
能够选择到这个Item Set的本身这个对象上去" (going back to the UI itself — why
have a checkbox at all? The whole selection language across this app is
unified [click a tree node → it highlights; click an Item row → it
highlights], and inside that language a checkbox doesn't actually select
the Item Set object itself). Before implementing a fix, a real technical
risk was surfaced and discussed rather than silently worked around: making
Item Set selectable via the existing `selectedHref` mechanism would need a
synthetic value (e.g. `href + '#itemset'`), which would embed a literal
`#` inside `useShareableUrl.ts`'s own hash-encoded URL — an ambiguous
nested fragment — and would key the loader's cache for one real resource
under two different string identities.

Rather than resolve that specific risk, the question was reopened at a
higher level and answered with a simplifying pivot: "既然整个STAC的技术架构
里面...就三个东西,一个是Item,一个是Catalog,一个是Collection...我们就应该为
这三个对象设计这个对象所专有的Inspector。我不再需要有通用的部分...那么这个
Collection的Inspector,如果它这个Collection下面有非常多的Item,那我们就可以
把这个Item的预览呀什么东西就放在Collection这一级的Inspector的UI里面去完成...
在这个程度上,其实我们又似乎都不需要这个Item Set这个概念了。但是需要做的是要
把这个UI做得非常清楚,哪个部分是Collection自既有的,哪个部分是通过...我们这个
系统所提供的...功能,就要做非常完整的区分" (STAC's own architecture really
only has three objects — Item, Catalog, Collection — so each should get its
own dedicated Inspector, no generic middle ground; a Collection's Inspector
can fold its own item-browsing right into its UI. At that point "Item Set"
doesn't need to be its own concept at all — what matters is making very
clear which part of that UI is the Collection's own and which part is a
capability this app provides). Confirmed directly: "我觉得理解是对的."

**Implemented:**

- `store/itemSet.ts`'s `aggregateSelected`/`setAggregateSelected` were
  renamed to `showOnLenses`/`setShowOnLenses` — same boolean, same reset-
  on-remount behavior from §35's second bug fix, but reframed in its own
  docstring as a plain feature toggle rather than a step toward "selecting"
  Item Set as an object. `ItemSetBrowser.tsx`'s checkbox became a
  `ToolButton` (the same control already used for "Draw area"/"Select
  range" in the same panel) — one consistent visual language for "arm a
  feature," not a selection.
- `DetailPanel.tsx` no longer has an `ItemSetSummaryView` full-panel
  replacement gated on that toggle. Instead every Inspector now carries a
  colored left border plus a colored, bold type label (`Catalog`/
  `Collection`/`Item`) reusing Structure Lens's own existing tree-node
  color tokens (`--color-node-catalog`/`-collection`/`-item`) — so the
  three object kinds are visually distinguishable at a glance, confirmed
  via computed style against a real page (Catalog `rgb(85,82,74)`,
  Collection `rgb(15,118,110)`, Item `rgb(180,83,9)`).
- A Collection's own Inspector always shows a "Browse this Collection's
  items" field once it has any — not gated by any selection or toggle —
  followed, once items are actually loaded/searched, by an inline derived
  summary (the same `summarizeItemSet()` range/union/intersection logic
  §35 built, unchanged) reusing `visibleHrefs` from `useItemSetStore`
  directly rather than requiring `showOnLenses` to be on. Both sit under
  one `SectionDivider` labeled "Provided by this app," visually separating
  them from the fields above (`Temporal (source)`, `Spatial (source)`,
  declared extensions, etc.) that come straight from the Collection's own
  JSON — the "哪个部分是Collection自既有的,哪个部分是...我们这个系统所提供的"
  distinction made structural, not just verbal. `showOnLenses` now controls
  only one separate, narrower question: whether that same browsed/filtered
  set is *also* pushed onto Time/Space Lens.
- Selecting one specific Item still shows that Item's own dedicated,
  amber-bordered Inspector with none of the above — the same "selecting an
  object shows exactly that object" scoping this whole redesign is built
  around, unchanged from §35's own guard.

Verified directly against real Earth Search data (Sentinel-2 L2A, a live
STAC API, not a static fixture): opening the Collection showed its own
stated temporal/spatial extent with an empty (0-loaded) browse section;
drawing a bbox and searching loaded 500 real items and the inline summary
correctly showed a real combined temporal range, a real union bbox, and
real common declared-extensions/namespaces across them — all while
Time/Space Lens still showed "0 items" (the separate toggle still off);
clicking "Show all 500 on Time/Space Lens" then showed "showing 500 items"
there, confirmed as a distinct action from browsing; drilling into one
specific Item switched Inspector to that Item's own single-object facts
(different border color, no browse/summary section) with Time/Space Lens
correctly scoped to just that one Item too.

**Update — the toggle button itself moved out of the tree-embedded panel
entirely.** Even after the button above was restyled to match Draw
area/Select range, it still physically lived in `ItemSetBrowser.tsx` — the
box embedded in Structure Lens's tree — rather than in the Collection
Inspector it now sits directly below — pointed out directly: "我这个时候
反而觉得按钮不应该
配置在tree view的panel上了。应该直接放置在collection的inspector那边的下边之类
的。没有按下的时候都是空的" (I now think the button shouldn't be on the tree
view's panel — it should sit directly below the Collection's own
Inspector; when not pressed, [Time/Space Lens] stays empty). `ToolButton`
was exported from `ItemSetBrowser.tsx` and the button itself now renders in
`DetailPanel.tsx`, directly under `ItemSetSummaryFields`, reading
`browsedItems.length` (already computed there) rather than the browsing
component's own local `filtered`/`query` state — `ItemSetBrowser.tsx` keeps
only `setShowOnLenses`'s reset-on-remount effect, since that's tied to its
own mount lifecycle, not Inspector's. Verified: the button is entirely
absent from the tree-embedded panel and appears exactly once, inside the
Inspector column (confirmed at its DOM x-position), still empty (0 items)
on both Lenses until pressed and still correctly flips to "showing 500
items" once it is.

## 37. Inspector field-completeness audit — license, providers, description, and a real namespace-scan gap

A different kind of critique than the previous two sections' UI-language
questions: whether the Human tab is actually *complete*, not just well
organized. Raised with a concrete, real example rather than a general
complaint: "比如说，我在看非洲的这份数据，我选择了一个collection...这个
collection明显在JSON里面有很多其他的数据，除了我们现在展示的，还有什么license
啊这些数据。为什么现在我在inspector里面我也看不到它呢" (looking at the Africa
data, I selected a Collection — its JSON clearly has plenty of other fields
besides what we currently show, like `license` — why can't I see that in
Inspector either). Framed as the actual precondition for everything else:
"我首先还是应该把...我们先把整个这个每一个节点的它的inspector先做充分吧。我觉得
我不做充分，我很难往下走，而且我也不知道你到底哪个做了哪个没做...这个东西还是
核心" (we should first make every node type's Inspector genuinely thorough
— without that I can't move forward, and I don't even know what's done and
what isn't; this is still the core thing). A related, explicitly *not yet
decided* idea was raised in the same message — embedding Time/Space Lens's
own map/timeline UI directly inside Inspector's Human tab as "a way of
reading the data," rather than as separate top-level views, possibly
hiding the standalone Lenses to try it — but immediately followed by "关于
time和space的lens那个东西，我得再想一下，应该放在哪里" (I need to think more
about where that should go) — parked, not implemented.

**Audit, grounded in real fetched JSON, not assumption:** a live Adaptation
Atlas Collection (`hazard_timeseries_annual/collection.json`) and a live
Earth Search Collection/Item were fetched directly via `curl` and diffed
field-by-field against what `DetailPanel.tsx` actually rendered. Confirmed
missing entirely: `description` (shown nowhere — not even for a Catalog,
where it's the only required prose field), `license`/`providers`/
`keywords` (Collection spec fields), `created`/`updated` (Common Metadata),
and Item-level `platform`/`instruments`/`constellation`/`mission`/`gsd`
(Common Metadata fields, unprefixed so they don't fit the per-namespace
`INTERPRETERS` table §34 built). A second, structural bug was found in the
same pass, not just a missing-Field oversight: `graph.ts`'s namespace scan
(`propertyNamespaces`, feeding "Property namespaces observed") only ever
scanned `properties`/each asset/`summaries` — never a Catalog/Collection's
own top-level keys. Real data showed exactly why that's wrong: Adaptation
Atlas's `contact:*`/`atlas:*` fields sit directly on the Collection object
itself (confirmed via `curl` — no `properties`, `summaries`, or `assets` on
that Collection at all), so they were completely invisible to Inspector,
not merely miscategorized.

**Implemented:**

- `StacNode` (types.ts) gained `description`, `license`, `providers`
  (`StacProvider[]`), `keywords`, `created`, `updated` — populated in
  `graph.ts`'s `buildNode()` per-type: `description`/`created`/`updated`
  read from the raw object's top level for Catalog/Collection but from
  `properties` for Item (Common Metadata puts them there instead — verified
  against a real Earth Search Item: absent at Feature top level, present
  under `properties`); `license`/`providers`/`keywords` are Collection-only
  per the spec.
- `graph.ts`'s `namespaceScans` now also scans the raw object's own top
  level (`scanNamespaces(raw as Record<string, unknown>)`), not just
  `properties`/assets/summaries — safe to do unconditionally since no real
  STAC core field name contains a colon, so this only ever picks up
  genuine custom namespaces like `atlas:*`/`contact:*` sitting directly on
  a Catalog/Collection.
- `extensionFacts.ts` gained `interpretCommonMetadataFacts()`, a sibling to
  the per-namespace `INTERPRETERS` table for the *unprefixed* Common
  Metadata fields (`platform`/`instruments`/`constellation`/`mission`/
  `gsd`), rendered under its own "Common metadata" Field group.
- `DetailPanel.tsx` renders all of the above as new source-tier Fields
  ("Description," "License," "Keywords," "Providers" with clickable
  provider URLs, "Created / updated," "Common metadata") — placed among
  the existing Temporal/Spatial source fields, at the same tier, not
  buried after the app-provided browse/summary section.

Verified directly against the real Adaptation Atlas Collection that
prompted this: Inspector now shows `Description: "Annual hazard
timeseries"`, `License: proprietary`, three real `Providers` (The Alliance
of Bioversity and CIAT — processor, Pete Steward — processor, AWS — host,
the first as a real clickable link), real `created`/`updated` timestamps,
and — confirming the namespace-scan fix — "Property namespaces observed"
now correctly lists `contact` and `atlas` where it previously showed
`none`. A live Earth Search Item was checked too: `Common metadata` showed
real `Platform: sentinel-2b`, `Instruments: msi`, `Constellation:
sentinel-2` (no placeholder for the genuinely-absent `mission`/`gsd`,
matching the existing "never show a placeholder for a missing field"
convention every other fact group already follows).

## 38. Folding Time/Space Lens into Inspector as tabs, and a real Leaflet crash it surfaced

Picking back up the idea floated alongside §37 but explicitly left
undecided at the time — a concrete decision to actually build it, not just
keep discussing it: "Time/Space Lens 折进Inspector当'阅读方式'这件事虽然我还
没有决定,但是我现在就想先把现有Time/Space Lens隐藏,然后在inspector先做出来支持
他的Time view和Space view" (I still haven't decided on folding Time/Space
Lens into Inspector as a "way of reading" the data, but I want to go ahead
now and hide the existing Time/Space Lens, then build Time view/Space view
support directly inside Inspector).

**Implemented:** `DetailPanel.tsx`'s tab bar grew from two tabs (Human/
JSON) to four (Human/JSON/Time/Space). `TimeLens`/`SpaceLens` needed *zero*
changes to work as tab content — both were already fully self-contained,
reading everything from `useSelectedItems()`/global stores rather than
props, so mounting them one level deeper renders identically. `App.tsx`
dropped `showTime`/`showSpace` state, the two separate header toggle
buttons, and the `drawRequest`-driven "bring a hidden panel back into view
and scroll to it" choreography entirely — arming the draw-bbox/select-range
tool from Item Set's own query section now just switches which of
Inspector's own tabs is active (`DetailPanel`'s own new effect watching
`useQueryStore`'s `drawRequest`), which needs no scrolling since it's the
same panel, not a separate one further down the column. The single
remaining header toggle was renamed `Detail` → `Inspector` to match, since
it now gates one thing (the whole Inspector column) rather than being one
of three.

**A real, reproducible crash this surfaced, not a hypothetical:** clicking
Item Set's "Draw area" now switches straight into a *freshly mounting*
Space tab with the draw tool already armed — impossible before, when Space
Lens was always mounted well before anyone could reach for that button.
The very first real drag after that crashed inside Leaflet's own internals
(`getSizedParentNode`, called from `Draggable._onDown`, reading
`.offsetWidth` off `null`) — confirmed via a real stack trace, then traced
to its actual mechanism by instrumenting both of `SpaceLens`'s effects
directly (not guessed): React StrictMode's dev-only mount→cleanup→remount
replay of the initial commit runs the map-creation effect's cleanup
(`map.remove()`) *before* the draw-tool effect's own cleanup in this case,
so that cleanup's `activeMap.dragging.enable()` was running against a map
that had *already been removed* — reviving Leaflet's own internal pan
handler on the shared, React-persistent container div, bound to an inner
pane element (`_mapPane`) that `.remove()` had already detached from the
DOM. That orphaned, re-armed listener stayed live, and the next real drag
hit it, walking a detached element's now-null ancestor chain. Fixed by
checking that `mapRef.current` is still the exact map instance this
cleanup belongs to before touching it — a no-op once that map is already
gone, confirmed directly by disabling StrictMode as a diagnostic (crash
disappeared, confirming the mechanism) and re-enabling it afterward (fix
holds with StrictMode back on, which is the correct end state, not the
diagnostic one).

Verified end to end against real Earth Search data: drawing a bbox
immediately after switching into a freshly-mounted Space tab, searching
(500 real items loaded), cycling rapidly through all four tabs several
times, and drawing again on a specific Item's own single-object Space
view — zero page errors across all of it, where the crash above had been
reliably reproducible before the fix.

## 39. Past tabs entirely — Time/Space inline in Human's own field flow, and the query tool dropped

§38's Time/Space tabs lasted about as long as it took to look at them.
Pushed one more level, rejecting the tab model itself, not just where its
content lived: "为什么我们不能把这个,比如说面向用户human readable的那一个页面
做成一个很长的东西,然后不同的属性进来呢,我就可以用不同的viewer,或者是渲染器去把
那个数据给渲染出来。比如说Time,对吧,那它就是排在现在按你的方法,就是排在
Description下边的Temporal的下边,就做成一个Time的UI。然后Spatial就是一个静态的
Spatial的一个范围,当然用户可以去zoom in、zoom out...这样不会更好吗?那我就不需要
用Tag去切换Time和Space了。那么从结构和语义上面来说,那就是给人类读的。那另外一个
JSON是给数据,或者是数据给机器读也好" (why can't the human-readable page just be
one long scroll, where each property is rendered by whatever viewer suits
it — Time right where Temporal already sits, made into an actual Time UI;
Spatial as a static-but-zoomable area. Then I wouldn't need a tab to
switch between Time and Space at all — structurally, Human is for people,
JSON is for machines/data). Explicitly asked, and answered directly rather
than assumed: whether Leaflet itself could even work this way, embedded
inline in a long scrolling page rather than as its own dedicated panel —
yes, with no fundamental blocker; a map just needs a non-zero-size
container, which an inline field section provides same as a tab ever did.

In the same message, a second, separable decision: drop the interactive
bbox/datetime query tool (draw-on-map, drag-on-timeline, "Search"/"Clear")
entirely, not fold it in here either — confirmed explicitly when asked
directly whether this meant only removing the redundant *button* from
Inspector while keeping the underlying drag-to-query capability working
elsewhere, or dropping the whole interactive tool: "彻底去掉整个交互式查询
工具" (get rid of the whole interactive query tool). Filed alongside the
still-open, separately-sized "API sources may need an entirely different
UI/navigation paradigm" question (§37's deferred list) rather than kept
half-working.

**Implemented:**

- `DetailPanel.tsx` is back to two tabs (Human/JSON). Its "Temporal"/
  "Spatial" fields now render `<TimeLens/>`/`<SpaceLens/>` directly inline
  (capped/fixed heights, `INLINE_TIME_MAX_HEIGHT`/`INLINE_SPACE_HEIGHT`),
  in the exact position the old plain-text versions occupied — no separate
  tab, no `drawRequest`-driven tab-switching effect (deleted along with
  the tabs it drove).
- `TimeLens.tsx`/`SpaceLens.tsx` had their entire query-tool halves
  removed: `rangeMode`/`dragRange`/`svgX`/`handleRange*`/`queryRangePx`
  and the "Select range" button (Time); `drawMode`/the draw-a-bbox mouse
  handlers/`queryLayerRef`'s overlay effect and the "Draw area" button
  (Space). What's left is pure visualization — axis, grouped/lane-packed
  marks, tooltip, click-to-select for Time; tiles, item-footprint layer,
  fit-bounds, fly-to-selected for Space — both still fully self-contained
  (`useSelectedItems()`/global selection store only, no props), which is
  exactly why embedding them inline needed zero changes to *that* part.
  §38's StrictMode/Leaflet crash fix (the `mapRef.current !== activeMap`
  guard) went with the draw-tool effect it protected — the effect that
  crashed no longer exists at all, not just relocated.
- `ItemSetBrowser.tsx` lost the whole "area/range drawn, Search, Clear"
  block; `useItemSet.ts` no longer reads a query draft or a search-trigger
  nonce from anywhere — every cursor-mode fetch is simply unfiltered now
  (the API's own default first page, paged via `rel:next` as before).
  `store/query.ts` was deleted outright once nothing referenced it
  anymore, not left as unreachable plumbing.

Verified against real Earth Search data end to end: the Collection
Inspector's Human tab now shows Description, then a live timeline right
under "Temporal" and a live, zoomable/pannable map right under "Spatial"
(confirmed interactive via a real scroll-to-zoom gesture), then License/
Keywords/Providers, all in one continuous scroll with zero tabs to
switch for any of it; drilling into one specific Item shows that Item's
own dedicated, correctly-scoped Time/Space widgets ("scoped to just this
Item, not its neighbors") alongside its Common Metadata/extension facts;
and a repo-wide check confirmed zero remaining occurrences of "Draw area,"
"Select range," or a "Search" button anywhere in the running app. Zero
page errors throughout.

## 40. A real Collection-level leak into a single Item's own inline Time/Space

Pointed at a specific, real deep link rather than a general complaint —
"http://192.168.0.53:5173/#https://digital-atlas.s3.amazonaws.com/stac/
public_stac/adaptive-capacity/women-and-gender/female-empowerment/
EmpowermentIndex_1995/EmpowermentIndex_1995.json 在item级别就真的不用再显示
collection级别的时间和范围了吧,因为item的metadata里面也没有这部分的数据呀" (at
the Item level we really shouldn't be showing the Collection-level time
and range anymore, since the Item's own metadata doesn't have that data).

Checked the real Item first, not assumed: `curl`'d it directly — it has a
perfectly good `properties.datetime` (`1995-01-01T00:00:00Z`) and its own
`geometry`/`bbox` (all of Africa). So the complaint wasn't "this Item has
no temporal/spatial of its own" — the Item's own facts were fine and
already rendering correctly. The actual bug: `useSelectedItems()` resolves
`node` to the *Collection* whenever the original selection is an Item (by
design — see its own docstring, §21), and `TimeLens`/`SpaceLens` both read
that `node`'s `temporal`/`spatial` to draw a "stated extent (source)"
dashed reference row/rectangle *alongside* the Item's own mark — genuinely
useful while browsing many Items ("does this one stray outside what the
Collection claims"), but a real Collection-level fact silently injected
into what's supposed to be one Item's own, fully-scoped Inspector widget.
Exactly the same "selection scoping" principle this whole session's
redesign has been built around, just found in one more place it hadn't
been checked yet.

**Implemented:** both `TimeLens.tsx` and `SpaceLens.tsx` now derive their
`statedBounds`/`statedBbox` as `undefined` whenever `highlightHref` is set
(true if and only if the original selection was an Item, per
`useSelectedItems`) — regardless of what the resolved Collection's own
`node.temporal`/`node.spatial` actually contain. This single change
correctly cascades through everything downstream that used to read those
values: the dashed reference row/rectangle itself, the domain calculation
feeding the timeline's axis, the reserved vertical space for that row, the
`fitBounds` boundsList on the map, and the "actual Item range extends
beyond the collection's stated extent" conflict warning — all silently
inert instead of needing separate suppression at each site.

Verified against the exact real Item URL given: Temporal now shows only
`EmpowermentIndex_1995`'s own single 1995 instant (no dashed collection
range beside it), Spatial shows only its own Africa-wide bbox rectangle (no
fainter collection-wide one around it) — a repo-wide check confirmed zero
occurrences of "stated extent" text anywhere on that Item's own page.
Reselecting the parent Collection itself was checked right after, to
confirm this didn't overcorrect: its own Inspector still correctly shows
"stated extent (source)" on its Temporal widget and the matching reference
rectangle on Spatial, exactly as before — the fix is scoped to "a specific
Item is selected," not "stated extent never renders again."

## 41. Retiring "Provided by this app" as its own section

Asked directly, as a question rather than a complaint, right after §40's
fix made the Temporal/Spatial widgets fully correct: "Provided by this
app 还需要么?" (do we still need "Provided by this app"?). Looked at what
was actually still under that divider and found a real redundancy, not
just a stylistic question: its own "Temporal (combined range across the N
browsed)"/"Spatial (union bbox across the browsed set)" text fields were
now saying the *exact same thing*, in plain text, that the Temporal/
Spatial widgets above (§39) already show visually the moment their own
"show on Time/Space Lens" toggle is on — the same class of duplication
§35 originally existed to fix, just reintroduced by the widgets moving
inline without anyone revisiting this section. Reflected this back with a
recommendation (drop the redundant text, fold the two fields that have no
visual equivalent — common declared extensions/namespaces across the
browsed set — into their existing sibling fields instead of a separate
divider) and asked which way to go; the user pushed further in the same
direction: "按钮和Browse this Collection's items其实也都可以不要了,我会放在
其他的部分" (the button and "Browse this Collection's items" can go too —
I'll put them somewhere else).

**Implemented:** the entire `SectionDivider label="Provided by this app"`
block — the "Browse this Collection's items" pointer field, the derived
Temporal/Spatial summary text, and the "Show these N on Time/Space Lens"
`ToolButton` — was removed from `DetailPanel.tsx` outright, along with the
now-dead `SectionDivider`/`ItemSetSummaryFields`/`ApiTag`/`formatDate`
helper functions and the `ToolButton`/`showOnLenses`/`setShowOnLenses`
imports that only served it. What's left of that block's *information*
(common declared extensions / common property namespaces across whatever
Item Set currently has loaded for this Collection) now renders as a small
annotation directly under the existing "Declared extensions"/"Property
namespaces observed" fields — "Common to the N currently browsed: ..." —
instead of a separately-labeled, separately-derived duplicate section.

The button and browse-pointer are a deliberate, acknowledged gap, not an
oversight: `useItemSetStore`'s `showOnLenses` flag and its gating inside
`useSelectedItems.ts` were left completely untouched (still defaulting to
`false`, so the inline Temporal/Spatial widgets show only each object's own
single stated extent until it's flipped on) — there is simply no UI left
anywhere that can flip it, until the user places one "elsewhere" per their
own stated intent above. Not this session's decision to make.

Verified against real Earth Search data: "Provided by this app," "Browse
this Collection's items," and any "on Time/Space Lens" button text are
all gone from the running app entirely (checked via direct text-search
across the rendered page, not just visual inspection); after Item Set
auto-loads its first unfiltered page, "Declared extensions"/"Property
namespaces observed" correctly grew a "Common to the 250 currently
browsed: ..." line each, with real, correct values.

## 42. A cleanup audit after §35–§41's rapid pivots

Asked directly after several fast pivots in a row (Item Set as selectable
→ three type-specific Inspectors → Time/Space as tabs → Time/Space inline
→ dropping the query tool → dropping "Provided by this app"): "我们哪里还
有代码等等逻辑没有清理干净么?" (help me check whether there's code or logic
anywhere that's not been cleaned up). Swept the whole `src` tree (every
exported symbol cross-referenced against its actual call sites, not just
`tsc`'s own unused-*local*-variable check, which doesn't catch an unused
*export*) plus every file this stretch had touched, read in full for stale
comments describing a since-superseded state.

**Found and fixed, real dead code (not just comments):**
- `ItemSetBrowser.tsx`'s `ToolButton` — exported, but its last real call
  site (DetailPanel's "show on Time/Space Lens" button) was removed in
  §41 without anyone deleting the function itself.
- `apiSearch.ts`'s `SearchQuery` interface and `fetchSearchPage`'s `query`
  option — nothing has populated `query` since §39 dropped the interactive
  bbox/datetime tool; the two conditional spreads building `bbox`/
  `datetime` params were permanently no-ops.
- `itemSetSummary.ts`'s `count`/`temporalRange`/`spatialUnionBbox` —
  computed on every call, read by nothing: `DetailPanel.tsx` only ever
  consumes `commonExtensions`/`commonNamespaces` from it (uses
  `browsedItems.length` directly instead of `.count`). Cut the interface
  and the computation down to just the two fields actually rendered.

**A false positive, caught before "fixing" it wrongly:** `temporal.ts`'s
`isOpenEnded` looked unused by the same `src`-only grep — removed, then
`tsc -b` (which also compiles `scripts/`) immediately caught
`scripts/verify-fixtures.ts` actually importing it. Restored. A reminder
that an export search needs to cover the whole project, not just the app
source tree, and that `tsc -b`'s own real compile is the actual check, not
a substitute for it.

**Stale comments fixed** (each still described an earlier, since-
superseded state as if current): `useSelectedItems.ts` and
`store/itemSet.ts` still said the "show on Time/Space Lens" toggle lived
in the Collection Inspector's own browse section (removed in §41);
`ItemSetBrowser.tsx` still described the toggle as having "moved into the
Collection's own Inspector" (same); `App.tsx` still described Time/Space
as Inspector tabs (superseded by §39's inline-in-Human-tab pivot);
`StructureTree.tsx` still cited "the API-search query section" and
"(query section, footer)" as reasons behind `ITEM_SET_BOX_HEIGHT`'s sizing
and its overflow safety net — that section no longer exists there at all.

**Not fixed, deliberately flagged instead of touched:** `README.md`. It
describes Time Lens and Space Lens as permanent, always-visible top-level
panels with independent header toggles, an entire "The real Space↔Time
query loop" section for the now-fully-removed interactive bbox/datetime
tool, a project-layout tree still listing `store/query.ts` (deleted), and
a "not yet built" list claiming the Human/JSON toggle and extension
interpreters don't exist yet (they've existed since §34). This is
substantial, user-facing rewrite work — several paragraphs plus the file
tree — not a small comment fix, so it's reported here rather than rewritten
without being asked to.

## 43. A real gap, previously researched but never closed: Collections-only API roots

Pointed at a specific real URL — a STAC Browser instance opened on
Microsoft Planetary Computer — and asked directly, with real frustration:
"这个数据,在stac browser就有,但是我们就没有,我们两次说至少要尽可能地支持之后,
还是没有,我就很困惑" (this data shows up in STAC Browser but not in ours,
even after we said twice we'd support this as much as possible — I'm just
confused). §22 had already researched and *documented* the actual
mechanism ("Planetary Computer's root has no `child`/`children` links at
all — API-only from the very top"), but the implication — that this
makes its Collections completely undiscoverable by a tree that only
understands `rel:child` — was never flagged as a follow-up or fixed. A
real, confirmed gap, not a mystery: re-fetched the actual root directly
(`curl`, not the STAC-Browser-wrapped URL the user linked, which is an
HTML page, not STAC JSON) — CORS wide open (`access-control-allow-origin:
*`), valid STAC JSON, `conformsTo` present, but genuinely zero `rel:child`
links; only a `rel:data` link to `/collections`. Loaded directly in this
app: the root appeared as a single leaf with no way to reach any of its
~136 real Collections (Sentinel-2, Landsat, NAIP, MODIS, Daymet, ...) —
confirmed via Playwright, not assumed from reading the code.

**What `/collections` actually is**, checked directly rather than
guessed: an OGC API - Features "Collections" listing endpoint. One
request returns every Collection already fully formed (not a bare href
needing its own fetch) — confirmed 136 real Collection objects in a
single response, `numberMatched: 137`/`numberReturned: 137` (a real,
harmless off-by-one in PC's own reporting), and a `?limit=` param that PC
silently ignores entirely (no `rel:next` link ever appeared, at any limit
tried) — unlike Item Search, which genuinely paginates.

**Implemented:** `StacNode` gained `collectionsEndpoint?: string`
(`graph.ts`'s `buildNode()`: a `rel:data` link, only consulted when
`childHrefs` is empty — a node with a real static child tree never needs
the fallback). `apiSearch.ts` gained `fetchCollectionsPage()`, a sibling
to `fetchSearchPage()` for this different response shape (`collections`
array instead of `features`, `rel:next` still checked and followed rather
than assumed absent, per the same "don't assume a uniform contract"
principle §22 already established for Item Search pagination).
`useStructureTree.ts`'s `expand()` now tries, in order: static
`childHrefs` (existing path) → `collectionsEndpoint` (new: fetches every
page up to a defensive `COLLECTIONS_SAFETY_CAP`, caching each Collection
via `cachePreFetched` the same way a search response's Items already do)
→ empty. `classifyNodeShape`'s `hasChildren` and `StructureTree.tsx`'s
`canExpand` both now check `collectionsEndpoint` alongside `childHrefs`,
so a Collections-only root renders as a normal expandable tree node, no
special-casing needed anywhere else — `buildDatum`'s existing "+N more"
logic already falls out correctly (`node.childHrefs.length` stays 0, so
`totalChildren > loadedChildren` never spuriously fires once everything's
been fetched in one `expand()` call).

Also added "Microsoft Planetary Computer" to the landing page's known-
catalog list (69th entry) — a live, working second example of a
pure-API-only root, parallel to Earth Search but with the opposite
discovery mechanism (Earth Search's root genuinely has real `rel:child`
links; Planetary Computer's has none at all).

Verified against the real Planetary Computer API, not the STAC-Browser
URL originally linked: opening the root shows all ~136 real Collections
as expandable tree nodes; drilling into "Sentinel-2 Level-2A" (a real
Collection reachable *only* through this new path) shows a fully correct
Inspector — description, license, keywords, providers, assets, declared
extensions — and a working Item Set that auto-loads 250 real Items with
correct common-extension/namespace annotations, identical in every way to
how Earth Search's own Collections already worked. Zero page errors
throughout.

## 44. Type icons for a general audience, and a draggable/collapsible Inspector

Two requests together, both aimed at making the app more approachable for
someone who isn't already fluent in STAC's own vocabulary — "因为我们这个是
偏一般用户的嘛,然后偏帮大家理解数据的嘛" (because this project skews toward
general users, toward helping people understand the data).

**Type icons.** "把这个三个层级,或者是四个层级吧,Collection,Catalog,Item,和
Asset,都用一些...简单的icon去代替...用一个icon去,非常明显地就告诉大家这也是一个
什么东西" (give Collection/Catalog/Item/Asset simple icons each, so an icon
alone makes obvious what kind of thing this is) — color alone (the
existing per-type border/label) only helps once someone has already
learned "teal means Collection"; a shape-based icon doesn't require that.
Implemented as `TypeIcon.tsx` — four small hand-drawn SVGs (this project
has no icon-library dependency, matching `tokens.css`'s own "not a
component library" framing), one deliberately distinct metaphor each: a
folder (Catalog), a stack of cards (Collection), a single photo frame
(Item), a file with a folded corner (Asset) — plus a fourth color token,
`--color-node-asset` (muted plum, kept out of the blue family already
claimed by `--color-selection`), since Assets never had a tree-node color
of their own before. Rendered at a prominent size next to Inspector's own
title (the type-color border/label already existed there — this adds the
shape signal on top, not a replacement), and at a small size on every row
of the Asset list.

**A draggable, collapsible Inspector, replacing the header toggle.**
"我们现在这个Inspector的开关在右上角,但是我觉得完全没有必要...我希望我能够用我的
鼠标去拖拽那个分界线...拖到边缘的地方,它就自己就吸附消失" (the Inspector
toggle is in the top-right corner, but I don't think we need it at all —
I want to drag the dividing line itself, and dragging it to the edge
should snap it away on its own) — matching the same "drag, not sliders or
buttons" language the tree's own pan/zoom already uses (docs/DESIGN.md,
early sections). `App.tsx`'s `showDetail` boolean became `inspectorWidth`,
a plain pixel number (`0` = fully collapsed): a thin draggable handle sits
between Structure Lens and Inspector, continuous mousedown/mousemove/
mouseup (not d3-drag — a single linear value on a plain HTML divider
doesn't need it) resizes it in real time, snapping to fully collapsed
below `MIN_INSPECTOR_WIDTH` and capped at 50% of the window's own width;
double-clicking the handle is a quick collapse/restore shortcut that
doesn't require dragging all the way. The header's old toggle button is
gone entirely — the handle is the only control now, doubling as the
"bring it back" affordance once collapsed (it's still there, at width 0,
to be dragged open again).

**A real bug this surfaced, in shared code, not new code:** the drag
silently refused to grow past its own starting width — every attempt
clamped straight back. Traced with real instrumentation (console logging
at each layer, not guessed) to `useElementSize.ts`'s `containerWidth`
staying `0` forever, which fed a `containerWidth > 0 ? ... : fallback`
cap check that fell back to a hardcoded value indistinguishable from "no
resize happened." Root cause: that hook's `ResizeObserver` was created
inside a `useEffect(() => {...}, [])` — empty deps, runs exactly once, on
the calling component's own first mount. `TimeLens.tsx` (the hook's other
caller) never hit this because its ref'd div exists unconditionally
whenever `TimeLens` renders at all; `App.tsx`'s new ref'd div does not — it
only exists once a catalog is open, well after `App`'s own first mount
(which happens while still showing `LandingPage`). That first-and-only
effect run found `ref.current` still `null`, never created a
`ResizeObserver` at all, and — because of the empty deps array — never got
a second chance to. Fixed properly, not patched around in `App.tsx`:
`useElementSize` now uses a callback ref instead of a plain object ref plus
a mount-only effect — React invokes a callback ref exactly when the node
attaches or detaches, correctly handling a ref target that starts absent
and appears later, which a `useEffect(..., [])` structurally cannot.

Verified against real interaction, not just the code reading right:
dragging the handle left by a measured 200px grew Inspector by exactly
200px (confirmed via `getBoundingClientRect`, both before and after this
fix — the fix is what took it from "clamped to no-op" to "exactly
correct"); dragging far past the low threshold snapped it to fully
collapsed; double-clicking restored the last open width; dragging far
past the *high* end clamped to exactly 50% of a 1400px viewport (700px),
not beyond; and `TimeLens`'s own unrelated use of the same now-rewritten
hook still measured and rendered its timeline correctly throughout.

## 45. The title is the back button, and Back finally does something useful

Two more small requests, both about accidental/redundant navigation
controls. "我觉得我们似乎不需要返回按钮,因为我觉得按下网站标题STAC Lens就可以
回到初始页" (I don't think we need a back button — clicking the "STAC
Lens" title itself should return to the initial page) — the separate "←
Catalogs" button is gone; the header's own title is now that control,
matching how countless real websites already treat their own logo/site
name (a link home), so there's one fewer redundant element rather than a
title *and* a button doing the same thing side by side.

The second was a real, specific complaint, not a feature request out of
nowhere: "浏览器的返回按钮按下之后就回到了浏览器的默认页...这个真的没有办法么?
因为这个太容易让人误操作了" (pressing the browser's own Back button goes
straight to the browser's default page — is there really no way around
this? It's far too easy to trigger by accident). Checked what was
actually happening rather than assuming: `useShareableUrlSync` (§18) uses
`history.replaceState`, deliberately, "on purpose" per its own original
comment — specifically to avoid turning every node selection into a
browser-history entry. That's still the right call for browsing *within*
one catalog (nobody wants to page back through fifty individual Item
clicks), but its side effect was that the entire app session — however
much exploring happened — collapsed to exactly one history entry, so
Back always meant "leave the app," never "go back one step within it."
Not a fundamental limitation of building this as an "application" rather
than a multi-page site (asked about directly, and the honest answer is
no) — real single-page apps get real Back/Forward behavior all the time,
via the standard `pushState`/`popstate` pair; this project's own original
scoping note simply said plainly "no back/forward support is being built
here, on purpose" (§18) and never revisited it once actual usage made the
tradeoff visible.

**Implemented**, without reopening the original "don't flood history"
concern: `useShareableUrlSync` now pushes a real history entry only at a
*logical page* boundary — landing page ↔ an open catalog, or one catalog
↔ a different one — and keeps using `replaceState` for everything within
the same catalog (selecting different nodes), tracked via a
`prevRootHrefRef` that distinguishes "never synced yet" (`undefined`,
so the very first sync after a fresh load or deep link never counts as
a push-worthy change) from "actually navigated to a different root."
`useDeepLinkBootstrap` (mount-once, unchanged) is now paired with a new
`usePopStateSync`, which listens for `popstate` for the app's entire
lifetime and re-resolves whatever hash the browser's own Back/Forward
just navigated to — the missing half of the mechanism: before this,
Back/Forward changed the address bar but the app itself never reacted to
it at all (§18's own "not yet built" note said exactly that). A hash that
can no longer resolve (a dead link, now that we've navigated back to it)
degrades to the landing page rather than a silent failure, the same safe
fallback an unresolvable hash already got on a fresh load.

Verified against real, sequential browser navigation, not just the code
reading right: opened Earth Search, selected a Collection then an Item
(hash updated each time, still one history entry — confirmed via
`page.url()` after each step); clicked the title — back to the landing
page instantly, in-app, no full reload; reopened the same catalog and
selected the Collection again (a genuinely new history entry this time);
one real browser Back landed exactly on the landing page (not outside the
app); a second Back landed on the *earlier* session's Item selection,
with Inspector correctly showing that Item's own Human tab again — not
just the right URL in the bar, the actual UI re-rendered to match.

## 46. Landing-page cards: a real raggedness bug, and an API badge to match STAC Browser

"我觉得我们似乎不需要...卡片里面的文字高高低低,一点都不整齐...我们是不是还能做
更好呢" (the text inside the cards is uneven, not aligned at all — can we
do better here too), plus a direct comparison to STAC Browser, which
shows whether an entry is a static catalog or a live API at a glance.

Checked what was actually rendering rather than assuming a text-align bug:
titles/descriptions were already left-aligned; the real issue was each
card's small `href` line sitting at a different height card-to-card in
the same row, purely because descriptions wrap to different numbers of
lines — a 1-line description leaves the URL sitting high, a 3-line one
leaves it much lower, so a row of cards reads as jagged/staggered even
though nothing was ever actually centered. Fixed by making each card an
internal flex column and pinning the `href` line to the bottom via
`marginTop: 'auto'` — every card in a row now ends on the same true
baseline regardless of its own description length. Also added explicit
`width: '100%'`/`boxSizing: 'border-box'` to each card `<button>` rather
than relying on CSS Grid's own default stretch behavior for a form
control, which some browsers don't apply the same way they would to a
plain `<div>` — a real, known cross-browser gotcha, not a hypothetical
one, worth closing defensively even though it wasn't reproducible in the
one engine tested here.

For the second half: `KNOWN_CATALOGS` entries gained an `isApi` flag (set
on Earth Search and Microsoft Planetary Computer, the only two actually
confirmed as live query endpoints — everything else was verified as a
static catalog per §19/§43's own methodology), rendered as the exact same
"API" pill already used everywhere else in the app (Structure Lens's
tree, Item Set) — only the special case gets a badge, matching both this
app's own established convention and STAC Browser's own, which it was
originally copied from in the first place (§33).

## 47. Closing the real STAC-Index gap: 33 more verified live APIs

"然后我在看stac browser还是有更多的数据我们没有，原因是?" (I notice STAC
Browser still has more data than we do — why?), followed by a direct
choice via three options — verify+add the ~60 (really 42, see below)
unadded API-type entries; verify+add newly-appeared static entries; or
check one specific catalog — with "先补 API 类型的这 60 个（推荐）" (fill in
the API-type ones first) as the answer.

Fetched STAC Index's own directory live (`stacindex.org/api/catalogs`,
147 entries) rather than trusting a remembered count: 62 are flagged
`isApi`, but 18 of those are `isPrivate` (auth-required, not real public
candidates), leaving 44 genuine public API candidates — 42 once Earth
Search and Planetary Computer (already here) are excluded, not the ~60
estimated before actually running the query.

Verified each of the 42 the same way §19 verified the static list: a real
GET with an `Origin` header (not just plain reachability), checking for
`Access-Control-Allow-Origin` on the response, and confirming the body
has a genuine `stac_version` rather than a superficially similar OGC API
- Records response. 34 passed. Excluded from the 34:

- Two GISTDA Thailand entries ("Drought Index", "Flood disaster") whose
  STAC Index URLs have a literal `?api_key=...` query string baked in —
  not this project's credential to redistribute by hardcoding into a
  public source file, decided without asking since it's a clear case, not
  a judgment call.
- "SkyServe Mission Data" (an Ellipsis Drive URL), whose path contains
  what looks like an embedded personal access token — same reasoning,
  excluded rather than silently added.
- Five more failed outright at check time (two TLS certificate errors,
  two timeouts, one HTTP 502, one HTTP 500) — genuinely unreachable, not
  a false negative worth relitigating: Digital Earth Australia, ESA
  Catalog, FAIRiCUBE Hub Catalog, FedEO Clearinghouse, KAGIS Katalog, UVT
  STAC Catalog.

Two of the 34 needed a closer look before trusting the pass:

- Boettiger Lab Geospatial Datasets and ERS open data are both plain
  static `catalog.json` files (only `child`/`root`/`self` links) that
  nonetheless declare a `conformsTo` array — enough for this app's own
  `detectSourceKind` (`graph.ts`) to classify them as `api-search`, same
  as a real STAC API root. Rather than assume this works, opened both in
  the actual running app via Playwright: children loaded and rendered
  correctly, "API" badge included, in both cases — a real, not
  hypothetical, verification.
- Google Earth Engine's openEO backend has no `conformsTo` and no
  `rel:search` at all (so this app's own detection — and the `isApi` flag
  below — correctly does *not* mark it as an API), but its `rel:data`
  link points at a real OGC-Collections-shaped endpoint with genuine STAC
  `Collection` objects (`stac_version`, `extent`, etc.) — 1046 of them.
  Confirmed by opening it in the real app: took about 10 seconds to load
  through the `collectionsEndpoint` fallback path built for Planetary
  Computer in §43, then rendered correctly.

All 33 additions (34 passing minus the token-bearing one) got hand-written
one-sentence descriptions grounded in each entry's own real `title`/
`description` fields, not generic filler — and `isApi: true` only where
this app's own runtime detection would actually treat it as one, checked
directly against each entry's raw JSON rather than copied from STAC
Index's own (looser) `isApi` flag. Known catalogs: 69 → 102. Verified via
Playwright against the real running dev server: card count, API badge
count, and the search-filter box all behave correctly post-change.

Still open, not addressed this round: STAC Index's static (non-API) side
has grown too (85 listed vs. 67 here) — a known, real gap left for a
possible future pass, not silently closed under cover of this one.

## 48. A real, consistent loading UI — not just "loading…" text, and not just missing entirely

"当打开一份数据的时候，常常需要加载很久，所以加载的时候需要有加载的UI，动画等等！
这个原则应该贯穿到整个产品的所有需要加载的地方" (opening a dataset often takes
a real while, so loading needs its own UI — an animation — and this
should apply everywhere the app has something to load).

Audited every loading state in the app before changing anything, rather
than guessing where the gap was. Found two different problems, not one:

- Structure Lens's root-catalog fetch — the single slowest, most-waited-on
  load in the app (opening a whole new catalog, sometimes a slow API
  root) — had no visible indicator *at all* while `!layout` (root not yet
  fetched): the tree column just rendered blank except for a tiny,
  easy-to-miss "loading…" pinned to the top-left corner.
- Everywhere else that already tracked a loading state (Inspector,
  Item Set's initial fetch/"load more"/"load all remaining", Time Lens,
  Space Lens, per-node tree expansion, the deep-link boot screen) had
  correct logic but rendered it as static "loading…" text with no
  animation — easy to mistake for stalled, especially on a slow API.

Built one shared primitive rather than a bespoke spinner per component:
`Spinner.tsx`, a small hand-drawn SVG arc (not a full ring — a full ring
spinning in place has rotational symmetry, so the spin isn't actually
visible; a ~28%-of-circumference arc's leading/trailing ends are what
read as motion) driven by one shared `stac-lens-spin` CSS keyframe
(`design/tokens.css`). It's deliberately just an `<svg>` itself, with
optional `x`/`y` props, so it drops into ordinary HTML flow *and* nests
directly inside Structure Lens's own tree `<svg>` (positioned the same
way its sibling `<text dx dy>` elements already are) without needing two
separate implementations. `LoadingState.tsx` pairs it with text as
`EmptyState`'s loading counterpart, for the block-level cases (Inspector,
Item Set's initial load, Time Lens) — kept separate from `EmptyState`
itself, which also renders genuine non-loading messages with no spinner
to show.

Applied everywhere a loading state already existed or should have:
Structure Lens's root fetch (now a centered spinner + "Loading catalog…"
over the whole canvas, not a corner note — this is the load users
actually sit and wait on), its per-node expand indicator (spinner next to
the node label, replacing plain "loading…" text under it), Item Set's
initial load/"loading more"/"Load all remaining" button, Inspector's own
node-not-yet-cached state, Time Lens's loading branch, Space Lens's
status overlay, and the deep-link "Opening shared link…" boot screen.

Verified live, not just read back from the code: real STAC fetches are
usually too fast to actually observe mid-flight, so verification used
Playwright's own request interception to add an artificial ~1s delay to
a real fixture's requests (the STAC spec example catalog, then
separately the Adaptation Atlas), then screenshotted mid-load. Confirmed
both the full-canvas root spinner and the per-node expand spinner render
correctly and clear cleanly once the (real, delayed) fetch resolves —
not a simulated/mocked loading state, a real one made observable.

## 49. Selecting a new node now resets Inspector's own scroll position

"右侧的inspector在选择了一个新的对象之后，需不需要重新加载一下，滚到头顶啊。不然
的话，就是看到图片在闪变并且留在原位置" (shouldn't the Inspector on the right
reset/scroll back to the top after a new object is selected? otherwise you
just see the image flash-change while staying in the same scroll spot).

A real, easy-to-miss bug: Inspector's own scroll container (the `overflow:
auto` div in `App.tsx` wrapping `DetailPanel`) persists across selections
— selecting a different node swaps out what `DetailPanel` renders, but
never touched the *scroll position* of the div containing it. Scrolled
partway into one Item's asset list or JSON tab, then clicking a different
node elsewhere in the tree, left the next Item's Inspector rendered
already scrolled down into whatever content happened to occupy that same
pixel range — reading as the old content mutating in place rather than a
genuinely new object being shown, exactly as described.

Fixed with a ref on that container and a `scrollTo({ top: 0 })` effect
keyed on `selectedHref` (`App.tsx`) — the minimal, correct fix: the
container itself doesn't unmount between selections (only its child
content changes), so nothing else already resets this for free the way,
say, swapping to a whole new component tree would.

Verified live: scrolled the real Inspector down (confirmed via a real
`scrollTop` read, not assumed), selected a different Catalog node, and
confirmed `scrollTop` read back as exactly `0` afterward, screenshotted
showing the new node's Inspector rendered from its own header down.

## 50. The header shows the catalog's own name, not just its URL

"打开一份数据之后，有没有可能把数据的名字页做得更加显眼一点？在header上面呢？
现在我只在header看到了数据链接，所以作用也不大" (after opening a dataset, could
its name be made more prominent in the header? right now I only see the
data's link there, which isn't very useful).

The header (`App.tsx`) showed only `rootHref` — a real fact, but not what
anyone actually orients by, especially for a long S3/API URL that doesn't
read as a name at all. Added a small cache-then-fetch effect (same shape
`useSelectedItems.ts` already uses) that resolves the root node itself,
then shows `node.title ?? node.id` as a bold, prominent line, with the
href demoted underneath it — small and muted, not removed, since it's
still a real, sometimes-useful reference (and is how the header already
behaved for a moment before the title resolves). Rarely triggers its own
network request in practice: Structure Lens's own root-expand effect
fetches the identical node via the same shared `loader` cache.

Verified against two real, differently-shaped roots: a static catalog
(Africa Agriculture Adaptation Atlas → "Africa Agriculture Adaptation
Atlas Catalog") and a live STAC API root (Earth Search → "Earth Search by
Element 84"), plus the brief in-between state (artificially delayed via
Playwright route interception) confirmed to fall back to showing just the
href, not an empty or duplicated line, until the title resolves.

## 51. What's deliberately deferred (not forgotten)

- Blocking Inspector's whole render until every async piece (the preview
  image especially) has finished loading, rather than showing instant
  content immediately and letting the image pop in on its own — asked
  about directly right after §49 landed: "需不需要在需要加载的内容都加载之后
  在将内容显示到inspector里面啊" (shouldn't we wait until everything that
  needs loading has loaded before showing it in Inspector?). Recommended
  against it and the user agreed ("明白，那就先不这么做"): most of
  Inspector's content (description, containment, declared extensions) is
  already synchronous by the time a node is selectable, and Time/Space
  are too except for a rare deep-linked-orphan-Item case (§21) — the only
  real asynchronous pop-in left is the preview `<img>` itself (changing
  `src` on the same element makes the browser clear it before the new
  image arrives). The targeted fix discussed instead, not yet built: a
  fixed-height placeholder + spinner + fade-in scoped to that image alone,
  so text content still renders instantly rather than everything waiting
  on one image's network fetch.
- Type icons (§44) in Structure Lens's own tree, not just Inspector —
  asked about directly right after §44 landed: "有没有可能在tree view里面也
  使用icon呢?" (could the tree view use icons too?). A real design conflict
  surfaced before agreeing on an approach: the tree's node circle already
  carries several signals at once (type color, filled-vs-hollow for
  "collapsed with more to expand" vs. "expanded/leaf," a dashed ring for
  invalid geometry, a solid/dashed ring for selected/contains-selection) —
  swapping the circle itself for a shaped icon would lose the filled/
  hollow expand-affordance, which has no equally-legible icon equivalent.
  Agreed direction instead: leave the circle exactly as it is, and add the
  type icon as a *separate* small glyph next to the node's text label —
  same pattern already used for Inspector's title and each Asset row, not
  a replacement of a working signal. Not yet implemented — the label's own
  position (`labelDx`) already feeds real downstream geometry (the Item
  Set box's connector line via `boxNearX`/`boxOffset`), so placing an icon
  without disturbing that math needs its own careful pass, and the node
  radius (6-7px) leaves too little room to simply tuck an icon into the
  existing circle-to-label gap at a legible size. Confirmed as the shared
  understanding to build from later: "先按你说的这么理解可以" (let's go with
  that understanding for now).
- §34/§34's update built the Human/JSON toggle and standard-extension
  interpreters for `eo`/`view`/`proj`/`sat`/`sar`/`sci`/`processing`/`grid`/
  `s2`, plus a per-asset `gsd`/`raster:bands` data-type badge — still open:
  `classification`/`table` (neither has shown real populated data in any
  fixture checked yet — add when one actually does, not speculatively),
  plus extensions the official registry has that this project hasn't added
  yet (`datacube`, `version`, `timestamps`, `alternate-assets`, `storage`,
  `label`, `render`). Custom/unrecognized property namespaces are
  explicitly out of scope for this pass entirely — deliberately deferred to
  be handled "一个一个" (one at a time), not a bulk pass.
- A genuinely different UI/navigation paradigm for API-backed data sources,
  raised directly and explicitly parked for its own dedicated discussion
  rather than folded into §35's Inspector fix: "如果一个数据有API的话...我们
  应该根据那个API可以提供完全另一套UI...如果我有了API,又使用API的时候,我就是在
  时间线和纯地图上就随便画,然后找到Item。那个时候就打破了所谓的树状结构了" (if a
  data source has an API, we should offer an entirely different UI for it —
  once you're actually using the API, you're drawing freely on the
  timeline/map to find Items, which breaks the whole tree-structure
  navigation model). Not yet researched or designed — the current model
  (a Catalog/Collection tree with Item Set as one embedded box) still
  applies uniformly regardless of `sourceKind`; whether API-backed sources
  deserve their own, query-first entry point instead is a real, separately-
  sized architectural question for later.
- In-browser COG/GeoTIFF rendering — real Item assets are routinely COG
  (`visual`/`overview`/individual bands), which no browser decodes natively;
  today these get a trustworthy copy-paste link (§34), not a rendered
  preview. Would need a client-side COG decoder (e.g. georaster/geotiff.js)
  to actually preview one inline.
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
- Growing the landing page's known-catalog list further — now at 102
  (§11's original 8, §19's static pass, Earth Search in §22, Planetary
  Computer in §43, and §47's 33 more APIs). §47 closed the API-side gap;
  the *static* side has not been re-swept since §19 and STAC Index's
  static listing has grown past what's here (85 there vs. 67 static
  entries here) — re-run §19's scripted method periodically rather than
  assuming either side of the list is permanently done.
- `CHILD_PAGE_SIZE`/`EXPAND_ALL_BUDGET` (§11, §17; the latter renamed from
  `AUTO_EXPAND_BUDGET` once the cascade it capped became manual) are
  untuned constants (100 and 60) picked to fix NZ Imagery's 833-wide root
  without breaking Atlas's ~30-node cascade — no attempt yet to make them
  adaptive (e.g. lowering the page size for a node whose sibling count is
  already known to be huge).
- Space Lens's Leaflet reskin (§7, §8) is light-touch — zoom control and
  tooltip colors only. No custom loading/error state while tiles are still
  fetching (Leaflet just shows blank/gray tiles natively during that
  window), and `fitBounds`/`flyToBounds`'s padding and `maxZoom` values are
  similarly untuned constants, not yet validated against a wide range of
  bbox sizes beyond Atlas's continent-scale and NZ Imagery's city-scale.
