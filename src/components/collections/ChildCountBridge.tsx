import { useEffect } from 'react'
import { useStructure } from '../../hooks/useStructure'
import { COLLECTIONS_SAFETY_CAP } from '../../hooks/useStructureTree'
import { loader } from '../../stac/loaderInstance'
import { useCollectionListStore } from '../../store/collectionList'
import { useSelectionStore } from '../../store/selection'
import { containerChildren } from './containerChildren'

/** Publishes how many children (Catalogs and Collections) the browsed
 *  node has, for `App` (outside the structure). Renders nothing. */
export function ChildCountBridge() {
  const browsingHref = useSelectionStore((s) => s.browsingHref)
  const setBrowsedChildren = useCollectionListStore((s) => s.setBrowsedChildren)
  const { root, isExpanded, isLoading } = useStructure()
  const kids = browsingHref
    ? containerChildren(root, browsingHref, isExpanded, isLoading, COLLECTIONS_SAFETY_CAP)
    : undefined
  // Before the node is opened, its `child` links already say how many there
  // are (not what they are): enough to decide whether the list opens by
  // itself — a deep link selects a Catalog without opening it, and the
  // list opens it.
  const declared = browsingHref ? (loader.get(browsingHref)?.childHrefs.length ?? 0) : 0
  const ready = kids?.status === 'ready'
  // The larger of the two once loaded: a static first page (NZ Imagery: 100
  // of 800) must not shrink the count it was opened for.
  const count = ready ? Math.max(kids.children.length, declared) : declared > 0 ? declared : -1
  useEffect(() => {
    setBrowsedChildren(browsingHref && count >= 0 ? { href: browsingHref, count } : null)
  }, [browsingHref, count, setBrowsedChildren])
  return null
}
