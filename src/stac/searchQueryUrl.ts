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

/** What a shared link keeps beyond the selection and the API search: the
 *  explorer view, and the Items panel's page (1-based) with its page size —
 *  a page number means nothing without the size it was counted in. */
export interface ViewState {
  view?: 'tree' | 'outline' | 'icicle'
  page?: number
  pageSize?: number
}

/** STAC Lens's own keys in the hash's `?` segment. They share the segment
 *  with the API search parameters but are split off before anything is
 *  decoded as a search, so they never reach a server and a link carrying
 *  only `view=icicle` never counts as "a search was applied". */
const VIEW_KEYS = ['view', 'page', 'page-size'] as const

/** Splits a hash query string into the API search part and the view state.
 *  Never throws; an unknown view or a page that is not an integer from 2
 *  up is dropped (the page size is checked against the pager's options
 *  where it is applied, `App`), as a malformed search field already is. */
export function splitViewState(queryString: string): { search: string; state: ViewState } {
  const params = new URLSearchParams(queryString)
  const state: ViewState = {}
  const view = params.get('view')
  if (view === 'tree' || view === 'outline' || view === 'icicle') state.view = view
  const page = Number(params.get('page'))
  const pageSize = Number(params.get('page-size'))
  // Page 1 is the default and never written; read, it would only hand a
  // pager a page it is already on.
  if (Number.isInteger(page) && page >= 2 && Number.isInteger(pageSize) && pageSize >= 1) {
    state.page = page
    state.pageSize = pageSize
  }
  for (const key of VIEW_KEYS) params.delete(key)
  return { search: params.toString(), state }
}

/** Inverse of `splitViewState`: the search part first (byte-identical to
 *  `encodeSearchQuery`'s output), then the view state. The tree and page 1
 *  are the defaults and are left out, so a link only says what differs. */
export function joinViewState(search: string, state: ViewState): string {
  const params = new URLSearchParams(search)
  if (state.view && state.view !== 'tree') params.set('view', state.view)
  if (state.page && state.page > 1 && state.pageSize) {
    params.set('page', String(state.page))
    params.set('page-size', String(state.pageSize))
  }
  return params.toString()
}
