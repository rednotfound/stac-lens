import { useCallback, useEffect, useRef, useState } from 'react'
import { loader } from '../stac/loaderInstance'
import { useSelectionStore } from '../store/selection'
import type { StacNode } from '../stac/types'

const ITEM_PAGE_SIZE = 20
const CHILD_PAGE_SIZE = 100
/** Total budget for auto-cascade-triggered expansions across one tree.
 *  Atlas's whole Catalog structure is ~30 nodes and cascades fully within
 *  this; a catalog with hundreds of Catalog-typed children at one level (or
 *  several wide levels deep) stops auto-expanding gracefully instead of
 *  firing an unbounded number of fetches — remaining nodes just wait for a
 *  manual click, same as any other collapsed node. */
const AUTO_EXPAND_BUDGET = 60

interface NodeUiState {
  expanded: boolean
  loading: boolean
  /** Set when this node's own fetch failed — arbitrary user-pasted STAC
   *  URLs fail far more often than our two hand-verified fixtures (bad
   *  URL, dead link, CORS). Node stays "expanded" so the error renders in
   *  place rather than looking stuck on a permanent spinner. */
  error?: string
  /** Resolved once expanded — undefined means "not fetched yet", not "empty". */
  childHrefs?: string[]
  itemHrefs?: string[]
}

export interface TreeDatum {
  href: string
  node: StacNode
  isItem: boolean
  /** Synthetic trailing leaf for a bounded item/child page — "+N more (not loaded)". */
  moreCount?: number
  moreKind?: 'items' | 'children'
  children?: TreeDatum[]
}

/** Owns the lazily-expanded subset of the STAC graph currently visible in
 *  Structure Lens, and builds the nested datum tree d3-hierarchy needs from
 *  it. Loading is per-node and on-demand — nothing is fetched until expanded,
 *  which is what keeps this safe against a 16,000-item collection. */
export function useStructureTree(rootHref: string) {
  const [uiState, setUiState] = useState<Map<string, NodeUiState>>(new Map())
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  const autoExpandBudgetRef = useRef(AUTO_EXPAND_BUDGET)

  // Named function expression so the recursive cascade (below) refers to
  // its own binding rather than the outer `const expand` — avoids reading
  // a variable while its own declaration is still being initialized.
  const expand = useCallback(async function expand(href: string): Promise<void> {
    setUiState((prev) => {
      const next = new Map(prev)
      const existing = next.get(href)
      next.set(href, { expanded: true, loading: true, ...existing, error: undefined })
      return next
    })

    try {
      const node = loader.get(href) ?? (await loader.load(href))

      const needChildren = node.childHrefs.length > 0
      const needItems = node.items.kind === 'links' && node.items.hrefs.length > 0
      const [children, items] = await Promise.all([
        needChildren ? loader.loadChildren(node, CHILD_PAGE_SIZE) : Promise.resolve([]),
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
      // stops at Collections — expanding one can mean fetching anywhere
      // from a handful to thousands of Items, which should stay a
      // deliberate click. A shared budget caps the total cascade size —
      // NZ Imagery's root alone has 800+ children, and a Catalog-heavy
      // structure at that scale would otherwise fire an unbounded number
      // of auto-triggered fetches.
      for (const child of children) {
        if (child.type === 'Catalog' && autoExpandBudgetRef.current > 0) {
          autoExpandBudgetRef.current -= 1
          void expand(child.href)
        }
      }
    } catch (err) {
      setUiState((prev) => {
        const next = new Map(prev)
        next.set(href, {
          expanded: true,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        })
        return next
      })
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

  // Selection can now come from Time Lens or Space Lens, whose Items may
  // belong to a Collection the tree was never manually expanded into — walk
  // up the selected node's ancestor chain and expand anything still
  // collapsed so the selection is actually visible, not just recorded in
  // state nobody can see. `expand` re-fetches are cache-backed, so calling
  // it again on an already-expanded ancestor is harmless.
  useEffect(() => {
    if (!selectedHref) return
    const node = loader.get(selectedHref)
    if (!node) return

    const ancestors: string[] = []
    let cur = node.parentHref
    while (cur) {
      ancestors.push(cur)
      cur = loader.get(cur)?.parentHref
    }
    ancestors.reverse() // root-to-leaf order

    void (async () => {
      for (const href of ancestors) {
        await expand(href)
      }
    })()
  }, [selectedHref, expand])

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

      const totalChildren = node.childHrefs.length
      const loadedChildren = state.childHrefs?.length ?? 0
      if (totalChildren > loadedChildren) {
        children.push({
          href: `${href}#more-children`,
          node,
          isItem: false,
          moreCount: totalChildren - loadedChildren,
          moreKind: 'children',
        })
      }

      const totalItems = node.items.kind === 'links' ? node.items.hrefs.length : 0
      const loadedItems = state.itemHrefs?.length ?? 0
      if (totalItems > loadedItems) {
        children.push({
          href: `${href}#more-items`,
          node,
          isItem: false,
          moreCount: totalItems - loadedItems,
          moreKind: 'items',
        })
      }
    }

    return { href, node, isItem: node.type === 'Item', children }
  }

  const rootDatum = loader.get(rootHref) ? buildDatum(rootHref) : undefined
  const isLoading = (href: string) => uiState.get(href)?.loading ?? false
  const isExpanded = (href: string) => uiState.get(href)?.expanded ?? false
  const rootError = !rootDatum ? uiState.get(rootHref)?.error : undefined

  return { root: rootDatum, toggle, isLoading, isExpanded, rootError }
}
