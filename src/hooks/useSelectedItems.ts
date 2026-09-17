import { useEffect, useMemo, useState } from 'react'
import { loader } from '../stac/loaderInstance'
import { useItemSetStore } from '../store/itemSet'
import { useSelectionStore } from '../store/selection'
import { classifyNodeShape, type StacNode } from '../stac/types'

const EMPTY_ITEMS: StacNode[] = []

export type SelectedItemsState =
  | { status: 'empty'; reason: 'no-selection' | 'no-direct-items' }
  | { status: 'loading' }
  | {
      status: 'ready'
      node: StacNode
      items: StacNode[]
      /** Undefined, not zero, when the Collection is API-searched and no
       *  query has run yet to learn a real count (or the API never reports
       *  one at all — see docs/DESIGN.md §22). */
      totalItemCount?: number
      /** Set when the original selection was an Item — that item should be
       *  highlighted among its siblings in whichever lens consumes this. */
      highlightHref?: string
    }

/** Resolves whatever is selected in Structure Lens to "the Collection whose
 *  own extent Time/Space Lens should show, plus whichever of its items are
 *  currently visible in Item Set" — never an independent bulk fetch of its
 *  own. Selecting a Collection alone (Item Set not yet browsed/searched)
 *  shows only its own stated temporal/spatial extent; individual item marks
 *  and footprints come entirely from `useItemSetStore`, kept in sync by
 *  `ItemSetBrowser`. This is the fix for "selecting an object should stay
 *  scoped to that object" — see docs/DESIGN.md §21: this hook used to load
 *  up to 100 Items itself on every Collection selection, which is exactly
 *  the silent over-fetching this app already fixed once for Structure
 *  Lens's auto-cascade.
 *
 *  Targets `browsingHref` (the Collection you're actually browsing), not
 *  an Item's own resolved `parentHref` — those can genuinely disagree
 *  (§15), and re-targeting on every Item selection is what caused "我就
 *  lost掉了" (§21): picking an Item from one Collection's Item Set whose
 *  `rel:collection` happens to point elsewhere silently swapped Time/Space
 *  Lens to a Collection you hadn't browsed yet (0 items, unfamiliar
 *  extent) instead of staying put with that Item highlighted in context. */
export function useSelectedItems(): SelectedItemsState {
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  const browsingHref = useSelectionStore((s) => s.browsingHref)
  const selectedNode = selectedHref ? loader.get(selectedHref) : undefined
  const targetHref = selectedNode
    ? selectedNode.type === 'Item'
      ? (browsingHref ?? selectedNode.parentHref)
      : selectedHref
    : undefined

  // The loader's cache is read synchronously during render — a node
  // reachable via Structure Lens is already loaded by the time it's
  // selectable, so this covers nearly every case with no extra render.
  // State exists only for the one case it doesn't: a deep-linked Item
  // whose parent Collection was never independently visited, which the
  // effect below fetches. The fetched node is keyed by the href it was
  // fetched for, so a stale result from a previous target is never shown.
  const [fetched, setFetched] = useState<{ href: string; node: StacNode } | undefined>(undefined)
  const targetNode = targetHref
    ? (loader.get(targetHref) ?? (fetched?.href === targetHref ? fetched.node : undefined))
    : undefined

  useEffect(() => {
    if (!targetHref || loader.get(targetHref)) return
    let cancelled = false
    loader
      .load(targetHref)
      .then((node) => {
        if (!cancelled) setFetched({ href: targetHref, node })
      })
      .catch((err) => {
        console.error('[useSelectedItems] failed', err)
      })
    return () => {
      cancelled = true
    }
  }, [targetHref])

  const forHref = useItemSetStore((s) => s.forHref)
  const visibleHrefs = useItemSetStore((s) => s.visibleHrefs)
  const showOnLenses = useItemSetStore((s) => s.showOnLenses)
  const items = useMemo(() => {
    // A specific Item is selected (not just its Collection) — show only
    // that one, not the whole neighborhood Item Set has loaded. Comparing
    // in context is the Collection Inspector's own browse section's job
    // (browsing the Collection, or a search-filtered subset of it); once
    // you've drilled down to one Item, "selecting an object stays scoped to
    // that object" applies here too — asked directly: "既然我选中了一个item,
    // 为什么还要显示所有item的时间和范围呢?" (having selected one Item, why
    // still show every Item's time and extent?). Using the Item itself
    // rather than filtering it out of `visibleHrefs` also sidesteps needing
    // it to actually be a member of whatever's currently browsed (it may
    // not be — see §21's `rel:collection`/`rel:parent` mismatch case).
    if (selectedNode?.type === 'Item') return [selectedNode]
    // Merely selecting/browsing a Collection must never show its Items'
    // aggregate on its own — only its own stated extent (`node.temporal`/
    // `node.spatial`, read directly by Time/Space Lens, not through this
    // hook's `items`). Showing the aggregate requires `showOnLenses` — a
    // plain feature toggle, not a "selection" of Item Set as its own object
    // (that framing was retired — see docs/DESIGN.md's three-object-
    // architecture update: Item, Catalog, Collection, nothing else). Its
    // own UI was removed from the Collection Inspector along with the rest
    // of "Provided by this app" (docs/DESIGN.md §41) and has not been
    // placed anywhere yet — `showOnLenses` currently defaults to `false`
    // with no way to flip it, so this branch is presently unreachable in
    // practice until that UI lands somewhere new.
    if (!targetHref || forHref !== targetHref || !showOnLenses) return EMPTY_ITEMS
    return visibleHrefs.map((h) => loader.get(h)).filter((n): n is StacNode => !!n)
  }, [selectedNode, targetHref, forHref, visibleHrefs, showOnLenses])

  if (!selectedHref) return { status: 'empty', reason: 'no-selection' }
  if (!targetHref) return { status: 'empty', reason: 'no-direct-items' }
  if (!targetNode || targetNode.href !== targetHref) return { status: 'loading' }

  // A `cursor` (API-searched) node's real item count is unknown until
  // queried — `classifyNodeShape` already treats that as "assume non-empty
  // until proven otherwise" rather than requiring a known positive count,
  // same convention used for the tree's own item badge (StructureTree.tsx).
  const shape = classifyNodeShape(targetNode)
  if (shape !== 'leaf-items' && shape !== 'mixed') {
    return { status: 'empty', reason: 'no-direct-items' }
  }
  const totalItemCount = targetNode.items.kind === 'links' ? targetNode.items.hrefs.length : undefined

  return {
    status: 'ready',
    node: targetNode,
    items,
    totalItemCount,
    highlightHref: selectedNode?.type === 'Item' ? selectedHref : undefined,
  }
}
