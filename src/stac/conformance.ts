import { loader } from './loaderInstance'
import type { StacNode } from './types'

// Both major STAC API spec versions are checked — real deployments lag the
// latest release, and there's no cost to matching either. Sort is declared
// against either the Item Search or the OGC API - Features surface,
// depending on which the implementation builds on.
export const SORT_CONFORMANCE_URIS = [
  'https://api.stacspec.org/v1.0.0/item-search#sort',
  'https://api.stacspec.org/v1.1.0/item-search#sort',
  'https://api.stacspec.org/v1.0.0/ogcapi-features#sort',
  'https://api.stacspec.org/v1.1.0/ogcapi-features#sort',
]

export function supportsSort(conformsTo: string[] | undefined): boolean {
  return !!conformsTo?.some((uri) => SORT_CONFORMANCE_URIS.includes(uri))
}

/** Resolves the `conformsTo` array that actually governs a node's own
 *  search endpoint. Per spec, `conformsTo` is only ever declared on a STAC
 *  API's landing page/root — never repeated on a nested Collection reached
 *  by browsing — so a Collection deep in the tree can't read this off its
 *  own `declaredConformsTo`; it has to find its root via `declaredRootHref`
 *  and read the root's copy instead. Returns `undefined`, not `[]`, when
 *  genuinely unknown (no root link, an unresolvable root, or a root that
 *  itself never declared conformsTo) — callers must treat that as "don't
 *  know" and hide any conformance-gated UI, never guess either way. */
export interface SearchTarget {
  endpoint: string
  /** The `collections=` constraint to send with a fresh request — set only
   *  when `endpoint` is the API root's cross-collection `/search`, never for
   *  a Collection's own `rel:items` link (already scoped by its URL). */
  collections?: string[]
}

/** Which endpoint a cursor-mode Collection's searches actually go to.
 *  Prefers the governing API root's own `rel:search` (STAC API - Item
 *  Search: `GET /search` is *required* by that spec, POST only optional),
 *  scoped with `collections=<id>`, over the Collection's own `rel:items`
 *  link (OGC API - Features); falls back to `rel:items` only when no such
 *  root/search link is known. Not a stylistic preference — confirmed
 *  directly against Microsoft Planetary Computer (2026-09-16) that its
 *  `/collections/{id}/items` endpoint serves a server-side cached response
 *  keyed *without* `bbox`/`datetime`: the first request for a given
 *  `limit` is computed correctly, and every later request with the same
 *  `limit` but a different `bbox` (or an added `datetime`, or a cache-
 *  busting param) gets that first result back verbatim — so a second
 *  search from the UI silently returned the first search's items no matter
 *  what area was drawn, even with every filter cleared. The same server's
 *  `/search` (GET and POST alike) returned distinct, correct results for
 *  the identical sequence. Item Search is also what every mainstream STAC
 *  client (pystac-client, STAC Browser) uses for filtered queries, so this
 *  is the well-trodden path, not a special case for one server. Resolved
 *  at fetch time rather than in `buildNode` because a deep-linked
 *  Collection is built before its root has ever been fetched. */
export async function resolveSearchTarget(node: StacNode & { items: { kind: 'cursor' } }): Promise<SearchTarget> {
  const own: SearchTarget = { endpoint: node.items.endpoint }
  // An API root searching through its own `/search` already covers every
  // Collection — nothing to scope.
  if (node.sourceKind.kind === 'api-search') return own
  const rootHref = node.declaredRootHref
  if (!rootHref) return own
  let root = loader.get(rootHref)
  if (!root) {
    try {
      root = await loader.load(rootHref)
    } catch {
      return own
    }
  }
  if (root.sourceKind.kind !== 'api-search') return own
  return { endpoint: root.sourceKind.searchHref, collections: [node.id] }
}

export async function resolveApiConformance(node: StacNode): Promise<string[] | undefined> {
  if (node.declaredConformsTo) return node.declaredConformsTo
  if (!node.declaredRootHref) return undefined
  const cached = loader.get(node.declaredRootHref)
  if (cached) return cached.declaredConformsTo
  try {
    return (await loader.load(node.declaredRootHref)).declaredConformsTo
  } catch {
    return undefined
  }
}
