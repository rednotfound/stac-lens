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
 *  (confirmed directly against both — see docs/DESIGN.md §22). */
export interface SearchQuery {
  /** `[west, south, east, north]`, WGS84 — the Item Search spec's own bbox
   *  format (SW corner then NE corner). */
  bbox?: [number, number, number, number]
  /** RFC 3339 interval, `start/end` — either side may be `..` for an
   *  open-ended bound, per the spec's own examples. Built by the caller
   *  (`useItemSet`) from separately-tracked start/end values, since only
   *  it knows which sides are actually set. */
  datetime?: string
}

/** Only applied when starting a *fresh* query (no `nextHref`) — a page
 *  requested via `nextHref` is followed verbatim (see the note above) and
 *  must not have query params layered onto it, since a well-formed
 *  `rel:next` link already encodes whatever filters produced it. */
export async function fetchSearchPage(
  endpoint: string,
  opts: { limit: number; nextHref?: string; query?: SearchQuery },
): Promise<SearchPage> {
  const url =
    opts.nextHref ??
    withQuery(endpoint, {
      limit: String(opts.limit),
      ...(opts.query?.bbox ? { bbox: opts.query.bbox.join(',') } : {}),
      ...(opts.query?.datetime ? { datetime: opts.query.datetime } : {}),
    })
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
