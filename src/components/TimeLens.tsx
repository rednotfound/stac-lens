import { useSelectionStore } from '../store/selection'
import { useSelectedItems } from '../hooks/useSelectedItems'
import { useElementSize } from '../hooks/useElementSize'
import type { StacNode } from '../stac/types'
import { EmptyState } from './EmptyState'
import { LoadingState } from './LoadingState'
import { ItemsTimeline } from './ItemsTimeline'

const FALLBACK_VIEW_WIDTH = 800
const EMPTY_ITEMS: StacNode[] = []

/** Wayback-Machine-style availability view, scoped to whatever's selected
 *  in Structure Lens — never global, since a collection can hold tens of
 *  thousands of items. The actual timeline drawing (grouping, lane
 *  packing, axis, marks, tooltip) lives in `ItemsTimeline.tsx`, shared with
 *  Item Set's own multi-item batch view (docs/DESIGN.md, "…tabs reuse the
 *  app's own tab style, and the box is now resizable") — this component's
 *  only job is resolving *what* to plot for a single selected object and
 *  handling the empty/loading states around it.
 *
 *  The container div here must always render (only its *contents* are
 *  conditional on data being ready) — the size-measuring effect below binds
 *  once on mount, and if the ref were only attached inside a conditional
 *  branch it could bind to a still-null ref on first render and never
 *  retry. Same class of bug as the Structure Lens pan/zoom fix; see
 *  docs/DESIGN.md, "Structure Lens — why a curved node-link tree, not a
 *  file-explorer list".
 *
 *  Deliberately `height: 'auto'`, not `100%` — this component hugs
 *  whatever height its own content (an EmptyState message, or the SVG's
 *  own data-driven height) actually needs; App.tsx's wrapper caps that at
 *  a max height with scroll, rather than this component stretching to
 *  fill a fixed-size slot sized for Space Lens's map instead (see
 *  docs/DESIGN.md, "Layout: Time Lens and Space Lens no longer share one
 *  fixed-height row"). */
export function TimeLens() {
  const [containerRef, { width: measuredWidth }] = useElementSize<HTMLDivElement>()
  const viewWidth = measuredWidth > 0 ? measuredWidth : FALLBACK_VIEW_WIDTH

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: 'auto' }}>
      <TimeLensBody viewWidth={viewWidth} />
    </div>
  )
}

function TimeLensBody({ viewWidth }: { viewWidth: number }) {
  const select = useSelectionStore((s) => s.select)
  const target = useSelectedItems()

  const items = target.status === 'ready' ? target.items : EMPTY_ITEMS
  const node = target.status === 'ready' ? target.node : undefined
  const highlightHref = target.status === 'ready' ? target.highlightHref : undefined
  const selectedItem = highlightHref ? items.find((i) => i.href === highlightHref) : undefined

  // The *Collection's own* declared extent — genuinely useful context while
  // browsing many Items ("does this one stray outside what the Collection
  // claims"), but not a fact about a single selected Item at all: real data
  // confirmed this directly (Adaptation Atlas's `EmpowermentIndex_1995`
  // Item has its own perfectly good `datetime`/`geometry` — the Collection's
  // stated extent showing up here regardless was pure noise, not something
  // missing from the Item's own metadata). `highlightHref` is set if and
  // only if the original selection was an Item (see `useSelectedItems`), so
  // suppressing this whenever it's set keeps a single Item's own Inspector
  // widgets scoped to exactly that Item — same principle as everywhere
  // else in this app.
  const statedShape = !highlightHref ? node?.temporal : undefined

  if (target.status === 'empty') {
    return (
      <EmptyState>
        {target.reason === 'no-selection'
          ? 'Select a Collection or Item in Structure to see its temporal shape.'
          : 'This node has no Items directly — drill into a sub-collection.'}
      </EmptyState>
    )
  }
  if (target.status === 'loading') {
    return <LoadingState>Loading…</LoadingState>
  }
  const hasAnyTemporal = statedShape != null || items.some((i) => i.temporal)
  if (!hasAnyTemporal) {
    // Reachable only once loading is done: no stated extent on the
    // Collection itself, and nothing yet visible in Item Set (Detail Panel)
    // to derive a range from either — not a timing artifact, an honest
    // "nothing to plot yet" (see docs/DESIGN.md, "Items removed from
    // Structure Lens entirely").
    return (
      <EmptyState>
        No stated temporal extent, and no items visible yet — open Detail Panel to browse this collection's items.
      </EmptyState>
    )
  }

  // Names whichever object Temporal is actually describing — the selected
  // Item itself if there is one, otherwise the Collection. No item count
  // ("showing 1 of 4 items") and no "scoped to just this Item, not its
  // neighbors" qualifier: Item Set has no aggregate multi-item display here
  // (docs/DESIGN.md, "Items removed from Structure Lens entirely",
  // "Retiring 'Provided by this app' as its own section" and "Temporal's
  // header was still describing a retired feature"), so exactly one Item
  // (itself) or zero Items ever populate this view, and "of N" or "not its
  // neighbors" would never describe a real alternative, just noise.
  return (
    <>
      <div style={{ padding: '6px 16px 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
        <strong style={{ color: 'var(--color-text)' }}>
          {selectedItem ? (selectedItem.title ?? selectedItem.id) : (node?.title ?? node?.id)}
        </strong>
      </div>
      <ItemsTimeline
        items={items}
        highlightHref={highlightHref}
        statedShape={statedShape}
        viewWidth={viewWidth}
        onSelectItem={select}
        focusOnSelection
      />
    </>
  )
}
