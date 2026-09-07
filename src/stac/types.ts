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

export interface StacNode {
  /** Canonical key — absolute resolved URL. Not `id`: ids are not
   *  guaranteed globally unique across a whole catalog tree. */
  href: string
  id: string
  type: StacNodeType
  title?: string
  parentHref?: string
  childHrefs: string[]
  items: ItemEnumeration
  /** Original JSON, untouched. SOURCE layer — never mutated. */
  raw: unknown

  spatial?: SpatialExtent
  temporal?: TemporalShape
  schemaHints?: SchemaHints

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
  const hasChildren = node.childHrefs.length > 0
  const hasItems =
    node.items.kind === 'links'
      ? node.items.hrefs.length > 0
      : (node.items.matched ?? 1) > 0 || !!node.items.cursor

  if (hasChildren && hasItems) return 'mixed'
  if (hasChildren) return 'branch-collections'
  if (hasItems) return 'leaf-items'
  return 'leaf-empty'
}
