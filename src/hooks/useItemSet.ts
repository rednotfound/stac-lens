import { useEffect, useRef, useState } from 'react'
import { loader } from '../stac/loaderInstance'
import { fetchSearchPage, type SearchQuery } from '../stac/apiSearch'
import { useQueryStore } from '../store/query'
import type { StacNode } from '../stac/types'

const LINKS_PAGE_SIZE = 40
// A `cursor` (API-search) page costs one network round-trip regardless of
// how many Items it returns — the response already embeds full Item JSON
// for each one — unlike `links` mode, where every Item is a separate
// fetch. So a much larger page size here is nearly free relatively
// speaking, and directly addresses a real complaint: 40 felt like an
// artificial hard cap for a real, meaningfully-narrowed area search
// ("我一直往下滚动,item的数据就越来越多,一直滚到720了,眼看还能往下滚" — I kept
// scrolling and it kept growing, up to 720, with clearly more to go). The
// Item Search spec's own `limit` bounds are `default: 10`, `maximum:
// 10000` — 250 is comfortably inside that range without making a single
// request unreasonably heavy.
const CURSOR_PAGE_SIZE = 250
// `loadAll` keeps paging until exhausted OR this many items are loaded,
// whichever comes first — a deliberate backstop, not a limitation of the
// mechanism itself. A search narrow enough to return, say, a few thousand
// real matches should genuinely load all of them in one action; a search
// that's still effectively unfiltered (millions of matches) should not be
// silently fetched to exhaustion by one click.
const LOAD_ALL_SAFETY_CAP = 5000

export type ItemSetState =
  | { status: 'empty' }
  | { status: 'loading' }
  | {
      status: 'ready'
      items: StacNode[]
      /** Undefined when genuinely unknown, not zero — some STAC API
       *  implementations never report a total match count at all (see
       *  docs/DESIGN.md §22), so this must stay honest rather than
       *  quietly defaulting to "items loaded so far". */
      totalCount?: number
      hasMore: boolean
      loadingMore: boolean
      loadMore: () => void
      /** Only meaningful in `cursor` mode — keeps paging until exhausted
       *  or `LOAD_ALL_SAFETY_CAP` is hit, for when the whole point of a
       *  search was "give me everything matching this area/range," not a
       *  trickle. A no-op (but harmless) call in `links` mode. */
      loadAll: () => void
    }

/** RFC 3339 interval string for the `datetime` query param — `start/end`,
 *  either side `..` for an open bound, per the Item Search spec's own
 *  examples. `undefined` when neither bound is set at all (no temporal
 *  filter), distinct from an open-ended one-sided filter. */
function buildDatetimeParam(start: string | null, end: string | null): string | undefined {
  if (!start && !end) return undefined
  return `${start ?? '..'}/${end ?? '..'}`
}

/** Browsable, incrementally-loaded view over a node's own direct items —
 *  the data source behind the Item Set browser embedded in Structure Lens.
 *  Two entirely different loading strategies live behind the same
 *  interface, branching on `node.items.kind`:
 *
 *  - `'links'` (static catalogs): items enumerate as one flat href array
 *    with no pagination of their own — confirmed directly (Capella,
 *    EuroSAT MS, USGS 3DEP all inline 2000+ item links in a single file,
 *    see docs/DESIGN.md §19's third update) — so "load more" fetches the
 *    next slice of hrefs already known, one network request per Item.
 *  - `'cursor'` (STAC API-backed collections): confirmed directly against
 *    Earth Search and Microsoft Planetary Computer that neither exposes a
 *    single `rel:item` link anywhere — Items are reachable only by
 *    querying (see docs/DESIGN.md §22) — so "load more" issues a real
 *    `/search` or `rel:items` request per page, and each page's response
 *    already embeds full Item JSON for every result (no per-Item fetch
 *    needed — see `StacLoader.cachePreFetched`). A fresh cursor-mode query
 *    (no `nextHref` yet) applies whatever bbox/datetime is currently in
 *    `useQueryStore` — bumping `searchNonce` there (the "Search" button)
 *    resets pagination and starts over with the current draft; subsequent
 *    pages just follow the response's own `rel:next` link verbatim. */
export function useItemSet(node: StacNode | undefined): ItemSetState {
  const nodeHref = node?.href
  const kind = node?.items.kind
  const bbox = useQueryStore((s) => s.bbox)
  const datetimeStart = useQueryStore((s) => s.datetimeStart)
  const datetimeEnd = useQueryStore((s) => s.datetimeEnd)
  const searchNonce = useQueryStore((s) => s.searchNonce)

  const [items, setItems] = useState<StacNode[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [matched, setMatched] = useState<number | undefined>(undefined)
  const generationRef = useRef(0)
  // 'links' mode: how many of the known hrefs have been fetched so far.
  const loadedCountRef = useRef(0)
  // 'cursor' mode: the next page's URL, whether we've run out, and how
  // many have been loaded so far (tracked in a ref, not derived from
  // `items.length`, so `loadAll`'s loop can check its own running total
  // without waiting on React state to catch up between iterations).
  const nextHrefRef = useRef<string | undefined>(undefined)
  const exhaustedRef = useRef(false)
  const cursorLoadedCountRef = useRef(0)
  // A synchronous companion to `loadingMore` state — React StrictMode
  // double-invokes this hook's mount effect in dev (mount, cleanup, mount
  // again) *before* the first invocation's `setLoadingMore(true)` has
  // actually committed to a re-render, so a guard that only reads
  // `loadingMore` state lets both invocations' `loadMore()` calls past it
  // and fetch/append the same first page twice — confirmed directly
  // against Earth Search (React's own "duplicate key" warning on repeated
  // Item hrefs). A ref is written and checked synchronously in the same
  // tick, closing that window; `loadingMore` state stays purely for the
  // UI's own "loading more…" text.
  const loadingRef = useRef(false)

  useEffect(() => {
    generationRef.current += 1
    loadedCountRef.current = 0
    nextHrefRef.current = undefined
    exhaustedRef.current = false
    cursorLoadedCountRef.current = 0
    loadingRef.current = false
    setItems([])
    setLoadingMore(false)
    setMatched(undefined)
  }, [nodeHref, kind, searchNonce])

  /** Fetches exactly one cursor-mode page and applies it to state/refs.
   *  Shared by `loadMore` (one page) and `loadAll` (loops this until
   *  exhausted or capped) so the actual fetch/apply logic exists once. */
  async function fetchOneCursorPage(cursorNode: StacNode & { items: { kind: 'cursor' } }) {
    const isFreshQuery = !nextHrefRef.current
    const query: SearchQuery | undefined = isFreshQuery
      ? {
          bbox: bbox ? [bbox.west, bbox.south, bbox.east, bbox.north] : undefined,
          datetime: buildDatetimeParam(datetimeStart, datetimeEnd),
        }
      : undefined
    const page = await fetchSearchPage(cursorNode.items.endpoint, {
      limit: CURSOR_PAGE_SIZE,
      nextHref: nextHrefRef.current,
      query,
    })
    for (const item of page.items) loader.cachePreFetched(item)
    nextHrefRef.current = page.nextHref
    if (!page.nextHref) exhaustedRef.current = true
    if (page.matched != null) setMatched(page.matched)
    cursorLoadedCountRef.current += page.items.length
    // Defense in depth against duplicate hrefs landing in `items` — beyond
    // the StrictMode double-invoke `loadingRef` already guards against,
    // an API could legitimately return an overlapping edge item across
    // two pages of a live, changing collection.
    setItems((prev) => {
      const seen = new Set(prev.map((i) => i.href))
      return [...prev, ...page.items.filter((i) => !seen.has(i.href))]
    })
  }

  async function loadMore() {
    if (!node || loadingRef.current) return
    const generation = generationRef.current

    if (node.items.kind === 'links') {
      const hrefs = node.items.hrefs
      if (loadedCountRef.current >= hrefs.length) return
      loadingRef.current = true
      setLoadingMore(true)
      const slice = hrefs.slice(loadedCountRef.current, loadedCountRef.current + LINKS_PAGE_SIZE)
      const results = await Promise.allSettled(slice.map((h) => loader.load(h)))
      if (generation !== generationRef.current) return // node changed mid-flight
      const newItems = results
        .filter((r): r is PromiseFulfilledResult<StacNode> => r.status === 'fulfilled')
        .map((r) => r.value)
      loadedCountRef.current += slice.length
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.href))
        return [...prev, ...newItems.filter((i) => !seen.has(i.href))]
      })
      loadingRef.current = false
      setLoadingMore(false)
      return
    }

    if (node.items.kind === 'cursor') {
      if (exhaustedRef.current) return
      loadingRef.current = true
      setLoadingMore(true)
      try {
        await fetchOneCursorPage(node as StacNode & { items: { kind: 'cursor' } })
        if (generation !== generationRef.current) return
      } catch (err) {
        console.error('[useItemSet] search request failed', err)
        exhaustedRef.current = true // don't retry a broken endpoint forever
      } finally {
        loadingRef.current = false
        setLoadingMore(false)
      }
    }
  }

  async function loadAll() {
    if (!node || node.items.kind !== 'cursor' || loadingRef.current) return
    const generation = generationRef.current
    loadingRef.current = true
    setLoadingMore(true)
    try {
      while (!exhaustedRef.current && cursorLoadedCountRef.current < LOAD_ALL_SAFETY_CAP) {
        await fetchOneCursorPage(node as StacNode & { items: { kind: 'cursor' } })
        if (generation !== generationRef.current) return // node/search changed mid-flight
      }
    } catch (err) {
      console.error('[useItemSet] load-all request failed', err)
      exhaustedRef.current = true
    } finally {
      loadingRef.current = false
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    if (!node) return
    if (node.items.kind === 'links' && node.items.hrefs.length === 0) return
    void loadMore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeHref, kind, searchNonce])

  if (!node) return { status: 'empty' }
  if (node.items.kind === 'links' && node.items.hrefs.length === 0) return { status: 'empty' }
  if (items.length === 0 && loadingMore) return { status: 'loading' }

  const hasMore =
    node.items.kind === 'links' ? loadedCountRef.current < node.items.hrefs.length : !exhaustedRef.current
  const totalCount = node.items.kind === 'links' ? node.items.hrefs.length : matched

  return {
    status: 'ready',
    items,
    totalCount,
    hasMore,
    loadingMore,
    loadMore: () => void loadMore(),
    loadAll: () => void loadAll(),
  }
}
