// Core STAC Lens data model.
// Deliberately generalized across three contrasting reference fixtures:
// a messy static climate catalog, a 51M-item dynamic STAC API, and the
// STAC spec's own minimal example tree. See project design notes.

export type StacNodeType = 'Catalog' | 'Collection' | 'Item'

/** How a node's descendants are discovered. Static catalogs are link-walked;
 *  STAC APIs (detected via `conformsTo` / rel=search) are search-queried. */
export type StacSourceKind =
  | { kind: 'static-links' }
  | { kind: 'api-search'; searchHref: string }

/** A node's item set is never assumed to be a finite, enumerable array —
 *  an API-backed collection can hold tens of millions of items behind an
 *  opaque cursor. */
export type ItemEnumeration =
  | { kind: 'links'; hrefs: string[] }
  | { kind: 'cursor'; endpoint: string; cursor?: string; matched?: number }

/** An Item's datetime is either a single instant, or an interval whose
 *  start/end are independently nullable (STAC's `datetime: null` pattern,
 *  and open-ended "ongoing" extents where one bound is null). */
export type TemporalShape =
  | { kind: 'instant'; at: string }
  | { kind: 'interval'; start: string | null; end: string | null }

export interface SpatialExtent {
  bbox?: number[]
  geometry?: GeoJSON.Geometry
  /** true when a raw `geometry` field was present but was not a valid
   *  GeoJSON geometry object (e.g. a bare bbox array) — a real bug seen
   *  in the wild, not a hypothetical. We fall back to bbox-only. */
  geometryInvalid?: boolean
}

/** Publisher-declared, non-authoritative hints about expected item shape.
 *  Useful for pre-rendering affordances before items are fetched, but must
 *  always be treated as a lower bound, not a guarantee. */
export interface SchemaHints {
  summaries?: Record<string, unknown>
  itemAssets?: Record<string, unknown>
}

/** A STAC Asset Object, normalized — critically, `href` here is always
 *  already resolved to an absolute URL, never the raw JSON value. The
 *  Asset Object spec permits a relative href (resolved against the STAC
 *  entity's own location, same as any `links` entry), and real catalogs
 *  use both forms — a UI that ever shows or copies the raw, unresolved
 *  value risks handing the user a link that silently doesn't work once
 *  pasted somewhere else. Asked about directly: "很多asset,它的路径是,有的
 *  是给完整路径,有的是给相对路径...这东西其实我们都要判别一下,才能够保证用户粘贴
 *  的那个是可以直接使用的那个才行" (a lot of assets give a relative path, not
 *  a full one — we have to account for that so whatever the user pastes
 *  actually works). */
export interface ResolvedAsset {
  key: string
  href: string
  title?: string
  description?: string
  type?: string
  roles?: string[]
  /** Ground sample distance in meters — the common `gsd` field, frequently
   *  overridden per-asset (a 10m visible band vs. a 20m SWIR band on the
   *  same Item, confirmed against real Earth Search Sentinel-2 assets). */
  gsd?: number
  /** The pixel data type from this asset's own `raster:bands[0].data_type`
   *  (e.g. "uint16", "float32") — only the first band's type, not a full
   *  band table; every real per-asset band file checked in this project's
   *  fixtures is single-band. */
  dataType?: string
}

/** STAC Provider Object (Collection spec) — `name` is the only required
 *  field; everything else is optional and shown only when present. */
export interface StacProvider {
  name: string
  description?: string
  roles?: string[]
  url?: string
}

export interface StacNode {
  /** Canonical key — absolute resolved URL. Not `id`: ids are not
   *  guaranteed globally unique across a whole catalog tree. */
  href: string
  id: string
  type: StacNodeType
  title?: string
  /** The single canonical container to navigate/highlight through — per
   *  STAC's own philosophy ("multiple collections can point to an Item, but
   *  an Item can only point back to a single collection," item-spec.md),
   *  this is deliberately singular, not a set. Resolved from whichever of
   *  `declaredCollectionHref`/`declaredParentHref` is authoritative — see
   *  `buildNode`. */
  parentHref?: string
  /** Source fact: this node's own `rel:collection` link, if any — the
   *  spec-authoritative "which Collection do I belong to" signal, required
   *  to be present (and to agree with the `collection` field) whenever that
   *  field is set. Kept separate from `parentHref` so Detail Panel can show
   *  it plainly rather than through a resolved, possibly-differing value. */
  declaredCollectionHref?: string
  /** Source fact: this node's own `rel:parent` link, if any — describes
   *  physical/crawl containment (where you'd walk up to from here), which
   *  the spec allows to diverge from `rel:collection` (e.g. a file that
   *  physically lives in one directory structure but logically belongs to
   *  a different, thematically-organized Collection — observed directly in
   *  Capella Open Data's static catalog). */
  declaredParentHref?: string
  /** Source fact: this node's own `rel:root` link, if any — per
   *  `commons/links.md`, "STAC entities SHALL have no more than one parent
   *  entity... therefore usually just one root entity." Lets a deep-linked
   *  node (fetched directly, in isolation, from a shared URL) find its way
   *  back to the catalog it belongs to in one hop, instead of walking
   *  `parentHref` all the way up one fetch at a time — that walk is kept as
   *  the fallback for publishers who omit this optional-but-recommended
   *  link. */
  declaredRootHref?: string
  childHrefs: string[]
  /** An OGC API - Features "Collections" listing endpoint (`rel:data`) —
   *  an alternative way to discover this node's child Collections when
   *  there are no static `rel:child` links at all. Real, not hypothetical:
   *  confirmed directly against Microsoft Planetary Computer's STAC API
   *  root, which has zero `child` links (API-only from the very top —
   *  already noted in docs/DESIGN.md §22) yet lists ~136 real Collections
   *  via this endpoint, each returned as a complete, ready-to-use
   *  Collection object in one response rather than a href to fetch
   *  separately (see `stac/apiSearch.ts`'s `fetchCollectionsPage`). Only
   *  set when `childHrefs` is empty — a node with a real static child tree
   *  never needs this fallback. `undefined` on any node without a `data`
   *  link, never a placeholder. */
  collectionsEndpoint?: string
  items: ItemEnumeration
  /** This node's own API capability — a landing page/root declaring
   *  `conformsTo`/`rel:search` is `api-search`; everything else is
   *  `static-links`, the default. Independent of `items.kind`: a STAC API
   *  root is `api-search` but may have no direct items of its own (it's a
   *  landing page), while a plain Collection nested under it inherits no
   *  `conformsTo` of its own yet still gets `items.kind === 'cursor'` via
   *  its own `rel:items` link — see `buildNode`. */
  sourceKind: StacSourceKind
  /** This node's own raw `conformsTo` array, when present — per spec this is
   *  only ever declared on a STAC API's landing page, never repeated on a
   *  nested Collection/Item reached by browsing. `undefined`, not `[]`,
   *  when the raw JSON had no such field at all. A nested node that wants
   *  to know what its *governing* API root actually conforms to (e.g. to
   *  gate a Sort UI control) can't read this off itself — see
   *  `stac/conformance.ts`'s `resolveApiConformance`, which walks
   *  `declaredRootHref` to find the root's own copy of this field instead. */
  declaredConformsTo?: string[]
  /** Original JSON, untouched. SOURCE layer — never mutated. */
  raw: unknown

  spatial?: SpatialExtent
  temporal?: TemporalShape
  schemaHints?: SchemaHints
  /** `description` — required on every Catalog/Collection, and (per the
   *  Common Metadata spec) a valid optional field inside an Item's own
   *  `properties` too; resolved from whichever of those two locations
   *  actually applies to this node's type — see `buildNode`. Asked about
   *  directly after a real Collection (Adaptation Atlas) turned out to
   *  have several source fields Inspector never showed at all: "为什么现在
   *  我在inspector里面也看不到它呢" (why can't I see it in Inspector either). */
  description?: string
  /** Collection-only source fields (Collection spec — `license` is
   *  required, `providers`/`keywords` optional); `undefined` on Catalog/
   *  Item, never a placeholder. */
  license?: string
  providers?: StacProvider[]
  keywords?: string[]
  /** `created`/`updated` (Common Metadata spec) — top-level on a Catalog/
   *  Collection, but inside an Item's own `properties` — same per-type
   *  resolution as `description` above. */
  created?: string
  updated?: string
  /** This node's own `assets` object, normalized — every `href` already
   *  resolved to an absolute URL (see `ResolvedAsset`). Present on Items
   *  (their real data/thumbnail files) and occasionally Collections
   *  (shared/representative assets, per the Collection spec's own
   *  optional `assets` field) — empty array when the source has none. */
  assets: ResolvedAsset[]

  /** stac_extensions as declared by the publisher. */
  declaredExtensions: string[]
  /** Every property-key namespace prefix actually observed on this node,
   *  regardless of whether it appears in declaredExtensions. This is the
   *  signal used to classify fields as known-extension vs custom/unknown —
   *  declaredExtensions alone is not reliable (fields can be present but
   *  undeclared, or declared but incomplete). */
  propertyNamespaces: string[]
}

/** A node's structural role, derived from its actual links rather than
 *  assumed from tree depth or STAC type. The same nominal "Collection"
 *  type can be a bag of Items, a bag of sub-Collections, both, or a
 *  genuine terminal leaf with neither (metadata-only Collection). */
export type NodeShape =
  | 'branch-collections' // has childHrefs, no direct items
  | 'leaf-items' // has direct items, no childHrefs
  | 'mixed' // has both
  | 'leaf-empty' // has neither — a real, valid terminal state, not "unloaded"

export function classifyNodeShape(node: StacNode): NodeShape {
  const hasChildren = node.childHrefs.length > 0 || !!node.collectionsEndpoint
  const hasItems =
    node.items.kind === 'links'
      ? node.items.hrefs.length > 0
      : (node.items.matched ?? 1) > 0 || !!node.items.cursor

  if (hasChildren && hasItems) return 'mixed'
  if (hasChildren) return 'branch-collections'
  if (hasItems) return 'leaf-items'
  return 'leaf-empty'
}
