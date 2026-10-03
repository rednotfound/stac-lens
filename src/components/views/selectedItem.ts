import { loader } from '../../stac/loaderInstance'
import type { StacNode } from '../../stac/types'

/** The selected node, when it is an Item that belongs under `hostHref`,
 *  the Collection being browsed. Both conditions: browsing can lag behind
 *  a selection (selecting an Item keeps the Collection already browsed),
 *  so an Item whose own parent is another Collection is not drawn here.
 *  Reads the loader cache in render, as the Inspector does. */
export function selectedItemUnder(
  selectedHref: string | null,
  hostHref: string,
  browsingHref: string | null,
): StacNode | undefined {
  if (!selectedHref || hostHref !== browsingHref) return undefined
  const node = loader.get(selectedHref)
  if (!node || node.type !== 'Item') return undefined
  if (node.parentHref && node.parentHref !== hostHref) return undefined
  return node
}

/** The selected Item, when it belongs under this Collection but is not
 *  among the Items a view draws for it — opened from a link or after a
 *  reload (an API Collection's window starts unsearched), left behind by a
 *  search that moved on, or further down a page than a view draws. A
 *  selection must show exactly that object (house rule), so every view
 *  draws it under its Collection anyway, marked as off the page. The
 *  tree's leaf builder makes the same "not among the drawn" test itself,
 *  over the leaves it draws, from `selectedItemUnder`. */
export function selectedItemOffPage(
  selectedHref: string | null,
  hostHref: string,
  browsingHref: string | null,
  drawn: readonly { href: string }[],
): StacNode | undefined {
  const node = selectedItemUnder(selectedHref, hostHref, browsingHref)
  return node && !drawn.some((i) => i.href === node.href) ? node : undefined
}

/** How the views label it. */
export const OFF_PAGE_NOTE = "selected · not on the Items panel's page"
