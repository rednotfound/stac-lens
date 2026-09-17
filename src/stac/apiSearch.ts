import { buildNode, resolveHref, type RawStacObject } from './graph'
import type { StacNode } from './types'

interface RawSearchLink {
  rel?: string
  href?: string
  method?: string
  headers?: Record<string, string>
  body?: Record<string, unknown>
  merge?: boolean
}

/** A pagination link as the spec actually defines it — STAC API's
 *  "Pagination" sections (Features and Item Search alike: "these
 *  mechanisms apply to both item and collection pagination") and, since
 *  STAC 1.1, the core Link object itself: not just an `href`, but
 *  optionally a `method` (POST), extra `headers`, a request `body`, and
 *  `merge` — whether that body is the whole next request or only the
 *  fields to change on top of the original one. A client that reads only
 *  `href` (as this one did) silently loses every page after the first
 *  from an implementation that paginates by POST. */
export interface NextLink {
  href: string
  method: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: Record<string, unknown>
  merge?: boolean
}

function findNextLink(links: RawSearchLink[] | undefined, baseUrl: string): NextLink | undefined {
  const link = (links ?? []).find((l) => l.rel === 'next' && l.href)
  if (!link) return undefined
  return {
    href: resolveHref(baseUrl, link.href!),
    method: link.method?.toUpperCase() === 'POST' ? 'POST' : 'GET',
    headers: link.headers,
    body: link.body,
    merge: link.merge,
  }
}

/** Follows a pagination link exactly as advertised. `originalBody` is the
 *  POST-shaped equivalent of the request that produced the first page —
 *  what a `merge: true` body is merged into. Headers are only sent when
 *  the link asks for them (custom headers cost a CORS preflight). */
function followNext(next: NextLink, originalBody: Record<string, unknown>): Promise<Response> {
  if (next.method === 'POST') {
    const body = next.merge ? { ...originalBody, ...(next.body ?? {}) } : (next.body ?? {})
    return fetch(next.href, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(next.headers ?? {}) },
      body: JSON.stringify(body),
    })
  }
  return next.headers ? fetch(next.href, { headers: next.headers }) : fetch(next.href)
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
  next?: NextLink
  /** Total match count, when the implementation reports one at all — see
   *  the note on `fetchSearchPage` below. Absent, not zero, when unknown. */
  matched?: number
}

/** An error that carries what the server actually said, not just the
 *  status — a STAC API's refusal is usually a one-line body (Planetary
 *  Computer's `/search` answers a cross-collection query with a bare
 *  `422 collection is required`), and under HTTP/2 `statusText` is
 *  empty, so without the body the user would see only "422". */
async function httpError(prefix: string, res: Response): Promise<Error> {
  let body = ''
  try {
    body = (await res.text()).replace(/\s+/g, ' ').trim().slice(0, 200)
  } catch {
    // body unreadable — the status alone will have to do
  }
  const status = res.statusText ? `${res.status} ${res.statusText}` : String(res.status)
  return new Error(`${prefix}: ${status}${body ? ` — ${body}` : ''}`)
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

function buildFreshQueryParams(limit: number, filter?: SearchFilter, collections?: string[]): Record<string, string> {
  return {
    limit: String(limit),
    ...(collections?.length ? { collections: collections.join(',') } : {}),
    ...filterToParams(filter),
  }
}

/** The same request in Item Search's POST shape — arrays instead of
 *  comma-separated strings, `sortby` as `[{field, direction}]` objects (the
 *  Sort extension's POST form). Only ever used as the merge base for a
 *  `next` link that asks to be followed by POST with `merge: true`. */
function buildPostBody(limit: number, filter?: SearchFilter, collections?: string[]): Record<string, unknown> {
  const body: Record<string, unknown> = { limit }
  if (collections?.length) body.collections = collections
  if (filter?.bbox) body.bbox = filter.bbox
  const datetime = filterToParams(filter).datetime
  if (datetime) body.datetime = datetime
  if (filter?.sortDirection) body.sortby = [{ field: 'properties.datetime', direction: filter.sortDirection }]
  return body
}

/** Fetches one page of Items from a STAC API `/search` or `rel:items`
 *  (OGC API - Features) endpoint. Always GET, never POST — the Item
 *  Search spec documents GET as a first-class supported method (its own
 *  pagination examples use query params), and a plain GET without custom
 *  headers never triggers a CORS preflight the way a POST with a JSON
 *  body would, which matters for a pure-frontend app with no backend to
 *  route through.
 *
 *  `next`, when given, is followed *exactly as advertised* rather than
 *  reconstructed — the spec deliberately leaves the shape of a `rel:next`
 *  link's own parameters up to the implementation (`page`, `next`,
 *  `token`, or anything else), so a client must never assume it knows how
 *  to build the next page's URL itself (docs/DESIGN.md, "Shareable URLs"
 *  reaches the same finding for the same reason, applied here to a different
 *  endpoint) — and that includes the link's `method`/`headers`/`body`/
 *  `merge`, not only its `href` (`NextLink`, `followNext`).
 *
 *  Real implementations disagree on how (or whether) they report a total
 *  match count at all: Earth Search returns `context.matched`; Microsoft
 *  Planetary Computer returns neither `context` nor `numberMatched` —
 *  `hasMore` must be judged solely from the presence of a `rel:next` link,
 *  never from comparing a running total against an assumed-present count
 *  (confirmed directly against both — see docs/DESIGN.md, "STAC API sources").
 *
 *  A fresh query (no `nextHref` yet) is filtered by `opts.filter` when
 *  given (see `SearchFilter` above) — a real, locally-scoped query module
 *  lives in the Item Set panel itself (docs/DESIGN.md, "Item Set's
 *  static-catalog and API-backed UI/UX split into two genuinely different
 *  panels"); there is deliberately no Inspector-wide interactive
 *  draw-a-bbox/select-a-range tool and no global query store
 *  (docs/DESIGN.md, "Past tabs entirely").
 *  `opts.filter`/`opts.collections` shape the *fresh* request's URL; for a
 *  followed `rel:next` link they are never re-appended to its href (the
 *  link already encodes whatever produced it server-side, in a shape the
 *  spec leaves entirely to the implementation) — they only serve as the
 *  merge base when that link asks to be followed by POST with `merge`.
 *
 *  Which endpoint a Collection's search actually goes to is decided by
 *  `resolveSearchTarget` (stac/conformance.ts), not here — a cross-
 *  collection `/search` needs `opts.collections` to stay scoped to the one
 *  Collection being browsed; a Collection's own `rel:items` link is already
 *  scoped by its URL and must not get it. */
export async function fetchSearchPage(
  endpoint: string,
  opts: { limit: number; next?: NextLink; filter?: SearchFilter; collections?: string[] },
): Promise<SearchPage> {
  const url = opts.next?.href ?? withQuery(endpoint, buildFreshQueryParams(opts.limit, opts.filter, opts.collections))
  const res = opts.next
    ? await followNext(opts.next, buildPostBody(opts.limit, opts.filter, opts.collections))
    : await fetch(url)
  if (!res.ok) throw await httpError('Search request failed', res)
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

  const matched = raw.context?.matched ?? raw.numberMatched

  return {
    items,
    next: findNextLink(raw.links, url),
    matched,
  }
}

export interface NodeListPage {
  items: StacNode[]
  next?: NextLink
}

/** One page of an endpoint that lists whole Catalog/Collection objects
 *  under a single array key — `/collections` (`collections`) and the
 *  Children extension's `/children` (`children`) share this exact shape,
 *  including the same pagination mechanism. */
async function fetchNodeListPage(
  endpoint: string,
  key: 'collections' | 'children',
  opts: { limit: number; next?: NextLink },
): Promise<NodeListPage> {
  const url = opts.next?.href ?? withQuery(endpoint, { limit: String(opts.limit) })
  const res = opts.next ? await followNext(opts.next, { limit: opts.limit }) : await fetch(url)
  if (!res.ok) throw await httpError(`${key === 'children' ? 'Children' : 'Collections'} request failed`, res)
  const raw = (await res.json()) as Record<string, unknown> & { links?: RawSearchLink[] }
  const entries = Array.isArray(raw[key]) ? (raw[key] as RawStacObject[]) : []

  const items = entries.map((entry) => {
    const selfLink = (entry.links ?? []).find((l) => l.rel === 'self' && l.href)
    // Same fallback reasoning as `fetchSearchPage` above — not every
    // implementation's listed entry carries its own `rel:self` link.
    const entryHref = selfLink
      ? resolveHref(url, selfLink.href!)
      : resolveHref(endpoint.endsWith('/') ? endpoint : `${endpoint}/`, String(entry.id ?? ''))
    return buildNode(entryHref, entry)
  })

  return { items, next: findNextLink(raw.links, url) }
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
export function fetchCollectionsPage(
  endpoint: string,
  opts: { limit: number; next?: NextLink },
): Promise<NodeListPage> {
  return fetchNodeListPage(endpoint, 'collections', opts)
}

/** One page of a STAC API - Children endpoint (`rel:children`) — see
 *  `StacNode.childrenEndpoint` for why it's preferred over following each
 *  `child` link separately. */
export function fetchChildrenPage(endpoint: string, opts: { limit: number; next?: NextLink }): Promise<NodeListPage> {
  return fetchNodeListPage(endpoint, 'children', opts)
}
