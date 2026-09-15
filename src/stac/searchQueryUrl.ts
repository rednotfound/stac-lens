import { filterToParams, type SearchFilter } from './apiSearch'

/** Encodes an applied API search into the query-string suffix appended to a
 *  shareable-URL hash (`#<href>?<query>` — see `splitHashFragment`/
 *  `joinHashFragment` below). Reuses `filterToParams` so the URL's own query
 *  string is byte-for-byte the same param set the real `/search` request
 *  uses (`datetime`, `bbox`, `sortby`) rather than a reinvented scheme.
 *  Returns `''` for an empty filter — callers then omit the `?` entirely
 *  (see `joinHashFragment`), so a Collection with no applied query keeps
 *  today's exact hash shape. */
export function encodeSearchQuery(filter: SearchFilter): string {
  const params = filterToParams(filter)
  return new URLSearchParams(params).toString()
}

/** Inverse of `encodeSearchQuery`. Never throws — a malformed or foreign
 *  query string (someone hand-edited the URL, or an old link predates a
 *  since-changed param shape) degrades field-by-field to "that field
 *  absent," matching this app's existing posture for a dead/invalid hash
 *  (fall back gracefully, never surface a parse error). */
export function decodeSearchQuery(queryString: string): SearchFilter {
  const params = new URLSearchParams(queryString)
  const filter: SearchFilter = {}

  const bbox = params.get('bbox')
  if (bbox) {
    const parts = bbox.split(',').map(Number)
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      filter.bbox = parts as [number, number, number, number]
    }
  }

  const datetime = params.get('datetime')
  if (datetime) {
    const [start, end] = datetime.split('/')
    if (start && start !== '..') filter.datetimeStart = start
    if (end && end !== '..') filter.datetimeEnd = end
  }

  const sortby = params.get('sortby')
  if (sortby === '-properties.datetime') filter.sortDirection = 'desc'
  else if (sortby === 'properties.datetime') filter.sortDirection = 'asc'

  return filter
}

/** Splits a shareable-URL hash into its href part and (optional) query-
 *  string part, on the *last* literal `?`. Safe because any query string we
 *  ourselves append is always produced by `URLSearchParams`, which
 *  percent-encodes a literal `?` inside a value to `%3F` — so our own
 *  suffix never contains a second raw `?`. A `?` the href itself owns (a
 *  STAC endpoint whose canonical href already has its own query string)
 *  therefore always sits strictly before ours, making "last `?`"
 *  unambiguous. When there's no appended query at all, the hash is
 *  byte-identical to the pre-existing bare-href format, so every link
 *  minted before this feature existed still resolves exactly as before. */
export function splitHashFragment(hash: string): { href: string; queryString?: string } {
  const i = hash.lastIndexOf('?')
  if (i === -1) return { href: hash }
  return { href: hash.slice(0, i), queryString: hash.slice(i + 1) }
}

/** Inverse of `splitHashFragment`. `queryString === ''` (no applied query)
 *  omits the `?` entirely rather than appending a trailing empty one. */
export function joinHashFragment(href: string, queryString: string): string {
  return queryString ? `${href}?${queryString}` : href
}
