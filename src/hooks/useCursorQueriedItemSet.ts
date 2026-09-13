import { useEffect, useRef, useState } from 'react'
import { loader } from '../stac/loaderInstance'
import { fetchSearchPage, type SearchFilter } from '../stac/apiSearch'
import type { StacNode } from '../stac/types'

// A cursor-mode page costs one network round-trip regardless of how many
// Items it returns — the response already embeds full Item JSON for each
// one — so a much larger page size than links-mode is nearly free. Kept
// identical to the old shared hook's value (raised there after a real
// complaint about a felt "40 item" cap — see docs/DESIGN.md §22).
const CURSOR_PAGE_SIZE = 250
// `loadAll` keeps paging until exhausted OR this many items are loaded,
// whichever comes first — a search narrow enough to return a few thousand
// real matches should genuinely load all of them in one action; one that's
// still effectively unfiltered (millions of matches) should not be
// silently fetched to exhaustion by one click.
const LOAD_ALL_SAFETY_CAP = 5000

export type CursorQuery = SearchFilter

const EMPTY_QUERY: CursorQuery = {}

export type CursorItemSetState =
  | { status: 'empty' }
  | {
      status: 'loading' | 'ready'
      items: StacNode[]
      /** Undefined when genuinely unknown, not zero — some STAC API
       *  implementations never report a total match count at all. Reflects
       *  `appliedQuery`'s own match count, not the whole Collection's. */
      totalCount?: number
      hasMore: boolean
      loadingMore: boolean
      loadMore: () => void
      loadAll: () => void
      /** The query actually in effect — only changes via `applyQuery`,
       *  never live-updated from draft edits still being typed/drawn. */
      appliedQuery: CursorQuery
      applyQuery: (q: CursorQuery) => void
      clearQuery: () => void
    }

/** Query-aware, cursor-following browsing for an API-backed Collection — a
 *  fundamentally different shape from a static catalog's page-indexed href
 *  array (see `useLinksPagedItemSet`): there is no numeric offset here,
 *  ever, only a `rel:next` link followed verbatim, so "pagination" for this
 *  mode means scroll/load-more/load-all, never "jump to page N". Query
 *  changes only ever apply to a *fresh* request — a followed `rel:next`
 *  link already encodes whatever produced it server-side (see
 *  `apiSearch.ts`'s `fetchSearchPage`) — so `applyQuery` always resets and
 *  restarts from a brand-new first page. */
export function useCursorQueriedItemSet(
  node: (StacNode & { items: { kind: 'cursor' } }) | undefined,
): CursorItemSetState {
  const nodeHref = node?.href

  const [items, setItems] = useState<StacNode[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [matched, setMatched] = useState<number | undefined>(undefined)
  const [appliedQuery, setAppliedQuery] = useState<CursorQuery>(EMPTY_QUERY)

  const generationRef = useRef(0)
  const nextHrefRef = useRef<string | undefined>(undefined)
  const exhaustedRef = useRef(false)
  const loadedCountRef = useRef(0)
  const appliedQueryRef = useRef<CursorQuery>(EMPTY_QUERY)
  // Synchronous companion to `loadingMore` state — closes the React
  // StrictMode double-invoke window the same way the old shared hook's
  // `loadingRef` did (see docs/DESIGN.md, `useItemSet`'s original comment).
  const loadingRef = useRef(false)

  function resetForNewQueryOrNode() {
    generationRef.current += 1
    nextHrefRef.current = undefined
    exhaustedRef.current = false
    loadedCountRef.current = 0
    loadingRef.current = false
    setItems([])
    setLoadingMore(false)
    setMatched(undefined)
  }

  useEffect(() => {
    resetForNewQueryOrNode()
    appliedQueryRef.current = EMPTY_QUERY
    setAppliedQuery(EMPTY_QUERY)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeHref])

  async function fetchOneCursorPage(cursorNode: StacNode & { items: { kind: 'cursor' } }, generation: number) {
    const page = await fetchSearchPage(cursorNode.items.endpoint, {
      limit: CURSOR_PAGE_SIZE,
      nextHref: nextHrefRef.current,
      filter: nextHrefRef.current ? undefined : appliedQueryRef.current,
    })
    if (generation !== generationRef.current) return // a newer applyQuery/node-change superseded this in flight
    for (const item of page.items) loader.cachePreFetched(item)
    nextHrefRef.current = page.nextHref
    if (!page.nextHref) exhaustedRef.current = true
    if (page.matched != null) setMatched(page.matched)
    loadedCountRef.current += page.items.length
    setItems((prev) => {
      const seen = new Set(prev.map((i) => i.href))
      return [...prev, ...page.items.filter((i) => !seen.has(i.href))]
    })
  }

  async function loadMore() {
    if (!node || loadingRef.current || exhaustedRef.current) return
    const generation = generationRef.current
    loadingRef.current = true
    setLoadingMore(true)
    try {
      await fetchOneCursorPage(node, generation)
    } catch (err) {
      console.error('[useCursorQueriedItemSet] search request failed', err)
      exhaustedRef.current = true // don't retry a broken endpoint forever
    } finally {
      loadingRef.current = false
      setLoadingMore(false)
    }
  }

  async function loadAll() {
    if (!node || loadingRef.current) return
    const generation = generationRef.current
    loadingRef.current = true
    setLoadingMore(true)
    try {
      while (!exhaustedRef.current && loadedCountRef.current < LOAD_ALL_SAFETY_CAP) {
        await fetchOneCursorPage(node, generation)
        if (generation !== generationRef.current) return // node/query changed mid-flight
      }
    } catch (err) {
      console.error('[useCursorQueriedItemSet] load-all request failed', err)
      exhaustedRef.current = true
    } finally {
      loadingRef.current = false
      setLoadingMore(false)
    }
  }

  function applyQuery(q: CursorQuery) {
    if (!node) return
    resetForNewQueryOrNode()
    appliedQueryRef.current = q
    setAppliedQuery(q)
    void loadMore()
  }

  function clearQuery() {
    applyQuery(EMPTY_QUERY)
  }

  useEffect(() => {
    if (!node) return
    void loadMore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeHref])

  if (!node) return { status: 'empty' }

  return {
    status: items.length === 0 && loadingMore ? 'loading' : 'ready',
    items,
    totalCount: matched,
    hasMore: !exhaustedRef.current,
    loadingMore,
    loadMore: () => void loadMore(),
    loadAll: () => void loadAll(),
    appliedQuery,
    applyQuery,
    clearQuery,
  }
}
