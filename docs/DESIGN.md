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

## 16. What's deliberately deferred (not forgotten)

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
- Space Lens's Leaflet reskin (§7, §8) is light-touch — zoom control and
  tooltip colors only. No custom loading/error state while tiles are still
  fetching (Leaflet just shows blank/gray tiles natively during that
  window), and `fitBounds`/`flyToBounds`'s padding and `maxZoom` values are
  similarly untuned constants, not yet validated against a wide range of
  bbox sizes beyond Atlas's continent-scale and NZ Imagery's city-scale.
