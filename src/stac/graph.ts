import type {
  ItemEnumeration,
  ResolvedAsset,
  SchemaHints,
  SpatialExtent,
  StacNode,
  StacNodeType,
  StacProvider,
  StacSourceKind,
} from './types'
import { normalizeCollectionTemporalExtent, normalizeItemTemporal, type TemporalProperties } from './temporal'
import { firstBboxIsUnion, isValidBbox, normalizeSpatial } from './spatial'
import { mergeNamespaceScans, scanNamespaces } from './namespaces'

interface StacLink {
  rel?: string
  href?: string
  type?: string
  title?: string
  method?: string
}

export interface RawStacObject {
  id?: string
  type?: string
  title?: string
  description?: string
  license?: string
  providers?: Record<string, unknown>[]
  keywords?: string[]
  created?: string
  updated?: string
  links?: StacLink[]
  stac_extensions?: string[]
  properties?: Record<string, unknown>
  assets?: Record<string, Record<string, unknown>>
  bbox?: number[]
  geometry?: unknown
  extent?: unknown
  summaries?: Record<string, unknown>
  item_assets?: Record<string, unknown>
  conformsTo?: string[]
}

export function resolveHref(base: string, href: string): string {
  return new URL(href, base).toString()
}

function detectType(raw: RawStacObject): StacNodeType {
  if (raw.type === 'Feature') return 'Item'
  if (raw.type === 'Collection') return 'Collection'
  if (raw.type === 'Catalog') return 'Catalog'
  // Fallback for objects that omit `type` (spec discourages this but doesn't forbid it everywhere)
  return raw.extent ? 'Collection' : 'Catalog'
}

/** A STAC API root/landing page is structurally a Catalog but declares
 *  `conformsTo` and a rel=search link — neither ever appears on a static
 *  catalog.json. This is the sole signal for picking a loader strategy. */
export function detectSourceKind(raw: RawStacObject, href: string): StacSourceKind {
  const searchLinks = (raw.links ?? []).filter((l) => l.rel === 'search' && l.href)
  // Item Search advertises GET and POST as two separate `rel:search` links
  // told apart by `method` (both real roots checked — Planetary Computer,
  // Earth Search — list GET first, but nothing guarantees that order).
  // Every request this app makes is a plain GET, so pick the GET link; a
  // missing `method` means GET per the spec.
  const searchLink = searchLinks.find((l) => !l.method || l.method.toUpperCase() === 'GET') ?? searchLinks[0]
  if (raw.conformsTo || searchLink) {
    return {
      kind: 'api-search',
      searchHref: searchLink ? resolveHref(href, searchLink.href!) : href,
    }
  }
  return { kind: 'static-links' }
}

function buildSchemaHints(raw: RawStacObject): SchemaHints | undefined {
  if (!raw.summaries && !raw.item_assets) return undefined
  return { summaries: raw.summaries, itemAssets: raw.item_assets }
}

function strArrayField(obj: Record<string, unknown> | undefined, key: string): string[] | undefined {
  const v = obj?.[key]
  if (!Array.isArray(v)) return undefined
  const strings = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
  return strings.length > 0 ? strings : undefined
}

function strField(obj: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = obj?.[key]
  return typeof v === 'string' ? v : undefined
}

function normalizeProviders(raw: unknown): StacProvider[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const providers = raw
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map((p) => ({
      name: strField(p, 'name') ?? '',
      description: strField(p, 'description'),
      roles: Array.isArray(p.roles) ? (p.roles as string[]) : undefined,
      url: strField(p, 'url'),
    }))
    .filter((p) => p.name)
  return providers.length > 0 ? providers : undefined
}

/** Resolves every asset's `href` against this node's own href — the Asset
 *  Object spec permits a relative path (real catalogs use both forms), so
 *  the raw JSON value is never safe to show or copy verbatim. Same
 *  resolution `childHrefs`/`rel:item`/etc. already get; assets just never
 *  went through it before because nothing rendered them yet. */
function buildAssets(href: string, raw: RawStacObject): ResolvedAsset[] {
  if (!raw.assets) return []
  return Object.entries(raw.assets).map(([key, asset]) => {
    // STAC 1.1 moved band metadata into common metadata: a plain `bands`
    // array (replacing `eo:bands`/`raster:bands`) and `data_type` directly
    // on the asset. 1.0 catalogs still carry `raster:bands`; read all
    // three, newest first.
    const bands = Array.isArray(asset.bands) ? (asset.bands as Record<string, unknown>[]) : undefined
    const rasterBands = Array.isArray(asset['raster:bands'])
      ? (asset['raster:bands'] as Record<string, unknown>[])
      : undefined
    const dataType = [bands?.[0]?.data_type, asset.data_type, rasterBands?.[0]?.data_type].find(
      (v): v is string => typeof v === 'string',
    )
    return {
      key,
      href: resolveHref(href, String(asset.href ?? '')),
      title: typeof asset.title === 'string' ? asset.title : undefined,
      description: typeof asset.description === 'string' ? asset.description : undefined,
      type: typeof asset.type === 'string' ? asset.type : undefined,
      roles: Array.isArray(asset.roles) ? (asset.roles as string[]) : undefined,
      gsd: typeof asset.gsd === 'number' ? asset.gsd : undefined,
      dataType,
    }
  })
}

/** Builds a normalized StacNode from raw fetched JSON. `href` must already
 *  be the absolute URL the JSON was fetched from (used as link-resolution
 *  base and as the node's canonical key). */
export function buildNode(href: string, raw: RawStacObject): StacNode {
  const type = detectType(raw)
  const links = raw.links ?? []

  const childHrefs = dedupe(links.filter((l) => l.rel === 'child' && l.href).map((l) => resolveHref(href, l.href!)))
  // Fallback child-discovery for a node with no static `rel:child` links at
  // all — an OGC API - Features "Collections" endpoint (`rel:data`), real
  // and not hypothetical: Microsoft Planetary Computer's own root has zero
  // `child` links (confirmed directly; see docs/DESIGN.md, "STAC API sources") but a `rel:data` link to
  // `/collections`, which returns ~136 real Collections in one response.
  // Only consulted when `childHrefs` is empty — a node with a genuine
  // static tree never needs it.
  const dataLink = links.find((l) => l.rel === 'data' && l.href)
  const collectionsEndpoint = childHrefs.length === 0 && dataLink ? resolveHref(href, dataLink.href!) : undefined
  // STAC API - Children: one response with every immediate child as a
  // complete object — taken whenever advertised, even alongside `child`
  // links (see `StacNode.childrenEndpoint`).
  const childrenLink = links.find((l) => l.rel === 'children' && l.href)
  const childrenEndpoint = childrenLink ? resolveHref(href, childrenLink.href!) : undefined
  const itemHrefs = dedupe(links.filter((l) => l.rel === 'item' && l.href).map((l) => resolveHref(href, l.href!)))
  const itemsLink = links.find((l) => l.rel === 'items' && l.href)
  const sourceKind = detectSourceKind(raw, href)
  // Three ways a node's own direct items can be enumerated, tried in this
  // order: flat `rel:item` links (a real, enumerable array — static
  // catalogs, confirmed to reach into the thousands with no pagination of
  // their own, see the third update under docs/DESIGN.md, "Growing the known-catalog list"); a `rel:items` link
  // (the OGC API - Features query endpoint STAC APIs put on individual
  // Collections instead — confirmed directly on Earth Search and Microsoft
  // Planetary Computer, neither of which has a single `rel:item` link
  // anywhere, only `rel:items`, see docs/DESIGN.md, "STAC API sources"); or, only for a node that is
  // itself an API root (`conformsTo`/`rel:search` on its own landing
  // page), its own cross-collection `/search` endpoint — a Catalog-typed
  // landing page has no items of its own to flatly list, but the spec's
  // own example shows exactly this pattern (browse via `child` links,
  // search across everything via the same root).
  const items: ItemEnumeration =
    itemHrefs.length > 0
      ? { kind: 'links', hrefs: itemHrefs }
      : itemsLink
        ? { kind: 'cursor', endpoint: resolveHref(href, itemsLink.href!) }
        : sourceKind.kind === 'api-search'
          ? { kind: 'cursor', endpoint: sourceKind.searchHref }
          : { kind: 'links', hrefs: [] }
  // Kept as two separate source facts rather than one `.find()` over both
  // rel types — the two can genuinely disagree (a file crawled from one
  // directory structure via `rel:parent` while its `collection` field/link
  // declares thematic membership elsewhere; confirmed in the wild in
  // Capella Open Data's static catalog). Per STAC's own philosophy
  // ("multiple collections can point to an Item, but an Item can only
  // point back to a single collection" — item-spec.md), `rel:collection`
  // is the spec-authoritative signal and wins when both are present;
  // `rel:parent` is the fallback for nodes with no formal Collection.
  const collectionLink = links.find((l) => l.rel === 'collection' && l.href)
  const parentLink = links.find((l) => l.rel === 'parent' && l.href)
  const rootLink = links.find((l) => l.rel === 'root' && l.href)
  const declaredCollectionHref = collectionLink ? resolveHref(href, collectionLink.href!) : undefined
  const declaredParentHref = parentLink ? resolveHref(href, parentLink.href!) : undefined
  const declaredRootHref = rootLink ? resolveHref(href, rootLink.href!) : undefined

  // Scanning the raw object's own top level too — not just `properties` —
  // is what actually finds a Catalog/Collection's own custom-namespaced
  // fields (Adaptation Atlas's `atlas:*`/`contact:*` live directly on the
  // Collection object, not nested under `properties` or `summaries`; a
  // real gap confirmed directly: these were completely invisible in
  // Inspector before this fix, not merely uncategorized). Harmless for an
  // Item, whose own top level never carries namespaced fields in any real
  // fixture checked (those live in `properties` instead, already scanned).
  const namespaceScans = [scanNamespaces(raw.properties), scanNamespaces(raw as Record<string, unknown>)]
  if (raw.assets) {
    for (const asset of Object.values(raw.assets)) namespaceScans.push(scanNamespaces(asset))
  }
  if (raw.summaries) namespaceScans.push(scanNamespaces(raw.summaries))

  return {
    href,
    id: raw.id ?? href,
    type,
    title: raw.title,
    parentHref: declaredCollectionHref ?? declaredParentHref,
    declaredCollectionHref,
    declaredParentHref,
    declaredRootHref,
    childHrefs,
    collectionsEndpoint,
    childrenEndpoint,
    items,
    sourceKind,
    declaredConformsTo: raw.conformsTo,
    raw,

    spatial:
      type === 'Item'
        ? normalizeSpatial({ bbox: raw.bbox, geometry: raw.geometry })
        : type === 'Collection'
          ? collectionSpatial(raw.extent)
          : undefined,

    temporal:
      type === 'Item'
        ? normalizeItemTemporal(raw.properties as TemporalProperties | undefined)
        : type === 'Collection'
          ? normalizeCollectionTemporalExtent(raw.extent)
          : undefined,

    schemaHints: type === 'Collection' ? buildSchemaHints(raw) : undefined,
    assets: buildAssets(href, raw),

    // `description`/`created`/`updated` are top-level fields on a Catalog/
    // Collection but live inside an Item's own `properties` instead (Common
    // Metadata spec) — confirmed against a real Earth Search Item (both
    // fields absent at Feature top level, present under `properties`) and
    // a real Collection (the reverse: present at top level, absent under
    // any nested object).
    description: type === 'Item' ? strField(raw.properties, 'description') : raw.description,
    created: type === 'Item' ? strField(raw.properties, 'created') : raw.created,
    updated: type === 'Item' ? strField(raw.properties, 'updated') : raw.updated,
    license: type === 'Collection' ? raw.license : undefined,
    providers: type === 'Collection' ? normalizeProviders(raw.providers) : undefined,
    keywords: type === 'Collection' && Array.isArray(raw.keywords) ? raw.keywords : undefined,

    ssysTargets: strArrayField(type === 'Item' ? raw.properties : (raw as Record<string, unknown>), 'ssys:targets'),
    ssysTargetClass: strField(type === 'Item' ? raw.properties : (raw as Record<string, unknown>), 'ssys:target_class'),

    declaredExtensions: raw.stac_extensions ?? [],
    propertyNamespaces: mergeNamespaceScans(namespaceScans),
  }
}

/** A Collection's `extent.spatial.bbox` is an *array* of bboxes. Per spec
 *  the first is the overall extent and the rest are finer sub-extents;
 *  real catalogs do not always honor that (Planetary Computer's 3dep-lidar
 *  Collections list two disjoint boxes), so every valid box is kept for
 *  drawing and `firstBboxIsUnion` records whether the spec's rule holds.
 *  `bbox` stays the first, for every consumer that wants one box. */
function collectionSpatial(extent: unknown): SpatialExtent | undefined {
  if (!extent || typeof extent !== 'object') return undefined
  const raw = (extent as { spatial?: { bbox?: unknown } }).spatial?.bbox
  if (!Array.isArray(raw) || !Array.isArray(raw[0])) return undefined
  const spatial = normalizeSpatial({ bbox: raw[0] as number[] })
  if (!spatial || raw.length === 1) return spatial
  const valid = raw.filter(isValidBbox)
  return {
    ...spatial,
    bboxCount: raw.length,
    bboxes: valid,
    firstBboxIsUnion: firstBboxIsUnion(valid),
  }
}

function dedupe(hrefs: string[]): string[] {
  return [...new Set(hrefs)]
}
