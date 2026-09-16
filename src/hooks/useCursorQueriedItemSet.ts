import { useEffect, useRef, useState } from 'react'
import { loader } from '../stac/loaderInstance'
import { fetchSearchPage, type NextLink, type SearchFilter } from '../stac/apiSearch'
import { resolveSearchTarget } from '../stac/conformance'
import type { StacNode } from '../stac/types'

// A cursor-mode page costs one network round-trip regardless of how many
// Items it returns — the response already embeds full Item JSON for each
// one — so a much larger page size than links-mode is nearly free. Kept
// identical to the old shared hook's value (raised there after a real
// complaint about a felt "40 item" cap — see docs/DESIGN.md §22).
const CURSOR_PAGE_SIZE = 250

export type CursorQuery = SearchFilter

const EMPTY_QUERY: CursorQuery = {}

export type CursorItemSetState =
  | { status: 'empty' }
  | {
      /** `idle`: no search has ever been run yet (and none was restored
       *  from a shareable URL) — deliberately not the same as `loading`.
       *  API mode is search-first: "在API没有search之前,没有结果" (before an
       *  API search runs, there's no result at all) — no request is made
       *  until `applyQuery` is actually called at least once. */
      status: 'idle' | 'loading' | 'ready' | 'error'
      /** Set while `status === 'error'`: the last request for the current
       *  query failed — shown as such, never as an empty result. A server
       *  refusing the query (Planetary Computer's `/search` answers a
       *  cross-collection request with `422 collection is required`) used
       *  to surface as "no items match this query," which is a different
       *  claim entirely. */
      error?: string
      items: StacNode[]
      /** Undefined when genuinely unknown, not zero — some STAC API
       *  implementations never report a total match count at all. Reflects
       *  `appliedQuery`'s own match count, not the whole Collection's. */
      totalCount?: number
      hasMore: boolean
      loadingMore: boolean
      loadMore: () => void
      /** The query actually in effect — only changes via `applyQuery`,
       *  never live-updated from draft edits still being typed/drawn.
       *  Still `{}` (not yet meaningfully "applied") while `status` is
       *  `idle` — check `status`, not this, to tell "never searched" apart
       *  from "searched with no filters." */
      appliedQuery: CursorQuery
      applyQuery: (q: CursorQuery) => void
      clearQuery: () => void
    }

/** Query-aware, cursor-following browsing for an API-backed Collection — a
 *  fundamentally different shape from a static catalog's page-indexed href
 *  array (see `useLinksPagedItemSet`): there is no numeric offset here,
 *  ever, only a `rel:next` link followed verbatim, so growing the buffer
 *  means calling `loadMore()` one page at a time — `usePagedCursorResults`
 *  is what turns that into numbered-page presentation, via its own
 *  catch-up mechanism, rather than this hook ever fetching more than one
 *  page per call itself (a bulk "load everything" affordance existed once
 *  and was deliberately removed — see `ItemSetResultsPanel`'s own comment
 *  for why). Query changes only ever apply to a *fresh* request — a
 *  followed `rel:next` link already encodes whatever produced it
 *  server-side (see `apiSearch.ts`'s `fetchSearchPage`) — so `applyQuery`
 *  always resets and restarts from a brand-new first page. */
export function useCursorQueriedItemSet(
  node: (StacNode & { items: { kind: 'cursor' } }) | undefined,
  /** A query to apply immediately on mount instead of the default
   *  unfiltered first load — e.g. one restored from a shareable URL. Only
   *  consulted at mount (see the reset effect below); changing it on an
   *  already-mounted instance has no effect, matching `applyQuery`'s own
   *  "only a fresh explicit call starts a new query" semantics. */
  initialQuery?: CursorQuery,
): CursorItemSetState {
  const nodeHref = node?.href

  const [items, setItems] = useState<StacNode[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [matched, setMatched] = useState<number | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [appliedQuery, setAppliedQuery] = useState<CursorQuery>(initialQuery ?? EMPTY_QUERY)
  // A restored `initialQuery` (from a shareable URL) counts as "already
  // searched" — it's replaying a real search someone actually ran, not
  // browsing the default unfiltered order.
  const [hasSearched, setHasSearched] = useState(initialQuery !== undefined)

  const generationRef = useRef(0)
  const nextRef = useRef<NextLink | undefined>(undefined)
  const exhaustedRef = useRef(false)
  const appliedQueryRef = useRef<CursorQuery>(initialQuery ?? EMPTY_QUERY)
  // Synchronous companion to `loadingMore` state — closes the React
  // StrictMode double-invoke window the same way the old shared hook's
  // `loadingRef` did (see docs/DESIGN.md, `useItemSet`'s original comment).
  const loadingRef = useRef(false)

  function resetForNewQueryOrNode() {
    generationRef.current += 1
    nextRef.current = undefined
    exhaustedRef.current = false
    loadingRef.current = false
    setItems([])
    setLoadingMore(false)
    setMatched(undefined)
    setError(undefined)
  }

  // One effect, not two — resetting state and (conditionally) kicking off
  // the first fetch need to happen in the same pass: a restored
  // `initialQuery` should fetch immediately (replaying a real search), but
  // the *default*, nothing-restored case must NOT auto-fetch at all
  // (search-first — see `CursorItemSetState.status`'s `idle` doc above).
  useEffect(() => {
    resetForNewQueryOrNode()
    appliedQueryRef.current = initialQuery ?? EMPTY_QUERY
    setAppliedQuery(initialQuery ?? EMPTY_QUERY)
    setHasSearched(initialQuery !== undefined)
    if (initialQuery !== undefined) void loadMore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeHref])

  async function fetchOneCursorPage(cursorNode: StacNode & { items: { kind: 'cursor' } }, generation: number) {
    // The root's `/search` scoped to this Collection when the API has one,
    // else the Collection's own `rel:items` — see `resolveSearchTarget` for
    // the real server behavior that makes this choice matter.
    const target = await resolveSearchTarget(cursorNode)
    if (generation !== generationRef.current) return
    // `filter`/`collections` are passed on every call — they shape the fresh
    // request, and stay the merge base for a `next` link followed by POST
    // (`fetchSearchPage` never re-appends them to a followed href).
    const page = await fetchSearchPage(target.endpoint, {
      limit: CURSOR_PAGE_SIZE,
      next: nextRef.current,
      filter: appliedQueryRef.current,
      collections: target.collections,
    })
    if (generation !== generationRef.current) return // a newer applyQuery/node-change superseded this in flight
    for (const item of page.items) loader.cachePreFetched(item)
    nextRef.current = page.next
    if (!page.next) exhaustedRef.current = true
    if (page.matched != null) setMatched(page.matched)
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
      if (generation !== generationRef.current) return
      console.error('[useCursorQueriedItemSet] search request failed', err)
      exhaustedRef.current = true // don't retry a broken endpoint forever
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      // Only this generation's own request may clear the loading flags. A
      // superseded request (a newer `applyQuery`/node-change already reset
      // and re-armed them for *its* in-flight fetch) must leave them alone
      // — clearing them here used to expose a window where the newer fetch
      // was still in flight but `loadingMore` read false, so the UI briefly
      // showed "ready, 0 items" and `usePagedCursorResults`'s catch-up
      // effect fired a duplicate request for the same query (measured
      // directly: three identical requests for one restored search).
      if (generation === generationRef.current) {
        loadingRef.current = false
        setLoadingMore(false)
      }
    }
  }

  function applyQuery(q: CursorQuery) {
    if (!node) return
    resetForNewQueryOrNode()
    appliedQueryRef.current = q
    setAppliedQuery(q)
    setHasSearched(true)
    void loadMore()
  }

  function clearQuery() {
    applyQuery(EMPTY_QUERY)
  }

  if (!node) return { status: 'empty' }

  return {
    status: !hasSearched ? 'idle' : error ? 'error' : items.length === 0 && loadingMore ? 'loading' : 'ready',
    error,
    items,
    totalCount: matched,
    hasMore: !exhaustedRef.current,
    loadingMore,
    loadMore: () => void loadMore(),
    appliedQuery,
    applyQuery,
    clearQuery,
  }
}
