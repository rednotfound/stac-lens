import { buildNode, resolveHref, type RawStacObject } from './graph'
import type { StacNode } from './types'

interface RawSearchLink {
  rel?: string
  href?: string
}

interface RawSearchResponse {
  features?: RawStacObject[]
  links?: RawSearchLink[]
  /** Earth Search's shape: matched/limit/returned. */
  context?: { matched?: number; limit?: number; returned?: number }
  /** An alternate shape some implementations use instead of `context`. */
  numberMatched?: number
}

export interface SearchPage {
  items: StacNode[]
  nextHref?: string
  /** Total match count, when the implementation reports one at all — see
   *  the note on `fetchSearchPage` below. Absent, not zero, when unknown. */
  matched?: number
}

function withQuery(base: string, params: Record<string, string>): string {
  const url = new URL(base)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

/** A query/sort filter for a *fresh* search request only — see the note on
 *  `fetchSearchPage` below for why this never applies to a followed
 *  `rel:next` link. Scoped deliberately narrow for this pass: `datetime`
 *  and `bbox` are the STAC API's own core parameters (universally
 *  supported); `sortDirection` covers only `properties.datetime` (no
 *  arbitrary-field sort UI yet — every real dataset has a datetime, not
 *  every dataset has a meaningful shared sort field beyond it). Verified
 *  directly against Earth Search's real `/items` endpoint (not assumed):
 *  `sortby=-properties.datetime`, `datetime=<start>/<end>`, and
 *  `bbox=w,s,e,n` all behave as expected. */
export interface SearchFilter {
  bbox?: [number, number, number, number]
  /** ISO 8601 date/datetime; undefined on one side means that side is
   *  open-ended (STAC's `..` interval convention). */
  datetimeStart?: string
  datetimeEnd?: string
  sortDirection?: 'asc' | 'desc'
}

/** The `SearchFilter` -> query-param mapping, on its own so the shareable-URL
 *  encoder (`searchQueryUrl.ts`) can produce the exact same param set the
 *  real request uses, instead of inventing a parallel encoding. */
export function filterToParams(filter?: SearchFilter): Record<string, string> {
  const params: Record<string, string> = {}
  if (filter?.bbox) params.bbox = filter.bbox.join(',')
  if (filter?.datetimeStart || filter?.datetimeEnd) {
    params.datetime = `${filter.datetimeStart ?? '..'}/${filter.datetimeEnd ?? '..'}`
  }
  if (filter?.sortDirection) {
    params.sortby = filter.sortDirection === 'desc' ? '-properties.datetime' : 'properties.datetime'
  }
  return params
}

function buildFreshQueryParams(limit: number, filter?: SearchFilter): Record<string, string> {
  return { limit: String(limit), ...filterToParams(filter) }
}

/** Fetches one page of Items from a STAC API `/search` or `rel:items`
 *  (OGC API - Features) endpoint. Always GET, never POST — the Item
 *  Search spec documents GET as a first-class supported method (its own
 *  pagination examples use query params), and a plain GET without custom
 *  headers never triggers a CORS preflight the way a POST with a JSON
 *  body would, which matters for a pure-frontend app with no backend to
 *  route through.
 *
 *  `nextHref`, when given, is followed *verbatim* rather than
 *  reconstructed — the spec deliberately leaves the shape of a `rel:next`
 *  link's own parameters up to the implementation (`page`, `next`,
 *  `token`, or anything else), so a client must never assume it knows how
 *  to build the next page's URL itself (see docs/DESIGN.md §18's earlier
 *  finding on this for the same reason, applied here to a different
 *  endpoint).
 *
 *  Real implementations disagree on how (or whether) they report a total
 *  match count at all: Earth Search returns `context.matched`; Microsoft
 *  Planetary Computer returns neither `context` nor `numberMatched` —
 *  `hasMore` must be judged solely from the presence of a `rel:next` link,
 *  never from comparing a running total against an assumed-present count
 *  (confirmed directly against both — see docs/DESIGN.md §22).
 *
 *  A fresh query (no `nextHref` yet) is filtered by `opts.filter` when
 *  given (see `SearchFilter` above) — a real, locally-scoped query module
 *  now lives in the Item Set panel itself (docs/DESIGN.md §68), distinct
 *  from the Inspector-wide interactive draw-a-bbox/select-a-range tool
 *  dropped entirely in §39 (and its now-deleted global `store/query.ts`).
 *  `opts.filter` is only ever consulted when `!opts.nextHref` — a followed
 *  `rel:next` link already encodes whatever filter/sort produced it
 *  server-side, and the spec leaves that link's own shape entirely up to
 *  the implementation, so re-appending filter params on top of it would be
 *  redundant at best and wrong at worst. */
export async function fetchSearchPage(
  endpoint: string,
  opts: { limit: number; nextHref?: string; filter?: SearchFilter },
): Promise<SearchPage> {
  const url = opts.nextHref ?? withQuery(endpoint, buildFreshQueryParams(opts.limit, opts.filter))
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Search request failed: ${res.status} ${res.statusText}`)
  }
  const raw = (await res.json()) as RawSearchResponse
  const features = raw.features ?? []

  const items = features.map((feature) => {
    const selfLink = (feature.links ?? []).find((l) => l.rel === 'self' && l.href)
    // Features returned by search don't always carry a `rel:self` link back
    // to their own canonical document — fall back to a synthetic key
    // (endpoint + id) that's at least stable and unique within this
    // Collection's own result set, since that's all the loader's cache
    // needs it for.
    const itemHref = selfLink ? resolveHref(url, selfLink.href!) : `${endpoint}#${feature.id}`
    return buildNode(itemHref, feature)
  })

  const nextLink = (raw.links ?? []).find((l) => l.rel === 'next' && l.href)
  const matched = raw.context?.matched ?? raw.numberMatched

  return {
    items,
    nextHref: nextLink?.href,
    matched,
  }
}

interface RawCollectionsResponse {
  collections?: RawStacObject[]
  links?: RawSearchLink[]
}

export interface CollectionsPage {
  items: StacNode[]
  nextHref?: string
}

/** Fetches one page from an OGC API - Features "Collections" listing
 *  endpoint (`rel:data`) — the fallback children-discovery mechanism for a
 *  node with no static `rel:child` links at all (`StacNode.
 *  collectionsEndpoint`, `graph.ts`). Real, not hypothetical: Microsoft
 *  Planetary Computer's root has zero `child` links but lists ~136
 *  Collections this way — and unlike a static child link (a bare href to
 *  fetch separately), each entry here already arrives as a complete,
 *  ready-to-use Collection object, so no per-Collection follow-up fetch is
 *  needed at all (confirmed directly: PC's own `?limit=` param is silently
 *  ignored and every Collection comes back in one response regardless —
 *  `rel:next` is still checked and followed rather than assumed absent,
 *  since a different implementation may genuinely paginate this). */
export async function fetchCollectionsPage(
  endpoint: string,
  opts: { limit: number; nextHref?: string },
): Promise<CollectionsPage> {
  const url = opts.nextHref ?? withQuery(endpoint, { limit: String(opts.limit) })
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Collections request failed: ${res.status} ${res.statusText}`)
  }
  const raw = (await res.json()) as RawCollectionsResponse
  const collections = raw.collections ?? []

  const items = collections.map((collection) => {
    const selfLink = (collection.links ?? []).find((l) => l.rel === 'self' && l.href)
    // Same fallback reasoning as `fetchSearchPage` above — not every
    // implementation's listed Collection carries its own `rel:self` link.
    const collectionHref = selfLink
      ? resolveHref(url, selfLink.href!)
      : resolveHref(endpoint.endsWith('/') ? endpoint : `${endpoint}/`, String(collection.id ?? ''))
    return buildNode(collectionHref, collection)
  })

  const nextLink = (raw.links ?? []).find((l) => l.rel === 'next' && l.href)

  return {
    items,
    nextHref: nextLink?.href,
  }
}
