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

## 51. The Legend now teaches all four type icons, not just two dot colors

"你之前说在tree 里面点已经很好了，不需要再加icon，那么我们的图例里面是不是可以
加入icon，让人更好识别呢" (you said before the tree's own dots are already
fine and don't need icons — so can we add icons to the Legend instead, to
help people recognize things better?).

The Legend (`StructureTree.tsx`) is a static explainer panel, not a tree
node — none of the constraints that shelved icons-on-the-tree itself
(§44's deferred note, still true) apply here, so this was a low-risk,
direct win rather than a design conflict to resolve first. Each existing
row (Catalog, Collection) now shows its `TypeIcon` glyph next to its real
dot color; two new rows (Item, Asset) show the same icon+color pairing
Inspector already uses for them, with no dot — neither is ever an actual
tree-node color, so a dot there would misleadingly imply one. The Legend
is now the one place that teaches the whole four-icon vocabulary at once,
reinforcing the same icon/color pairing wherever it shows up elsewhere
(Inspector's own title icon and colored border, each Asset row).

Verified visually: opened the Legend against a real catalog, screenshotted
and cropped/zoomed the panel specifically to confirm each icon reads
clearly at its actual 12px render size, not just that it exists in the DOM.

## 52. Hovering a tree node now shows its type — and its thumbnail, if it has one

"我想让hover的任何一个结点的时候可以给更多的信息！比如type之类的，如果有缩略图，
就应该在hover里面也出现缩略图" (hovering any node should show more
information — its type, and if there's a thumbnail, that should appear
in the hover too).

The tooltip (`StructureTree.tsx`) used to be one plain-text line — the
node's own title, or that plus an API-searched note. Restructured into a
small `HoverInfo` (`type`, `title`, `note?`, `thumbnailHref?`) computed
once per node next to its existing label/API-tag logic, rendered by a new
`NodeTooltip` component: a small uppercase type row (reusing `TypeIcon`,
the same glyph shown in Inspector and the Legend, §51), the title, the
API note when present, and the thumbnail when the node has one.

The thumbnail check reuses `isInlinePreviewAsset` (`stac/assets.ts`)
verbatim — the exact same "is this a browser-renderable `thumbnail`-role
asset" test Inspector's own preview image already uses, so "does this
node get a thumbnail" is answered identically in both places rather than
by a second, looser heuristic invented here. Real, not hypothetical:
confirmed directly against Microsoft Planetary Computer's Collections,
several of which (Sentinel-2 L2A among them) carry exactly this.

A real subtlety found while verifying, not assumed: a thumbnail can make
this tooltip tall enough to run off the bottom or right edge of the
window near a screen's edge, which the old text-only tooltip's fixed
`cursor + offset` position never had to account for — added a simple
viewport clamp (flip to the node's left/above when the estimated box
would overflow) rather than leaving part of it cut off.

Verified against a real thumbnail-bearing Collection (Planetary
Computer's Sentinel-2 L2A — confirmed the same asset is present via a
direct `curl` of the live API first, not assumed from memory), waiting
for the actual cross-origin image to finish loading (`img.complete`/
`naturalWidth` checked directly, not just DOM presence) before
screenshotting, and separately against a node with no thumbnail (Africa
Agriculture Adaptation Atlas) to confirm the tooltip stays compact with
no wasted space when there's nothing to show.

## 53. The hover tooltip's real job: understand what's inside before clicking

"hover的目的是为例让人快速理解这里面可能有什么，所以，难道不应该也给一些介绍在
里面么" (the whole point of hovering is to quickly understand what might be
inside — shouldn't it show a description too?), asked directly right
after §52's type/thumbnail tooltip landed.

Added `node.description` (truncated to 160 characters, `HoverInfo`'s new
`description` field) between the title and the existing API note — the
same field Inspector's own "Description (source)" already shows in full,
here trimmed to a glanceable snippet.

A real problem surfaced while verifying against an actual fixture, not
hypothetical: Planetary Computer's Sentinel-2 L2A Collection opens its
description with a markdown link — `[Sentinel-2](https://sentinel.esa.
int/web/sentinel/missions/sentinel-2)` — and a raw 160-character
truncation window spent most of its budget on that URL, leaving almost
no room for the actual sentence. Fixed with `stripMarkdownLinks`, a
narrowly scoped `[text](url)` → `text` replace applied only when building
this snippet — deliberately not a general markdown-rendering pass, and
deliberately not applied to Inspector's own Description field, which
still shows the untouched source text: full source fidelity matters more
there (an intentional "no silent interpretation" rule elsewhere in this
project) than in a hover snippet whose entire purpose is a fast read.

Bumped `TOOLTIP_WIDTH` from 220 to 240 (description text needs a bit more
room to read comfortably than a single title line did) and extended the
tooltip's own viewport-clamp height estimate to account for the extra
description block.

Verified against two real cases: Africa Agriculture Adaptation Atlas's
"Population Catalog" (a short, clean one-line description, no thumbnail)
and Planetary Computer's Sentinel-2 L2A (description *and* thumbnail
together, confirming the markdown-link fix and the combined layout both
read correctly, not just the description alone).

## 54. Item Set rows get the same type icon, and the Legend starts open

Two small, direct requests together: "既然catalog还有collection已经用颜色
区分了，那么item难道不也应该表现一下么？即使是在一个列表的panel里面" (Catalog
and Collection are already color-distinguished — shouldn't Item show
something too, even inside a list panel?), and "图例面板其实一开始就可以是
打开的，这样让大家很直观地明白各个节点是什么" (the Legend panel could just
start open, so everyone immediately understands what each node means).

Item Set's own list rows (`ItemSetBrowser.tsx`) had never carried any
type signal at all — plain id/title text, no color, no icon — since
Items are never tree nodes and so never had a dot color to inherit in the
first place (§21). Gave each row the same small icon+color treatment
Inspector's own Asset rows already use (§44): a 12px `TypeIcon` type=
`"Item"` in `--color-node-item`, inverting to `--color-bg` on the
selected (blue-background) row so it stays legible there too. The
temporal subtitle line got a matching `marginLeft` so it aligns under the
title text, not the icon.

The Legend (§51's four-icon version) previously started collapsed to a
small two-dot preview button, requiring a click before showing anything
— changed its default `open` state to `true`. Still fully closeable for
anyone who wants the screen space back once they already know the
vocabulary; nothing else about its behavior changed.

Verified against a real API-backed Collection (Earth Search's Sentinel-2
Pre-Collection 1 Level-2A): Legend visible immediately on opening the
catalog with no click, Item Set rows showing the orange Item icon
consistently, and the icon correctly inverting to white on the selected
row without becoming illegible against the blue background.

## 55. A real, confirmed bug: selecting an Item kept re-panning the canvas

"不知道为什么，我选择了一个item的瞬间，画面又会移动，我感觉是之前开发的功能的
残留" (I don't know why, but the instant I select an Item the view moves
again — feels like a leftover from an earlier feature). Correct
diagnosis, not just a hunch.

Structure Lens's own auto-recenter effect (added for a genuinely different
case — a selection arriving from Time Lens or Space Lens, back when those
were separate panels the tree had to pan into view for) was guarded by
`selectedHref === lastCenteredRef.current`, meant to fire "only once per
distinct selection." But an Item selection has no tree node of its own to
center on — the effect already knew this, and pans to `browsingHref` (the
Collection containing it) instead. The guard, though, was still comparing
against `selectedHref`, not `browsingHref` — so every single Item clicked
inside an already-open, already-on-screen Item Set box counted as a "new"
selection and re-ran the pan, even though the actual pan *target*
(the Collection, and its box) never moved or changed at all.

Fixed by keying `lastCenteredRef` on `panHref` (`browsingHref ?? selectedHref`)
instead of `selectedHref` — the unit the effect's own logic already treated
as "the thing being centered on," just not the unit its skip-guard checked.
Clicking through Items in the same open box no longer moves the canvas at
all now; selecting an Item in a genuinely different Collection still
correctly re-centers on it.

Verified directly via the real rendered SVG's own `transform` attribute
(not just visually): unchanged (`translate(-180, 487.5) scale(1)`) across
three separate Item clicks within one open Item Set box; changed to a new
value when switching to a different Collection's box entirely, confirming
the fix didn't just suppress panning outright.

## 56. Unifying the label's click with the circle's, and fixing its cursor

Two related complaints about the same root cause: "光标移动到比如说collection
上的时候,确实是手的形状,意味着可以拖拽,但是更重要的是点击功能,应该让人知道这里
可以点,而不是抓手形状的光标欸" (hovering a Collection shows a grab-hand
cursor, implying drag — but the more important thing is that it's
clickable, and the cursor should say that instead), and "这里也有矛盾的操作,
catalog是必须要点圆圈才会打开下一级,而collection只要点名字就会打开下一级!就是
这些困惑的操作,使得我们的UI还是不好用" (there's also a real inconsistency:
a Catalog needs its circle clicked to open the next level, but a
Collection opens it just by clicking the name — this confusion makes the
UI hard to use).

Both trace back to the same asymmetry: the circle's click (`onSelect()` +
toggle-expand if `canExpand`) and the label's click (`onSelect()` only)
had never done the same thing. A Collection with direct Items only
*looked* like clicking its name opened the next level — selecting it
happens to open its inline Item Set box as a side effect (§21) — while a
Catalog's name click visibly did nothing beyond selecting it, since
nothing else about a Catalog reacts to mere selection. The same gesture
meant two different things depending on a shape distinction (leaf-items
vs. has-children) users have no way to see in advance.

This is the same tension the *circle* itself already resolved once
before (§32: drag moved off the circle and onto the label specifically so
the circle's own cursor could stay an unambiguous `pointer`) — it had
simply reappeared on the label once drag landed there instead, since the
label kept a plain `cursor: 'grab'` for the drag affordance while its
click still only did half of what the circle's click did.

Fixed both together, not separately, since they're the same underlying
problem: the label's `onClick` now calls the exact same handler the
circle already used (renamed `handleSelectAndToggle`, shared by both) —
select, and toggle-expand if the node has children — so clicking either
target always does the identical thing regardless of node type or shape.
The label's cursor now defaults to `pointer`, switching to `grabbing`
only once an actual drag gesture starts (tracked via the label's own
`d3.drag()` `start`/`end` events, not the canvas-wide pan-drag state),
so the cursor's strongest signal goes to the click action, not to a drag
affordance most users will still discover naturally by pressing and
moving. Combining drag and click on the same element stays safe: d3-drag
only swallows the following click once a real drag has moved the pointer
past its own threshold, so a plain click still reaches the handler
normally, exactly as it already did on the circle before §32 moved drag
away from it.

Verified against the real running app, not just code review: clicking a
Catalog's name ("Population Catalog," which has one real child
Collection) now both selects it and expands it to reveal that child —
confirmed via Playwright reading the rendered tree, not assumed from the
click handler alone. A real drag (mousedown, move past threshold, mouseup)
still repositions the label (`getBoundingClientRect` before/after
confirmed a real position change) and does *not* also trigger a selection
or expand — confirmed by checking that no Inspector column mounts and no
child node appears after a pure drag gesture.

## 57. Temporal's header was still describing a retired feature

"我觉得这难道不还是之前开发的遗留信息么？我们现在的Temporal和Spatial难道不是就
都是专注在选中的那个么" (isn't this leftover info from earlier development?
aren't Temporal and Spatial both now scoped to just the selected object?),
quoting Temporal's own header: "showing 1 of 4 items selected: crop_ha —
scoped to just this Item, not its neighbors."

Traced it, and the diagnosis was exactly right. `useSelectedItems()`
(§21) already guarantees Temporal's `items` array is either exactly one
Item (a direct Item selection — never any "neighbors," full stop) or
empty (a Collection selected on its own — aggregate multi-item display
was retired in §41 and is still unreachable, pending "somewhere else").
Given that, every piece of the old header was describing a state that
can no longer occur:

- "showing 1 of 4 items" — the "4" was the *Collection's* total item
  count, unrelated to what's actually shown; always reads as "1 of 4
  displayed" when really all 4 were never candidates for display at all.
- "selected: X — scoped to just this Item, not its neighbors" — X is
  always the one and only entry in the array; there are no neighbors to
  be scoped away from, so this sentence was permanently tautological.
- "· grouped into N distinct timings" — required `groups.length !==
  sortedItems.length`, which can't happen when there are only ever 0 or 1
  items to group.
- The ⚠ "actual Item range extends beyond the collection's stated extent"
  conflict check — a real, previously-working feature (confirmed against
  Adaptation Atlas's own `hazard_timeseries_mean_annual`, whose Items
  really do run to 2060 against a stated 1995–2020 extent), but its
  inputs can no longer coexist: the stated-extent comparison only runs
  when *no* Item is highlighted, and in that state the items array is
  always empty (nothing to compare against) — so the check itself was
  fully wired but structurally unreachable.

Asked directly whether to keep the conflict-detection logic dormant
(ready to reactivate once the retired aggregate-item view returns
"somewhere else," per the user's own words in §41) or remove it outright:
"直接删掉" (just delete it) — removed the `actualDates`/`actualMin`/
`actualMax`/`conflict` computation entirely, along with the header's
item-count and "scoped to just this Item" text and the now-impossible
grouping-mismatch line. The stated-extent reference row's color
(previously `conflict ? warning : faint`) is now just always the plain
faint color. The header is now one honest line: the selected Item's own
title if one is selected, otherwise the Collection's.

Verified against three real cases: an Item selected inside Earth Search's
Sentinel-2 Pre-Collection 1 Level-2A (header now just names the Item, no
count/neighbor text); that same Collection selected on its own (header
names the Collection, no "showing 0 items"); and a direct deep link into
Adaptation Atlas's real historical conflict Collection itself
(`hazard_timeseries_mean_annual`) to confirm removing the dead
conflict-detection code didn't break anything about that Collection's own
Temporal card rendering.

## 58. Item Set becomes a real multi-view panel: List, Temporal, Spatial

A substantial, explicitly-scoped-in-phases redesign, proposed directly:
"我恰恰觉得这里才应该是呈现多个item的bbox以及时间的面板。因为不管是时间还是空间都
是看待同一批数据的另一种方式而已，因此完全可以切换view，list view到Temporal
view和Spatial" (this is exactly where multiple Items' bbox and time should
be shown — time and space are both just another way of looking at the
same batch of data, so switching from List view to a Temporal or Spatial
view should be entirely possible). The full proposal also included real
pagination (not infinite scroll) and an API query-input module, both
explicitly deferred to later phases — this section covers only the view
switcher, chosen first as the lowest-risk starting point.

This directly resolves the gap §58's deferred list (previously) tracked:
§41 retired the "show on Time/Space Lens" aggregate view with no UI left
to enable it, on the explicit understanding the user would "put it
somewhere else" later. "Somewhere else" is Item Set's own panel — not a
toggle bolted onto Inspector's single-object view, but a real second
reading of the exact same batch already being browsed there as a list.

**Extraction, not duplication.** Inspector's `TimeLens.tsx`/`SpaceLens.tsx`
were each split into two layers: a new `ItemsTimeline.tsx`/`ItemsMap.tsx`
(the actual drawing — grouping/lane-packing/axis/marks/tooltip for time;
tiles/rectangles/fit-bounds/fly-to for space) that takes a plain `items`
array and an `onSelectItem` callback with no opinion about *why* those
items are being shown, and a thin caller-specific wrapper that resolves
*what* to plot. `TimeLens`/`SpaceLens` keep calling `useSelectedItems()`
exactly as before (single-object-scoped, empty/loading states, the
Collection-stated-extent-suppressed-while-an-Item-is-highlighted rule);
Item Set's own new tabs feed the same two drawing components with
whatever `useItemSet()` has paginated in so far, `filtered` by its
existing id/title search box. One deliberate behavioral difference kept
explicit rather than silently shared: Inspector's Temporal view narrows
the axis to a padded window around a selected Item (there are no
neighbors to lose — without it, a single day is an invisible sliver on a
decades-wide axis); Item Set's own Temporal tab does not (narrowing there
would hide every other item in the batch just to focus on the one
clicked, defeating the point of a batch view at all) — surfaced as an
explicit `focusOnSelection` prop on `ItemsTimeline`, on by default nowhere
except Inspector's own caller.

**What's new in `ItemSetBrowser.tsx`:** a three-way List/Temporal/Spatial
pill switcher above the existing search box; the search box now filters
all three views identically (a Temporal/Spatial tab only ever plots
`filtered`, the exact same subset the List rows show); both new tabs pass
the browsed Collection's own `node.temporal`/`node.spatial.bbox` as a
reference row/rectangle, matching Inspector's own "stated extent (source)"
convention; clicking a mark or footprint calls the same `select()` the
List rows' own `onClick` already used, so selection stays perfectly in
sync with the tree, Inspector, and every other lens regardless of which
tab last changed it. The footer's "scroll to load more" hint is now
view-aware (real pagination replacing scroll-to-load is next phase's
job, not this one's — for now, Temporal/Spatial simply reflect however
much the existing infinite-scroll mechanism has loaded).

Verified against real data in both directions this project's sources
split into: Earth Search's Sentinel-2 Pre-Collection 1 Level-2A (API/
cursor-mode) — Temporal tab plotted a real open-ended stated extent plus
a loaded Item's own instant mark; Spatial tab plotted real Sentinel-2
tile footprints, auto-fit; clicking a mark selected the Item and updated
Inspector correctly (thumbnail, Temporal, Spatial, "1 item footprint") —
and Adaptation Atlas's Population 2020 (static/links-mode) — confirmed
the exact-duplicate-timestamp grouping feature ("2 items, identical
timing") still fires correctly post-extraction, and its own Spatial tab
plotted a real continent-wide footprint. Zero console/page errors
throughout, and a direct before/after comparison confirmed the extraction
itself introduced no regression to Inspector's existing Temporal/Spatial
behavior (same focus-narrowing, same stated-extent suppression rules).

## 59. §58's tabs reuse the app's own tab style, and the box is now resizable

Two follow-up refinements on §58's view switcher, both asked about
directly: "如果是tab切换的话，我不知道是不是应该使用我们系统中已经有的tab组件？
给我一些想法" (if it's a tab switch, shouldn't it reuse the tab component
the system already has? give me some thoughts), and "明显显示时间和显示地图
的部分是要更宽的panel，我宁愿你开始就给我很宽的panel，然后我可以自动拖拽右下角
来改变panel的尺寸" (the Temporal/Spatial views clearly need a wider panel —
I'd rather it start wide, and let me drag the bottom-right corner myself
to resize it).

**Reused, not reinvented.** §58's List/Temporal/Spatial switcher had used
a pill-button style, different from Inspector's own Human/JSON tabs
(an underline style, `TabButton` — previously a private function inside
`DetailPanel.tsx`). Extracted it into `TabButton.tsx` and switched Item
Set to use the exact same component, so there's one tab visual language
in the app, not two. `DetailPanel.tsx` itself is unaffected beyond the
import — same look, same behavior, now just sourced from a shared file.

**Wide by default, freely resizable.** The Item Set box's width/height
(`ITEM_SET_BOX_WIDTH`/`HEIGHT` in `StructureTree.tsx`) were plain module
constants; renamed to `DEFAULT_BOX_WIDTH`/`HEIGHT` (640×760, width nearly
doubled from 320) and turned into real per-node state (`boxSizes`, a
`Map<href, {width,height}>` — same pattern `boxOffsets` already uses for
remembering a dragged position per Collection). A new corner-drag handle,
built the same `d3.drag()` way the box's own move-handle already is,
lets you resize it freely; "Reset layout" now clears sizes back to
default alongside positions.

A real geometric subtlety, not just a slap-on handle: the box can render
on *either* side of its node (`labelOnLeft`), and which edge is actually
fixed differs by side — on the right (the common case), the box's near/
left edge is pinned and it grows rightward; on the left, its near/*right*
edge is pinned instead (flush against the node's own connector line) and
it grows further left. A single bottom-right handle would feel backwards
on that second side — dragging it rightward would need to *shrink* the
box, not grow it, since the edge under the cursor is the pinned one. Fixed
by mirroring both the handle's own position (bottom-left instead of
bottom-right, matching cursor `nesw-resize` vs `nwse-resize`) and the
sign of its horizontal delta, based on `labelOnLeft` — tracked in a ref
(`labelOnLeftRef`) so the drag callback (bound once per box) always reads
the current side rather than a stale one.

**The resize is also not cosmetic.** Making the outer box bigger without
its content actually using the extra space would just add dead space —
`ItemSetBrowser.tsx`'s own List/Temporal/Spatial content area used to be
fixed-pixel-height constants (`LIST_MAX_HEIGHT`, `PLOT_VIEW_HEIGHT`);
replaced with a flex-column layout (`flex: 1, minHeight: 0` on the
content area, chrome — tabs, search box, footer — keeping its own natural
height) so the list genuinely shows more rows, the timeline genuinely
gets more horizontal room for tick labels, and Leaflet's map genuinely
gets a bigger real pixel container, all by however much the box itself
was resized. Required threading the same flex-column sizing up through
the box's own wrapper `<div>` in `StructureTree.tsx` too, not just inside
`ItemSetBrowser.tsx` — a percentage/flex height only resolves against a
parent that itself has a real resolved height, not just `height: '100%'`
at every level independently.

Verified against the real running app, not just code review: dragging the
corner handle on a normal (box-on-the-right) node grew the foreignObject
from 640×760 to 784×854 for a ~150×100px mouse movement (confirmed via
its own `width`/`height` attributes, not just visually); the List view
after resizing showed dozens more rows than before; the Temporal view's
axis gained multiple additional date tick labels instead of just one; the
Spatial view's Leaflet map rendered at the new, larger real pixel size
with all previously-loaded footprints still correctly plotted. The
mirrored (box-on-the-left) geometry was verified by careful reasoning
about the existing `x` formula rather than a live drag test — no fixture
on hand at the time had a node that was both expanded (to have
`labelOnLeft`) and had its own direct Items (to show a box) at once.

## 60. Filled/hollow now also reflects direct Items, not just child nodes

A real, reported case: opening the Africa Agriculture Adaptation Atlas's
Women and Gender Catalog, "Female Empowerment Index Collection" (21 real
Items) rendered hollow, indistinguishable at a glance from a genuinely
empty leaf node. "我以为这里得是filled的状态" (I expected this to be
filled) — asked as a real semantics question, not a bug report, so this
was discussed and a direction confirmed before any code changed, per
this project's own established norm for open design questions.

The root cause: `filled` was defined purely as "has child Catalogs/
Collections to expand, not yet expanded" — for a leaf-items node
(Items but no children at all, the majority shape in this fixture),
`canExpand` is permanently `false`, so it was permanently hollow
regardless of whether it held 0 Items or 21. The only distinguishing
signal was the "N items" caption beneath the label — real, but far
lower visual salience than the circle's own fill state, and easy to miss
next to a row of otherwise-identical hollow siblings.

Redefined `filled` to mean "there's something behind this circle you
haven't opened yet" — either tree children (unchanged) or, when there
are no children at all, its own Item Set box:
`filled = (canExpand && !hasRenderedChildren) || (hasDirectItems(node) && !showItemSetBox)`.
A leaf-items node now reads filled until its Item Set box is opened,
then hollow — the same filled→click→hollow rhythm a branch Catalog
already had, just extended to cover the other way a node can hold real
content.

One real tradeoff surfaced and explicitly decided, not defaulted to:
whether "already opened" should behave like expanded tree children
(sticky — stays revealed forever, even after selecting something else
entirely) or track the box's current open/closed state directly
(non-sticky — closing the box by browsing elsewhere and coming back
shows filled again). Chose non-sticky, tied directly to `showItemSetBox`
rather than a new per-node "ever opened" record: honest about "is this
open right now" rather than a permanent memory, and needs no additional
state to implement. The Legend's own filled/hollow row text was updated
to match ("has something to open (children or items)" / "already open,
or genuinely empty").

Verified against the real reported fixture, not just code review: read
the actual circle's own `fill` style before and after clicking —
`var(--color-node-collection)` (filled) before opening, `var(--color-
surface)` (hollow) after — confirming the DOM state changed exactly as
designed, not just visually plausible in a screenshot. The parent Women
and Gender Catalog (a pure branch node, 0 direct Items) was confirmed
unaffected — still filled-then-hollow purely on its own children, per
the original, unchanged half of the rule.

## 61. Item Set's Temporal and Spatial merge into one tab, and the timeline gets real zoom

Two related refinements to §58/§59's Item Set view switcher, both asked
about directly: "在tree view的items panel的Temporal和Spatial其实可以组成成
一个tab" (Temporal and Spatial in the Item Set panel could actually be
combined into one tab), and "如果items很多话，我觉得timeline完全可以zoom in
zoom out，就像很多ui做到的那样的" (when there are many items, the timeline
should support zoom in/out, the way plenty of UIs already do).

**Merged tab.** `ItemSetView` narrowed from `'list' | 'temporal' |
'spatial'` to `'list' | 'time-space'` — the combined view stacks
`ItemsTimeline` above `ItemsMap`, same top-to-bottom order Inspector's own
Temporal-then-Spatial fields already use, so this reads as the same two
facets just seen together rather than a new arrangement. The timeline's
own height is capped (`TIMELINE_MAX_HEIGHT`, its own scroll past that) so
the map below always keeps a real, usable share of the box regardless of
how many distinct timings load. A genuine side-effect improvement, not
just a rearrangement: each half now gets its *own* empty-state message
independently (no temporal data but real spatial data, say, now still
shows the map instead of blanking the whole tab the way switching to a
data-less "Spatial" tab used to).

**Timeline zoom — and a real bug hiding under a wrong first diagnosis.**
The first implementation gave `ItemsTimeline` an opt-in `zoomable` prop
built on d3-zoom + the same `data-block-pan` composition Structure Lens's
own canvas already uses. Automated Playwright verification of the wheel/
drag gesture couldn't trigger it, across many attempts and environments —
misdiagnosed at the time as a Playwright testing-tool artifact (a
lingering `window`-level capturing `mousedown` interceptor Playwright
installs after any `Locator.click()`, confirmed real via `addEventListener`
monkey-patching, but a red herring here) and shipped anyway on the
strength of directly invoking d3-zoom's own `behavior.transform()` API,
which correctly proved the render pipeline. **The user then tested it
with a real mouse and confirmed neither drag nor zoom did anything at
all** — the right call, since "I verified the renderer, not the gesture"
is not the same claim as "the feature works," and it wasn't.

Re-investigated from scratch rather than trusting the earlier diagnosis.
Attaching a plain React `onMouseDown`/`onWheel` directly to the same
`<svg>` confirmed those synthetic handlers *did* fire reliably, even in
the exact spot d3-zoom's own directly-attached native listener
mysteriously didn't — which narrowed the real bug to something inside
d3-zoom's own `.filter()` gate, not event delivery at all. The actual
cause: `.filter()`'s check was `event.target.closest('[data-block-pan]')`
— and Structure Lens's own Item Set box has `data-block-pan="true"` on
its *entire outer wrapper div* (for the unrelated purpose of keeping the
tree's own canvas zoom from engaging anywhere inside the box), which
`ItemsTimeline` now lives nested inside. `.closest()` walks all the way
up the DOM regardless of which layer set the attribute, so it matched
that outer wrapper on *every single gesture, everywhere in the
component* — silently rejecting every zoom/pan attempt at the very first
line of d3-zoom's internal handler, before ever reaching the debug
logging originally used to investigate it (which had been placed a few
lines further down, past that same early return — the reason none of
those logs ever printed, and the detail that sent the earlier
investigation toward blaming the test tool instead).

Fixed by rebuilding the gesture handling with plain React events (the
exact same mousedown/mousemove/mouseup composition App.tsx's own
Inspector-width divider already uses) instead of d3-zoom, computing the
zoomed scale by hand (`rescaleX`, replicating d3's own algorithm using
only `scaleUtc`'s existing `.copy()`/`.domain()`/`.range()`/`.invert()`)
rather than depending on a `ZoomTransform` instance — and, critically,
replacing the pan-gesture's own opt-out check with a manual ancestor walk
that stops at *this component's own* `<svg>` root instead of searching
the whole document, so a distant, unrelated ancestor's `data-block-pan`
can never again block a gesture that has nothing to do with it. Wheel
handling uses a real native (non-React-synthetic) `{passive: false}`
listener, attached via a callback ref rather than a plain ref + fixed-deps
effect — deliberately reusing the exact `useElementSize` fix from §44,
since that's precisely the class of bug a plain ref can reintroduce.

Verified this time with the gesture itself, not just the transform API:
wheeling over the timeline narrowed real ticks from a 2016–2022 range
down to 2018–2019; dragging afterward shifted them further to 2019–2020;
clicking "Reset zoom" restored the original 2016–2022 range — and,
separately, reading the actual DOM `transform` attribute on a tick
element before and after a pure drag (no wheel first) confirmed a real
~52px shift, not just a plausible-looking screenshot. Zero console/page
errors throughout.

## 62. The timeline's label column goes away entirely, and a hover-bubbling bug it exposed

Direct feedback right after §61's zoom fix was confirmed working: "一个UI的
问题，timeline需要一直显示name么？导致左侧的2/5都是没用的被浪费的空间！" (a UI
problem: does the timeline need to keep showing names all the time? It's
wasting ~2/5 of the width on the left that isn't being used for anything).
Presented three options; the user picked removing the persistent label
column entirely in favor of hover-only names, matching the convention
`ItemsMap`'s own footprints already use ("完全去掉，改成悬停才显示名字
（推荐）").

**The change itself.** `LABEL_WIDTH = 220` removed from `ItemsTimeline.tsx`
in favor of a minimal `LEFT_PAD = 12`; every per-row/reference label
(`groupLabel()`, the per-lane label key) removed entirely, with identity
now shown only via the existing hover tooltip (`groupTooltip()` was already
the richer source — items grouped by identical timing already needed a
tooltip, not a label, to disambiguate). The axis now spans the full box
width, showing more real date ticks than before.

**A second real bug this surfaced, not itself part of the label removal:**
verifying the hover tooltip directly (not just screenshotting it) found
*two* tooltip `<div>`s rendering simultaneously at the same point —
`ItemsTimeline`'s own correct one (`S2B_T21NYC_...`, z-index 2000) and
Structure Lens's own tree-node tooltip for the Collection the box belongs
to (z-index 10) — both genuinely present in the DOM, not a z-index-only
illusion. Root cause: the Item Set box is a DOM *descendant* of the tree
node's own `<g>` (nested inside its `foreignObject`), and that `<g>` has
`onMouseEnter`/`onMouseMove` for the node's own tooltip. Hovering
*anything* inside the box — a timeline mark, a map footprint — bubbles the
native mouse event straight up to that ancestor handler, which sets the
node's own tooltip on top of whatever the box's own content wants to show.
Worse: once the ancestor's tooltip was already showing (from the cursor
passing over the node's own visible hit-circle on the way to the box), it
stayed stuck the entire time the cursor was over the box afterward,
because the box is still *inside* the node's own `<g>` subtree — its
`onMouseLeave` never fires just from moving deeper into a descendant.

The first fix attempt — `e.stopPropagation()` on the box's own wrapper —
looked right and made the double-tooltip go away, but broke something
else: §61's own hand-rolled drag-pan listens for `mousemove` on `window`,
added imperatively outside React specifically so it isn't tied to any one
element's bounds. React 17+'s `stopPropagation()` on a synthetic event
also calls the underlying native event's `stopPropagation()`, so it
silently killed *every* native `mousemove` at the box boundary before it
could ever reach that `window` listener — re-breaking the exact drag gesture
§61 had just fixed, confirmed by the same kind of instrumentation §61's own
investigation used (a temporary `console.log` in the pan handler showed
`mousedown` still starting the gesture, but `mousemove` on `window` never
firing again once the cursor entered the box).

The actual fix avoids touching propagation at all: the node's own
`handleEnter`/`handleMove` now check, via a manual ancestor walk bounded at
the node's own `<g>` (a `nodeGroupRef`, the same scoped-walk convention
§61 already established for `data-block-pan`, not an unscoped
`.closest()`), whether the event's target sits inside the Item Set box
(`itemSetBoxRef`). If so, they explicitly clear the node's own tooltip
(`onHover(null, ...)`, the same call `handleLeave` makes) instead of
setting it — removing any stuck tooltip on entry, and suppressing further
sets on every move — without ever calling `stopPropagation`, so `window`-
level listeners elsewhere are untouched.

Verified with the same standard as §61: not a screenshot alone, but reading
actual DOM state after each step — hovering a timeline mark (crossing over
the node's own hit-circle first, deliberately the worst case) shows exactly
one tooltip div in the DOM, with the timeline's own text; moving away
clears it to zero; a real drag afterward still shifts the axis's tick
`transform` (confirmed via `getBoundingClientRect`/attribute reads, not
`d3-zoom`'s own API); a real wheel-zoom still rescales it too. All four
checked in the same run, not in isolation, since the propagation-based fix
had looked correct in isolation and only failed once combined with §61's
own gesture.

## 63. The timeline's tooltip lands far from the cursor and shrinks when the tree zooms — a containing-block bug, fixed with a portal

Reported directly, right after §62's tooltip-bubbling fix: "现在的hover还
是有问题，尤其是在timeline里面，hover之后，出来的气泡离开我的光标非常得远，差
100个px呢。然后气泡难道不应该是一个固定尺寸的东西么，为何随着我zoom 在地图上，
气泡中的字体还能变小呢？" (the timeline's hover tooltip lands ~100px from the
cursor, and shouldn't it be a fixed size? — its font shrinks when I zoom the
map). Both symptoms, one cause.

`ItemsTimeline`'s tooltip is a plain `<div style={{position:'fixed', left:
tooltip.x+14, top: tooltip.y+12, ...}}>` — correct in isolation, and
exactly the same pattern Structure Tree's own `NodeTooltip` already uses
successfully. The difference: `NodeTooltip` renders as a sibling right
after the tree's own `</svg>` closes, fully outside any transformed
ancestor. `ItemsTimeline`'s tooltip, by contrast, is nested many layers
deep inside the tree's own zoomed/panned canvas — inside the Item Set
box's `foreignObject`, inside the `<g transform="translate(x,y)
scale(k)">` Structure Lens uses for its own pan/zoom (§14/§32). An SVG
ancestor carrying a `transform` establishes a new CSS containing block for
`position: fixed` HTML content nested in a `foreignObject` beneath it — the
exact same rule a CSS `transform` property triggers on ordinary HTML.  So
this tooltip's "fixed" positioning was actually anchored to that scaled,
translated `<g>`, not the real viewport: `left`/`top` computed from real
`clientX`/`clientY` landed at the wrong place relative to that wrong
containing block (the reported ~100px offset, worse the further the box
sat from the canvas's own local origin), and everything painted inside a
scaled containing block visually scales with it — including a `12px` font
that never itself references the zoom level (the reported shrink/grow as
the *tree's* canvas, not the timeline's own, was zoomed).

Fixed with `createPortal(tooltipDiv, document.body)` — the standard escape
hatch for exactly this class of problem, rendering the div as a true child
of `<body>` regardless of where in the React tree it's declared, so it's
positioned and sized relative to the real viewport unconditionally. The
first portal used anywhere in this codebase; no other fixed-position UI
needed one before because everything else generating one (`NodeTooltip`)
already happened to render outside every transformed ancestor by
construction, not by design — worth remembering for any *future* tooltip/
popover nested inside the Item Set box (a map marker tooltip, say): it
needs the same portal, not just this component's own fix.

Verified via real DOM state, matching the position-check convention
established for this exact tooltip in §62: hovering a mark with no outer
zoom applied placed the tooltip at `clientX+14`/`clientY+12` in true
viewport coordinates (`parentElement === document.body` confirmed);
zooming the tree's own canvas by wheeling over empty canvas space, then
re-hovering, still placed it correctly offset from the cursor with
`font-size: 12px` unchanged — not assumed fixed by the portal alone, since
CSS containing-block edge cases are exactly the kind of thing that "should
obviously work" until actually checked.

## 64. Item Set's "stated extent (source)" reference row/rectangle removed — it duplicated Inspector, almost always

Asked directly, after using the merged Time & Space tab for a while: "我真
的不知道在我们的tree view的items panel的timeline里面，stated extent
（source）还有什么用？这个不是来自于上一级的么？而且往往在右侧已经显示了"
(I genuinely don't know what use the timeline's "stated extent (source)"
row still serves — doesn't it come from the level above, and isn't it
usually already shown on the right?).

Traced both halves before answering. `ItemSetBrowser.tsx`'s "Time & Space"
tab passed `statedShape={node.temporal}` into `ItemsTimeline` (the
Collection's own declared temporal extent, drawn as a reference bar above
the item marks) and `statedBbox={node.spatial?.bbox}` into `ItemsMap` (the
same Collection's declared bbox, drawn as a rectangle) — `node` here is
always the very Collection whose box this is. Opening that box happens by
selecting that Collection (`selection.ts`: selecting a non-Item sets both
`selectedHref` *and* `browsingHref` to the same href, and `boxHref`
derives from `browsingHref`) — so Inspector, on the right, is at that same
moment showing that identical Collection's own Temporal/Spatial fields
(`TimeLens`/`SpaceLens`), with the identical `node.temporal`/
`node.spatial?.bbox` values. The user's read was exactly right: this was
almost always pure duplication, not new information.

One real nuance found before just deleting it: clicking a specific Item
*inside* the open box changes `selectedHref` to that Item while
`browsingHref` (and thus the box) stays put — Inspector then switches to
showing *that Item's own* Temporal/Spatial (via `highlightHref`,
suppressing the Collection-level fact entirely, per §40's original
Collection-level-data-leak fix, which called that exact combination "pure
noise"). In that one specific state, the box's own stated-extent row was
briefly the *only* place still showing "how does this Item compare to what
the Collection as a whole claims" — a real, non-redundant use, not
imagined. Surfaced this distinction and asked rather than assuming the
"remove entirely" framing was already the full picture; the user chose
removing it outright anyway (over "only show it once an Item inside the
box is selected"), for simplicity — losing that one narrow comparison
case was an accepted, explicit tradeoff, not an oversight.

Also checked whether the exact same duplication existed on the spatial
side before touching it, rather than assuming symmetry — confirmed via
`SpaceLens.tsx`'s own `!highlightHref ? node?.spatial?.bbox : undefined`,
the identical suppression pattern `TimeLens.tsx` uses. Asked separately,
since the user's own question named only the timeline; they confirmed
removing `statedBbox` too, for the same reason.

Removed both props from `ItemSetBrowser.tsx`'s two `ItemsTimeline`/
`ItemsMap` calls (the components themselves keep supporting `statedShape`/
`statedBbox` — `TimeLens.tsx`/`SpaceLens.tsx`'s own Inspector-side callers
still need them, and that usage isn't redundant with anything, since it's
the *only* place that Collection-level fact is shown once you're not
inside its own box). `hasTemporalData`/`hasSpatialData` (the checks
gating whether to render the timeline/map at all vs. an empty-state
message) were narrowed to only the *items'* own data — previously
`!!node.temporal ||`/`!!node.spatial?.bbox ||` meant a Collection with a
stated extent but zero Items carrying their own would still render an
otherwise-empty plot just to show the now-removed reference mark.

Verified live: the "Time & Space" tab's timeline now shows only real item
marks (axis height dropped from including the old reference row's
`STATED_ROW_HEIGHT + 8` to just the item lanes), the map below shows only
item footprints, with Inspector's own Temporal/Spatial fields on the right
still showing the Collection's stated extent/bbox exactly as before —
confirming the fact wasn't lost app-wide, only its redundant second copy.

## 65. The map's initial "fit everything" never actually fired — a ref marked itself done before checking there was anything to fit

Reported directly: "Time&Space的地图其实没有fly to功能，或者现在非常不智能。
不管是我选中了一个结点，还是选择了之后，选中别的，然后再选择，都没办法很好地
fly to，定位到比较好的位置去，导致用户其实不知道地图上有没有显示，在哪里，因
为常常范围是小的" (the Time & Space map effectively has no working fly-to,
or it's very unintelligent — selecting a node, or reselecting different
things afterward, never lands on a good position, so I can't tell whether
or where anything is shown, since the extent is often small).

Checked both mechanisms `ItemsMap.tsx` has for this rather than assuming
which one was broken. The per-*Item* `flyToBounds` effect (triggered by
`highlightHref`) turned out to already work correctly — verified directly
by clicking two genuinely distant Items in sequence (Malta, then a site in
the Brazilian Amazon) and confirming the map really flew to each one's own
bbox, at a sensible zoom, both times. The *other* mechanism — fitting the
whole currently-loaded batch into view once a box first opens, before any
one Item is picked — was the real, reproducible bug: opening any
Collection's box and waiting (items visibly loaded, real footprints
drawn, real dates in the timeline) left the map stuck at its literal
initial `[0,0]`/zoom-2 view, confirmed by reading the real map's center/
zoom directly (not just a screenshot) and separately by checking the
actual OpenStreetMap tile requests the browser made — all at zoom 2, none
past the initial load.

Root cause: `lastFitTargetRef.current = fitKey` was set *before* checking
whether `itemsWithBbox` had anything in it yet:

```
if (lastFitTargetRef.current === fitKey) return
lastFitTargetRef.current = fitKey        // marked "done" here...
const boundsList = itemsWithBbox.map(...)
if (boundsList.length === 0) return      // ...even though nothing was fit
```

`fitKey` (a Collection's own href) is available the instant a box opens —
well before `useItemSet()`'s own async fetch resolves any Items. The
effect's very first run, with `itemsWithBbox` still empty, hit that early
return, but had *already* poisoned the guard for this `fitKey`. The effect
does depend on `itemsWithBbox` and does re-run once Items actually arrive
— but by then `lastFitTargetRef.current === fitKey` was already true, so
every subsequent, real opportunity to fit was silently skipped, forever,
for that Collection. Fixed by moving the ref-write to *after* confirming
there's a real, non-empty `bounds` to fit — the effect now keeps retrying
across the async load instead of giving up on the first, empty attempt,
while still fitting only once per `fitKey` after that (so it doesn't fight
a manual pan/zoom the way the original comment already intended).

Verified against two very different fixtures, deliberately, rather than
declaring victory on one screenshot: Earth Search's Sentinel-2 Collection
(this session's running example) turned out to be a poor test of the fix's
*visible* effect — reading the map's real center confirmed the fit now
does run (center measurably shifted off `[0,0]`), but this Collection's
default browse order returns Items scattered across the entire globe (a
Malta scene followed by an Amazon scene, back to back), so "fit to
everything currently loaded" is legitimately close to a world view
regardless — a property of this fixture's own data order, not a bug.
Adaptation Atlas's regionally-scoped "Population 2020" Collection (Africa-
wide coverage, 2 Items) made the fix's actual value obvious: opening its
box now correctly frames the continent-scale extent immediately, and
clicking either Item flies in further to that Item's own bbox — both the
box's own map and Inspector's separate map (same `ItemsMap` component,
different caller) confirmed showing a sensibly-fit view, not a stuck
world view or an empty ocean.

## 66. The tree recentered on every Collection click, even ones already on screen — and the Item Set box now always paints on top, by construction

Two related complaints about exploring Structure Lens, reported together:
"每次选中了collection对象之后tree view也还会调整视野，我感觉这种移动视野会影响
我的操作和探索的连续性啊，这难道不是历史遗留问题么？然后items panel在有的
collection 点之前 在有的之后，难道不应该永远在最上面么？" (every time I select
a Collection the tree view still adjusts, disrupting the continuity of my
browsing — isn't this legacy behavior? And the Items panel ends up in
front of some Collection dots, behind others — shouldn't it always be on
top?).

**Auto-recenter fired unconditionally, not just for genuinely off-screen
selections.** The pan-to-selection effect's own comment already named its
real purpose: bringing a selection *panned far outside the current view*
(arriving from Time/Space Lens, or not yet expanded into view) back on
screen. But the implementation never actually checked whether the target
was already visible — it recentered on every distinct `panHref`,
including nodes the user had just clicked directly because they could
already see them. Confirmed live, not just by reading the code: clicking
three already-visible sibling Collections in a row shifted the tree's own
`transform` attribute every single time (`translate(-180, 727.5)` →
`689.5` → `575.5` → `499.5`), even though all three stayed on screen the
entire time. Fixed by projecting the target's *current* screen position
(using the transform as it stood *before* any change) and skipping the
pan entirely when it already falls within the viewport, minus a
`VISIBILITY_MARGIN` of 100px on each side. Verified both directions didn't
regress: the same three-click sequence now leaves the transform completely
unchanged, while a genuinely off-screen selection (simulated by manually
dragging the canvas far away, then selecting a node that had scrolled out
of view) still correctly pans it back into frame.

**The Item Set box's left/right side wasn't actually the complaint — its
paint order was.** Traced `labelOnLeft = hasRenderedChildren && !isRoot`
first (the mechanism that flips which side a node's label, and therefore
its box, renders on) as a candidate explanation, but asked before
assuming: the user's own "永远在最上面" (always on top) pointed at z-order,
not left/right placement. SVG paints in strict document order with no
z-index-like override available for plain elements — the box, rendered
inline as part of its own owning node's `<g>` (itself just one entry in
`nodes.map(...)`), painted above or below other nodes/links purely by
coincidence of where that node fell in traversal order relative to
whatever visually overlapped it, with nothing guaranteeing "the box the
user is actively interacting with is always the foreground element."

Fixed by portaling the currently-open box into a dedicated `<g>` rendered
*last* inside the same zoomed/panned canvas group (a `boxLayer` state, set
via callback ref rather than a plain ref — the same class of fix as
`useElementSize`, §44, since a plain ref wouldn't be attached yet on the
very render that needs to check it) — confirmed structurally, not just
visually, via `parentElement.lastElementChild === parentG`, guaranteeing
by SVG's own document-order painting rule (not incidental layout) that the
open box always renders above every ordinary node and link, regardless of
where its owning node falls in the tree's traversal order. The portaled
`<g>` reproduces the same `translate(y, x)` its owning node's own `<g>`
already applied, so its internal coordinate math (the connector line, the
`foreignObject`'s x/y) needed no changes at all.

One real, necessary follow-on fix this required: §62's hover-tooltip-
bubbling guard (`isInsideItemSetBox`) used a manual ancestor walk bounded
at the node's own `<g>` — which assumed the box was still a *DOM*
descendant of that `<g>`, no longer true once portaled elsewhere in the
document. React's own synthetic event bubbling is portal-transparent (an
event from inside a portal still bubbles to its *React*-tree ancestors,
regardless of real DOM position) — so the ancestor node's own
`onMouseEnter`/`onMouseMove` would still fire exactly as before, but the
walk meant to detect and suppress that would now silently fail (never
finding `itemSetBoxRef` between the event target and the node's `<g>`,
since it no longer sits between them in the real DOM), reopening the
exact bug §62 had just fixed. Replaced the walk with a direct
`itemSetBoxRef.current?.contains(target)` check — correct regardless of
where in the DOM the box actually renders, since `.contains()` asks "is
this a descendant of this *specific* element" rather than searching
upward through a class of elements the way the earlier, since-abandoned
`.closest('[data-block-pan]')` bugs (§61) did. Verified together in one
run: hovering a timeline mark still shows exactly one correct tooltip
(no stuck/duplicate ancestor tooltip), drag-pan and wheel-zoom inside the
timeline still work, and the box's own drag/resize handles are all still
present and functional — confirming the portal didn't quietly break any
of the interaction fixes built in §61/§62.

## 67. The Legend moves to the bottom-left corner

Asked directly: "图例应该放在左下角，不影响重要的信息呈现" (the legend should
sit in the bottom-left corner, so it doesn't get in the way of important
content). Moved both the expanded panel and its collapsed "show legend"
button from `top: 10, right: 10` to `bottom: 10, left: 10`. Top-left was
already claimed by the "Collapse to top level"/"Expand all catalogs"
buttons; bottom-left had nothing else anchored there. Top-right — where it
used to sit — is also where the tree's own nodes fan out toward and where
an open Item Set box (§66, now guaranteed to paint above everything) is
likely to end up, so moving off that corner has real, not just cosmetic,
value. Verified live via screenshot.

## 68. Item Set's static-catalog and API-backed UI/UX split into two genuinely different panels

Asked directly, grounded in STAC's own two design philosophies: "按照stac的
设计，其实static catalog和api就是两种不同的方式和不同的设计哲学...Pagination逻辑
只存在在static catalog中，那我们就在这种类型的时候支持完整的Pagination UI/UX，
而API的话我们就用别的，纯粹基于搜索，检索，排序的方式就可以" (static catalogs
and APIs are two different design philosophies — pagination logic only
makes sense for static catalogs, so give that mode real pagination UI/UX,
and give API mode something else entirely: pure search/retrieval/sort).
This directly resolves §58's own long-deferred bullet (real page-based
pagination + a dedicated bbox/datetime API query module, both explicitly
parked pending design details) — not new scope invented from nothing.

Research first (per this project's own "research before design" norm):
official `stac-browser` genuinely does the same split already — its
`Items.vue`/`Pagination.vue` show numbered-page controls with `rel:next/
prev/first/last` link buttons only for an API source, and a plain "show
more" chunk-reveal button otherwise; no search/sort/filter UI exists for a
static source at all in that codebase either. Confirmed live against real
STAC APIs (not assumed): Earth Search and Microsoft Planetary Computer's
own `/items` endpoints both accept `datetime=<start>/<end>`, `bbox=w,s,e,n`,
and `sortby=-properties.datetime` as plain GET query params, verified with
direct `curl` requests before writing any code against them.

**`ItemSetBrowser.tsx` is now a thin dispatcher** on `node.items.kind`,
rendering one of two components that share almost nothing beyond a row
renderer and the `ItemsTimeline`/`ItemsMap` embedding:

- **`LinksItemSetBrowser`** (static catalogs) — the id/title text search
  box is gone entirely: "在static catalog中的搜索几乎是没有意义的，按照ID或者
  名字搜索，没有人能够做到" (searching a static catalog by id/name is close
  to useless — nobody using this system would already know the id). In its
  place, `useLinksPagedItemSet` (replacing half of the old, deleted
  `useItemSet.ts`) does real page-based browsing: `hrefs.length` is always
  known exactly up front, so `totalPages` is exact, not estimated, and a
  page-number jump box, page-size select, and Prev/Next all work like a
  genuine paginated browser rather than infinite scroll. Each page's Items
  are fetched (one request per href, same as before — static catalogs have
  no batch-fetch endpoint) only the first time that page is visited; a
  local page cache means revisiting an already-seen page is instant, no
  spinner. **List and Time & Space share the exact same page's data** — a
  direct user choice (offered as an alternative to giving Time & Space its
  own independent full-collection load) — so paging changes what both tabs
  show together, keeping the panel's state single and simple rather than
  two half-independent views of the same Collection.
- **`CursorItemSetBrowser`** (API-backed Collections) — same id/title
  search box removed, replaced with a real, **locally-scoped** query panel:
  a datetime range (two `<input type="date">`, converted to a full RFC3339
  interval on submit — `date` alone fails STAC's own validation, confirmed
  directly against Earth Search returning "does not match RFC3339 format"),
  a sort direction select, and a "draw a bbox on this panel's own map"
  toggle. This is **not** a revival of the interactive draw-tool §39
  deleted wholesale (a *global* store shared with Inspector's own Space/
  Time Lens) — it's the differently-scoped module §58/§75 explicitly kept
  open: state lives as plain `useState` inside `CursorItemSetBrowser`
  itself, nothing global, and Inspector's own Lenses stay untouched, pure
  visualization, exactly as §39 left them. No numbered pagination here at
  all — a STAC API's Item Search only ever exposes an opaque `rel:next`
  cursor, never a numeric offset, so "jump to page 10" is categorically
  impossible against a live API; the existing scroll/"Load more"/"Load all
  remaining" mechanics are kept, just now firing against a filtered+sorted
  endpoint instead of an always-unfiltered one. A query only takes effect
  on an explicit "Search" click (matching the deleted tool's own original
  reasoning: refiring on every keystroke/mousemove would be wasteful), with
  a "Clear filters" reset and a "filtered: ..." summary line so the
  `showing N of M` count is legible as *this query's* match count, not the
  whole Collection's.

**New data-model plumbing** (`src/stac/types.ts`, `src/stac/graph.ts`):
`StacNode` gained `declaredConformsTo?: string[]` — `raw.conformsTo` used
to be read once inside `detectSourceKind` and discarded; it's now retained,
since gating the new Sort control correctly needs it. Per spec,
`conformsTo` is only ever declared on an API's own landing page, never
repeated on a nested Collection reached by browsing — so a new file,
`src/stac/conformance.ts` (`resolveApiConformance`), walks a node's
`declaredRootHref` via the shared `loader` cache to find its *governing*
root's copy, and `useApiConformance.ts` wraps that reactively (synchronous
in the normal top-down browse case, since the root is always already
cached by then; genuinely async only for a deep link straight to a nested
node). `supportsSort()` checks a node's resolved `conformsTo` against the
known Sort-extension conformance URIs (both v1.0.0/v1.1.0, `item-search`
and `ogcapi-features` variants) — the Sort *select* control is omitted
entirely, not just disabled, when unsupported, so no param is ever sent
that a server might reject or silently ignore. (In practice this rarely
hides anything: every real API fixture checked — Earth Search, Microsoft
Planetary Computer, USGS LandsatLook, GeoBON, Canada's Datacube — already
declares Sort; both major server implementations, `stac-fastapi` and
`stac-server`, bundle it by default. Scoped deliberately narrow for this
pass regardless: sort is offered on `properties.datetime` only, no
arbitrary-field sort UI — CQL2 property filtering stays on the deferred
list below.)

**`src/stac/apiSearch.ts`**: `fetchSearchPage` gained an optional `filter:
SearchFilter` (`bbox`/`datetimeStart`/`datetimeEnd`/`sortDirection`),
applied only when building a *fresh* request (`!nextHref`) — a followed
`rel:next` link already encodes whatever produced it server-side, and the
spec leaves that link's own shape entirely up to the implementation, so
re-appending filter params on top of it would be redundant at best.

**`useItemSet.ts` is deleted outright**, split into `useLinksPagedItemSet.ts`
and `useCursorQueriedItemSet.ts` — confirmed via `grep` to have exactly one
caller before removing it. The two modes' state shapes are different types
now (an indexed page cache + page index vs. an ever-growing array + opaque
cursor + query object), not just different branches of shared fields, so a
real split reads more honestly than one hook with two internal branches.

**`ItemsMap.tsx`** gained `appliedBbox`/`drawMode`/`onBboxDrawn` — the
bbox-draw gesture reuses the exact hand-rolled mousedown/mousemove/mouseup
pattern from the deleted `SpaceLens.tsx` draw tool (`git show
b266a59^:src/components/SpaceLens.tsx` is the reference: `map.dragging.
disable()` for the gesture's duration is what actually lets a drag-to-draw
coexist with Leaflet's own drag-to-pan on the same map — no other
mechanism found works). `appliedBbox` renders as its own bold dashed
overlay, deliberately not reusing `statedBbox`'s fainter rendering path —
the two are semantically different (a source's own declared extent vs. a
user's active filter) and a Collection can have both at once.
**A real bug found and fixed during Playwright verification**: both the
drawn preview rectangle and the persistent applied-bbox overlay must be
created with `interactive: false` — an interactive Leaflet vector layer
sitting under the cursor is a plausible way for it to swallow a mouse
event before it reaches the map's own listener, and this is standard
practice for a pure visual overlay regardless. (First suspected as *the*
cause of a real observed failure in this feature's own testing — dragging
a full rectangle producing no bbox at all — but isolating it properly
showed the actual cause that time was the test script's own drag endpoint
landing outside the browser viewport entirely, a test-script bug, not an
app bug; `interactive: false` was kept anyway as independently-correct
practice, not because it was proven to be the fix for that specific
failure. Worth recording so a future reader doesn't take the in-code
comment's original, stronger claim at face value — it was corrected once
following its own reasoning through to the end.) A second, real, actually-
confirmed bug from the same testing pass: `onBboxDrawn` was a fresh closure
on every render of `CursorItemSetBrowser` (itself re-rendering on every
scroll-triggered background `loadMore`), which is one of the draw-mode
effect's own dependencies — an unmemoized callback there tears the effect
down and rebuilds it (detaching/reattaching the map's native listeners) on
any parent re-render, a real risk during a drag gesture; wrapped in
`useCallback` with an empty dependency array, since it only closes over
stable `useState` setters.

**`ItemsTimeline.tsx`** gained one new, purely presentational prop,
`appliedRange`, drawing a low-opacity background band for the currently-
applied datetime filter. **Deliberately no drag-to-select-range gesture
was added** — datetime filtering is two plain `<input type="date">` fields
in the query panel instead. Reasoning, not just a preference: this
component's existing pan/zoom drag already needed a real fix earlier this
project (an unscoped `.closest('[data-block-pan]')` walk matching an
unrelated ancestor, §61) — adding a second, semantically different drag
gesture (range-select) to the same canvas would need the two to agree on
`mousedown` precedence every time, a combinatorially worse version of a
bug class already paid for once. The deleted `TimeLens.tsx`'s old range-
select drag (real prior art, checked directly via `git show`) is not
actually a usable precedent for *combining* the two — it predates pan/zoom
existing in this component at all, so there is no historical case of both
gestures coexisting to learn from. Two native date inputs touch none of
`svgRef`/`data-block-pan`/window listeners and are trivially testable
(`page.fill`, no synthetic drag-coordinate math).

**Verification**: every piece checked live — `curl` against real Earth
Search endpoints before writing the query-param code (not assumed);
Playwright against a real static catalog (Adaptation Atlas's "Annual
Hazard Timeseries," 100 items → exactly 3 pages at the default page size)
confirmed page jump/prev/next/page-size, instant revisits to a cached
page, and List/Time & Space staying in sync; Playwright against Earth
Search's `sentinel-2-l2a` confirmed the Sort control's presence (real
conformance detected), a real filtered+sorted request firing with the
exact expected query string, the match count and result ordering changing
correctly, and Clear Filters reverting to the unfiltered default; the bbox
draw gesture was verified by literally dragging the mouse across the
embedded Leaflet map and confirming the resulting bbox query param and the
overlay rendering, not by calling Leaflet's API directly (this project's
own established "a render-pipeline test is not a gesture test" lesson,
§61) — the first several attempts at this specific check failed for a
mundane reason (the drag endpoint fell outside the test's own viewport
height), a useful reminder that a failing gesture test is not automatically
evidence of an app bug until the test itself is confirmed correct.

## 69. Static-catalog pagination gets numbered page buttons, not a jump-to-page input; form controls fixed for dark mode

Two issues reported directly right after §68 shipped. First: "我点了数字后面的上下按钮，数字有变化，但是没有加载" (I clicked the spin-button arrows next to the number, the digit changed, but nothing loaded) — the original page-jump control was a plain `<input type="number">` with a `blur`/Enter-only commit handler; a native number input's own spin-button arrows fire `input`/`change` events, not `blur`, so clicking them changed the displayed digit without ever calling `goToPage`. Second, and unprompted by the first: "我更喜欢那种就是有1、2、3。。。23、24、25这种感觉的pagination" (I'd prefer the kind of pagination that feels like 1, 2, 3 ... 23, 24, 25).

Replaced the input entirely with a classic MUI-style numbered page list (`buildPageList` in `ItemSetBrowser.tsx`): always page 1, the last page, and a small window around the current page, collapsing everything else behind a single ellipsis on each side once the total exceeds what fits — every page is a direct click, no intermediate typed/committed state to get out of sync with. Verified the exact edge cases (`current=1`, `current=total`, a window straddling both ellipses, and small totals with no ellipsis needed at all) match the expected `[1,2,3,4,5,…,25]` / `[1,…,21,22,23,24,25]` / `[1,…,12,13,14,…,25]` shapes before wiring it into the UI.

Separately: "dropdown的按钮底是白色，难道不应该是深色主题么" (the dropdown's background is white — shouldn't it be dark-themed?) — the new page-size `<select>` and the API query panel's date inputs/sort `<select>` never set their own `background`/`color`, so native form controls rendered with the browser's own light-mode default regardless of this app's actual theme. Fixed with a shared `formControlStyle` (`background: var(--color-bg)`, `color: var(--color-text)`, plus `colorScheme: 'light dark'` so the browser's own chrome around them — a date input's calendar popup, a select's dropdown arrow — also renders dark, not just the control's own flat background). Verified with Playwright's `colorScheme: 'dark'` emulation: the select's computed background resolved to the same `rgb(28, 26, 23)` as `--color-bg`'s dark value.

## 70. Already-loaded pages stay visible, dimmed, when paging through a static catalog

Asked directly, for both halves of the Time & Space view together: "如果可以，已经加载过的page的数据就留在地图上，可以不以当前页为最highlight，但是可以也以某种方式留下来，timeline和地图都一样，比如说灰色的之类的，但是需要能够被看见" (if possible, keep already-loaded pages' data on the map — it doesn't have to be as highlighted as the current page, but it should stay visible somehow, same for the timeline, grayed out but genuinely visible).

`useLinksPagedItemSet` already kept every visited page in a local `pageCache` (for instant back-navigation, §68) — it just never exposed anything but the current page. Added `otherLoadedItems`: every cached page's Items except whichever one is currently rendered, flattened into one array (pages are disjoint slices by construction, so no dedup logic is needed beyond excluding the current page's own entry). Threaded through as a new `dimmedItems` prop on `ItemsMap`/`ItemsTimeline` (API-backed Collections never pass one — infinite-scroll accumulation already puts everything ever loaded into the "active" set itself, so there's no "other pages" concept there):

- **`ItemsMap`**: dimmed footprints draw in the same rebuild pass as the active ones, *before* them so they always sit underneath, in `palette.textFaint` at low fill opacity, with a hover tooltip but no click handler (selecting an Item on a page that isn't displayed would need to also switch pages to make sense — more behavior than was asked for).
- **`ItemsTimeline`**: dimmed and active Items are merged into *one* combined array before grouping/lane-packing, so they share the exact same domain and never visually overlap — only the per-group render color/interactivity differs, decided by whether a group contains at least one *active*-page Item (a group can genuinely mix both, since Adaptation Atlas has real duplicate-timestamp Items that already collapse together regardless of page; any active membership makes the whole group behave as active).

Verified on Adaptation Atlas's "Annual Hazard Timeseries" (100 items, page size 20): after visiting page 3, the timeline showed a gray band (pages 1–2's combined range) alongside two full-color bars for page 3's own groups. The map version was verified by reading the DOM directly rather than trusting the screenshot alone — this particular fixture's Items all share one continent-wide footprint, so the dimmed rectangle is completely covered by the active one drawn on top of it at the exact same position; confirmed both `stroke="#b7b1a4"` (dimmed) and `stroke="#b45309"` (active) genuinely coexist in the rendered SVG even though only one is visible on top for this specific fixture's data shape.

## 71. The drawn bbox was invisible until Search, and drawing once could permanently break every map's drag-to-pan on the page

Two problems reported together after using the API query panel's "Draw area on map": "我绘制search范围的时候，看不见我绘制的区域，当然确实看到了bbox set。然后在结果上我也无法拖拽地图，只能zoom in & out" (when I drew the search area I couldn't see the area I drew, though I did see "bbox set" — and afterward I couldn't drag the map at all, only zoom).

**The invisible area** was a real gap, not a rendering bug: the temporary preview rectangle is removed the instant the drag gesture ends (by design — it's only a live preview), and the *persistent* overlay (`appliedBbox` on `ItemsMap`, §68) was wired to `appliedQuery.bbox`, which stays `undefined` until "Search" is actually clicked — leaving a multi-second gap with zero visual confirmation of what was just drawn, only the small "bbox set" text chip. Fixed by feeding the *draft* bbox into that same overlay prop instead (`appliedBbox={draft.bbox}` in `CursorItemSetBrowser`) — identical value once Search does commit, so nothing visually changes at that transition.

**The permanently-broken dragging** was a genuinely serious bug, confirmed live (not assumed) via a real, repeatable Playwright reproduction rather than reasoning about it in the abstract: drawing a bbox — most reliably right after clicking "Draw area on map" straight from the List tab, which mounts `ItemsMap` for the first time *with `drawMode` already true* — reliably threw `Cannot read properties of null (reading 'offsetWidth')` from deep inside Leaflet's own `Draggable._onDown`/`getSizedParentNode`, and every subsequent drag attempt on *any* Leaflet map on the page (Item Set's own, and Inspector's separate always-visible one) silently did nothing afterward, with no further error.

Root cause, isolated by instrumenting the actual mount/cleanup call order rather than guessing: React's development-mode double-invoke of a component's effects on its first mount does not clean up in the LIFO order it does for a genuine unmount here — the draw-mode effect's own cleanup (which calls `map.dragging.enable()`) can run *after* the base mount effect's cleanup has already called `map.remove()` on that same `map` instance. Calling `Handler.enable()` on an already-removed map still unconditionally re-attaches a real native `mousedown` listener to the container — Leaflet's own `Draggable.enable()` doesn't check whether the map it belongs to is still alive — and that listener's handler then references the removed map's already-torn-down internal panes. The *next* real mousedown anywhere throws inside `getSizedParentNode`, and because `Draggable._dragging` is a **static, page-wide flag** (not one per map instance) that never gets cleared when the handler throws before reaching that step, every drag on every Leaflet map on the page is silently blocked from that point on — until a full page reload, since nothing in the running page's JavaScript ever resets that static field on its own (an already-corrupted tab stays broken even after the underlying code is fixed and hot-reloaded, since HMR swaps module code, not already-executed static state — confirmed directly: the fix alone didn't visibly help until the reporting user did a full refresh).

Fixed by guarding the draw effect's cleanup with `if (mapRef.current === map)` before touching `dragging`/cursor at all — `mapRef.current` is updated by the sibling mount effect, so a mismatch reliably means this exact `map` instance is stale (already removed, or superseded by a newer one), regardless of the exact interleaving order that produced that state. Verified with a repeated stress sequence in one fresh browser session (tab-switch back and forth, draw+search twice in a row, Clear Filters) checking real drag-and-confirm-the-view-moved after every step, plus three independent repeats of the original failing reproduction — all clean, zero page errors, dragging genuinely worked throughout.

## 72. The Item Set box could visually bleed into Inspector's own column — Chrome-only, and the fix needed both a size clamp and a position correction

Reported directly, from a real screenshot: "我在你的Root路下上传了一张截图...我在使用Chrome的时候发现的，但是我在使用Firefox的时候并没有这个框出来" (uploaded a screenshot — this only showed up in Chrome, not Firefox, which is why it wasn't caught before). The screenshot showed what looked like a large rectangular frame enclosing both the selected Collection's label and the whole Item Set box below it.

Root cause: the box (a `foreignObject` portaled into Structure Lens's own zoomed/panned SVG canvas, §66) has no ceiling on its own size or position tied to how much of the Structure Lens column is actually available at the moment it's shown — its default width (640, §59) or a manually-resized width could easily exceed the real column width, especially in a narrower window or after the Structure/Inspector divider was dragged. Structure Lens's own `overflow: hidden` (App.tsx) was assumed to clip that overflow away — confirmed directly, via this report, that this assumption doesn't hold in Chrome: Chrome does not clip a `foreignObject`'s overflowing content against an ancestor HTML element's `overflow: hidden` the same way Firefox does, so the exact same box that Firefox merely (still wrongly) cut off cleanly instead visibly bled into Inspector's own later-painted, opaque column div in Chrome — the "frame" was Inspector's own boundary, painted on top of the overflowed box underneath it.

Two existing mechanisms turned out to already assume this couldn't happen, and both needed real fixes once instrumented directly (reasoning about the geometry alone kept producing fixes that didn't change anything measurable — this needed live values logged and read back, not guessed):

1. The auto-pan-to-selection effect's own "already visible, don't yank the view" check (§66) only ever considered the bare node's position against a flat 100px margin — it had no idea a box was about to open on one side needing several hundred px, so it routinely reported "already visible" and skipped the box-fitting bias entirely, even when the box demonstrably wouldn't fit. Unified the two: when the target has an open box, the margin on the box's own side is the box's real current width (its last manual resize, or the default) instead of the generic 100px — so the "should I even bother re-panning" decision and the "how much room does the box need" decision now agree.
2. Even with that fixed, a long node label alone (`boxNearX` — the box's near edge sits past the label's own *rendered width*, not the bare node position) could already place the box's own left edge most of the way across the column, before its width even entered into it — confirmed directly: a real measured case had the box's near edge at screen x=754 in an 832px-wide column, leaving only 78px, nowhere near even the 320px minimum. A width clamp alone can't fix a box that's already mispositioned before any width is chosen. Added a position correction — reusing the exact same `dxHoriz` offset a manual box-drag already applies (purely for rendering here, never written back to the stored `boxOffsets` map) — that nudges the box just enough to guarantee its minimum width fits, computed *before* the width clamp so the two cooperate instead of the width clamp alone trying (and failing) to compensate for a position that was never going to work.

Verified directly against the reported scenario (the exact Collection from the screenshot, at the same window size) — the box now renders entirely within Structure Lens's own column with zero overlap, confirmed by reading which real DOM element resolves at the "Time & Space" tab's own screen coordinates (previously a large Inspector-owned div; now the button itself) — and against a wide, ordinary-case viewport, confirming the fix is inert (box still renders at its full default 640×760) when there's genuinely enough room and doesn't regress the common case.

## 73. The §72 "frame" diagnosis was wrong — the real cause was a Chrome-only default focus outline, not layout overflow

§72's fix (a size clamp + position correction on the Item Set box) is real and independently worth keeping — it fixed an actual, separately-confirmed case where the box could render wider than Structure Lens's own column. But it turned out **not** to be what the user's original screenshot was actually showing, confirmed once the user looked more closely at the screenshot themselves and described it precisely: "这个框正好是一个G标签的范围...选择的那个蓝色的collection节点，作为这个框的左上角，右下角是Panel的右下角的那个框" (the frame exactly matches a `<g>` tag's bounds — the selected Collection node is its top-left corner, the Panel's own bottom-right is its bottom-right).

Reproduced and confirmed directly this time, not reasoned about abstractly (the exact mistake made in §72 — two rounds of plausible-sounding geometry fixes that changed measured values but never the reported symptom, until the actual live `document.activeElement` was read): clicking a plain `onClick` `<div>` inside the box's `foreignObject` (a List row — anything that isn't itself natively focusable, unlike a `<button>`/`<input>`) makes Chrome's click-to-focus algorithm fall back to focusing the nearest SVG ancestor, since the actual click target can't take focus itself. That ancestor is the dedicated `boxLayer` `<g>` (§66 — the layer every open Item Set box portals into, to always paint on top) — Chrome draws its own default browser focus ring around it (`outlineStyle: 'auto'`), exactly matching the reported rectangle's corners. Firefox does not fall back to focusing anything for the same click on `foreignObject`-embedded content, which is why it never showed there. Fixed with a plain `style={{ outline: 'none' }}` on that `<g>` — verified by re-reading `document.activeElement`'s own computed `outlineStyle` after the same click (now `'none'`) and by screenshotting the same click that previously showed the frame.

Lesson worth keeping alongside [[feedback-verify-in-browser]]: when a fix changes *some* measured value but the user says the reported symptom is unchanged, that's a signal the diagnosis itself is wrong, not that the fix needs another round of tuning — the right move is to go back to first evidence (here, `document.activeElement`) rather than refine a theory that was never confirmed against the actual browser state to begin with.

## 74. Inspector's divider gets pointer-capture dragging and a collapse/expand button; fixed a page-wide scrollbar the new button introduced

The drag-to-resize/collapse handle (§45) had a real, separately-discovered bug: it attached `mousemove`/`mouseup` to `window`, which never fires if the pointer leaves the browser window before release (a fast drag, or collapsing all the way to the edge) or if something the drag passes over — Leaflet's own map dragging — calls `stopPropagation()` on the underlying event first, so it never reaches `window` at all. Either way the stale listener pair stayed attached forever, permanently hijacking every later mouse movement anywhere on the page back toward the frozen drag's own stale `startX`/`startWidth`, looking like the handle was stuck. Fixed (by another agent, working from the user's own direction, reviewed and confirmed sound here before committing) by switching to Pointer Events with `setPointerCapture` on the handle itself — once captured, the browser guarantees `pointerup`/`pointercancel` reach that exact element regardless of where the pointer ends up, closing the gap at the source rather than working around it.

The same pass added a small, always-present chevron button centered on the divider, since a fully-collapsed 8px-wide (`HANDLE_WIDTH`) divider sliver at the very edge of the window is a genuinely difficult drag target to grab again once collapsed — a plain click-driven affordance, independent of drag geometry, layered on the same handle (double-click still works too).

That button is deliberately larger (22px) than the 8px handle it's centered on, for a comfortable click target — which introduced a new, real bug: "当我点了那个按钮以后...导致我在Chrome里面右侧和底部都出现了滚动条...这个滚动条的部分在这个Firefox浏览器里面也出现了" (after clicking that button, scrollbars showed up on the right and bottom in Chrome — and the same thing showed up in Firefox too). Confirmed directly: the button overflows ~7px past the divider on each side by design, and once the divider collapses to the far right edge of the window, that overflow bleeds straight past `body`/`html` — neither clips by default — growing a real page-level horizontal scrollbar (measured directly: `document.documentElement.scrollWidth` 1307 against a 1300px `clientWidth`, before any fix). Fixed at the actual root — not by shrinking the button or otherwise compromising the click target — by adding `overflow: 'hidden'` to the app's own top-level container: this is a fixed-viewport app end to end (Structure Lens's own canvas and Inspector's own column already manage all their own internal scrolling), so the *page* itself should never need to scroll regardless of what any single descendant does. Verified directly: `scrollWidth`/`clientWidth` and `scrollHeight`/`clientHeight` match exactly before and after collapsing Inspector via the new button (no overflow in either axis), and a full regression pass (collapse via button, expand via button, manual drag-resize) confirmed none of those interactions broke from adding the clip.

## 76. A long, unbroken href pushed Inspector's own content off-screen — Chrome-only again, plus an unrelated scroll bug it exposed

Reported directly, with a real repro Item: "当一个inspector,它上面的这一个可能是它的UI会特别特别长的时候,它会把整个右侧的panel挤出画面,然后使得底部出来一个这个slider...当然这个也只发生在Chrome里面" (when Inspector's content is especially long, it pushes the whole right panel out of view and a scrollbar shows up at the bottom — Chrome-only again, confirmed against the same Item in Firefox).

Root cause: `DetailPanel.tsx` rendered a node's own canonical `href` (and the Containment block's declared collection/parent hrefs) as plain, unstyled text — for a normal-length URL this wraps fine under default text flow, but a real, deep Capella S3 path with no spaces has no *reliable* break point either: Chrome and Firefox disagree on which punctuation (`/`, `-`) counts as a normal line-break opportunity for an unbroken run of characters this long, so the identical markup happened to wrap in Firefox and render as one solid overflowing line in Chrome — forcing Inspector's own column wider than its assigned width. Fixed with `overflowWrap: 'break-word'` on Inspector's shared Human-tab wrapper (one place, covering the current known offenders and any future field that renders a long real-world string) rather than patching each field individually; the JSON tab's own `<pre>` doesn't need it, since it already manages its own overflow explicitly.

A second, genuinely unrelated bug surfaced while verifying this fix, not by reasoning about it — measuring the actual scroll state (as [[feedback-verify-in-browser]] keeps proving necessary) found Inspector's own scroll container sitting at `scrollTop: 105` on a fresh page load, which is what was actually pushing the breadcrumb out of view vertically, on top of the horizontal issue above. Traced to `ItemsTimeline.tsx`'s own "bring the selected row into view" effect (used by both Inspector's inline Temporal widget and Item Set's batch view) calling `scrollIntoView({block:'center'})` unconditionally: that call has no way to target only its own local scroll container — it walks *every* scrollable ancestor between the element and the viewport — so for Inspector's single-object case (exactly one row, already sitting in its natural, already-visible position) it was also scrolling Inspector's entire outer column to "center" a tiny SVG mark that never needed centering at all, and did so more disruptively here simply because the now-taller wrapped breadcrumb pushed the Temporal section further down, requiring a bigger corrective scroll to (uselessly) center it. First suspected as a browser scroll-anchoring side effect (a plausible, but wrong, theory — disabling `overflow-anchor` on the container changed nothing, confirmed directly before accepting the theory). Fixed with a new `scrollSelectedIntoView` prop on `ItemsTimeline`, off by default, turned on only by `ItemSetBrowser.tsx` where the behavior is actually wanted (surfacing which row is selected among many) — Inspector's own `TimeLens.tsx` never sets it.

Verified directly: the breadcrumb span's own computed `overflowWrap` reads `break-word` and its rendered width now matches Inspector's own column instead of overflowing it; the scroll container's `scrollTop` reads `0` on the same fresh load that previously showed `105`; and `document.documentElement`'s `scrollWidth`/`scrollHeight` matched `clientWidth`/`clientHeight` throughout, confirming no page-level overflow at any point (the App-level `overflow: hidden` from §74 already covered that layer; this section is entirely about overflow one level deeper, inside Inspector's own column).

## 77. Item Set's static/API split (§68) grows a shared results panel, and an applied API search now round-trips through the shareable URL

Two ideas the user worked out independently, then asked to build together in one pass: "静态目录的那套UI的Panel,它是一种对于结果的呈现...而API...搜索之后总有结果,那这个结果就可以用这个Items Panel Static Catalog的那套UI去呈现" (the static-catalog panel is fundamentally just a *results presentation*; once an API search has produced a result, that same presentation UI can show it too) — and, separately, "如果这一份搜索的结果是基于API的,那么我们也恰恰可以把这一份的这个搜索作为URL的一部分写进去...下一个人在拿到这个URL的时候...再执行一遍" (an applied API search should be writable into the URL, so opening the same link replays it). Confirmed explicitly ("两件事一起做") to plan and build as one combined change rather than two.

**Results/search split.** `ItemSetBrowser.tsx` (§68) shrank to the dispatcher plus genuinely shared bits (`ItemRow`, `TimeSpaceView`, `TabBar`, `ApiBadge`, the pager style helpers, `buildPageList`). Two new files carry the presentation: `ItemSetResultsPanel.tsx` is the numbered-page results UI both modes now render — List/Time & Space tabs, Prev/page-numbers/Next, page-size select, a footer summary — and `ItemSetSearchPanel.tsx` is API mode's own query controls (date range, sort, draw-bbox, Search/Clear), stacked above the results panel rather than beside it (matches the app's existing top-to-bottom arrangement; a side-by-side layout would need to solve responsive width-splitting between two very differently-sized panels for no stated benefit). `LinksItemSetBrowser.tsx` and `CursorItemSetBrowser.tsx` are now each their own thin file, mapping their respective hook's state onto `ItemSetResultsPanel`'s shared prop shape.

The real design problem was reconciling links-mode's true random-access paging (the full href array is known up front) with cursor-mode's forward-only opaque `rel:next` cursor — a STAC API genuinely cannot be asked for "page 7" directly. New hook `usePagedCursorResults.ts` wraps `useCursorQueriedItemSet`'s append-only buffer with client-side page slicing: a page already covered by the buffer is a pure synchronous slice (instant), while a page beyond it triggers a "catch-up" effect that calls the underlying hook's own `loadMore()` until the target page is covered, surfacing as `loadingPage`/`loadingPageLabel` ("Fetching more results…") meanwhile. `totalPages` has three regimes, verified against two real, differently-behaved APIs: Earth Search reports `context.matched` up front, so the total is exact immediately ("page 1 of 680 — 27187 items total", confirmed against a real filtered search); Microsoft Planetary Computer reports no total at all, so until the buffer is exhausted the UI shows a `totalPagesIsLowerBound` state ("page 1 of 7+ — 250+ items total", confirmed directly) with Next left enabled past the apparent last page specifically so clicking it can trigger catch-up into genuinely new territory.

**Search persisted in the URL.** The existing shareable-hash scheme (§-many) stored exactly one raw, unescaped href, on the stated premise that "there's only ever this one value." A new module, `stac/searchQueryUrl.ts`, appends a second, `URLSearchParams`-encoded value when a query is applied: `#<href>?<query>`, split on the *last* literal `?` (safe because our own appended suffix, being `URLSearchParams`-produced, always percent-encodes any literal `?` inside a value — so a `?` the href itself owns, if any, always sits strictly earlier). The query's own param names/formats (`datetime`, `bbox`, `sortby`) are pulled from a newly-exported `filterToParams` in `apiSearch.ts` — the exact function that builds the real request — rather than invented separately, so the URL is a byte-for-byte mirror of what actually gets fetched (confirmed directly: capturing the real network request off a freshly-opened shared link showed the identical `datetime`/`sortby` params on the very first fetch, with no unfiltered flash beforehand).

The applied query needed a home reachable from both the Item Set panel and `App.tsx`'s URL-sync logic, correctly scoped to *which* Collection it belongs to — extended `store/itemSet.ts` (already the single owner of "what's loaded/visible for the currently-open Item Set box," keyed by `forHref`) rather than a new store. This surfaced one real bug worth a fix of its own: `setVisible` needed to clear `appliedQuery` whenever `forHref` actually changes, or a stale API query would survive a switch to an unrelated static Collection and leak into its URL — confirmed as a genuine risk, then confirmed fixed (switching from a filtered API Collection to a static one now produces a clean hash with no stray query string). `useCursorQueriedItemSet` gained one new optional `initialQuery` param, seeded into both the `appliedQuery` state and the ref the very first fetch reads, so a restored query's first request is already filtered rather than firing once unfiltered and once filtered.

Verified end to end, including the parts easy to get wrong silently: pasting a captured shared-search URL into a fresh tab reproduces the same result count and page, with the date/sort draft controls visibly pre-filled (via a new `queryToDraft`, the inverse of the existing `draftToFilter`) rather than just the results matching by coincidence; and — since `usePopStateSync`'s handler shares the exact same `resolveHashTarget` parsing as the mount-time bootstrap, but is a genuinely different code path — a real in-document Back-button press (not a page reload: an in-app "return to landing" click first, to create an actual `pushState` entry, then a real browser Back) was confirmed to correctly re-decode the query and re-populate both the draft controls and the "filtered: …" summary through `popstate`, not just through initial mount.

Deliberately not persisted, per the user's own stated scope: which page a *static* catalog was on (static browsing is deterministic per href, not "a search"), and which tab (List vs. Time & Space) or bbox-draw-mode toggle was active.

## 78. §77's Results panel auto-loaded an unfiltered first page — API mode is meant to be search-first, with nothing shown until a real search runs

Corrected directly, twice, after §77 shipped. First: "我觉得我的解释还是不够充分...你想象一下,结果很可能还是有上千个...是不是这个把API的那种UI,它就是查询,查询的结果以后还用这个我们现有的这种方式去...跟静态目录一样的方式去展现" — reaffirming §77's own core premise (a query's results get paged the same way a static catalog's do), but making explicit what §77 had missed: before any search runs, there should be nothing to page through at all, not an unfiltered default load standing in for "no query yet."

`useCursorQueriedItemSet`'s own mount effect had always fired `loadMore()` unconditionally, a holdover from before §77 gave cursor mode numbered pages — reasonable when the box was just an infinite-scroll list of "whatever's there by default," wrong once the box is explicitly framed as a search producing a result. Fixed by adding a `hasSearched` flag alongside `appliedQuery`, folded into a new `'idle'` member of `CursorItemSetState['status']` (alongside the existing `'loading'`/`'ready'`) — `idle` means "no search has ever run, don't fetch anything, don't show a pager." A restored `initialQuery` from a shareable URL (§77 again) counts as `hasSearched` immediately, since replaying a real prior search is not "no search yet." `usePagedCursorResults`'s own catch-up/exhaustion-clamp effects both gained an explicit `idle` skip, since `hasMore` (derived from `!exhaustedRef.current`, `false` at mount) would otherwise misread "haven't searched" as "more to fetch" and fire a request nobody asked for. `ItemSetResultsPanel` renders a plain "Set your search filters above and click Search to see results" message in place of the pager/list entirely while `idle` — links mode never sees this state (it never passes `idle` at all, its data is always known up front). One real UX corner this touches: with no unfiltered load to compare against, `draftFilter === appliedQuery` (both `{}`) is true the very first time, which would otherwise leave the Search button permanently disabled with no way to ever trigger a first search — fixed by making any explicit click before `status !== 'idle'` unconditionally enabled, filters set or not.

Verified directly against Earth Search: zero network requests to `/items` fire between opening the box and clicking Search (captured via Playwright's own request listener, not inferred from the UI); the idle message renders in the Results area with the Search box still fully usable above it; a real search still lands correctly afterward.

## 79. §77's "search feeds results" framing needed two literally separate `foreignObject`s, not two `<div>`s inside one — a real node-editor-style pair of independently draggable/resizable boxes

§77 built the Search/Results split as two visually-distinct cards stacked inside the same single box (`PanelSection` framing, one `foreignObject`). Corrected directly, precisely: "我指的不只是一个foreignObject object中有两个div(block)...我指的是有纯粹的两个独立的foreignObject,一个是Search,一个是result...想象一下,一个节点编辑器,它数据进入一个panel,那是一个API的search,search完了以后,这个又一个结果出来" (I don't mean two divs inside one foreignObject — I mean two literally separate foreignObjects, like a node editor: data flows into a Search panel, and the result comes out as a second, separate thing). Confirmed via three follow-up questions before implementing: yes to a connecting line between the two boxes (reinforcing the same "output feeds the next stage" reading a tree node's own connector to its box already has); yes to both boxes being independently draggable *and* resizable, not just one; static catalogs keep exactly one box, unchanged.

This is a materially bigger change than §77's own version — `StructureTree.tsx` previously modeled "the currently-open Item Set box" as exactly one `{offset, size}` pair per node (`boxOffsets`/`boxSizes`, one drag handle, one resize handle, one `foreignObject`). A cursor-mode node now gets two complete, independent copies of that same geometry — `searchBoxOffsets`/`searchBoxSizes`/`resultsBoxOffsets`/`resultsBoxSizes`, each following the exact same Map-keyed-by-href pattern the original single box used, so revisiting a Collection later in the session still remembers where both its boxes were left, exactly as before for the single-box case. The single-box drag/resize wiring was extracted into a reusable `useBoxDragHandles` hook specifically so the two-box case could reuse it verbatim rather than duplicating it — the static-catalog path calls the exact same hook it always did, just now sharing the implementation with cursor mode's two calls instead of owning a private copy of it. (The position/size edge-clamp math this paragraph originally described, `computeClampedBox`, was itself removed one round later — see §80.)

The connector line between Search and Results is the one genuinely new piece of geometry: drawn from the Search box's own *current* bottom edge (its clamped size + offset, recomputed every render) to the Results box's own current top edge — not from the tree node, and not a static default position — so it stays correct no matter how far either box has been independently dragged, verified directly (dragging the Search box alone moved the line's source point but left the Results box and the line's target point exactly where they were).

The two boxes' actual content — the query controls and the paged results list — still needs to be one coherent piece of state (one search, one result set), so `CursorItemSetBrowser.tsx` was renamed to `CursorItemSetPanels.tsx` and restructured around that: `StructureTree.tsx` renders the two `foreignObject`s itself (each wrapping a plain empty `<div>` target, tracked via the same callback-ref-into-state pattern as `boxLayer`), and `CursorItemSetPanels` — mounted once both targets exist — owns the single `usePagedCursorResults` hook instance and `createPortal`s its Search-controls JSX into one target and its Results-panel JSX into the other. One hook, two physically separate places in the DOM it renders into — not two components each running their own independent copy of the search/results state, which would have desynced the moment either half's local state diverged from the other's.

Verified directly, all three confirmed asks: `document.querySelectorAll('svg foreignObject').length` reads `2` for a cursor-mode node's open box, `1` for a static catalog's (unchanged); dragging the Search box's own handle moved only that `foreignObject`'s rendered position (confirmed via before/after screenshots — the Results box and its own content stayed exactly in place, the connector line updated to follow); resizing the Search box's own corner handle changed only that box's own height (180→274px in one real drag), leaving the Results box's size untouched.

## 80. §79's own box-column clamp removed entirely at the user's explicit direction — replaced by a much lighter default-width-only cap after a real, confirmed regression

Direct follow-up once §79 shipped: "由于我们有两个panel,其实我觉得固定屏幕挺好的...能够拉拉尺寸,然后这个被右侧盖住,其实问题不是很大。它就是一个画布中的两个panel嘛" (since we have two panels, keeping their position fixed is fine — being able to resize them, and having them get covered by the panel on the right, isn't really a problem; they're just two panels inside a canvas). `computeClampedBox` (§72, carried into §79's two-box version) shrank/repositioned a box on every render specifically to keep it from ever reaching Inspector's own screen region — built for a bug that turned out (§73) to be an unrelated focus-outline artifact, not real overflow, so the whole mechanism was removed outright: `svgSize`'s own `ResizeObserver`, `viewTransform`/`svgSize` threaded down to `TreeNodeView`, and `computeClampedBox` itself all deleted. A box now renders exactly at its own stored offset/size, however far that reaches into Inspector's own column; Inspector's own `<div>` (a later DOM sibling, painted after Structure Lens's) simply covers whatever overlaps it.

Verifying this directly (not just reading the diff) surfaced a real, confirmed regression the user's own framing hadn't anticipated: at a moderate, entirely ordinary window width (measured directly at 1400px), the Search box's own "Search" button — at its *untouched default* size and position, nothing dragged, nothing resized — landed geometrically inside Inspector's own Leaflet map region and was completely unclickable. That's a different problem from what the user explicitly accepted above: they were describing the consequence of *their own* deliberate resize, not stumbling into an unusable default state through no action of their own. Reported back with the exact overlapping bounding boxes before deciding anything, and confirmed via a follow-up question: keep manual drag/resize completely unclamped as asked, but reintroduce a much lighter, narrower safeguard — cap only a still-*untouched-default* box's own **width** (never height, never position) to whatever room is actually visible, and stop applying entirely the instant that box has been resized even once.

`BoxGeometry` (§79) gained a `sizeIsDefault` boolean (`!sizes.has(href)`, computed in `makeBoxGeometry`) so the render logic can tell "still at the fallback default" apart from "the user set this explicitly" — the single-box case gets the same distinction via a new `boxSizeIsDefault` prop. A new pure function, `computeDefaultWidthCap`, reintroduces just the width half of the old `computeClampedBox` math (no repositioning, no height limit) and only ever runs while `sizeIsDefault`/`boxSizeIsDefault` is true. `svgSize`'s `ResizeObserver` came back for this alone. Verified directly across a range of realistic widths: full default width (640px) at 1800px+ browser width (an ordinary laptop/desktop size), graceful shrinking as the window narrows, down to a `MIN_BOX_WIDTH` floor (320px) at 1400px — and, separately, that a single manual resize afterward is completely unclamped again (a box dragged wide at 1400px renders at its full requested size, overlapping Inspector exactly as the user said was fine).

## 81. "Load all remaining" gets a confirmation gate and a lower safety cap — a real, reported danger, not a hypothetical one (superseded by §83 — removed outright one round later)

Reported directly, with a concrete real-world case: "我什么都没search,我就读出来大概有三万多个item...点一下Load All Remaining,那一下子这个页面就爆了" (I hadn't even searched — it showed roughly 30,000 items — one click on Load All Remaining and the page just blew up). The button already had a fetch-loop safety cap (`LOAD_ALL_SAFETY_CAP`, previously 5000), but nothing warned before firing it, and every loaded Item (not just the current page) gets plotted on the Time & Space map/timeline at once (`dimmedItems`) — so even hitting the existing cap could still make the page unresponsive, with zero warning beforehand.

Two changes: `LOAD_ALL_SAFETY_CAP` lowered to 2000 (still generous for a real narrowing search, per its own original reasoning — a query that's actually narrow enough to matter should still load in full) and exported so the UI can name the exact number rather than guessing; and `ItemSetResultsPanel`'s own click handler now computes the real remaining count when it's known (`totalItems - loadedCount`, when `!totalPagesIsLowerBound`) and shows a `window.confirm()` naming that exact number and warning about possible slowness — or, when the total is genuinely unknown, naming the cap itself ("could load up to 2,000 more items"). A small remaining count (≤500) skips the prompt entirely, so the common, intended case (a real search that's already narrowed results to a few hundred matches) stays a single, uninterrupted click — the friction only appears when there's real, previously-invisible risk to warn about.

**This fix wasn't enough, per a direct follow-up — see §83**: a confirmation dialog only asks permission to hit the same rendering cost, it doesn't remove it. The whole affordance was removed outright one round later.

## 82. The Search panel's own "draw a bbox" affordance moves into a dedicated modal, reusing the same shared map component used everywhere else in the app

The user, after seeing the two-`foreignObject` split (§79) working, asked directly for the Search panel's own query conditions — specifically an area/bbox condition — to get a real map-based interaction, and floated a specific pattern themselves: "每个点了以后出了一个modal,出了一个模态对话框,然后在里面选择。对我来说这也是非常好的一个交互" (clicking something opens a modal — a dialog box — and you make your selection inside it; that's a very good interaction for me), alongside a broader direction to make this kind of map-based selection "到处都存在" (exist everywhere) in the app rather than build something bespoke just for this one spot. Before this, "Draw area on map" switched the Results box over to its own Time & Space tab and armed drawing directly on *that* map — functional, but borrowed a view whose actual job is showing results, not editing a search condition, and competed for the same small tab for two different purposes.

New `BboxPickerModal.tsx`: a full-size (`min(900px, 92vw)` × `min(680px, 88vh)`), centered, `document.body`-portaled dialog (same portal reasoning as `NodeTooltip` in `StructureTree.tsx` — escapes the small Search box's own `foreignObject`/SVG-transform context entirely) wrapping `ItemsMap` in `drawMode` — the *same* shared map component Inspector's own per-item Spatial field and Item Set's own Results map already use, not a second implementation, directly answering the "make it exist everywhere, don't build bespoke" ask. Confirm stays disabled until a box has actually been drawn; Cancel/backdrop-click discard the in-progress draw; Confirm applies it back to the Search panel's own draft state and closes. The Results box's own map keeps showing `draft.bbox` as a reference overlay (so you can see what your search will be scoped to, and see results against it once a search runs) but is no longer itself directly drawable — one clear place to draw, one clear place to see the outcome, rather than the same map serving both roles.

One real bug surfaced and fixed while verifying this, not before shipping it: `BboxPickerModal`'s own `onBboxDrawn` callback was passed to `ItemsMap` as a fresh inline arrow function on every render — exactly the class of bug this codebase already found and fixed once before, in the very component this modal replaces (see §71's Item Set query panel notes): a fresh closure is one of the draw-mode effect's own dependencies, so any unrelated re-render mid-gesture tears the effect down and rebuilds it, detaching the map's native mouse listeners and silently discarding whatever the in-progress drag had drawn so far. First verification attempt genuinely reproduced this — drawing a real rectangle in the modal left "Confirm" still disabled, as if nothing had been drawn at all. Fixed with `useCallback`, matching the established pattern; re-verified with the same real-mouse drag afterward: Confirm correctly enables mid-gesture, and confirming closes the modal with the drawn area applied as the Search panel's own "bbox set" chip.

Deliberately not built this round, confirmed directly with the user: a real draggable-timeline range picker for the "time" half of the query (showing a Collection's own declared temporal extent as a reference, with two draggable handles) — the two plain `<input type="date">` fields stay for now, parked as a later, larger piece of work once the map-based interaction above is settled.

## 83. Three real bugs in the Search/Results split (§79), found by direct use after §80–§82 shipped: a footer needing a scroll to see, "Load all remaining" removed outright, and the Space half of Time & Space simply not rendering

Reported together, in one message, after actually using the two-`foreignObject` Search/Results split day to day: "这个搜索框的结果列表我也看到了...比如说现在是哪个page,然后还有多少个icon remain,这一行消息居然在这个滚动条的最下方,不滚动下去也是看不到" (I can see the results list — but the "which page, how many remaining" line is at the very bottom of a scrollbar, invisible unless you scroll down); "这个load all remains这个按钮还在,我也觉得好像不应该在,因为太危险。比如说我这份数据就还有一千四百个item,我点一下,我们的系统就瞬间爆" (that "load all remaining" button is still there — I don't think it should be, it's too dangerous; even 1,400 remaining items instantly blew up the system on one click); "我切换到结果的result的那个panel的time and space,只有time,没有space" (switching Results' own Time & Space tab, I only get Time — no Space at all).

**Root cause of the first and third — one bug, two symptoms.** `StructureTree.tsx`'s own `renderBox` function (§79) wraps whatever's rendered inside a box in a `<div style={{ flex: 1, minHeight: 0 }}>{opts.children}</div>` — missing `display: 'flex'`. Flex sizing (`flex: 1`) and percentage heights (`height: '100%'`, used further down the tree by `LinksItemSetBrowser`/`ItemSetResultsPanel`) only mean anything relative to an actual flex container with a definite computed height; a plain block-level div here has neither, so every descendant's own careful `flex:1, minHeight:0` sizing silently became a no-op, and content rendered at its own natural, unconstrained height instead — for the List view, tall enough to push the pager's own footer line below the box's visible area, needing the box's own outer `overflow:'auto'` (a deliberate safety net, per its own comment, not the primary sizing mechanism) to scroll down to it; for the Time & Space view, the Space (map) half's own `flex:1` sizing (`ItemsMap`'s wrapper in `TimeSpaceView`) collapsed toward zero real height, rendering invisibly while the Timeline half (sized by its own explicit `maxHeight`, not `flex:1`) stayed visible — reading as "only Time, no Space," exactly as reported. A second, identical instance of the same mistake was found one layer up the same chain, in the plain portal-target `<div>`s cursor mode's own Search/Results boxes portal their content into (`setSearchTargetEl`/`setResultsTargetEl`) — fixed the same way. Static catalogs' shorter default content happened to fit without ever needing the broken sizing to actually work, which is why this went unnoticed until cursor mode's own taller content (idle message, query panel, 40-per-page list) exposed it. Verified directly, not just visually: read the Results box's own scroll container's `scrollHeight`/`clientHeight` before (1586 vs 758 — real overflow) and after (758 vs 758 — none) the fix, and confirmed the Space map itself now renders at a real, non-trivial size (620×576px, 16 tiles actually loaded) rather than collapsed or absent.

**The second — "load all remaining" — needed removal, not a better warning.** §81's confirmation-dialog fix (naming the real count, warning about slowness) turned out insufficient: the actual cost isn't the fetch itself (already capped), it's that every loaded Item — not just the current page — gets plotted on the Time & Space map/timeline at once, and a dialog can only ask permission to hit that cost, not make it safe. Removed outright: the button, `ItemSetResultsPanel`'s `loadAllRemaining` prop, `usePagedCursorResults`'s exported `loadAll`/`hasMore`, and `useCursorQueriedItemSet`'s own `loadAll` function and `LOAD_ALL_SAFETY_CAP` constant all deleted rather than left as unreachable dead code. The numbered pager is now the only way to reach any given page of a large result set — slower than one click, but never one click away from rendering thousands of markers at once.

## 84. The Search panel's own controls were "太粗糙" (way too crude) — redesigned around real prior art, condition-row layout, and a genuinely informative Area display instead of a bare "bbox set" label

Direct, blunt feedback after using the redesigned Search/Results split for real: "整个搜索的这个search的API search的这个面板的UI,现在做得非常的粗糙,我实在是有点受不了,太粗糙了" (the whole API search panel's UI is genuinely crude right now — I really can't stand it, it's way too rough), alongside a specific complaint about the Area filter's own display: "如果我在一个model里面画了一个search范围,那那个search范围就是在我们的UI里面仅仅是一个filter的Bbox and set,对吧?你有没有可能给一些更多的信息呢" (if I draw a search area in a modal, that area is just a bare "bbox set" filter label in our UI — could you show more information?). Asked directly to research how real multi-condition search UIs are built before redesigning, rather than guessing.

Researched two categories of real prior art before touching code: dedicated EO/geospatial data search tools (Copernicus Browser, NASA Earthdata Search) and general multi-condition filter-builder UI patterns (Notion/Linear-style filter rows, e-commerce faceted search). Two findings applied directly: (1) every one of these lists each filter condition — temporal, spatial, source, etc. — as its own clearly-labeled, independently-structured row or section, never crammed into one undifferentiated control strip; (2) an active filter's own chip/summary should show its actual *value*, not just that it's set (the researched pattern's own example: "Price: $50–$200," not "Price") — 80% of users lose track of what they've filtered by when a UI only shows *that* something's active, not *what*.

`ItemSetSearchPanel.tsx` rebuilt around a new `ConditionRow` component — Date, Sort, and Area each their own row (label column + value/control column, consistently aligned), replacing the single wrapped flex row every control used to share with no visual grouping at all. Search/Clear filters moved to their own footer row, separated by a border from the condition list above — deliberately splitting "what are the conditions" from "commit the conditions," the same separation the researched examples consistently make. The Area row's own bare "bbox set" button became a real value display: two new pure functions in `describe.ts`, `describeBboxArea` (a simple equirectangular approximation — accurate enough for a UI summary, explicitly not a precision geodesy calculation, verified directly against the known ~111.32km/degree-at-the-equator figure) and `describeBboxCoords` (each of the four edges labeled with its own hemisphere — "12.3°W–8.1°W, 4.2°N–9.6°N" — rather than STAC's raw signed `[west,south,east,north]` order, which nobody should have to decode by eye), plus "Edit"/"Clear" buttons (Edit reopens `BboxPickerModal`, §82, pre-filled with the current draft). Confirmed directly with the user before building, since a full alternative (a small inline world-outline SVG thumbnail highlighting the drawn area) was also on the table: text-only (area + coordinates) was the chosen scope, not the thumbnail.

One more small but real gap closed in the same pass: the old flat "filtered: …" recap line duplicated exactly what each condition row now already shows directly, so it was dropped — replaced with a single "unapplied changes" hint next to Search, reusing `draftDirty` (already computed in `CursorItemSetPanels.tsx`, previously used only to enable/disable the Search button) rather than adding new per-field diffing logic just for display.

Verified directly: the empty state cleanly shows all three rows with "Not set" for Area and a plain "Draw on map" button; drawing a real area via the modal and confirming shows the correct computed figures inline (a real drawn box came back as "≈35,509,931 km²" / "63.3°W–15.5°E, 0.0°N–38.5°N" — matches the coordinates actually drawn); editing a date afterward (without re-searching) correctly shows "unapplied changes" next to Search, which disappears the instant Search is clicked and a new fetch starts.

## 85. `BboxPickerModal` left a stray tooltip stuck to the cursor — React portals bubble synthetic events through the React tree, not the DOM tree; and §80's default-width cap fully removed, not just relaxed further

Two more direct reports after §82–§84 shipped.

**The stuck tooltip.** "在modal出来...我一旦我绘制结束以后...我的那个光标会有一个collection的那个pop-up出现...当我取消了那个modal之后,就又不见了" (once the modal is open, a Collection popup appears near my cursor — it disappears once I cancel the modal). Root cause: `TreeNodeView`'s own `<g onMouseEnter/onMouseMove/onMouseLeave>` already has a suppression check for exactly this class of problem, `isInsideItemSetBox` (§62) — but it works by testing DOM containment against `itemSetBoxRef`/`resultsBoxRef`, and `BboxPickerModal` is `createPortal`'d straight to `document.body`, nowhere near either ref's actual DOM subtree, so the check always says "not inside" for it. The deeper issue: React bubbles *synthetic* events along the **React component tree**, not the real DOM tree, and `createPortal` only changes where a component's output is mounted in the DOM — it stays exactly where it was in the React tree. `BboxPickerModal` is opened from inside `CursorItemSetPanels`, itself rendered as a React descendant of that same node's own `<g>` — so every `mousemove`/`mouseenter` over the modal's own map (physically in `document.body`) was still bubbling, in React's synthetic system, straight up to that node's own hover handler, showing *that node's* tooltip at the cursor's current (modal-relative) position. Fixed by stopping propagation at the modal's own outer wrapper — safe specifically because that subtree's real DOM position (under `document.body`) isn't nested inside the SVG canvas at all, so no legitimate native/window-level listener (d3-zoom's pan gesture, a box's own drag handles) depends on these events bubbling any further; the earlier, hard-learned caution in this codebase against `stopPropagation` (§61/§62) applied specifically to elements that *were* still real DOM descendants of the SVG, which this modal never is. Verified directly: no tooltip-shaped element exists in the DOM while the modal is open or immediately after cancelling, across a full draw-and-cancel cycle.

**The default-width cap, fully removed.** §80 built a lighter replacement for §72's full clamp — capping only a still-untouched-default box's own width, never height or position, and never once manually resized — specifically to fix a confirmed problem (a default-sized Search box's own button landing unreachable under Inspector at an ordinary window width). Reported as still not worth it: "当我们拖拽画布空白的地方的时候...这两个panel跟右侧的inspector这个交互的时候,它会把那个panel的size,宽度变短嘛。这个真的是有必要的吗?在我看来,不这么做问题也不大,因为用户可以自己去拖小啊" (when we drag the canvas, these two panels shrink as they get near Inspector — is that really necessary? I don't think it's a big problem without it, since the user can just resize them down themselves). The gap: §80's cap recomputed live from the box's *current* screen position every render, so simply panning the canvas — moving a node (and its still-default-sized box) closer to Inspector — visibly shrank an already-open box in real time, which reads as distracting, over-eager behavior distinct from the original "unreachable on first open" problem it was built to fix. Removed outright, for the second time on this same mechanism: `computeDefaultWidthCap`, `BoxGeometry`'s `sizeIsDefault` field, `boxSizeIsDefault`, and the `svgSize`/`ResizeObserver` state that fed them all deleted. A box — default or manually resized, either one — now always renders at exactly its own stored size, full stop, regardless of where it currently sits on screen; Inspector's own later-painted `<div>` covers whatever overlaps it, which the user has now confirmed, twice, is an acceptable tradeoff. Verified directly: `foreignObject` widths read identically (640/640) before and after panning the canvas toward Inspector, confirming no more live width adjustment tied to scroll/pan position at all.

## 86. Real, measured jank after loading many pages of API search results — a missing `useMemo` let a full Leaflet layer rebuild fire on every tree-canvas pan/zoom tick, unrelated to the map at all

Reported directly, with a real repro URL: "我在测试API...加载了很多页也好,加载了很多列表也好。加载了一段时间以后呢,我会发现我整个页面里面拖拽啊,什么东西都比较卡" (after loading many pages/a long list in API mode, dragging anything on the whole page starts feeling janky). Asked to investigate the cause and look for real optimizations, while acknowledging some slowness from genuinely large data volume is expected.

Investigated by reproducing exactly, not guessing: opened the given URL (a real bbox-filtered Earth Search query, auto-applied via §77's shareable-query restore), paged forward with `pageSize=200` until ~4,000 real Items were accumulated in the buffer, switched to Time & Space, then instrumented the actual `ItemsMap.tsx` layer-rebuild effect directly (a temporary counter) rather than trusting assumptions — a first instrumentation attempt via `window.L` read zero calls, which turned out to be a dead monkey-patch (`import * as L from 'leaflet'` never attaches to `window.L`), not evidence of no bug; switching to counting inside the real effect confirmed it. First pan attempt also read zero — the drag started on the bottom-left Legend panel, not blank canvas, so it never engaged d3-zoom at all; confirmed via reading the SVG's own `transform` attribute before/after, then corrected the drag's start position. With both measurement bugs fixed, one ordinary ~20-move pan gesture, unrelated to the map in any way, triggered **42 full Leaflet layer rebuilds** against the ~4,000-Item buffer — each one calling `layerGroup.clearLayers()` and reconstructing every `L.rectangle()` from scratch, real DOM work with no virtual-DOM diffing to fall back on (Leaflet, unlike `ItemsTimeline`'s plain SVG/React output, isn't reconciled — every rebuild is genuine layer teardown and reconstruction).

Root cause: `usePagedCursorResults.ts` computed `pageItems`/`dimmedItems` as plain `.slice()`/`.concat()` calls directly in the hook's render body, not memoized — a fresh array reference on *every* render, including ones with nothing to do with the actual data (this whole component subtree, portaled into a `foreignObject`, is a React descendant of `TreeNodeView`, which re-executes its render function on every `viewTransform` update — i.e., every single pan/zoom frame). `ItemsMap`'s own `itemsWithBbox`/`dimmedItemsWithBbox` `useMemo`s were already correctly written, keyed on `[items]`/`[dimmedItems]` — but since those *inputs* were fresh every render, the memoization was silently defeated at the very next level down, and the actual layer-rebuild effect (keyed on those two, among others) reran unconditionally. `ItemsTimeline`'s own sort/group/lane-pack `useMemo` chain sits downstream of the exact same props and was equally affected, though with a smaller real cost (React reconciliation still diffs its plain SVG output before touching the DOM; Leaflet's own imperative layers have no such backstop).

Fixed by wrapping both computations in `useMemo`, keyed on `[items, pageIndex, pageSize]` — `items` itself (from `useCursorQueriedItemSet`, a `useState` value only reassigned when a fetch actually resolves) is already genuinely stable across irrelevant re-renders, so once `pageItems`/`dimmedItems` stopped rebuilding their own array on every render, every downstream `useMemo`/`useEffect` keyed on them started correctly skipping unneeded work too — no changes needed in `ItemsMap.tsx` or `ItemsTimeline.tsx` at all; the fix landed entirely at the source. Checked the static-catalog sibling hook (`useLinksPagedItemSet.ts`) for the same mistake — it doesn't have it: `pageItems` there is a plain `pageCache[renderedIndex]` property lookup (not a fresh `.slice()` construction), already stable by construction, and `otherLoadedItems` was already wrapped in its own `useMemo`.

Verified directly, before and after, with the identical instrumented pan gesture against the identical ~4,000-Item buffer: **42 layer rebuilds → 0**. Separately confirmed the fix doesn't stop *real* updates from happening — paging to an actually different page still produces a fresh `pageItems`/`dimmedItems` reference (since `pageIndex` is itself a memo dependency) and correctly triggers exactly the rebuilds it should.

## 87. Inspector's Spatial map never flew to a Collection's declared bbox — the fit ran, on a map React StrictMode had already thrown away

Reported with a real repro (Planetary Computer's `3dep-lidar-returns`):
"inspector的Spatial的地图并没有fly to bbox,让我可以第一时间找到,我只是猜测这个
数据在us,我移动过去才看到的" (Inspector's Spatial map didn't fly to the
bbox so I could find it right away — I only guessed the data was in the
US and panned there myself). Investigated by measuring, not reading:
the raw Collection JSON has a perfectly good `extent.spatial.bbox`
(two entries — CONUS+Alaska first, a small Guam box second; `firstBbox`
correctly takes the first), the same value comes back from both the
direct fetch and the `/collections` listing, `statedBbox` reached
`ItemsMap` intact, the container had a real 426×318px size, and
`map.fitBounds()` was genuinely called with the right bounds — yet
`getZoom()/getCenter()` right afterwards still read zoom 2 at (0, 0).

Root cause: React 18 StrictMode's dev-only double-invoke of mount
effects. `ItemsMap`'s mount effect creates the Leaflet map, StrictMode
immediately runs its cleanup (`map.remove()`) and runs it again,
creating a *second* map — the one that actually stays on screen. The
fit effect had already run against the first map and recorded "done for
this `fitKey`" in `lastFitTargetRef`; that ref survives the effect
cleanup/remount cycle untouched, so on the real map the fit effect
early-returned forever. Fix: the mount effect's cleanup now also resets
`lastFitTargetRef`/`lastFlyHrefRef` — a "fitted already" memory is a
fact about one map instance and must die with it. Production never
re-runs a mount effect without a real unmount, so this only ever showed
in dev — but a test environment that silently shows a broken behavior
that isn't real is its own problem worth fixing outright, not just
noting. Verified in Playwright: the map now opens on North America
(zoom 3, dashed extent visible) instead of the whole-world default.

## 88. "第二次搜索永远不刷新" — a real server-side cache bug in Planetary Computer's `/items` endpoint; searches now go through the root's `GET /search?collections=…`

Reported precisely: the first API search (near New York) returned four
results; every later search — a new area near Miami, then Phoenix, even
"Clear filters" — kept showing the same four: "它永远只给我第一次搜索的纽约
的那四个结果". Reproduced in Playwright step by step, then instrumented:
the second search *did* send the right request with the new `bbox`, the
URL updated, `applyQuery` reset the buffer to 0 and the response was
applied correctly — the response itself was the old result set. Even
the unfiltered `Clear filters` request came back with the identical 130
New Jersey items and no `next` link.

Confirmed directly with `curl`, no app code involved: on
`/collections/3dep-lidar-returns/items`, the first request for a given
`limit` is computed correctly, and every later request with the *same*
`limit` but a different `bbox` — or an added `datetime`, or a cache-
busting query param — returns that first result verbatim. Two fresh
`limit` values proved it both ways (NJ first → PHX returned NJ; PHX
first → NJ returned PHX). The same server's `/search` endpoint, GET and
POST alike, returned distinct, correct results for the identical
sequence, and its CORS preflight allows POST too. So the OGC-Features
per-collection endpoint on this server caches responses under a key
that omits the spatial/temporal parameters — a genuine upstream bug.

Fix (`resolveSearchTarget` in `stac/conformance.ts`, used by
`useCursorQueriedItemSet`): a cursor-mode Collection's searches now
prefer the governing API root's own `rel:search` endpoint, scoped with
`collections=<id>`, and fall back to the Collection's own `rel:items`
link only when no such root/search link is known. Checked against the
spec rather than assumed: STAC API - Item Search states "Implementing
`GET /search` is required, `POST /search` is optional, but recommended"
— so staying with GET keeps both the no-preflight property and full
spec coverage. Both real roots (Planetary Computer, Earth Search)
advertise GET and POST as two separate `rel:search` links told apart by
`method`; `detectSourceKind` now picks the GET one instead of whichever
came first. Item Search is also what every mainstream client
(pystac-client, STAC Browser) uses for filtered queries — this is the
well-trodden path, not a workaround for one server. Verified: the
second search now returns 0 items for an ocean box, "Clear filters"
returns the real unfiltered set (250+, Utah first), and Earth Search
still works through the same request shape (250 features, 3,999
matched, `next` present).

A second, smaller real bug fell out of the same instrumentation: a
restored search fired **three** identical requests. StrictMode's double
mount explains two (the first is superseded by generation), but the
superseded request's `finally` still cleared `loadingRef`/`loadingMore`
— flags that by then belonged to the *newer* in-flight request — so the
UI briefly read "ready, 0 items" and `usePagedCursorResults`'s catch-up
effect fired a third, duplicate request. Only the current generation
may clear those flags now (and the async endpoint resolution gives the
superseded run an early exit before it ever hits the network): one
request per restored search.

## 89. The bbox modal couldn't be panned — explicit Draw-box tool with navigate-by-default, framed on the Collection's extent; and §85's `stopPropagation` fix quietly broke Leaflet's drag inside it

Two problems in one report. First, the design one: "我可以绘制一个框框...但
是同时我也失去了拖拽地图的能力...那这样子我要如何先找到一个地方去...zoom in,找到
一个地方,移动,找到一个地方,再绘制这个area呢" (I can draw a box, but I lose
the ability to drag the map — then how do I first get somewhere, zoom
in, find a place, and *then* draw?). `ItemsMap`'s draw mode has to take
the drag gesture away from Leaflet's drag-to-pan (the only way the two
coexist on one map), and the modal opened already in that mode. Every
dedicated draw tool handles this the same way — Leaflet.draw, Copernicus
Browser's and NASA Earthdata Search's area tools: the map pans/zooms
normally, an explicit tool button arms drawing, and drawing one shape
disarms it again so the very next drag pans rather than replacing the
box you just drew. `BboxPickerModal` now does exactly that (a "Draw
box"/"Redraw"/"Cancel drawing" toggle in its header, hint text per
mode), and opens *framed*: on the existing box when re-editing one,
otherwise on the Collection's own declared extent (`statedBbox`, drawn
dashed) — the direct answer to "how do I find the place first."

Second, the bug that would have made navigate mode useless anyway: even
with dragging enabled (`leaflet-grab` present), a drag in the modal
didn't pan while wheel-zoom worked fine. Cause: §85's fix for the stuck
tooltip — `onMouseMove={(e) => e.stopPropagation()}` on the modal root.
React's synthetic `stopPropagation()` also stops the *native* event
(verified in react-dom's source), and it runs from the portal container
(`document.body`) — before the event reaches `document`, which is
exactly where Leaflet's `Draggable._onDown` binds `mousemove`/`mouseup`
(verified in Leaflet's source). §85 itself noted that stopping
propagation is only safe where "no real native/window-level listener"
sits above — and then the modal's own map turned out to be that
listener. The tooltip leak is now stopped where it belongs instead:
the tree node's hover handlers ignore any event whose target isn't a
real DOM descendant of that node's own `<g>` (`isNotThisNode`), the
same explicit-containment approach §61/§62 already chose over
`stopPropagation` for the box. Verified in Playwright: no tooltip while
moving over the modal, the tooltip still shows on the node's own label,
drag pans the modal map both before and after a box is drawn, and the
Inspector map still pans. One deliberate side effect: hovering exactly
on a box's 1.5px connector stroke (portaled into `boxLayer`, so React
counted it as the node's descendant) no longer shows the node tooltip
— it never should have.

## 90. The boxes get a real title bar — the bare grey grip strip was chrome no other product has

Reported directly, with the request to research before designing: "每个
panel的顶部都有一个...灰色的长条,好像可以拖着它...这个UI UX做得非常的奇怪。我其实
没有见过第二个产品是长这个样子的...一个正常的panel通常也是带有头,像一个窗口一
样,有一个头部,头部上面有它的title,然后下面才是这个内容。然后可能假设它底部有
按钮" (each panel has a grey strip on top you can drag — I've never seen a
second product that looks like this; a normal panel has a head like a
window, with its title, then the content, and maybe buttons at the
bottom). The strip came from §59's "dedicated handle, not the whole box"
reasoning — correct about *what* should be draggable, but it separated
"where do I grab this" from "what is this" with nothing on it.

Prior art checked, all pointing the same way:
- **OS title bars.** Fluent: a 32px bar, a 16px icon then a caption-style
  title, "all empty space in the title bar or space taken up by non-
  interactive elements like the window title should be draggable"; macOS
  HIG: move by dragging the frame, resize by the edges.
- **Node editors** (the closest analogue to two boxes on a canvas joined
  by a line): ComfyUI/LiteGraph — "the title bar serves as the drag point
  for moving nodes," a collapse toggle at its left, a resize control at
  the bottom-right corner; Unreal Blueprints — a title bar coloured by
  node kind with icon + title over a body of pins; Blender — a header
  with the node's name and collapse arrow, body of sockets below.
- **Tool windows** (JetBrains): a header with a one-or-two-word title and
  an icon; frequently used actions in a toolbar; content below.
- **Design-system cards** (Fluent 2, Spectrum, Carbon, PatternFly): header
  (title, optional badge/actions), body, and a footer that "is used for
  important or routine actions... such as Approve or Submit."

Built (`renderBox`): a 28px title bar — glyph, short title ("Search" /
"Results" / "Items"; JetBrains' two-word rule, and the Collection's own
name is already on the tree node and in Inspector), the "API" pill at
the right edge for the two API-mode boxes — with the bar itself as the
d3-drag handle (grab cursor, full-bleed, bottom rule). The body keeps
its padding; the Search box's action row and the Results box's "page N
of M" line become genuine bottom bars, bled out over that padding so
their rule runs the box's full width like the title bar's. The separate
`ApiBadge` component (a pill plus a long line at the top of the Search
content) is gone. Decided with the user before building, from three
options each: fixed "Search" title over a Collection-name title; the
pager stays at the top next to the tabs (the bottom bar is status
only); no window controls (collapse/close) in the bar for now — the
box's lifetime is already the node selection's. Resize stays a corner
grip, unchanged (every reference above agrees on that one). Verified in
Playwright for all three boxes: bars present with the right text/badge,
dragging the bar moves the box, footers flush with the box edges.

## 91. A spec audit, and its first fix round — pagination links as the spec defines them, STAC 1.1 `bands`, the Children endpoint, two Inspector notes

Asked for directly once the panel work settled: "广泛地搜索...STAC的基准和要
求...看看我们有哪些做得不是特别对,然后支持得也不是特别充分的部分...跟官方的思
想和官方的哲学出入比较大的部分...或者跟那个STAC Browser出入比较大的部分" (search
broadly for STAC's standards and requirements; where are we not quite
right, not sufficiently supported, or at odds with the official
philosophy or with STAC Browser). Audited against the spec texts
themselves (STAC API Core/Features/Item Search, the extensions index,
Collection Search, Children, Sort, the STAC 1.1.0 changelog, best-
practices) and STAC Browser's README, options and `SearchFilter.vue` —
not from memory. Verdict in brief: the philosophy is aligned (never
enumerate, follow links verbatim, resolve relative links against the
document, gate UI on `conformsTo`, both `context` and `numberMatched`);
the gaps are (1) a handful of hard compliance misses, (2) most Item
Search extensions and all of Collection Search / Children unsupported
where STAC Browser supports them, (3) two *deliberate* divergences worth
naming — API mode is search-first where STAC Browser lists a
Collection's first page immediately via `rel=items`, and a tree instead
of thumbnail cards.

This round fixed the compliance misses, in the order proposed:

- **Pagination links are objects, not hrefs.** Features and Item Search
  both say a `next` link may carry `method`, `headers`, `body` and
  `merge` ("these mechanisms apply to both item and collection
  pagination"), and STAC 1.1 put `method`/`headers`/`body` into the core
  Link object. We read only `href` and always GET — every page after the
  first from a POST-paginating implementation was silently lost.
  `apiSearch.ts` now models `NextLink` and follows it exactly as
  advertised; for `merge: true` the original request is re-expressed in
  Item Search's POST shape (`buildPostBody`: arrays, `sortby` as
  `[{field, direction}]`) and merged under the link's body. Verified by
  rewriting a real Earth Search response's `next` into a POST+merge link
  and capturing what was sent: `{"limit":250,"collections":
  ["sentinel-2-pre-c1-l2a"],"bbox":[…],"token":"abc123"}`.
- **STAC 1.1 `bands`.** 1.1 replaced `eo:bands`/`raster:bands` with a
  common `bands` array and allows `data_type` directly on an asset; the
  asset badge read only `raster:bands[0].data_type`, so 1.1 catalogs lost
  it. Now `bands[0].data_type` → `data_type` → `raster:bands[0].data_type`.
- **Children extension (`rel=children` → `/children`).** Taken whenever
  advertised, even alongside `child` links, for exactly the reason the
  extension gives (following each `child` link "just to find any
  information about the children (e.g., title, description)... can cause
  significant performance issues"). Same list-page shape as
  `/collections` (`fetchNodeListPage` serves both), same pagination. No
  public server at hand implements it, so verified by injecting a
  `children` link into Planetary Computer's real landing page and
  serving a two-entry `/children`: the tree showed exactly those two and
  never called `/collections`. The "+N more" leaf is skipped for an
  endpoint-sourced child list — the endpoint is complete by definition.
- **Two Inspector notes from 1.1:** `license: proprietary`/`various` is
  flagged as a deprecated value (SPDX expression or `other` expected),
  and a Collection declaring exactly two spatial bboxes gets a ⚠ — the
  1.1 changelog's "two spatial bounding boxes in a Collection don't make
  sense and will be reported as invalid" — with the first shown; three
  or more get a muted note that sub-extents aren't drawn. Planetary
  Computer's `3dep-lidar-returns` is a live example of both.

Still open from the same audit, deliberately not in this round because
each needs a UI decision: Collection Search (`/collections?q&bbox&
datetime`), free-text `q`, `ids`/`intersects`, arbitrary-field sort via
`queryables`, CQL2 filter, `fields`; `overview`/`visual` asset roles and
`rel=preview`; `alternate`/`via`/`license` links in Inspector; auth
headers and a CORS proxy option; an "Open in STAC Browser" link. Listed
in §96.

## 92. Collection Search — built, verified against a real server, then parked by decision; and a failed search now looks like a failure

Built as the first item of §91's open list: a third box, `Collections`,
on an API root whose `conformsTo` declares STAC API - Collection Search,
shown when the root is selected and stacked above the root's existing
cross-collection Item Search/Results pair; Text (`#free-text`) / Date /
Area rows; **its result was the tree itself** — the root's child list
reloaded through `/collections?q&bbox&datetime`, "240 of 422 collections
match" from `numberMatched`, the query in the shareable URL as
`#<root>?q=…`, and a Collection opened underneath got its Item Search
draft pre-filled with the root's bbox/datetime. Facts established on the
way, worth keeping: Collection Search is API-only (static catalogs are
"browseable" — a client "search" of one is a crawl; STAC Browser shows a
search panel only when the API declares the classes); Planetary Computer
and Earth Search declare no such class and ignore the params, but 14 of
the 34 API roots on this app's landing page implement it (Copernicus Data
Space, NASA CMR, Digital Earth Africa, HOT OSM, Thünen, GEO BON…), all
with `q`; declared URIs vary by version (`rc.1`/`1.0.0`/`1.1.0`), so the
gate matched by path suffix. Verified end to end in Playwright on
Copernicus Data Space (422 → 239 with `q=sentinel`, URL round-trip,
prefill, clear).

Then parked, not shipped: "我对于用 API search collection...虽然官方可能支
持了...但我觉得这个事情我还是有疑问。我们的系统暂时不支持,回退过去吧...等我想清
楚了,我们再来做" (I still have doubts about searching collections via the
API, even if the spec supports it — don't support it for now, revert, and
come back when I've thought it through). The doubt is about the model,
not the implementation: the tree is meant to show the publisher's
structure, and a search that silently swaps the root's children for a
filtered subset sits uneasily with that — the same instinct that ruled
out a client-derived grouping layer (§96). The complete work lives on the
local branch `parked/collection-search` (one WIP commit on top of
`5fbdfbb`, not pushed) so the decision, when it comes, starts from a
verified implementation rather than from scratch. What it also surfaced
and this section keeps: the root of an API gets an Item Search pair today
(its `items.kind` is `cursor` via `/search`), and on Planetary Computer
that search can never succeed — the server answers any query without
`collections=` with `422 collection is required` — which raised, and left
open, whether the root should carry an Item Search box at all.

One piece kept on `main`, because it is a plain bug regardless of any of
the above: that 422 used to render as "no items match this query — 0
items total". A failed request is not an empty result. `fetchSearchPage`/
`fetchNodeListPage` now raise an error carrying the server's own body
(under HTTP/2 `statusText` is empty, so "422" alone said nothing),
`useCursorQueriedItemSet` exposes an `'error'` status with the message,
and `ItemSetResultsPanel` shows it in warning color in place of the list
("⚠ Search request failed: 422 — collection is required"), with the
footer reading "search failed" instead of a page count.

## 93. A logo, real icons, and the hierarchy palette moved onto the STAC brand's three colors

The user drew the mark (`src/assets/stac-lens-logo.svg`): the STAC
logo's three nested squares — `#C4E2EF`, `#0EB4AE`, `#144E63`, outermost
to innermost — with a white lens over the front one. Their reading, now
the app's: the three squares are the three levels, Catalog → Collection
→ Item. (The STAC site's page accent `#6CC24A` is a different green from
the mark's own squares — checked, since the request called them
"greens"; what the logo actually uses is this blue-teal triad.)

Used everywhere one asset should: the same SVG is `public/favicon.svg`
(vector, any size), the header mark (20px, part of the title-is-home
button) and the landing title (44px) via `<Logo>`, and — rendered from
the same file with Playwright, no design-tool round trip — a 32px PNG
favicon, a 180px opaque Apple touch icon and 192/512px manifest icons,
with a `manifest.webmanifest` (theme color = the Collection teal) and a
proper `<title>`. The previous `favicon.svg` was the purple Vite/React
template leftover.

The palette followed, with one measured constraint. The request was to
use the three colors on the three levels directly; contrast said the
exact values can't carry both themes: `#C4E2EF` is 1.4:1 on the light
surface, `#144E63` is 1.7:1 on the dark one — a 1.5px node ring or a
12px type icon disappears at either. Three options were put to the
user; chosen: **same hues, luminance per theme.** Each level keeps the
exact brand value in the theme where it already reads — Catalog in
dark, Item in light, Collection (`#0EB4AE`) in both — and takes a same-
hue shade/tint in the other: light Catalog `#2F7A99` (4.8:1), dark Item
`#6FB3D2` (6.8:1). Asset (a fourth type the brand doesn't define; never a
tree node) keeps its muted plum, deliberately outside the family. The
old orange Item color also lived as a literal in `ItemsMap.tsx`'s Leaflet
palette (Leaflet's SVG attributes can't read CSS variables) — updated in
step; `--color-node-warning` stays orange, it's a state, not a level.

**Preparing to deploy surfaced two things.** First, the repository had no
license at all — no `LICENSE`, no `license` field — so a public repo was
legally "all rights reserved" and the UI had nothing true to show. The
user chose **Apache-2.0** (what the STAC spec and STAC Browser use; a
patent grant MIT lacks) over MIT and over staying unlicensed; the
canonical text was downloaded from apache.org, `package.json` gained
`license`/`repository` and a first real version, `0.1.0`. Where it shows
was also chosen from options: a landing-page footer ("STAC Lens v0.1.0 ·
Apache-2.0 license · Source on GitHub", the version inlined from
package.json through a Vite `define` so it can't drift) plus the bare
GitHub mark at the catalog header's far edge — STAC Browser's footer-
links convention, not an About dialog. A second, fainter footer row
then places the app in its ecosystem (asked for once the site was live):
STAC's home, the core and API specs, both extension registries (the
Inspector's extension facts and the API gating are read against them),
STAC Browser (the reference this one is explicitly "not another" of),
STAC Index (where the landing list comes from), stac-utils, the
tutorials, and STAC's OGC community-standard page — every URL checked
live before listing. Second, `npx tsc --noEmit -p .`
had been checking *nothing* all along: the root `tsconfig.json` is a
references-only shell (`"files": []`), so every "tsc clean" this session
was vacuous; the first real `npm run build` (`tsc -b`) failed on a
missing type import from §91's own bbox-count change. Fixed, and the
verification command is now `npx tsc -b` — recorded in memory so it
isn't repeated.

**Where it deploys, and how.** Pure static output, no backend, every
data request browser-to-STAC-server: any static host serves it. Compared
for the user: Cloudflare Pages (unlimited bandwidth), Netlify (100 GB/
month free), Vercel (100 GB/month, non-commercial Hobby terms), GitHub
Pages (sub-path unless a custom domain, so Vite `base` and manifest paths
would need changing). At ~600 KB per visit the bandwidth caps are
notional, so the user's existing **Netlify** account decided it — the
one thing Cloudflare had over it was moot. Live at **https://staclens.com**
(Netlify; `www` and plain `http` both 301 to the apex; checked from
outside: 200, correct title, hashed assets, icons, manifest — the only
nit was `.webmanifest` served as `application/octet-stream`, fixed with a
headers rule). The repository itself is still private at the time of
writing, so the site's source/license links 404 for visitors — known,
and left as they are because the repo is to be made public; flipping
visibility is the whole fix, not a UI change. Settings live in the repo,
not the dashboard: `netlify.toml` (build `npm run build`, publish `dist`,
Node 22, immutable caching for Vite's hashed `/assets/*`; deliberately
*no* SPA redirect rule — routing is hash-based, every path is a real
file), `.nvmrc` (22), and `.github/workflows/ci.yml` running lint plus
the real `tsc -b && vite build` on every push and pull request — the
check that would have caught the import error above the day it was
introduced. The landing-page list was scanned for plain `http://`
catalogs (blocked as mixed content from an HTTPS page): none — the one
such candidate had already been excluded in §19/§47 for that reason.

## 94. Positioning — a lens, not a browser

Raised by the user right after the first public deployment, as a real
doubt rather than a marketing exercise: "Stack Browser 的定位...你要发布自己
的数据,你想让别人看的时候有一个 Browser 来看...我们其实并不是让人去...作为一个
open source 的产品的意义不是很大...别人要发布产品的时候也不需要一个我们这样子的
工具...我有点没有看到这个我们这个开源项目的价值点所在" (STAC Browser makes
sense for someone publishing data who wants visitors to have a browser;
we aren't that — publishers don't need a tool like ours — I'm not sure
where the value of this open-source project is).

The answer came from reading what had actually been built, not from
what was intended. Nothing distinctive in this app is *browsing*: it is
cross-catalog (one entry point, 102 verified catalogs, versus STAC
Browser's one `catalogUrl` per deployment); it shows a catalog's shape
(Copernicus Data Space's 422 flat Collections are visible as a flat
fan-out, not a long list); it shows the distance between spec and
reality by exercising servers (Planetary Computer's `/items` cache
ignoring `bbox`, its 422 on any cross-collection search, POST-only
pagination links, 14 of 34 APIs implementing Collection Search); it
flags metadata that contradicts itself or the spec (two disjoint bboxes,
`rel:collection` vs `rel:parent`, deprecated licenses) rather than
rendering it; and it teaches the three-level model by carrying one color
per level through tree, Inspector, timeline and map. STAC Browser
assumes the server is right and renders every field faithfully — that
is its job, it does it well, and this app should not compete with it.

Positioning, stated positively rather than as "not another STAC
Browser": **see the shape of a STAC dataset, its health, and its
distance from the specification.** Four audiences, in order of how
distinctive the value is: the STAC community (an empirical conformance
view nobody publishes — STAC Index has only an `isApi` flag), publishers
checking their own catalog before or after shipping it (a linter with a
picture; schema validators check the JSON, this checks what the JSON
does), people choosing a data source, and people learning STAC. The
author's own use ("我是为着我自己") is a legitimate fifth — most good
tools start there.

Consequences for scope, which this section exists to make binding:
strengthen the lens (a catalog-health summary aggregating the existing
⚠ flags; an API root's "declared vs. observed" capability page;
cross-catalog comparison) and hold Item-level browsing at "deliberately
sufficient" — a longer field list is STAC Browser's lane. This also
settles the morning's Collection Search doubt (§92): searching for
Collections is browsing, so parking it was right; whether a server
*supports* Collection Search is diagnosis, so that fact belongs on a
capability page. Written into the README the same day, as a "who it's
for" section and an explicit side-by-side with STAC Browser.

The immediate follow-up question was the right one: "目录健康度的话,有标准
么?没有标准的话我们也不知道怎么做" (is there a standard for catalog health?
Without one we wouldn't know what to build). There is no score standard,
and this project will not invent one — but there are three layers of
rules with authors: the spec's own REQUIRED/MUST/SHOULD (schema-checked
by `stac-validator`), `best-practices.md`'s RECOMMENDED (linted by
stac-utils' `stac-check`, whose rule list — lowercase ids, `datetime`
null, unlocated Items, bloated links/metadata, `self` links, `summaries`,
link titles, coordinate sanity — is the closest thing to a community
standard), and "declared conformance vs. actual response" as a method
(`stac-api-validator`), which is exactly what this app's live-server
findings extend. So "health" is defined as **findings, each citing its
rule, in four tiers**: Invalid (normative), Warning (recommendation),
Behavior (a server contradicting its own `conformsTo`, shown only after
a real request), and Observation (a fact with no rule behind it — a flat
root is one; §96's principle, made structural). The full rule list, with
sources and what is built, is `docs/HEALTH-RULES.md`; adding a rule means
adding a row there first. What distinguishes this app from those three
tools is not new rules but placing all three layers on the same picture,
in a browser, for any public catalog.

## 95. Making the code contributor-ready, part 1 — the map, the rules of the road, and a clean baseline

Steps 1–3 of the plan recorded in the deferred list (§96), done in one
morning; 4–6 (tests, the `StructureTree.tsx` split, the comment pass)
follow.

**`docs/ARCHITECTURE.md`** — the map of the code as it is: the three
layers and the import direction between them, the `StacNode` model and
its two discriminated unions, each module's one job, the two stores and
why `selectedHref` and `browsingHref` differ, one interaction traced end
to end (a deep link with a query, from hash to rendered results), the
invariants stated as rules a reviewer can apply, how to verify, and
where things get written down. Present tense, English, no section
numbers, no quotes — and with an explicit contract: if it disagrees with
the code, the document is what's wrong. `DESIGN.md` stays the log.

**`CONTRIBUTING.md` and templates** — what kind of change fits (health
checks with a cited rule, conformance-gated API features, real-catalog
fixes) and what doesn't (field-completeness, invented hierarchy,
single-server quirks); setup; the verification standard with the
`tsc -b` trap spelled out and a Playwright starter; a table of catalogs
that exercise specific paths; where decisions go. Three issue forms
(bug — requires the catalog URL; server behavior — requires the request
and response; feature — asks which of shape/health/spec-distance it
serves and, for a check, its source) and a PR template whose checklist
is the verification standard.

**Prettier and a warning-free lint.** Prettier (single quotes, no
semicolons, 120 columns — the style the code already had) over code and
config only; Markdown is excluded on purpose, since this file is a
5,500-line log that a formatter would rewrap for no gain. The first run
touched 24 files, ~300 lines each way, all formatting; `tsc -b` and the
Playwright smoke (header title, Inspector extent, an Item deep link)
confirmed nothing observable changed. It did break the two single-line
`eslint-disable-line` suppressions in `usePagedCursorResults.ts` by
moving the comment off the dependency-array line — replaced with
`disable-next-line` directly above the array. The twelve baseline
oxlint warnings went to zero honestly: `only-export-components` is
turned off for the two deliberate shared-bits modules
(`ItemSetBrowser.tsx`, `ItemSetResultsPanel.tsx`) via a scoped override,
not globally; two `set-state-in-effect` sites (`useSelectedItems`, the
header's root title in `App.tsx`) were rewritten to read the loader's
cache during render and keep state only for a node the effect itself had
to fetch, keyed by href so a previous target's result is never shown;
the two remaining sites are genuine external-system synchronization (the
resolved deep-link URL; the root's own network load) and carry a one-
line reason each. CI now runs `format:check`, `lint`, and the real build
on every push and pull request.

**Step 4 — tests that pin the verified facts.** Two layers, both in CI.
Vitest over the pure data layer (54 tests, `src/stac/__tests__/`): link
resolution and deduping, `rel:collection` vs `rel:parent` kept apart,
`/collections` and `/children` endpoint recording, how Items are reached
(finite list vs. cursor vs. a root's own `/search`), the GET-over-POST
search-link preference, the Collection bbox rules (first is overall;
exactly two flagged — the 3dep case verbatim), invalid geometry kept as a
flag, the STAC 1.1 `bands` → `data_type` → `raster:bands` precedence,
`filterToParams`' exact parameter names and the `..` open end, fresh
`/search` requests scoped by `collections=` as a plain GET, `next` links
followed verbatim and POST+`merge` bodies assembled exactly as the spec
describes, `numberMatched`/`context` both read and absence meaning
unknown, a 422 surfacing the server's body, URL round-tripping and its
last-`?` split, and `resolveSearchTarget` choosing the root's search over
`rel:items`. Writing them caught one test that asserted the parked
branch's behavior (`matched` on a `/collections` page) — the test was
wrong, not `main`; a pinned fact has to be a fact about `main`. Then an
offline Playwright smoke suite (`tests/smoke.mjs`, run by CI against the
production build under `vite preview`) with every Planetary Computer
request answered from recorded fixtures in `tests/fixtures/pc` (a real
root, a trimmed `/collections`, the 3dep Collection, a five-Item search
page, and the literal `collection is required` 422 body) and every other
external request refused: the landing page and footer, an API root whose
children come from `/collections`, a deep link into a Collection with an
applied bbox that renders the fixture page and round-trips the URL, the
Inspector's two-bbox and deprecated-license notes on real data, and a
rejected root search shown as the server's words. Two of the first
assertions were wrong in instructive ways — `innerText` separates flex
children with newlines, and Playwright supplies a `statusText` the real
server omits — both loosened to match what matters, not the accident.

## 96. What's deliberately deferred (not forgotten)

- **Done (agreed 2026-09-16; steps 1–3 and 4 on 2026-09-17, see §95;
  steps 5–6 the same day, see §97): making the codebase contributor-ready
  before the repo goes public.** Kept here as the record of what was
  measured and planned. Measured
  state: 9,300 source lines, 30% comments — all "why", but written for
  the two of us (Chinese quotes in 23 files, `§NN` pointers into this
  5,500-line chronological log); `StructureTree.tsx` at 2,034 lines;
  zero checked-in tests (the Playwright verifications of the last days
  were ad-hoc scripts); no formatter; 12 baseline lint warnings; no
  CONTRIBUTING or architecture overview. Plan, in this order:
  1. `docs/ARCHITECTURE.md` — the current-state map (data layer → hooks
     → components, the two stores, one interaction traced end to end,
     the invariants). This file stays the log; that one is the map.
  2. `CONTRIBUTING.md` + issue/PR templates — how to run and *verify*
     (`tsc -b`, Playwright against real catalogs), where decisions go
     (append here; a health check gets a `HEALTH-RULES.md` row first),
     the README's principles as review criteria; issues must name a
     catalog URL, PRs must say what was tested against.
  3. Prettier matching the existing style (single quotes, no semicolons,
     120 columns) in CI; clear or explicitly allow-list the 12 warnings.
  4. Tests that pin the verified facts: Vitest over the pure data layer
     (`graph.ts` link/bbox/bands rules, `apiSearch.ts` params and POST
     merge, `searchQueryUrl.ts`, `conformance.ts` suffix matching,
     temporal/spatial normalization — each maps to a `HEALTH-RULES.md`
     row), plus a small Playwright smoke suite driven by recorded
     responses via `page.route` (no live servers in CI).
  5. Split `StructureTree.tsx`: canvas (layout/zoom), node view, the box
     renderer, `useBoxDragHandles` into `hooks/`, tooltip, legend —
     pure moves, Playwright before/after.
  6. Folded into 5, file by file: comments keep their "why" but quote
     the user in English paraphrase (the original Chinese stays here),
     replace `§NN` with the section's title text (numbers have shifted
     twice), and rewrite history-narration into present-tense reasons.
     Decided: code speaks English to contributors; this document stays
     bilingual.

- **Parked by decision, complete on `parked/collection-search`:
  Collection Search on API roots (§92).** To revisit: whether the tree
  should ever show a *filtered* root at all, or whether collection
  discovery belongs somewhere other than the structure view; and, tied
  to it, whether an API root should carry an Item Search box (Planetary
  Computer rejects cross-collection search outright).
- **Open question surfaced by §97's before/after comparison: should a
  click on the root label collapse the tree?** On `main` the root toggles
  like any expandable node, so clicking it folds everything (the
  "Collapse to top level" button deliberately never folds the root). The
  parked branch made the root select-only because selecting it is how
  its boxes would open. Undecided; not changed during the refactor.
- **Decided against, not deferred: inventing a grouping layer over a
  flat API root.** Copernicus Data Space lists 422 Collections with no
  `child` Catalogs at all (220 CLMS products split by variable ×
  resolution × cadence × version × file format, 150 Sentinel by
  instrument × level × product × timeliness). A client *could* derive
  CLMS / Sentinel-1 / … groups from ID prefixes or `keywords` and show
  them as tree levels. The user ruled it out: "我只是觉得源数据制作单位没有
  太认真的去思考而已,我们也不应该多做这一层" (the publisher just didn't think
  it through — that isn't a layer we should add either). Structure Lens
  shows the structure the publisher actually made, flat where it is flat.
  Same principle as never fabricating a count or a search result.

- **From §91's spec audit, the not-yet-built half** (each gated on
  `conformsTo` like Sort already is; static catalogs unaffected):
  Collection Search (candidate extension — `GET /collections?bbox&
  datetime&limit`, plus `q`/`filter`/`sortby`/`fields` by further
  conformance classes; the real pain it solves is finding one of ~136
  Collections under an API root), free-text `q` on Item Search, `ids`
  and `intersects`, Sort on arbitrary fields via `queryables`, CQL2
  Filter (already parked in §68/§84), `fields`. Inspector-side: the
  `overview`/`visual` asset roles and `rel=preview` links best-practices
  defines for visualization (only `thumbnail` is inlined today), and the
  discovery/provenance links `alternate` (HTML), `via`, `license`,
  `derived_from`, `canonical`. Access: auth headers / API keys and a
  CORS proxy option (STAC Browser: `authConfig`, `requestHeaders`,
  `~param`, `stacProxyUrl`). Interop: an "Open in STAC Browser" link
  (`#/external/<url>`). Also still silent: a `/collections` or
  `/children` listing past `COLLECTIONS_SAFETY_CAP` (2000) is truncated
  without a "+N more" leaf.

- A real, resolved lesson from §61, worth keeping in mind for future
  additions inside Structure Lens's Item Set box specifically: anything
  nested inside it sits under a `data-block-pan="true"` wrapper set for
  the *outer* tree canvas's own purposes, so a naive `element.closest
  ('[data-block-pan]')` check written for a *new* gesture built inside
  that box will always match that outer wrapper and silently reject
  every gesture, everywhere, regardless of what the new code's own
  interactive elements do or don't mark. The correct pattern (now used by
  `ItemsTimeline`'s own pan handler) is a manual ancestor walk that stops
  at the new component's own root element, not an unscoped `.closest()`
  call. Also a broader process lesson from the same investigation: a
  render-pipeline test (calling a library's public API directly) proves
  the renderer, not the gesture — don't report a gesture-driven feature
  done on that evidence alone; the user's own real-mouse test caught
  exactly the gap that evidence couldn't.
- A real, separate finding surfaced while investigating §60 (not itself
  §60's bug, and not yet acted on): the whole app has no responsive
  layout at all for narrow viewports. Tested directly at a phone-sized
  390px width — Structure Lens's own tree column collapses to effectively
  zero width and disappears entirely; Inspector's column (with its own
  wide default width, §45/§59) fills and overflows the whole screen
  instead. App.tsx's Structure/Inspector split has never had a narrow-
  screen breakpoint or a stacked/tabbed mobile layout — this project has
  been developed and verified desktop-width throughout. A real gap for
  anyone opening this on a phone, not a hypothetical one.
- §59's mirrored resize-handle geometry (the box-on-the-left/`labelOnLeft`
  case: bottom-left handle, flipped delta sign) was verified by reasoning
  through the existing `x` formula, not by an actual live drag test — no
  fixture on hand at the time had a node both expanded (to be
  `labelOnLeft`) and holding its own direct Items (to show a box) at the
  same moment. Worth a real Playwright drag confirmation the next time
  such a fixture turns up, rather than trusting the reasoning
  indefinitely.
- §41's aggregate multi-item Temporal/Space view finally has its home:
  §58's Item Set Temporal/Spatial tabs. The old `showOnLenses` mechanism
  itself stays permanently retired (§58's tabs read `filtered` directly,
  not through that store) — this bullet is resolved, kept here only as a
  pointer for anyone who goes looking for "show on Time/Space Lens" and
  wonders where it ended up. §57's removed stated-extent-vs-actual-range
  conflict check is still genuinely gone, not rebuilt by §58 — it was
  specific to the single-Collection-selected case that no longer exists
  the way it used to, not directly to the new multi-item batch view;
  whether a similar check belongs in the new Temporal tab is an open,
  not-yet-asked question of its own.
- §58's two other explicitly-deferred phases from the same proposal —
  real page-based pagination for static/links-mode Collections, and a
  dedicated bbox/datetime/sort API query module scoped to this panel — are
  both now built; see §68. Kept here only as a pointer for anyone tracing
  this bullet's history. Still genuinely open, not touched by §68: CQL2/
  arbitrary-property filtering (sort stayed scoped to `properties.datetime`
  only), and the still-unresolved "should an API-backed source get an
  entirely different navigation paradigm" question below.
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
  that understanding for now). §51 separately gave the Legend its own
  full icon set, but that's a static explainer panel, not the tree node
  itself — this bullet (icons directly on a live tree node's label) is
  still open on its own terms.
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
- A real draggable-timeline range picker for the Search panel's own "Date"
  condition (§82) — showing a Collection's own declared temporal extent as
  a background reference, with two draggable handles for start/end, the
  same "drag, not a slider" language the tree canvas/timeline/map already
  use elsewhere. Confirmed directly with the user as later, larger work:
  "先保留日期输入框,以后再做" (keep the plain date inputs for now, do this
  later) — the two `<input type="date">` fields stay as the interim
  interaction until this is actually built.
- CQL2 arbitrary-property filtering on an API search, and per-field sort
  beyond `properties.datetime` (§68, reaffirmed in §84's own research
  pass) — still genuinely out of scope, not just unmentioned.

## 97. Making the code contributor-ready, part 2 — the tree split into modules, and the comments switched to English

**Date:** 2026-09-17. Steps 5 and 6 of the plan in §96's first bullet.

### The split

`StructureTree.tsx` was 2,034 lines: canvas, node view, box renderer,
drag hook, tooltip, legend and every geometry constant in one file. It is
now the canvas only (425 lines), and the rest lives beside it:

| File | Holds |
|---|---|
| `src/components/StructureTree.tsx` | layout, zoom/pan, node drag offsets, per-node box geometry state, auto-pan, the `boxLayer` |
| `src/components/tree/TreeNodeView.tsx` | one node — circle, label drag, badges, hover, its portaled box(es) |
| `src/components/tree/ItemSetBox.tsx` | `renderBox` and the title-bar glyphs |
| `src/components/tree/boxGeometry.ts` | box sizes/minimums/gaps/inset, `BoxGeometry`, `makeBoxGeometry` |
| `src/components/tree/treeGeometry.ts` | row/level spacing, label helpers, `linkGenerator`, `BLOCK_PAN_ATTR`, hover types |
| `src/components/tree/NodeTooltip.tsx` | the viewport-clamped hover card |
| `src/components/tree/Legend.tsx` | the bottom-left key |
| `src/hooks/useBoxDragHandles.ts` | d3-drag wiring for a box's move and resize handles |

Pure moves, with one exception: the literal `14` that dropped every box
below its node's baseline appeared six times and is now
`BOX_TOP_OFFSET`. `makeBoxGeometry` left the component body — it never
closed over component scope, its setters were already parameters. The
`App.tsx` import path is unchanged, so nothing outside the tree noticed.

### How "pure" was checked, and what the check caught

Before and after: `tsc -b`, lint, Prettier, the 54 unit tests, the
12-check offline smoke suite, and a live Playwright script against two
real catalogs — the stac-spec `examples/catalog.json` (static; hover
tooltip, root click, Items box, title-bar drag, corner resize, label
drag, legend toggle) and Planetary Computer's `3dep-lidar-returns`
(Search + Results boxes with their API pills). The same script was then
run against the pre-split code (`git stash` of the source paths, the dev
server hot-reloading in between) and the two outputs compared line by
line.

The comparison caught one thing the green checks did not: in the split
I had transcribed `handleSelectAndToggle` as select-only for the root
(`if (canExpand && !isRoot)`) — the parked Collection Search branch's
version, which my memory had merged with main's. On main the root
toggles like every other expandable node, so a root click collapses the
tree. Restored to the committed behavior. Whether the root *should*
collapse on click is a real question (the parked branch answered no,
because selecting the root is how its boxes would open) — but it is a
behavior decision, not part of a refactor, and is listed in §96.

Two script-side lessons for the next live check, so they are not
re-learned: an Item Set box's resize grip sits at the box's far corner,
which at the default size lands *under the Inspector* on a 1600-px
viewport — drag the box left first, or the mouse hits the Inspector; and
Playwright's `innerText` throws on an SVG `<foreignObject>` (not an
`HTMLElement`) — read the inner `div`.

### The comment pass

Measured before: Chinese quotations in 23 source files (107 lines) and
43 `§NN` pointers into this document in 17 files. Rules applied, file by
file, with the tree modules done by hand during the move and the rest in
four parallel passes:

- A quoted request becomes the reason stated in English, present tense;
  the fact that it was a *reported* problem rather than a guess stays
  when it carries weight ("a reported problem, not a guess: …"). The
  Chinese originals remain in this document.
- `§NN` becomes `docs/DESIGN.md, "Section title"` — section numbers have
  shifted twice; titles are stable enough to search for.
- History narration ("used to", "was retired") in a touched sentence
  becomes the current rule and why.

Only comments changed. The same tool chain (type check, lint, Prettier,
unit tests, smoke suite) is the proof: a comment-only diff that breaks
none of them changed no code. Decided in §96 and standing: the code
speaks English to contributors; this document stays bilingual.

### Where this leaves the plan

All six steps of the contributor-readiness plan are done. What remains
before flipping the repo public is the owner's call, not code: making
the repository public and, if wanted, a first release tag.

## 98. Deployment made host-neutral — Docker, sub-path builds, and Netlify demoted to "how our instance runs"

**Date:** 2026-09-17. Prompted by the owner's question: the repository
talked about Netlify in several places, but a user of an open-source
project may deploy anywhere — how do open-source projects usually arrange
this, and is the root directory reasonably organized?

### What the neighbors do (checked, not assumed)

- **STAC Browser** ships a `Dockerfile`, `.dockerignore` and a `docker/`
  directory; no Netlify or Vercel config at all. Its README says: build,
  then copy `dist/` to any web host; sub-folder deployments use a
  `pathPrefix` option; Docker details live in `docs/`.
- **stac-manager** (Development Seed): Docker is the primary path, plus a
  Helm chart; again no hosting-provider file.

So the convention in this ecosystem is *generic build output plus a Docker
image as the portable path*, with provider-specific files either absent or
present only as the maintainers' own record.

### What was wrong here, in order of weight

1. The README's Deploying section led with `netlify.toml`, which reads as
   a recommendation even though the text already said "any static host".
2. There was no portable path. Self-hosters had to build their own nginx
   config and would not know about the two headers `netlify.toml` sets.
3. Sub-path deployment meant editing source (`base` in `vite.config.ts`),
   which rules out GitHub Pages — the most common free host for an
   open-source project — without a fork-local patch.
4. A CI comment mentioned Netlify by name.

### Decisions

- **`netlify.toml` stays in the root.** Netlify only reads it there; it is
  the truthful record of how staclens.com is deployed; and one provider
  file in the root is ordinary for a Vite project. Its header comment and
  the docs now frame it as *one host's configuration*.
- **`VITE_BASE`** — `vite.config.ts` reads `process.env.VITE_BASE ?? '/'`.
  Shell environment at build time, never a source edit. The manifest's
  `start_url` and icon `src` values became relative, because Vite rewrites
  URLs in `index.html` for the base but does not touch JSON inside
  `public/`; verified by building with `VITE_BASE=/stac-lens/`, serving it
  with `vite preview`, and checking in a browser that every reference in
  `index.html` carries the prefix, the manifest resolves its first icon to
  `/stac-lens/icon-192.png` (HTTP 200), the landing page renders and no
  request fails.
- **Docker**: a two-stage `Dockerfile` (`node:22-alpine` build →
  `nginxinc/nginx-unprivileged:alpine`) with `docker/nginx.conf`
  declaring the same two headers as `netlify.toml`, gzip, and no SPA
  fallback (routing is hash-based, so none is needed). `ARG VITE_BASE`
  covers a proxy that keeps its prefix. Verified locally: the container
  runs as uid 101, `/` and the manifest answer `Cache-Control: no-cache`
  with `application/manifest+json` on the manifest, `/assets/*` answers
  `public, max-age=31536000, immutable` and gzips, and the 12-check smoke
  suite passes against the container. Image size 91.6 MB. CI now runs
  `docker build` so the image can't rot silently.
- **`docs/DEPLOY.md`** holds the details (the two values every host
  needs, the headers, sub-path, Docker, a GitHub Pages workflow, Netlify,
  HTTPS and CORS caveats); the README's Deploying section is four bullets
  and a link, with Netlify last.

### The root directory: judged fine, left alone

Twenty entries: three `tsconfig` files (Vite's template convention),
`index.html` (must be in the root for Vite), one dotfile each for lint,
Prettier, nvm and Docker, one provider file, and the usual `src/`,
`public/`, `tests/`, `scripts/`, `docs/`, `.github/`. The only reduction
available was folding `.prettierrc` into `package.json`; not worth a
change. Reorganizing further would be tidying for its own sake.

## 99. The known-catalog list becomes maintained data — and Overture comes back

**Date:** 2026-09-17. Prompted by the owner noticing that Overture Maps
had disappeared from the landing page and asking why the list keeps
changing and how it should be maintained "instead of guessing".

### What had happened

Overture was added on 2026-09-07 (§19), removed on 2026-09-10 (§19's third
update) on a one-line note — "collections list raw Parquet part files in
a `registry.manifest` array, not STAC Items" — and nobody could see that
from the app. The list lived as a 600-line array inside
`LandingPage.tsx`; the only record of a removal was a sentence in this
5,000-line log.

Re-checked today: every one of the 15 Collections in release
`2026-08-19.0` is `type: Collection`, STAC 1.1.0, table extension, with
real `rel:item` links (987 in total, 512 under `building`); no
`registry.manifest` anywhere; the previous release looks the same; CORS
`*`; the app opens it down to an Item without error. The Wayback snapshot
of 2026-09-09 has the root and theme levels (identical to today) but not
the collection files, so whether the note was ever right cannot be
established. That is the real finding: **the removal was not
reproducible**, so a week later it could neither be defended nor refuted.

### What changed

- **The list is data.** `src/data/catalogs.json` (103 records), typed by
  `src/data/knownCatalogs.ts`; `LandingPage.tsx` shrank from 883 to 275
  lines. Each record carries `kind` (`static`/`api`, replacing `isApi`),
  `addedOn` (first commit listing the href, from `git log -S`) and
  `verifiedOn`.
- **The rules are written down** in `docs/CATALOGS.md`: six inclusion
  criteria, how to add (run the verifier on your entry, paste its line in
  the PR), how to remove (a log row with a reproducible reason, never on a
  single failed run), and the log itself — starting with MSC GeoMet and
  Overture's removal, Overture's restoration, the entries excluded at add
  time, and today's two flagged failures.
- **A verifier, `npm run verify:catalogs`** (`scripts/verify-catalogs.ts`),
  checks every entry the way a browser would: reachable, CORS header
  present, `stac_version`, declared kind vs the app's own
  `detectSourceKind`, and *shape* — for static catalogs a breadth-first
  walk (depth 3, 16 documents, 4 children per node) that must reach Items
  or at least a Collection; for APIs, `rel:child` links or a working
  `/collections`, in the order the app tries them. `--stamp` writes
  `verifiedOn`; `--report` writes Markdown. **It never adds or removes an
  entry.** `.github/workflows/catalogs.yml` runs it every Monday and posts
  the report to the job summary — separate from CI, because a hundred
  external hosts must not block a push.

### What the first full run taught

Three of the script's first ten "failures" were the script's, not the
catalogs' — worth recording because each would have produced a false
removal under the old habits:

1. **Node's Happy Eyeballs.** Two static catalogs (Nantes' Cassini VIMS,
   EOX's Cubes and Clouds) failed with `ETIMEDOUT` after 283 ms while
   curl, `https.get` and Chromium all opened them in under a second.
   Node's `fetch` gives each address-family attempt 250 ms; these hosts
   need ~300 ms for the TCP handshake. Fixed with
   `setDefaultAutoSelectFamilyAttemptTimeout(2000)`.
2. **API roots with `rel:child` links.** NASA CMR STAC, CBERS, Boettiger
   Lab, ERS and Digital Earth Africa all "failed" `/collections`, but the
   app never calls `/collections` when a root has `child` links — and
   these do. The check now follows the app's order.
3. **"Item-shaped" was the wrong question.** With a first-child-only
   walk, 22 static catalogs warned. Probing eight of them: fiboa and
   TriMet are Collections with collection-level GeoParquet assets and no
   Items — a legitimate STAC shape the app renders fine (extent, assets);
   Umbra and RapidAI4EO have Items three levels down; Google Earth
   Engine's 132 root children exhausted a naive budget. The criterion is
   now "reaches Items *or a Collection*", breadth-first, capped per node.
   Overture's supposed problem — collections whose data is neither Items
   nor assets — would still trip it.

Final run: **99 ok, 2 warn, 2 fail** in 47 s. The warnings are honest
(Pangeo's documents carry no STAC `type`; the openEO GEE root lists
nothing the walk can follow). The two failures are real and confirmed in
Chromium: **USGS Landsat** echoes its own origin in
`Access-Control-Allow-Origin` (it passed on 2026-09-11, so the server
changed), and **UK NCEO** sends the header twice (`*, *`), which browsers
reject. Both stay in the list, flagged in the log, per the rule that a
removal follows persistence, not one Monday — the owner may decide
otherwise.

### Decisions

- Catalog-list changes are data diffs plus a log row. Code review of the
  list means reading `catalogs.json` and `CATALOGS.md`, nothing else.
- The verifier reports; people decide. A scheduled job that edited the
  list would recreate the original problem with better handwriting.
- README says "100+" catalogs, not a number that goes stale.
