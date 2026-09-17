import { useEffect, useMemo, useRef, useState } from 'react'
import { loader } from '../stac/loaderInstance'
import type { StacNode } from '../stac/types'

export const DEFAULT_LINKS_PAGE_SIZE = 40

export type LinksPagedItemSetState =
  | { status: 'empty' }
  | {
      status: 'loading' | 'ready'
      /** The last page that finished loading — kept visible, never blanked,
       *  while a *different* page is being fetched (see `loadingPage`), so
       *  flipping pages never looks like the data vanished. */
      pageItems: StacNode[]
      /** 0-based *target* page — the one the UI should label as current,
       *  even before its own fetch resolves (see `pageItems`'s note). */
      pageIndex: number
      pageSize: number
      /** Always exact — the full href array is known up front, no server
       *  pagination concept applies to a static catalog. */
      totalItems: number
      totalPages: number
      /** True while `pageIndex` doesn't match whatever `pageItems` is
       *  currently showing — i.e. a page not yet in the local cache is in
       *  flight. Revisiting an already-cached page never sets this. */
      loadingPage: boolean
      /** Every already-fetched Item from every OTHER page still held in the
       *  local page cache — i.e. everything a prior page turn has already
       *  paid the network cost for, excluding whatever `pageItems` is
       *  showing right now. This is an explicit request, not a guess:
       *  already-loaded pages' data should stay visible on the map/timeline,
       *  dimmed, not gone — this is exactly that set, left for the caller to
       *  render de-emphasized alongside the current page's own full-color
       *  items. */
      otherLoadedItems: StacNode[]
      goToPage: (index0Based: number) => void
      setPageSize: (n: number) => void
    }

/** Real page-based browsing for a static catalog's flat, fully-known href
 *  array — a fundamentally different shape from an API's opaque cursor
 *  (see `useCursorQueriedItemSet`), so this is its own hook rather than one
 *  more branch of a shared one. Each page's Items are fetched (one network
 *  request per href — static catalogs have no batch endpoint) only the
 *  first time that page is visited; revisiting an already-seen page reads
 *  the local `pageCache` synchronously, no re-fetch, no loading flicker. */
export function useLinksPagedItemSet(
  node: (StacNode & { items: { kind: 'links' } }) | undefined,
): LinksPagedItemSetState {
  const nodeHref = node?.href
  const totalItems = node?.items.hrefs.length ?? 0

  const [pageCache, setPageCache] = useState<Record<number, StacNode[]>>({})
  const [pageIndex, setPageIndex] = useState(0) // target/requested page
  const [renderedIndex, setRenderedIndex] = useState(0) // page whose items are actually shown
  const [pageSize, setPageSizeState] = useState(DEFAULT_LINKS_PAGE_SIZE)

  const generationRef = useRef(0)

  // Node changed — a whole different href array, previous pages are
  // meaningless for it. Page size deliberately survives a node change (a
  // UI preference, not per-collection state).
  useEffect(() => {
    generationRef.current += 1
    setPageCache({})
    setPageIndex(0)
    setRenderedIndex(0)
  }, [nodeHref])

  useEffect(() => {
    if (!node || totalItems === 0) return
    if (pageCache[pageIndex]) {
      // Already fetched (e.g. navigating back to a seen page) — show
      // immediately, no network request.
      setRenderedIndex(pageIndex)
      return
    }
    const generation = generationRef.current
    const hrefs = node.items.hrefs
    const slice = hrefs.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize)
    Promise.allSettled(slice.map((h) => loader.load(h))).then((results) => {
      if (generation !== generationRef.current) return // node/page-size changed mid-flight
      const items = results
        .filter((r): r is PromiseFulfilledResult<StacNode> => r.status === 'fulfilled')
        .map((r) => r.value)
      setPageCache((prev) => ({ ...prev, [pageIndex]: items }))
      setRenderedIndex(pageIndex)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pageCache read but intentionally not a dep: this effect should only re-run when the *target* page/size/node changes, not on every cache write it itself causes
  }, [nodeHref, pageIndex, pageSize, totalItems])

  function goToPage(index0Based: number) {
    if (!node) return
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
    setPageIndex(Math.min(Math.max(0, index0Based), totalPages - 1))
  }

  function setPageSize(n: number) {
    // Page boundaries shift with page size — every cached page's contents
    // are now the wrong slice, so the cache and current position both reset.
    generationRef.current += 1
    setPageCache({})
    setPageIndex(0)
    setRenderedIndex(0)
    setPageSizeState(n)
  }

  // Flattens every cached page except `renderedIndex` into one array —
  // pages are disjoint hrefs slices by construction, so no dedup is needed
  // beyond simply excluding the current page's own entry. Computed
  // unconditionally, before the early `status: 'empty'` return below, same
  // as every other Hook call in this function — a conditional `useMemo`
  // call would violate the rules of Hooks the moment `node`/`totalItems`
  // ever differs between renders.
  const otherLoadedItems = useMemo(() => {
    const out: StacNode[] = []
    for (const [idx, items] of Object.entries(pageCache)) {
      if (Number(idx) === renderedIndex) continue
      out.push(...items)
    }
    return out
  }, [pageCache, renderedIndex])

  if (!node || totalItems === 0) return { status: 'empty' }

  const totalPages = Math.ceil(totalItems / pageSize)
  const pageItems = pageCache[renderedIndex] ?? []
  const loadingPage = pageIndex !== renderedIndex || !pageCache[renderedIndex]
  const status = Object.keys(pageCache).length === 0 ? 'loading' : 'ready'

  return {
    status,
    pageItems,
    pageIndex,
    pageSize,
    totalItems,
    totalPages,
    loadingPage,
    otherLoadedItems,
    goToPage,
    setPageSize,
  }
}
