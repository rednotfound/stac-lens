import type { TreeDatum } from '../../hooks/useStructureTree'
import { canExpandNode } from '../tree/treeGeometry'

export interface StructureStats {
  /** Catalog-typed nodes currently in the loaded tree (including the root
   *  when it is a Catalog). */
  catalogs: number
  collections: number
  /** Catalogs that have structural children but have not been expanded
   *  — what "Load all catalogs" would open (within its budget). */
  unopenedCatalogs: number
  /** Children hidden behind "+N more" leaves, summed. */
  moreLeaves: number
  /** Depth of the deepest loaded node, root = 0. */
  maxDepth: number
}

/** Counts over the loaded datum tree — only what is loaded, never a guess
 *  at what a closed node would contain. `isExpanded` is the structure
 *  state's own answer, so a node whose expansion is still loading counts
 *  as opened. */
export function structureStats(root: TreeDatum, isExpanded: (href: string) => boolean): StructureStats {
  const stats: StructureStats = { catalogs: 0, collections: 0, unopenedCatalogs: 0, moreLeaves: 0, maxDepth: 0 }
  function walk(datum: TreeDatum, depth: number) {
    if (datum.moreCount) {
      stats.moreLeaves += datum.moreCount
      return
    }
    stats.maxDepth = Math.max(stats.maxDepth, depth)
    const { node } = datum
    if (node.type === 'Catalog') {
      stats.catalogs += 1
      if (canExpandNode(node) && !isExpanded(datum.href)) stats.unopenedCatalogs += 1
    } else if (node.type === 'Collection') {
      stats.collections += 1
    }
    for (const child of datum.children ?? []) walk(child, depth + 1)
  }
  walk(root, 0)
  return stats
}
