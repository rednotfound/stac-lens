import { useEffect, useRef, useState } from 'react'
import { fetchSearchPage, type NextLink } from '../stac/apiSearch'
import { resolveSearchTarget, type SearchTarget } from '../stac/conformance'
import { loader } from '../stac/loaderInstance'
import type { StacNode } from '../stac/types'
import { usePublishVisible } from '../components/ItemSetBrowser'
import { useItemSetStore } from '../store/itemSet'

/** How many Items the phone loads per step. Enough to see what the Items
 *  are like — names, dates, footprints on the map — and no more at once;
 *  a "load more" adds the next ten. */
export const PHONE_ITEM_LIMIT = 10
/** How many rows the phone keeps at once. Loading never stops — the list
 *  is a window that slides: once it is full, each further step drops the
 *  oldest ten as it adds the newest ten, so the rows (and the footprints on
 *  the map) stay bounded however far someone goes. Searching and paging
 *  thousands of Items with any precision remains the desktop's job. */
export const PHONE_ITEM_WINDOW = 100

export interface PhoneItemsState {
  status: 'loading' | 'ready' | 'error'
  items: StacNode[]
  /** Known for a static list (its length); for an API only when the
   *  server reports a match count. */
  total?: number
  /** More can be loaded — the list has more hrefs, or the API returned a
   *  `next` link. */
  hasMore: boolean
  /** Index (0-based) of the first row still shown; > 0 once the window
   *  has slid past the beginning. */
  windowStart: number
  loadingMore: boolean
  loadMore: () => void
  error?: string
}

interface Loaded {
  forHref: string
  items: StacNode[]
  windowStart: number
  total?: number
  /** Static: how many hrefs consumed; API: the `next` link, if any. */
  offset: number
  next?: NextLink
  target?: SearchTarget
  exhausted: boolean
}

/** Appends a step's Items and slides the window: never more than
 *  PHONE_ITEM_WINDOW rows, the oldest dropped first. */
function windowed(prev: Loaded | null, added: StacNode[]): { items: StacNode[]; windowStart: number } {
  const all = [...(prev?.items ?? []), ...added]
  const drop = Math.max(0, all.length - PHONE_ITEM_WINDOW)
  return { items: all.slice(drop), windowStart: (prev?.windowStart ?? 0) + drop }
}

/** The first Items of a Collection, ten at a time, for the phone's
 *  outline. A static list is sliced and loaded through the shared loader;
 *  an API Collection is requested in the server's default order through
 *  the same `resolveSearchTarget` the desktop's Search box uses (same
 *  endpoint, same `collections=` scoping) and continued through the
 *  server's own `next` link. Results go into the shared cache, so tapping
 *  one opens its Inspector at once. The loaded Items are published as the
 *  Collection's visible set, so the Inspector's Temporal and Spatial
 *  widgets plot them — the full function on a slice of the data. */
export function usePhoneItems(node: StacNode): PhoneItemsState {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)

  async function fetchStep(prev: Loaded | null): Promise<Loaded> {
    if (node.items.kind === 'links') {
      const all = node.items.hrefs
      const offset = prev?.offset ?? 0
      const slice = all.slice(offset, offset + PHONE_ITEM_LIMIT)
      const items = await Promise.all(slice.map((h) => loader.load(h)))
      return {
        forHref: node.href,
        ...windowed(prev, items),
        total: all.length,
        offset: offset + slice.length,
        exhausted: offset + slice.length >= all.length,
      }
    }
    const target = prev?.target ?? (await resolveSearchTarget(node as StacNode & { items: { kind: 'cursor' } }))
    const page = await fetchSearchPage(target.endpoint, {
      limit: PHONE_ITEM_LIMIT,
      collections: target.collections,
      next: prev?.next,
    })
    for (const item of page.items) loader.cachePreFetched(item)
    return {
      forHref: node.href,
      ...windowed(prev, page.items),
      total: page.matched ?? prev?.total,
      offset: (prev?.offset ?? 0) + page.items.length,
      next: page.next,
      target,
      exhausted: !page.next || page.items.length === 0,
    }
  }

  function run(prev: Loaded | null) {
    const gen = ++generation.current
    setBusy(true)
    setError(undefined)
    fetchStep(prev)
      .then((next) => {
        if (gen === generation.current) setLoaded(next)
      })
      .catch((e) => {
        if (gen === generation.current) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (gen === generation.current) setBusy(false)
      })
  }

  // First step for each node; a node change starts over.
  useEffect(() => {
    run(null)
    // `run` closes over `node`; the node is the only input that matters. A
    // step still in flight for a previous node is discarded by the
    // generation check inside `run` (the next call advances it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node])

  const current = loaded && loaded.forHref === node.href ? loaded : null
  const items = current?.items ?? []
  usePublishVisible(node.href, items)

  // On the desktop the Inspector's Temporal/Spatial widgets show only the
  // Collection's own declared extent — the Item Set box has its own Time &
  // Space view for the Items. The phone has no such box, so here the
  // Inspector's widgets *are* where the loaded Items are plotted: the
  // aggregate flag is on while this Collection's Items are the visible set
  // and off again when the rows unmount.
  const ready = !!current
  const setShowOnLenses = useItemSetStore((s) => s.setShowOnLenses)
  useEffect(() => {
    if (!ready) return
    setShowOnLenses(true)
    return () => setShowOnLenses(false)
  }, [ready, node.href, setShowOnLenses])

  return {
    status: error && !current ? 'error' : current ? 'ready' : 'loading',
    items,
    total: current?.total,
    hasMore: !!current && !current.exhausted,
    windowStart: current?.windowStart ?? 0,
    loadingMore: busy && !!current,
    loadMore: () => {
      if (current && !busy && !current.exhausted) run(current)
    },
    error,
  }
}
