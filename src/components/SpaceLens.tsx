import { useSelectionStore } from '../store/selection'
import { useSelectedItems } from '../hooks/useSelectedItems'
import { Spinner } from './Spinner'
import { ItemsMap } from './ItemsMap'
import type { StacNode } from '../stac/types'

const EMPTY_ITEMS: StacNode[] = []

/** A real interactive map (Leaflet + the standard OSM tile server), scoped
 *  to whatever's selected in Structure Lens. The actual map/footprint
 *  drawing (tiles, rectangles, fit-bounds, fly-to-selected) lives in
 *  `ItemsMap.tsx`, shared with Item Set's own multi-item batch view (§59)
 *  — this component's only job is resolving *what* to plot for a single
 *  selected object and rendering the status overlay around it.
 *
 *  The map container always renders regardless of loading/empty status —
 *  same rule as every other lens in this app (see docs/DESIGN.md §5): the
 *  mount effect binds to the ref once, and a container that only appears
 *  in some render branches risks binding to a still-null ref. */
export function SpaceLens() {
  const select = useSelectionStore((s) => s.select)
  const target = useSelectedItems()

  const items = target.status === 'ready' ? target.items : EMPTY_ITEMS
  const node = target.status === 'ready' ? target.node : undefined
  const highlightHref = target.status === 'ready' ? target.highlightHref : undefined
  // The *Collection's own* declared bbox — real context while browsing
  // many Items, but not a fact about a single selected Item at all: real
  // data confirmed this directly (Adaptation Atlas's `EmpowermentIndex_1995`
  // Item has its own perfectly good `geometry`/`bbox` — the Collection's
  // stated bbox showing up here regardless was pure noise). `highlightHref`
  // is set if and only if the original selection was an Item, so
  // suppressing this whenever it's set keeps a single Item's own Inspector
  // widget scoped to exactly that Item.
  const statedBbox = !highlightHref ? node?.spatial?.bbox : undefined
  const itemFootprintCount = items.filter((i) => !!i.spatial?.bbox).length

  const isLoadingTarget = target.status === 'loading'
  const statusMessage =
    target.status === 'empty'
      ? target.reason === 'no-selection'
        ? 'Select a Collection or Item in Structure to see where it is.'
        : 'This node has no Items directly — drill into a sub-collection.'
      : isLoadingTarget
        ? 'Loading…'
        : itemFootprintCount === 0 && !statedBbox
          ? "No stated bbox, and no footprints visible yet — open Detail Panel to browse this collection's items."
          : undefined

  return (
    // `zIndex: 0` here too, not just decorative — see ItemsMap's own note;
    // this component's overlay label needs the same containment.
    <div style={{ position: 'relative', width: '100%', height: '100%', zIndex: 0 }}>
      <ItemsMap
        items={items}
        highlightHref={highlightHref}
        statedBbox={statedBbox}
        fitKey={node?.href}
        onSelectItem={select}
      />
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: '6px 10px',
          fontSize: 12,
          color: 'var(--color-text-muted)',
          background: 'var(--color-surface)',
          opacity: 0.92,
          pointerEvents: 'none',
          // Leaflet's own internal panes/controls go up to z-index 1000
          // (its control-container, e.g. the zoom buttons).
          zIndex: 1001,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {node ? (
          <>
            <strong style={{ color: 'var(--color-text)' }}>{node.title ?? node.id}</strong>
            {' · '}
            {itemFootprintCount} item footprint{itemFootprintCount === 1 ? '' : 's'}
          </>
        ) : (
          <>
            {isLoadingTarget && <Spinner size={12} />}
            {statusMessage}
          </>
        )}
      </div>
    </div>
  )
}
