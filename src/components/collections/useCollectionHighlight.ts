import { useMemo } from 'react'
import { useStructure } from '../../hooks/useStructure'
import { COLLECTIONS_SAFETY_CAP } from '../../hooks/useStructureTree'
import { filterCollections, isFilterActive } from '../../stac/collectionFacets'
import { loader } from '../../stac/loaderInstance'
import type { StacNode } from '../../stac/types'
import { filterFor, useCollectionListStore } from '../../store/collectionList'
import { useSelectionStore } from '../../store/selection'
import { containerChildren } from './containerChildren'
import { usePaneState } from './usePaneMode'
import { useItemSetStore } from '../../store/itemSet'
import { useIsNarrow } from '../../hooks/useMediaQuery'

export interface CollectionHighlight {
  /** The browsed node whose children are being filtered. */
  containerHref: string
  /** Its children that match; every other child is drawn dimmed. */
  matches: ReadonlySet<string>
}

/** What the Collections list's filter means for the views: while the
 *  browsed node's list has a filter (or server results), its matching
 *  children are lit and the rest dimmed — the structure itself is never
 *  changed (DESIGN §128; §92's doubt about a search that swaps a node's
 *  children). `null` when nothing is filtered. Memoized on the filter and
 *  the loaded children, since every view calls it on every render. */
export function useCollectionHighlight(): CollectionHighlight | null {
  const browsingHref = useSelectionStore((s) => s.browsingHref)
  const filter = useCollectionListStore((s) => filterFor(s.filters, browsingHref))
  const server = useCollectionListStore((s) => (browsingHref ? s.serverResults[browsingHref] : undefined))
  // Only while the filter is in sight: the column open on the Children
  // list, on a desktop. Hidden, or on the Items tab, or on a phone (no
  // list), the views must not stay dimmed for a reason no longer shown.
  const panelOpen = useItemSetStore((s) => s.panelOpen)
  const pane = usePaneState()
  const narrow = useIsNarrow()
  const inSight = panelOpen && pane.mode === 'collections' && !!pane.node && !narrow
  const { root, isExpanded, isLoading } = useStructure()
  const kids = browsingHref
    ? containerChildren(root, browsingHref, isExpanded, isLoading, COLLECTIONS_SAFETY_CAP)
    : undefined
  const children = kids?.children
  const signature = children ? `${children.length}|${children[0]?.href}|${children[children.length - 1]?.href}` : ''
  return useMemo(() => {
    if (!inSight || !browsingHref || !children) return null
    if (!isFilterActive(filter) && !server) return null
    const pool: StacNode[] = server
      ? server.hrefs.map((h) => loader.get(h)).filter((n): n is StacNode => !!n)
      : children
    // Server results already answer the text; only the facets remain local.
    const matched = filterCollections(pool, server ? { ...filter, text: '' } : filter)
    return { containerHref: browsingHref, matches: new Set(matched.map((n) => n.href)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `children` is keyed by `signature`; it is rebuilt on every structure render
  }, [inSight, browsingHref, filter, server, signature])
}
