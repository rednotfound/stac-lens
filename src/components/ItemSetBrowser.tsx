import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { useItemSetStore } from '../store/itemSet'
import { useElementSize } from '../hooks/useElementSize'
import { describeTemporal } from '../stac/describe'
import { LoadingState } from './LoadingState'
import { TypeIcon } from './TypeIcon'
import { ItemsTimeline } from './ItemsTimeline'
import { ItemsMap } from './ItemsMap'
import { TabButton } from './TabButton'
import type { StacNode } from '../stac/types'

// Temporal and Spatial started as two separate tabs (§58) but were folded
// into one — asked about directly: "在tree view的items panel的Temporal和
// Spatial其实可以组成成一个tab" (Temporal and Spatial in the tree view's
// item panel could actually be combined into one tab). They're both just
// another way of looking at the same batch of items (the same reasoning
// that put them in this panel in the first place), so seeing them
// together — timeline above, map below, matching the same top-to-bottom
// order Inspector's own Temporal/Spatial fields already use — lets you
// cross-reference one against the other without a tab switch, rather
// than forcing a choice between them.
export type ItemSetView = 'list' | 'time-space'

// The combined view's own internal split — timeline capped at this height
// (its own scroll if there are enough lanes to exceed it) so the map
// below always keeps a real, usable share of the box's total height
// regardless of how many distinct timings are loaded.
const TIMELINE_MAX_HEIGHT = 220

// Static catalogs and STAC APIs are different design philosophies, not
// just different data sources (docs/DESIGN.md §68) — a static catalog's
// full item list is known up front and can't respond to a query at all, so
// it gets real page-based browsing (`LinksItemSetBrowser`, its own file);
// an API-backed Collection can't ever support a numbered "page N" (only an
// opaque `rel:next` cursor), so it gets a real query instead, and — asked
// for directly, a real node-editor-style pair of independent boxes, not a
// dispatcher choosing between two single-box components — two entirely
// separate `foreignObject`s (`CursorItemSetPanels`, StructureTree.tsx's own
// two-box render logic). There is no longer one shared `ItemSetBrowser`
// dispatcher component picking between the two: `StructureTree.tsx` itself
// branches on `node.items.kind` and renders the right shape of box(es)
// directly, since the two paths no longer share a single box's worth of
// chrome to dispatch into.

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

export function ItemRow({
  item,
  selected,
  onSelect,
  rowRef,
}: {
  item: StacNode
  selected: boolean
  onSelect: () => void
  rowRef?: RefObject<HTMLDivElement | null>
}) {
  return (
    <div
      ref={rowRef}
      onClick={onSelect}
      style={{
        padding: '5px 8px',
        fontSize: 12,
        cursor: 'pointer',
        borderBottom: '1px solid var(--color-border)',
        background: selected ? 'var(--color-selection)' : 'transparent',
        color: selected ? 'var(--color-bg)' : 'var(--color-text)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        {/* Catalog/Collection already read as distinct types via the
         * tree's own dot color; a list row has no such dot to reuse, so
         * Item gets the same small icon+color treatment Inspector's own
         * Asset rows already use — asked about directly: "既然catalog还有
         * collection已经用颜色区分了，那么item难道不也应该表现一下么？即使是在
         * 一个列表的panel里面" (Catalog/Collection are already
         * color-distinguished — shouldn't Item show something too, even in
         * a list panel?). */}
        <TypeIcon type="Item" size={12} color={selected ? 'var(--color-bg)' : 'var(--color-node-item)'} />
        {item.title ?? item.id}
      </div>
      {item.temporal && (
        <div
          style={{
            fontSize: 11,
            marginLeft: 17,
            color: selected ? 'var(--color-bg)' : 'var(--color-text-faint)',
            opacity: selected ? 0.85 : 1,
          }}
        >
          {describeTemporal(item.temporal)}
        </div>
      )}
    </div>
  )
}

export function TimeSpaceView({
  items,
  dimmedItems,
  selectedHref,
  onSelect,
  nodeHref,
  loading,
  emptyMessage,
  appliedBbox,
  drawMode,
  onBboxDrawn,
  appliedRange,
}: {
  items: StacNode[]
  /** See `ItemsMap`/`ItemsTimeline`'s own `dimmedItems` prop — passed
   *  straight through to both. Undefined for API-backed Collections,
   *  which have no "other pages" concept (infinite-scroll accumulation
   *  already puts everything ever loaded into `items` itself). */
  dimmedItems?: StacNode[]
  selectedHref?: string
  onSelect: (href: string) => void
  nodeHref: string
  loading: boolean
  emptyMessage: (kind: 'temporal' | 'spatial') => string
  appliedBbox?: [number, number, number, number]
  drawMode?: boolean
  onBboxDrawn?: (bbox: [number, number, number, number]) => void
  appliedRange?: { start?: string; end?: string }
}) {
  const [plotContainerRef, { width: plotWidth }] = useElementSize<HTMLDivElement>()
  // Only the *items'* own temporal/spatial data justifies rendering the
  // timeline/map — the Collection's own stated extent used to be shown as
  // its own reference row here too, but that was almost always pure
  // duplication of Inspector's own Temporal/Spatial fields showing the
  // exact same Collection at the exact same moment (docs/DESIGN.md).
  // Dimmed items also count here — page 2 having temporal/spatial data
  // should still render the axis/map even if page 3 (the current one)
  // happens to have none of its own.
  const hasTemporalData = items.some((i) => i.temporal) || (dimmedItems ?? []).some((i) => i.temporal)
  const hasSpatialData = items.some((i) => i.spatial?.bbox) || (dimmedItems ?? []).some((i) => i.spatial?.bbox)

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Timeline above, map below — the same top-to-bottom order
       * Inspector's own Temporal-then-Spatial fields already use, so this
       * reads as the same two facets just seen together instead of a new
       * arrangement to learn. Capped height (its own scroll past that)
       * rather than sizing to its own lane count, so the map below always
       * keeps a real, usable share of the box no matter how many distinct
       * timings load. */}
      <div
        ref={plotContainerRef}
        style={{
          maxHeight: TIMELINE_MAX_HEIGHT,
          overflow: 'auto',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          position: 'relative',
          flexShrink: 0,
        }}
      >
        {loading ? (
          <LoadingState>Loading items…</LoadingState>
        ) : !hasTemporalData ? (
          <div style={{ padding: 8, fontSize: 12, color: 'var(--color-text-faint)' }}>{emptyMessage('temporal')}</div>
        ) : (
          <ItemsTimeline
            items={items}
            dimmedItems={dimmedItems}
            highlightHref={selectedHref ?? undefined}
            viewWidth={plotWidth > 0 ? plotWidth : 280}
            onSelectItem={onSelect}
            zoomable
            scrollSelectedIntoView
            appliedRange={appliedRange}
          />
        )}
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          position: 'relative',
        }}
      >
        {loading ? (
          <LoadingState>Loading items…</LoadingState>
        ) : !hasSpatialData ? (
          <div style={{ padding: 8, fontSize: 12, color: 'var(--color-text-faint)' }}>{emptyMessage('spatial')}</div>
        ) : (
          <ItemsMap
            items={items}
            dimmedItems={dimmedItems}
            highlightHref={selectedHref ?? undefined}
            fitKey={nodeHref}
            onSelectItem={onSelect}
            appliedBbox={appliedBbox}
            drawMode={drawMode}
            onBboxDrawn={onBboxDrawn}
          />
        )}
      </div>
    </div>
  )
}

/** Bring the selected row into view automatically — same pattern in both
 *  modes below. Selecting an Item from Space Lens or Time Lens (both
 *  driven by this same list, via `useItemSetStore`) highlights its row
 *  here correctly, but with only a handful of rows visible at once, a
 *  highlight with no scroll is invisible in practice. */
export function useScrollSelectedIntoView(selectedHref: string | null | undefined, items: StacNode[]) {
  const rowRef = useRef<HTMLDivElement | null>(null)
  const lastScrolledRef = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedHref || selectedHref === lastScrolledRef.current) return
    if (rowRef.current) {
      lastScrolledRef.current = selectedHref
      rowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [selectedHref, items])
  return rowRef
}

/** Reset `showOnLenses` back to off on every (re)mount — this component
 *  only ever exists while `browsingHref` points at this exact node
 *  (StructureTree.tsx's `showItemSetBox`), fully unmounting the moment
 *  browsing moves elsewhere. Browsing through a Collection with no items
 *  never calls `setVisible` at all, which left a stale `showOnLenses: true`
 *  surviving a round trip back to the same Collection (confirmed directly
 *  before this fix) — resetting on mount rather than trying to detect the
 *  change some other way closes that gap at the source. */
export function useResetShowOnLenses(nodeHref: string) {
  const setShowOnLenses = useItemSetStore((s) => s.setShowOnLenses)
  useEffect(() => {
    setShowOnLenses(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeHref])
}

/** Publishes "what's actually in view here" for Inspector's own "common to
 *  the currently browsed set" annotation on Declared extensions/Property
 *  namespaces (DetailPanel.tsx's `browsedItems`). */
export function usePublishVisible(nodeHref: string, items: StacNode[]) {
  const setVisible = useItemSetStore((s) => s.setVisible)
  useEffect(() => {
    setVisible(nodeHref, items.map((i) => i.href))
  }, [nodeHref, items, setVisible])
}

export const TabBar = ({ view, setView }: { view: ItemSetView; setView: (v: ItemSetView) => void }) => (
  <div style={{ display: 'flex', gap: 4, marginBottom: 6, borderBottom: '1px solid var(--color-border)' }}>
    <TabButton label="List" active={view === 'list'} onClick={() => setView('list')} />
    <TabButton label="Time & Space" active={view === 'time-space'} onClick={() => setView('time-space')} />
  </div>
)

// ---------------------------------------------------------------------------
// Shared pager building blocks (used by ItemSetResultsPanel)
// ---------------------------------------------------------------------------

export function pagerButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 999,
    border: '1px solid var(--color-border)',
    background: 'var(--color-surface)',
    color: disabled ? 'var(--color-text-faint)' : 'var(--color-text-muted)',
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}

export function pageNumberButtonStyle(selected: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    minWidth: 22,
    padding: '2px 6px',
    borderRadius: 999,
    border: '1px solid ' + (selected ? 'var(--color-selection)' : 'var(--color-border)'),
    background: selected ? 'var(--color-selection)' : 'var(--color-surface)',
    color: selected ? 'var(--color-bg)' : 'var(--color-text-muted)',
    fontWeight: selected ? 700 : 400,
    cursor: selected ? 'default' : 'pointer',
  }
}

/** A classic "1 2 3 … 23 24 25" page list — always page 1, page `total`,
 *  and a small window around `current`, collapsing everything else behind
 *  a single ellipsis. Asked for directly, in preference to a jump-to-page
 *  number input (a first attempt): "我更喜欢那种就是有1、2、3。。。23、24、25这种
 *  感觉的pagination" (I prefer the kind of pagination that feels like
 *  1, 2, 3 ... 23, 24, 25). The number-input version had its own real bug
 *  anyway — a native `<input type="number">`'s spin-button arrows fire
 *  `input`/`change`, not the `blur`/Enter events the old commit handler
 *  waited for, so clicking them changed the displayed digit without ever
 *  navigating: "我点了数字后面的上下按钮，数字有变化，但是没有加载". Numbered
 *  buttons have no such native-widget gap — every page is one direct
 *  click, no intermediate typed/committed state at all. */
export function buildPageList(current: number, total: number): (number | 'ellipsis')[] {
  const siblingCount = 1
  const totalVisible = siblingCount * 2 + 5 // first + last + current + 2 siblings + 2 ellipsis slots
  if (totalVisible >= total) return range(1, total)

  const leftSibling = Math.max(current - siblingCount, 1)
  const rightSibling = Math.min(current + siblingCount, total)
  const showLeftEllipsis = leftSibling > 2
  const showRightEllipsis = rightSibling < total - 1

  if (!showLeftEllipsis && showRightEllipsis) {
    return [...range(1, 3 + siblingCount * 2), 'ellipsis', total]
  }
  if (showLeftEllipsis && !showRightEllipsis) {
    return [1, 'ellipsis', ...range(total - (3 + siblingCount * 2) + 1, total)]
  }
  return [1, 'ellipsis', ...range(leftSibling, rightSibling), 'ellipsis', total]
}

function range(start: number, end: number): number[] {
  const out: number[] = []
  for (let i = start; i <= end; i++) out.push(i)
  return out
}

/** Explicit `background`/`color` (native `<select>`/`<input>` elements
 *  otherwise render with the browser's own default white-on-black
 *  regardless of this app's theme) plus `colorScheme` so the browser's own
 *  chrome around them (a date input's calendar-icon/popup, a select's
 *  dropdown arrow) also renders dark in dark mode instead of looking like
 *  a light-mode control glued onto a dark page — reported directly:
 *  "dropdown的按钮底是白色，难道不应该是深色主题么". */
export const formControlStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 4px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  colorScheme: 'light dark',
}

