import { useEffect, useMemo, useRef, useState } from 'react'
import { useCursorQueriedItemSet, type CursorQuery } from './useCursorQueriedItemSet'
import type { StacNode } from '../stac/types'

export const CURSOR_RESULTS_PAGE_SIZE_OPTIONS = [20, 40, 100, 200]
export const DEFAULT_CURSOR_RESULTS_PAGE_SIZE = 40

export type PagedCursorResultsState =
  | { status: 'empty' }
  | {
      /** `idle`: no search has been run yet (search-first — see
       *  `CursorItemSetState.status`'s own doc). No pager/results to show;
       *  render a "run a search" prompt instead. */
      status: 'idle' | 'loading' | 'ready' | 'error'
      /** See `CursorItemSetState.error`. */
      error?: string
      pageItems: StacNode[]
      dimmedItems: StacNode[]
      pageIndex: number
      pageSize: number
      totalPages: number
      /** True while `totalPages` is a lower bound, not a confirmed final
       *  count — the server never reported a total match count and there's
       *  still more to fetch. False once either becomes known (an exact
       *  `matched` count from the server, or the buffer is exhausted). */
      totalPagesIsLowerBound: boolean
      /** Exact when `!totalPagesIsLowerBound`; otherwise "at least this
       *  many" (however much has actually been loaded so far). */
      totalItems: number
      /** True while the requested page isn't in the buffer yet — a forward
       *  jump past what's loaded, being caught up to. */
      loadingPage: boolean
      loadingPageLabel?: string
      goToPage: (index0Based: number) => void
      setPageSize: (n: number) => void
      appliedQuery: CursorQuery
      applyQuery: (q: CursorQuery) => void
      clearQuery: () => void
      /** True while a background fetch (a scroll-triggered load, or a
       *  catch-up fetch for a page jump beyond the buffer) is in flight —
       *  used to disable Search while one's underway. No "load everything
       *  remaining" affordance exists any more (deliberately removed —
       *  see `ItemSetResultsPanel`'s own comment on why), so `hasMore`
       *  itself isn't exposed here; nothing outside this hook needs it. */
      loadingMore: boolean
    }

/** Numbered-page presentation over `useCursorQueriedItemSet`'s append-only
 *  buffer — the same "page N of M" shape a static catalog's
 *  `useLinksPagedItemSet` exposes, so both can render through the shared
 *  `ItemSetResultsPanel` (docs/DESIGN.md): once a query has produced a
 *  result, presenting it page-by-page is the same problem a static
 *  catalog's already-known href list has. A STAC API only ever exposes a
 *  forward-only opaque `rel:next` cursor though, never true random access,
 *  so a page beyond what's already buffered needs a "catch-up" fetch first
 *  (below) — a page already covered by the buffer is a pure synchronous
 *  slice instead: no fetch, no loading state, instant. */
export function usePagedCursorResults(
  node: (StacNode & { items: { kind: 'cursor' } }) | undefined,
  initialQuery?: CursorQuery,
): PagedCursorResultsState {
  const inner = useCursorQueriedItemSet(node, initialQuery)

  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSizeState] = useState(DEFAULT_CURSOR_RESULTS_PAGE_SIZE)
  const [catchingUp, setCatchingUp] = useState(false)

  // A fresh `appliedQuery` object identity means a real `applyQuery`/
  // `clearQuery`/mount just happened (`useCursorQueriedItemSet` never
  // mutates `appliedQuery` in place — see its own state) — reset back to
  // page 1 for the new result set. Computed during render and compared
  // against a ref, React's own documented pattern for "adjust state when
  // an upstream value changes" without an extra effect round-trip.
  const lastQueryRef = useRef<CursorQuery | undefined>(undefined)
  const appliedQuery = inner.status === 'empty' ? undefined : inner.appliedQuery
  if (appliedQuery !== undefined && appliedQuery !== lastQueryRef.current) {
    lastQueryRef.current = appliedQuery
    if (pageIndex !== 0) setPageIndex(0)
  }

  const items = inner.status === 'empty' ? [] : inner.items
  const hasMore = inner.status !== 'empty' && inner.hasMore
  const loadingMore = inner.status !== 'empty' && inner.loadingMore
  const totalCount = inner.status === 'empty' ? undefined : inner.totalCount
  const loadMore = inner.status === 'empty' ? undefined : inner.loadMore

  // Catch-up: jumping to a page beyond the already-loaded buffer needs a
  // sequential loadMore() first — a cursor can't be asked for "page 7"
  // directly. Re-fires on its own as each successive `loadMore()` resolves
  // (via the `items.length`/`loadingMore` deps) until the target page is
  // covered or the buffer is exhausted.
  useEffect(() => {
    // Also skip while `idle` — nothing has been searched yet, so
    // `hasMore` (derived from `!exhaustedRef.current`, which starts
    // `false`) would otherwise misread as "more to fetch" and trigger a
    // request before any search was ever requested.
    if (inner.status === 'empty' || inner.status === 'idle') return
    const needed = (pageIndex + 1) * pageSize
    const stillShort = needed > items.length
    if (stillShort && hasMore && !loadingMore) {
      setCatchingUp(true)
      loadMore?.()
    } else if (catchingUp && (!stillShort || !hasMore)) {
      setCatchingUp(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inner.status, pageIndex, pageSize, items.length, hasMore, loadingMore])

  // Once exhausted, clamp back to the true last page if the requested one
  // turned out not to exist — mirrors `useLinksPagedItemSet.goToPage`'s own
  // clamp, just deferred here until exhaustion is actually known.
  useEffect(() => {
    if (inner.status === 'empty' || inner.status === 'idle' || hasMore) return
    const lastPageIndex = Math.max(0, Math.ceil(items.length / pageSize) - 1)
    if (pageIndex > lastPageIndex) setPageIndex(lastPageIndex)
  }, [inner.status, hasMore, items.length, pageSize, pageIndex])

  // Memoized on the buffer's own identity plus the page window — `items`
  // (from `useCursorQueriedItemSet`) only gets a new array reference when
  // real data actually arrives, so on every *other* re-render (this
  // component tree sits under `StructureTree`'s own `viewTransform` state,
  // which updates on every tree-canvas pan/zoom tick, regardless of
  // whether any Item data changed) these two stay the exact same array
  // reference. That matters well beyond this hook: `ItemsMap`'s own
  // layer-rebuild effect (a real `L.rectangle()` per Item, added straight
  // to Leaflet — no virtual-DOM diffing to fall back on) and
  // `ItemsTimeline`'s own sort/group/lane-pack `useMemo` chain both key off
  // `pageItems`/`dimmedItems` by reference; a fresh array every render
  // silently defeated both of those, forcing a full rebuild of every
  // Leaflet layer (and Item Set potentially holds thousands of Items once
  // a few pages have loaded) on every single pan/zoom frame, with nothing
  // about the actual displayed batch having changed at all — confirmed
  // directly as a real, reported perf problem: "加载了一段时间以后呢,我会
  // 发现我整个页面里面拖拽啊,什么东西都比较卡" (after loading for a while,
  // dragging anything on the whole page feels janky), and measured
  // directly before this fix — one ordinary canvas-pan gesture (~20 mouse-
  // move events) triggered 42 full Leaflet layer rebuilds against a
  // ~4,000-Item buffer, none of which had anything to do with the map.
  // The linter can't see that `items` (a local `const` re-derived from
  // `inner.items` every render, per the ternary above) is only a *new
  // binding*, not a new *array* — `inner.items` is itself a `useState`
  // value inside `useCursorQueriedItemSet`, only ever reassigned via
  // `setItems` when a fetch actually resolves, so it's genuinely stable
  // across every other re-render; confirmed directly (42 real Leaflet
  // rebuilds during one pan → 0, after this fix landed).
  const pageItems = useMemo(
    () => items.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, pageIndex, pageSize],
  )
  const dimmedItems = useMemo(
    () => items.slice(0, pageIndex * pageSize).concat(items.slice((pageIndex + 1) * pageSize)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, pageIndex, pageSize],
  )

  if (inner.status === 'empty') return { status: 'empty' }

  const totalPagesIsLowerBound = totalCount == null && hasMore
  const totalPages =
    totalCount != null
      ? Math.max(1, Math.ceil(totalCount / pageSize))
      : Math.max(Math.ceil(items.length / pageSize) || 1, pageIndex + 1)

  function goToPage(index0Based: number) {
    const upperBound = totalCount != null ? Math.max(0, Math.ceil(totalCount / pageSize) - 1) : Infinity
    setPageIndex(Math.min(Math.max(0, index0Based), upperBound))
  }

  function setPageSize(n: number) {
    setPageSizeState(n)
    setPageIndex(0)
  }

  return {
    status: inner.status,
    error: inner.error,
    pageItems,
    dimmedItems,
    pageIndex,
    pageSize,
    totalPages,
    totalPagesIsLowerBound,
    totalItems: totalCount ?? items.length,
    loadingPage: catchingUp,
    loadingPageLabel: catchingUp ? 'Fetching more results…' : undefined,
    goToPage,
    setPageSize,
    appliedQuery: inner.appliedQuery,
    applyQuery: inner.applyQuery,
    clearQuery: inner.clearQuery,
    loadingMore,
  }
}
