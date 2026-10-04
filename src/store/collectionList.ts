import { create } from 'zustand'
import { EMPTY_COLLECTION_FILTER, type CollectionFilter } from '../stac/collectionFacets'

/** What a Collection Search answered: the query, the hrefs in the server's
 *  order, `numberMatched` when reported, and whether it had more than were
 *  fetched (stopped at the safety cap). */
export interface ServerResults {
  q: string
  hrefs: string[]
  matched?: number
  more: boolean
}

/** The Children list's state (DESIGN §128), per container — the browsed
 *  node whose children are listed — for one open catalog. Kept
 *  here, not in the list component, because the views read it too: a
 *  filter lights the matching children in every view. Cleared when another
 *  catalog opens. */
interface CollectionListState {
  filters: Record<string, CollectionFilter>
  setFilter: (containerHref: string, filter: CollectionFilter) => void
  /** Server results for a container whose list is incomplete and whose API
   *  declares Collection Search free text. */
  serverResults: Record<string, ServerResults | undefined>
  setServerResults: (containerHref: string, results: ServerResults | undefined) => void
  /** The container whose list the person left through a row's "Items →",
   *  so the Items panel can offer the way back to it. */
  origin: string | null
  setOrigin: (containerHref: string | null) => void
  /** For a node with both children and Items of its own (a static Catalog
   *  with Items), which one the pane shows. Absent: decided by `decidePane`
   *  — Items, unless it has many children. */
  tab: Record<string, 'collections' | 'items'>
  setTab: (containerHref: string, tab: 'collections' | 'items') => void
  /** The browsed node's loaded children, as the structure has them — how
   *  many — published from inside the explorer (`ChildCountBridge`) for
   *  `App`, which sits outside the structure and decides whether the list
   *  opens by itself. */
  browsedChildren: { href: string; count: number } | null
  setBrowsedChildren: (v: { href: string; count: number } | null) => void
  clear: () => void
}

export const useCollectionListStore = create<CollectionListState>((set) => ({
  filters: {},
  serverResults: {},
  origin: null,
  tab: {},
  browsedChildren: null,
  setBrowsedChildren: (browsedChildren) => set({ browsedChildren }),
  setFilter: (href, filter) => set((s) => ({ filters: { ...s.filters, [href]: filter } })),
  setServerResults: (href, results) => set((s) => ({ serverResults: { ...s.serverResults, [href]: results } })),
  setOrigin: (origin) => set({ origin }),
  setTab: (href, tab) => set((s) => ({ tab: { ...s.tab, [href]: tab } })),
  // `browsedChildren` is left alone: it names the node it counts, so it is
  // never read for another one, and clearing it here raced the bridge —
  // children's effects run first, so a deep link's count was published and
  // then wiped in the same commit, and the list never opened (review H3).
  clear: () => set({ filters: {}, serverResults: {}, origin: null, tab: {} }),
}))

export function filterFor(
  filters: Record<string, CollectionFilter>,
  href: string | null | undefined,
): CollectionFilter {
  return (href && filters[href]) || EMPTY_COLLECTION_FILTER
}
