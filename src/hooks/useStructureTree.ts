import { useCallback, useEffect, useRef, useState } from 'react'
import { loader } from '../stac/loaderInstance'
import { fetchChildrenPage, fetchCollectionsPage, type NextLink, type NodeListPage } from '../stac/apiSearch'
import { useSelectionStore } from '../store/selection'
import type { StacNode } from '../stac/types'

const CHILD_PAGE_SIZE = 100
/** Total budget for auto-cascade-triggered expansions across one tree.
 *  Atlas's whole Catalog structure is ~30 nodes and cascades fully within
 *  this; a catalog with hundreds of Catalog-typed children at one level (or
 *  several wide levels deep) stops auto-expanding gracefully instead of
 *  firing an unbounded number of fetches — remaining nodes just wait for a
 *  manual click, same as any other collapsed node. */
const EXPAND_ALL_BUDGET = 60
/** Safety backstop for a `collectionsEndpoint` fetch (`rel:data`) — every
 *  real implementation checked so far (Microsoft Planetary Computer, ~136
 *  Collections) returns everything in one unpaginated response regardless
 *  of a `limit` param, so this is a defensive cap against a hypothetical
 *  implementation with many thousands of Collections, not a limit expected
 *  to actually bind today. */
const COLLECTIONS_SAFETY_CAP = 2000

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
}

export interface TreeDatum {
  href: string
  node: StacNode
  /** Synthetic trailing leaf for a bounded child page — "+N more (not loaded)". */
  moreCount?: number
  children?: TreeDatum[]
}

/** Fetches every Collection from a `collectionsEndpoint` (`rel:data`),
 *  following `rel:next` until exhausted or `COLLECTIONS_SAFETY_CAP` is hit
 *  — a full fetch-to-completion, not a scroll-paged "load more" the way
 *  Item Set handles a real API search, since a Collections listing is
 *  realistically a few hundred entries at most in any real implementation
 *  checked so far, unlike Items (which can be tens of millions). Caches
 *  each result via `cachePreFetched` the same way a search response's
 *  Items already do, since each Collection here arrives whole, not as a
 *  bare href needing its own follow-up fetch. */
async function loadAllFromListEndpoint(
  fetchPage: (endpoint: string, opts: { limit: number; next?: NextLink }) => Promise<NodeListPage>,
  endpoint: string,
): Promise<StacNode[]> {
  const all: StacNode[] = []
  let next: NextLink | undefined
  do {
    const page = await fetchPage(endpoint, { limit: COLLECTIONS_SAFETY_CAP, next })
    for (const node of page.items) loader.cachePreFetched(node)
    all.push(...page.items)
    next = page.next
  } while (next && all.length < COLLECTIONS_SAFETY_CAP)
  return all
}

/** Owns the lazily-expanded subset of the STAC graph currently visible in
 *  Structure Lens, and builds the nested datum tree d3-hierarchy needs from
 *  it. Loading is per-node and on-demand — nothing is fetched until expanded,
 *  which is what keeps this safe against a catalog with hundreds of children.
 *
 *  Items are deliberately never part of this tree at all — they're reached
 *  only through Item Set (Detail Panel), never as tree leaves. A Collection
 *  used to expand into up to 20 Item leaves on click, which meant two
 *  different, inconsistent paths to "find an item" (tree-click vs Item
 *  Set's search) and a real, confirmed bug: selecting an Item via Item Set
 *  re-triggered the ancestor-auto-expand effect below, silently re-opening
 *  a Collection the user had just manually collapsed. Structure Lens is now
 *  purely a Catalog/Collection navigator — see docs/DESIGN.md §21. */
export function useStructureTree(rootHref: string) {
  const [uiState, setUiState] = useState<Map<string, NodeUiState>>(new Map())
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  const browsingHref = useSelectionStore((s) => s.browsingHref)

  const expand = useCallback(async (href: string): Promise<void> => {
    setUiState((prev) => {
      const next = new Map(prev)
      const existing = next.get(href)
      next.set(href, { expanded: true, loading: true, ...existing, error: undefined })
      return next
    })

    try {
      const node = loader.get(href) ?? (await loader.load(href))
      // A Children endpoint wins over static `child` links even when both
      // exist: one response carrying every child as a complete object,
      // versus one fetch per link just to learn each child's title.
      const children = node.childrenEndpoint
        ? await loadAllFromListEndpoint(fetchChildrenPage, node.childrenEndpoint)
        : node.childHrefs.length > 0
          ? await loader.loadChildren(node, CHILD_PAGE_SIZE)
          : node.collectionsEndpoint
            ? await loadAllFromListEndpoint(fetchCollectionsPage, node.collectionsEndpoint)
            : []

      setUiState((prev) => {
        const next = new Map(prev)
        next.set(href, {
          expanded: true,
          loading: false,
          childHrefs: children.map((c) => c.href),
        })
        return next
      })
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

  // Collapses every expanded node back down to just the root's own direct
  // children — "reset to first level" for catalogs whose auto-expand
  // cascade (see `expand` above) or a lot of manual clicking has opened up
  // many levels deep (NZ Imagery/Capella-scale catalogs especially). Doesn't
  // touch the loader cache or re-fetch anything — collapsed nodes' data
  // stays cached, so re-expanding them afterward is instant.
  const collapseAll = useCallback(() => {
    setUiState((prev) => {
      const next = new Map(prev)
      for (const [href, state] of prev) {
        if (href === rootHref) continue
        next.set(href, { ...state, expanded: false })
      }
      return next
    })
  }, [rootHref])

  // The opposite of collapseAll, and manual rather than automatic — see the
  // comment on the root pre-expand effect below for why this used to run by
  // itself on load. Walks every currently-reachable Catalog (never a
  // Collection — expanding one can mean fetching anywhere from a handful to
  // thousands of Items, which should always stay a deliberate click) and
  // expands it, so the publisher's whole curated Catalog hierarchy becomes
  // visible in one action instead of one click per level. Same shared budget
  // the old auto-cascade used, now scoped to a single manual invocation
  // instead of implicitly firing on every expand() call — NZ Imagery's root
  // alone has 800+ children, so this still needs a cap even on purpose.
  const expandAllCatalogs = useCallback(async () => {
    let budget = EXPAND_ALL_BUDGET
    async function walk(href: string): Promise<void> {
      await expand(href)
      const node = loader.get(href)
      if (!node) return
      const catalogChildren = node.childHrefs.filter((h) => loader.get(h)?.type === 'Catalog')
      await Promise.all(
        catalogChildren.map((childHref) => {
          if (budget <= 0) return Promise.resolve()
          budget -= 1
          return walk(childHref)
        }),
      )
    }
    await walk(rootHref)
  }, [expand, rootHref])

  const toggle = useCallback(
    (href: string) => {
      if (uiState.get(href)?.expanded) collapse(href)
      else void expand(href)
    },
    [uiState, expand, collapse],
  )

  // Root starts pre-expanded — the user shouldn't have to click the root
  // node just to see the first level of a catalog they already navigated to.
  // Deliberately *only* the root, one level: this used to cascade
  // recursively through every nested Catalog automatically, which for a
  // deep, unfamiliar structure (Capella's by-datetime facet nests
  // Catalog→year→month→day) fetched far more than the user asked to see
  // before they'd even gotten oriented — "我也不知道结构...会一下子加载太多
  // 东西" (I don't know the structure yet, and it loads too much all at
  // once). Deeper levels are now always a deliberate click, one at a time,
  // or one `expandAllCatalogs()` call away if the user wants the whole
  // curated hierarchy at once.
  useEffect(() => {
    void expand(rootHref)
  }, [rootHref, expand])

  // Selection can come from Time Lens, Space Lens, or Item Set, and may
  // belong to a Collection the tree was never manually expanded into — walk
  // up to that Collection and expand every ancestor *above* it so it
  // actually renders as a visible tree node. Deliberately does not expand
  // the target itself: Items are never tree children (see the note on
  // `useStructureTree` above), so there's nothing to reveal by expanding a
  // leaf-items Collection — StructureTree.tsx highlights it directly via
  // "contains the current selection" instead.
  //
  // Targets `browsingHref` (the Collection actually being browsed), not an
  // Item's own resolved `parentHref` — those can genuinely disagree (§15),
  // and navigating off of it on every Item selection is what caused "我就
  // lost掉了" (§21): the tree would jump to wherever the clicked Item's
  // `rel:collection` happened to point, away from the Collection whose
  // Item Set the user was actually browsing.
  //
  // Only re-runs when the target actually changes, not on every individual
  // Item selection — Item Set lets you click through many Items belonging
  // to the same Collection in quick succession, and without this guard
  // each click would re-expand that Collection's ancestor chain, silently
  // undoing a manual collapse of one of them (a real, confirmed case:
  // collapsing a Catalog while continuing to browse an already-open Item
  // Set). Navigating to a genuinely different Collection still expands its
  // ancestors as before — `expand` re-fetches are cache-backed, so calling
  // it again on an already-expanded ancestor is harmless.
  const lastNavigatedTargetRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!selectedHref) return
    const node = loader.get(selectedHref)
    if (!node) return
    const targetHref = node.type === 'Item' ? (browsingHref ?? node.parentHref) : selectedHref
    if (!targetHref || targetHref === lastNavigatedTargetRef.current) return
    lastNavigatedTargetRef.current = targetHref

    void (async () => {
      // Walking via `loader.get` alone (cache peek, no fetch) is enough
      // once the user has been browsing — Time/Space/Item Set selections
      // arise from an already-loaded Collection, so every ancestor up to
      // root is already cached. A deep-linked node (§18's hash URL) breaks
      // that assumption: it's fetched in isolation, with *nothing* else
      // loaded, so the chain has to be fetched on the way up, not just
      // peeked — same as `StacLoader.resolveRoot`, and bounded the same way
      // against a malformed/cyclic parent chain in an arbitrary catalog.
      const target = loader.get(targetHref) ?? (await loader.load(targetHref))
      const ancestors: string[] = []
      let cur = target.parentHref
      for (let i = 0; i < 50 && cur; i++) {
        ancestors.push(cur)
        const parent = loader.get(cur) ?? (await loader.load(cur))
        // `parent.href` always equals `cur` here (that's the href we just
        // fetched it by) — the guard against a cyclic parent chain has to
        // compare the *next* hop instead.
        cur = parent.parentHref === cur ? undefined : parent.parentHref
      }
      ancestors.reverse() // root-to-leaf order

      for (const href of ancestors) {
        await expand(href)
      }
    })()
  }, [selectedHref, browsingHref, expand])

  function buildDatum(href: string): TreeDatum | undefined {
    const node = loader.get(href)
    if (!node) return undefined
    const state = uiState.get(href)

    let children: TreeDatum[] | undefined
    if (state?.expanded && !state.loading) {
      children = (state.childHrefs ?? []).map(buildDatum).filter((d): d is TreeDatum => !!d)

      // A Children endpoint's response is the complete list by definition
      // (paginated to exhaustion above), so the static `child` link count
      // is not the yardstick for it — only a bounded `child`-link page can
      // leave a remainder worth a "+N more" leaf.
      const totalChildren = node.childrenEndpoint ? 0 : node.childHrefs.length
      const loadedChildren = state.childHrefs?.length ?? 0
      if (totalChildren > loadedChildren) {
        children.push({
          href: `${href}#more-children`,
          node,
          moreCount: totalChildren - loadedChildren,
        })
      }
    }

    return { href, node, children }
  }

  const rootDatum = loader.get(rootHref) ? buildDatum(rootHref) : undefined
  const isLoading = (href: string) => uiState.get(href)?.loading ?? false
  const isExpanded = (href: string) => uiState.get(href)?.expanded ?? false
  const rootError = !rootDatum ? uiState.get(rootHref)?.error : undefined

  return { root: rootDatum, toggle, collapseAll, expandAllCatalogs, isLoading, isExpanded, rootError }
}
