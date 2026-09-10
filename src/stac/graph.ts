import type {
  ItemEnumeration,
  ResolvedAsset,
  SchemaHints,
  StacNode,
  StacNodeType,
  StacSourceKind,
} from './types'
import {
  normalizeCollectionTemporalExtent,
  normalizeItemTemporal,
  type TemporalProperties,
} from './temporal'
import { normalizeSpatial } from './spatial'
import { mergeNamespaceScans, scanNamespaces } from './namespaces'

interface StacLink {
  rel?: string
  href?: string
  type?: string
  title?: string
}

export interface RawStacObject {
  id?: string
  type?: string
  title?: string
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
  const searchLink = (raw.links ?? []).find((l) => l.rel === 'search' && l.href)
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

/** Resolves every asset's `href` against this node's own href — the Asset
 *  Object spec permits a relative path (real catalogs use both forms), so
 *  the raw JSON value is never safe to show or copy verbatim. Same
 *  resolution `childHrefs`/`rel:item`/etc. already get; assets just never
 *  went through it before because nothing rendered them yet. */
function buildAssets(href: string, raw: RawStacObject): ResolvedAsset[] {
  if (!raw.assets) return []
  return Object.entries(raw.assets).map(([key, asset]) => ({
    key,
    href: resolveHref(href, String(asset.href ?? '')),
    title: typeof asset.title === 'string' ? asset.title : undefined,
    description: typeof asset.description === 'string' ? asset.description : undefined,
    type: typeof asset.type === 'string' ? asset.type : undefined,
    roles: Array.isArray(asset.roles) ? (asset.roles as string[]) : undefined,
  }))
}

/** Builds a normalized StacNode from raw fetched JSON. `href` must already
 *  be the absolute URL the JSON was fetched from (used as link-resolution
 *  base and as the node's canonical key). */
export function buildNode(href: string, raw: RawStacObject): StacNode {
  const type = detectType(raw)
  const links = raw.links ?? []

  const childHrefs = dedupe(
    links.filter((l) => l.rel === 'child' && l.href).map((l) => resolveHref(href, l.href!)),
  )
  const itemHrefs = dedupe(
    links.filter((l) => l.rel === 'item' && l.href).map((l) => resolveHref(href, l.href!)),
  )
  const itemsLink = links.find((l) => l.rel === 'items' && l.href)
  const sourceKind = detectSourceKind(raw, href)
  // Three ways a node's own direct items can be enumerated, tried in this
  // order: flat `rel:item` links (a real, enumerable array — static
  // catalogs, confirmed to reach into the thousands with no pagination of
  // their own, see docs/DESIGN.md §19's third update); a `rel:items` link
  // (the OGC API - Features query endpoint STAC APIs put on individual
  // Collections instead — confirmed directly on Earth Search and Microsoft
  // Planetary Computer, neither of which has a single `rel:item` link
  // anywhere, only `rel:items`, see §22); or, only for a node that is
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

  const namespaceScans = [scanNamespaces(raw.properties)]
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
    items,
    sourceKind,
    raw,

    spatial:
      type === 'Item'
        ? normalizeSpatial({ bbox: raw.bbox, geometry: raw.geometry })
        : type === 'Collection'
          ? normalizeSpatial({ bbox: firstBbox(raw.extent) })
          : undefined,

    temporal:
      type === 'Item'
        ? normalizeItemTemporal(raw.properties as TemporalProperties | undefined)
        : type === 'Collection'
          ? normalizeCollectionTemporalExtent(raw.extent)
          : undefined,

    schemaHints: type === 'Collection' ? buildSchemaHints(raw) : undefined,
    assets: buildAssets(href, raw),

    declaredExtensions: raw.stac_extensions ?? [],
    propertyNamespaces: mergeNamespaceScans(namespaceScans),
  }
}

function firstBbox(extent: unknown): number[] | undefined {
  if (!extent || typeof extent !== 'object') return undefined
  const spatial = (extent as { spatial?: { bbox?: unknown } }).spatial
  const bbox = spatial?.bbox
  return Array.isArray(bbox) && Array.isArray(bbox[0]) ? (bbox[0] as number[]) : undefined
}

function dedupe(hrefs: string[]): string[] {
  return [...new Set(hrefs)]
}
