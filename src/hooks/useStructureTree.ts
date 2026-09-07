import { useCallback, useEffect, useState } from 'react'
import { loader } from '../stac/loaderInstance'
import type { StacNode } from '../stac/types'

const ITEM_PAGE_SIZE = 20

interface NodeUiState {
  expanded: boolean
  loading: boolean
  /** Resolved once expanded — undefined means "not fetched yet", not "empty". */
  childHrefs?: string[]
  itemHrefs?: string[]
}

export interface TreeDatum {
  href: string
  node: StacNode
  isItem: boolean
  /** Synthetic trailing leaf for a bounded item page — "+N more (not loaded)". */
  moreCount?: number
  children?: TreeDatum[]
}

/** Owns the lazily-expanded subset of the STAC graph currently visible in
 *  Structure Lens, and builds the nested datum tree d3-hierarchy needs from
 *  it. Loading is per-node and on-demand — nothing is fetched until expanded,
 *  which is what keeps this safe against a 16,000-item collection. */
export function useStructureTree(rootHref: string) {
  const [uiState, setUiState] = useState<Map<string, NodeUiState>>(new Map())

  // Named function expression so the recursive cascade (below) refers to
  // its own binding rather than the outer `const expand` — avoids reading
  // a variable while its own declaration is still being initialized.
  const expand = useCallback(async function expand(href: string): Promise<void> {
    setUiState((prev) => {
      const next = new Map(prev)
      const existing = next.get(href)
      next.set(href, { expanded: true, loading: true, ...existing })
      return next
    })

    const node = loader.get(href) ?? (await loader.load(href))

    const needChildren = node.childHrefs.length > 0
    const needItems = node.items.kind === 'links' && node.items.hrefs.length > 0
    const [children, items] = await Promise.all([
      needChildren ? loader.loadChildren(node) : Promise.resolve([]),
      needItems ? loader.loadItems(node, ITEM_PAGE_SIZE) : Promise.resolve([]),
    ])

    setUiState((prev) => {
      const next = new Map(prev)
      next.set(href, {
        expanded: true,
        loading: false,
        childHrefs: children.map((c) => c.href),
        itemHrefs: items.map((i) => i.href),
      })
      return next
    })

    // Auto-expand cascades through curated Catalog structure (the
    // publisher's information architecture, cheap to reveal) but always
    // stops at Collections — expanding one can mean fetching anywhere from
    // a handful to thousands of Items, which should stay a deliberate click.
    for (const child of children) {
      if (child.type === 'Catalog') void expand(child.href)
    }
  }, [])

  const collapse = useCallback((href: string) => {
    setUiState((prev) => {
      const next = new Map(prev)
      const existing = next.get(href)
      if (existing) next.set(href, { ...existing, expanded: false })
      return next
    })
  }, [])

  const toggle = useCallback(
    (href: string) => {
      if (uiState.get(href)?.expanded) collapse(href)
      else void expand(href)
    },
    [uiState, expand, collapse],
  )

  // Root starts pre-expanded — the user shouldn't have to click the root
  // node just to see the first level of a catalog they already navigated to.
  useEffect(() => {
    void expand(rootHref)
  }, [rootHref, expand])

  function buildDatum(href: string): TreeDatum | undefined {
    const node = loader.get(href)
    if (!node) return undefined
    const state = uiState.get(href)

    let children: TreeDatum[] | undefined
    if (state?.expanded && !state.loading) {
      const childDatums = (state.childHrefs ?? [])
        .map(buildDatum)
        .filter((d): d is TreeDatum => !!d)

      const itemDatums = (state.itemHrefs ?? [])
        .map((h) => {
          const itemNode = loader.get(h)
          return itemNode ? { href: h, node: itemNode, isItem: true } : undefined
        })
        .filter((d): d is TreeDatum => !!d)

      children = [...childDatums, ...itemDatums]

      const totalItems = node.items.kind === 'links' ? node.items.hrefs.length : 0
      const loadedItems = state.itemHrefs?.length ?? 0
      if (totalItems > loadedItems) {
        children.push({
          href: `${href}#more`,
          node,
          isItem: false,
          moreCount: totalItems - loadedItems,
        })
      }
    }

    return { href, node, isItem: node.type === 'Item', children }
  }

  const rootDatum = loader.get(rootHref) ? buildDatum(rootHref) : undefined
  const isLoading = (href: string) => uiState.get(href)?.loading ?? false
  const isExpanded = (href: string) => uiState.get(href)?.expanded ?? false

  return { root: rootDatum, toggle, isLoading, isExpanded }
}
