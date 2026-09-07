import { useEffect, useState } from 'react'
import { loader } from '../stac/loaderInstance'
import type { StacNode } from '../stac/types'

const ITEM_LIMIT = 100

export type SelectedItemsState =
  | { status: 'empty'; reason: 'no-selection' | 'no-direct-items' }
  | { status: 'loading' }
  | {
      status: 'ready'
      node: StacNode
      items: StacNode[]
      totalItemCount: number
      /** Set when the original selection was an Item — that item should be
       *  highlighted among its siblings in whichever lens consumes this. */
      highlightHref?: string
    }

/** Resolves whatever is selected in Structure Lens to "the collection whose
 *  items should be shown": a selected Collection/Catalog with direct items
 *  shows itself; a selected Item shows its parent collection with itself
 *  highlighted. Shared by Time Lens and Space Lens so both stay in sync off
 *  the same selection without duplicating the fetch. */
export function useSelectedItems(selectedHref: string | null): SelectedItemsState {
  const [ready, setReady] = useState<
    { targetHref: string; node: StacNode; items: StacNode[]; totalItemCount: number } | undefined
  >()
  const [loading, setLoading] = useState(false)

  const selectedNode = selectedHref ? loader.get(selectedHref) : undefined
  const targetHref = selectedNode
    ? selectedNode.type === 'Item'
      ? selectedNode.parentHref
      : selectedHref
    : undefined

  useEffect(() => {
    if (!targetHref) {
      setReady(undefined)
      return
    }
    let cancelled = false
    setLoading(true)
    loader
      .load(targetHref)
      .then(async (node) => {
        if (cancelled) return
        const totalItemCount = node.items.kind === 'links' ? node.items.hrefs.length : 0
        const items = totalItemCount > 0 ? await loader.loadItems(node, ITEM_LIMIT) : []
        if (cancelled) return
        setReady({ targetHref, node, items, totalItemCount })
        setLoading(false)
      })
      .catch((err) => {
        console.error('[useSelectedItems] failed', err)
      })
    return () => {
      cancelled = true
    }
  }, [targetHref])

  if (!selectedHref) return { status: 'empty', reason: 'no-selection' }
  if (!targetHref) return { status: 'empty', reason: 'no-direct-items' }
  if (!ready || ready.targetHref !== targetHref || loading) return { status: 'loading' }
  if (ready.totalItemCount === 0) return { status: 'empty', reason: 'no-direct-items' }

  return {
    status: 'ready',
    node: ready.node,
    items: ready.items,
    totalItemCount: ready.totalItemCount,
    highlightHref: selectedNode?.type === 'Item' ? selectedHref : undefined,
  }
}
