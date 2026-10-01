import type { TreeDatum } from '../../hooks/useStructureTree'
import type { StacNode } from '../../stac/types'
import { hasDirectItems } from './treeGeometry'

/** How many of the Items window's page the tree shows as leaves. Ten —
 *  the phone outline's scale — because the tree is a sketch of where the
 *  Items sit, not the place to read them; a page of forty to two hundred
 *  leaves is the wall the tree was once relieved of. The rest of the page
 *  is one leaf saying how many more, pointing at the window. */
export const TREE_ITEM_LEAVES = 10

/** A tree datum as the Tree view lays it out: the structure's own datum
 *  plus, under a browsed Collection, the Items window's page as leaves. */
export interface ViewDatum extends TreeDatum {
  children?: ViewDatum[]
  /** This leaf is one Item of a page; `current` when that page is the
   *  one the Items window shows, false for a page last seen. */
  itemLeaf?: { current: boolean; hostHref: string; offPage?: boolean }
  /** The trailing leaf: how much of the page is not drawn. */
  moreItems?: { current: boolean; hostHref: string; remaining: number; pageIndex: number; pageTotal: number }
}

export interface ItemLeafContext {
  /** The Collection the Items window shows (`browsingHref`), if any. */
  browsingHref: string | null
  /** The page the window shows, as nodes, when its `forHref` matches. */
  windowPage: { forHref: string | null; items: StacNode[]; pageIndex: number }
  /** The page a Collection last showed, from its session. */
  rememberedPage: (node: StacNode) => { items: StacNode[]; pageIndex: number } | undefined
  /** The selected Item, if it is one, and the Collection it is browsed
   *  under; drawn as a leaf there whenever the leaves do not include it. */
  selectedItem?: { node: StacNode; hostHref: string }
}

/** The structure's datum tree with Item leaves added under every
 *  Collection that has been browsed: the window's page for the Collection
 *  being browsed, the page last seen for the others. Pure — the same
 *  reading of the shared state the outline and the icicle make, in the
 *  tree's own vocabulary. Structural children come first; Item leaves
 *  follow them, whether or not the Collection is expanded (Items are not
 *  part of expansion). */
export function withItemLeaves(root: TreeDatum, ctx: ItemLeafContext): ViewDatum {
  function visit(datum: TreeDatum): ViewDatum {
    const children = datum.children?.map(visit)
    if (datum.moreCount || !hasDirectItems(datum.node)) return { ...datum, children }
    const current = datum.href === ctx.browsingHref
    const page = current
      ? ctx.windowPage.forHref === datum.href
        ? { items: ctx.windowPage.items, pageIndex: ctx.windowPage.pageIndex }
        : undefined
      : ctx.rememberedPage(datum.node)
    const shown = page ? page.items.slice(0, TREE_ITEM_LEAVES) : []
    const leaves: ViewDatum[] = shown.map((item) => ({
      href: `${datum.href}#item:${item.href}`,
      node: item,
      itemLeaf: { current, hostHref: datum.href },
    }))
    // The selected Item, when none of the leaves is it (a reload, a link,
    // a search that moved on, a page turned): first, marked off the page.
    const sel = ctx.selectedItem
    if (sel && sel.hostHref === datum.href && !shown.some((i) => i.href === sel.node.href)) {
      leaves.unshift({
        href: `${datum.href}#item:${sel.node.href}`,
        node: sel.node,
        itemLeaf: { current: true, hostHref: datum.href, offPage: true },
      })
    }
    if (page && page.items.length > shown.length) {
      leaves.push({
        href: `${datum.href}#more-items`,
        node: datum.node,
        moreItems: {
          current,
          hostHref: datum.href,
          remaining: page.items.length - shown.length,
          pageIndex: page.pageIndex,
          pageTotal: page.items.length,
        },
      })
    }
    if (leaves.length === 0) return { ...datum, children }
    return { ...datum, children: [...(children ?? []), ...leaves] }
  }
  return visit(root)
}
