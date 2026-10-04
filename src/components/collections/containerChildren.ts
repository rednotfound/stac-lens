import type { TreeDatum } from '../../hooks/useStructureTree'
import type { StacNode } from '../../stac/types'

/** Below this many child Catalogs/Collections a node's list is left to the
 *  tree, where it is read at a glance; at or above it the Collections list
 *  opens by itself when the node is browsed (DESIGN §128). Fewer can still
 *  be listed from the header toggle. */
export const AUTO_OPEN_MIN_CHILDREN = 10

export interface ContainerChildren {
  /** Not opened in the structure yet, or opening now; `absent` when the
   *  node is not drawn in the structure at all (its ancestors not open yet,
   *  or beyond a parent's first page) — nothing to open from here. */
  status: 'absent' | 'not-open' | 'loading' | 'ready'
  /** The loaded children, in the publisher's order. */
  children: StacNode[]
  /** How many the source declares, when that is known and more than were
   *  loaded: a static catalog's `child` links beyond the first page. */
  declaredTotal?: number
  /** Whether `children` is everything there is. False for a static first
   *  page and for an API listing stopped at the safety cap. */
  complete: boolean
}

function findDatum(datum: TreeDatum | undefined, href: string): TreeDatum | undefined {
  if (!datum) return undefined
  if (datum.href === href) return datum
  for (const c of datum.children ?? []) {
    const hit = findDatum(c, href)
    if (hit) return hit
  }
  return undefined
}

/** A node's child Catalogs/Collections as the shared structure has loaded
 *  them — the same list every view draws, so the Collections list can
 *  never disagree with the tree. Counts are only what is loaded or
 *  declared, never estimated. */
export function containerChildren(
  root: TreeDatum | undefined,
  href: string,
  isExpanded: (href: string) => boolean,
  isLoading: (href: string) => boolean,
  listCap: number,
): ContainerChildren {
  const datum = findDatum(root, href)
  if (!datum) return { status: 'absent', children: [], complete: false }
  if (!isExpanded(href)) {
    return { status: isLoading(href) ? 'loading' : 'not-open', children: [], complete: false }
  }
  if (isLoading(href)) return { status: 'loading', children: [], complete: false }
  const real = (datum.children ?? []).filter((c) => c.moreCount === undefined)
  const children = real.map((c) => c.node).filter((n) => n.type !== 'Item')
  const more = (datum.children ?? []).find((c) => c.moreCount !== undefined)
  const node = datum.node
  const fromListEndpoint = !!node.childrenEndpoint || (node.childHrefs.length === 0 && !!node.collectionsEndpoint)
  if (more) return { status: 'ready', children, declaredTotal: node.childHrefs.length, complete: false }
  // Static `child` links that continue on a `next` page: what is here is a
  // first page, whatever its length.
  if (!fromListEndpoint && node.childPagesNext) return { status: 'ready', children, complete: false }
  return { status: 'ready', children, complete: !(fromListEndpoint && children.length >= listCap) }
}
