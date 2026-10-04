import { loader } from '../../stac/loaderInstance'
import type { StacNode } from '../../stac/types'
import { useCollectionListStore } from '../../store/collectionList'
import { useItemSetStore } from '../../store/itemSet'
import { useSelectionStore } from '../../store/selection'
import { canExpandNode, hasDirectItems } from '../tree/treeGeometry'
import { AUTO_OPEN_MIN_CHILDREN } from './containerChildren'

export interface PaneState {
  /** The browsed node, when it has anything to list. */
  node?: StacNode
  /** Its Items (static links or an API search), when it has any. */
  itemsNode?: StacNode
  hasChildren: boolean
  /** What the contents pane shows for it. */
  mode: 'collections' | 'items'
  /** Loaded children, once the structure has them. */
  childInfo?: { count: number }
  /** Whether the pane should open by itself: Items to list, or many
   *  children (`AUTO_OPEN_MIN_CHILDREN`). */
  toShow: boolean
}

/** What the contents pane shows for the browsed node (DESIGN §128) — one
 *  answer for `App` (the pane, its toggle, when it opens) and for the views
 *  (whether a node's Items are open), outside or inside the structure. */
export function usePaneState(): PaneState {
  const browsingHref = useSelectionStore((s) => s.browsingHref)
  const browsed = useCollectionListStore((s) => s.browsedChildren)
  const tab = useCollectionListStore((s) => (browsingHref ? s.tab[browsingHref] : undefined))
  const linkedSearchFor = useItemSetStore((s) => s.pendingInitialQuery?.forHref)
  const browsingNode = browsingHref ? loader.get(browsingHref) : undefined
  return decidePane({
    browsingNode,
    childInfo: browsed && browsed.href === browsingHref ? browsed : undefined,
    tab,
    linkedSearchFor,
  })
}

/** The decision itself, pure (unit-tested). */
export function decidePane({
  browsingNode,
  childInfo,
  tab,
  linkedSearchFor,
}: {
  browsingNode: StacNode | undefined
  childInfo: { count: number } | undefined
  tab: 'collections' | 'items' | undefined
  linkedSearchFor: string | undefined
}): PaneState {
  const itemsNode = browsingNode && hasDirectItems(browsingNode) ? browsingNode : undefined
  const hasChildren = !!browsingNode && canExpandNode(browsingNode)
  const node = browsingNode && (itemsNode || hasChildren) ? browsingNode : undefined
  const collectionsToShow = (childInfo?.count ?? 0) >= AUTO_OPEN_MIN_CHILDREN
  // A node with both (a Catalog with Items of its own) shows its Items by
  // default — unless it has many children, or a link names its Items.
  const mode = !itemsNode
    ? 'collections'
    : !hasChildren
      ? 'items'
      : (tab ?? (linkedSearchFor !== itemsNode.href && collectionsToShow ? 'collections' : 'items'))
  return { node, itemsNode, hasChildren, mode, childInfo, toShow: !!itemsNode || collectionsToShow }
}
