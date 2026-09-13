import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useLinksPagedItemSet, DEFAULT_LINKS_PAGE_SIZE } from '../hooks/useLinksPagedItemSet'
import { useCursorQueriedItemSet, type CursorQuery } from '../hooks/useCursorQueriedItemSet'
import { useApiConformance } from '../hooks/useApiConformance'
import { supportsSort } from '../stac/conformance'
import { useSelectionStore } from '../store/selection'
import { useItemSetStore } from '../store/itemSet'
import { useElementSize } from '../hooks/useElementSize'
import { describeTemporal } from '../stac/describe'
import { Spinner } from './Spinner'
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
type ItemSetView = 'list' | 'time-space'

const SCROLL_LOAD_THRESHOLD = 120
// The combined view's own internal split — timeline capped at this height
// (its own scroll if there are enough lanes to exceed it) so the map
// below always keeps a real, usable share of the box's total height
// regardless of how many distinct timings are loaded.
const TIMELINE_MAX_HEIGHT = 220

/** A Collection's direct items, browsable as their own selectable object —
 *  distinct from drilling into Structure Lens's tree, which would mean
 *  cascading potentially thousands of item nodes into the tree layout just
 *  to reach one.
 *
 *  Static catalogs and STAC APIs are different design philosophies, not
 *  just different data sources (docs/DESIGN.md §68) — a static catalog's
 *  full item list is known up front and can't respond to a query at all,
 *  so it gets real page-based browsing; an API-backed Collection can't
 *  ever support a numbered "page N" (only an opaque `rel:next` cursor), so
 *  it gets a real query (datetime/bbox/sort) instead. The two modes are
 *  different enough now that they're two separate components below,
 *  dispatched on `node.items.kind`, rather than one component branching
 *  internally throughout. */
export function ItemSetBrowser({ node }: { node: StacNode }) {
  if (node.items.kind === 'links') {
    return <LinksItemSetBrowser node={node as StacNode & { items: { kind: 'links' } }} />
  }
  return <CursorItemSetBrowser node={node as StacNode & { items: { kind: 'cursor' } }} />
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function ItemRow({
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

function TimeSpaceView({
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
function useScrollSelectedIntoView(selectedHref: string | null | undefined, items: StacNode[]) {
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
function useResetShowOnLenses(nodeHref: string) {
  const setShowOnLenses = useItemSetStore((s) => s.setShowOnLenses)
  useEffect(() => {
    setShowOnLenses(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeHref])
}

/** Publishes "what's actually in view here" for Inspector's own "common to
 *  the currently browsed set" annotation on Declared extensions/Property
 *  namespaces (DetailPanel.tsx's `browsedItems`). */
function usePublishVisible(nodeHref: string, items: StacNode[]) {
  const setVisible = useItemSetStore((s) => s.setVisible)
  useEffect(() => {
    setVisible(nodeHref, items.map((i) => i.href))
  }, [nodeHref, items, setVisible])
}

const ApiBadge = () => (
  // Same tag as Structure Lens's own tree node (StructureTree.tsx) —
  // carried through here too so it reads as one consistent signal rather
  // than something only visible before you open the panel: "得有一个标签也
  // 好,highlight也好什么东西,因为你看这个Stack Browser里面,它就是有一个tag在"
  // (it needs a tag or highlight — STAC Browser has a tag for this).
  <span
    style={{
      display: 'inline-block',
      fontSize: 10,
      fontWeight: 700,
      padding: '2px 7px',
      borderRadius: 999,
      background: 'var(--color-badge-api-bg)',
      color: 'var(--color-badge-api-text)',
      marginBottom: 6,
    }}
  >
    API
  </span>
)

const TabBar = ({ view, setView }: { view: ItemSetView; setView: (v: ItemSetView) => void }) => (
  <div style={{ display: 'flex', gap: 4, marginBottom: 6, borderBottom: '1px solid var(--color-border)' }}>
    <TabButton label="List" active={view === 'list'} onClick={() => setView('list')} />
    <TabButton label="Time & Space" active={view === 'time-space'} onClick={() => setView('time-space')} />
  </div>
)

// ---------------------------------------------------------------------------
// Static catalogs — real page-based pagination
// ---------------------------------------------------------------------------

const PAGE_SIZE_OPTIONS = [20, DEFAULT_LINKS_PAGE_SIZE, 100, 200]

function LinksItemSetBrowser({ node }: { node: StacNode & { items: { kind: 'links' } } }) {
  const state = useLinksPagedItemSet(node)
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  const select = useSelectionStore((s) => s.select)
  const [view, setView] = useState<ItemSetView>('list')

  useResetShowOnLenses(node.href)
  const pageItems = state.status === 'empty' ? [] : state.pageItems
  usePublishVisible(node.href, pageItems)
  const selectedRowRef = useScrollSelectedIntoView(selectedHref, pageItems)

  if (state.status === 'empty') return null

  const pageList = buildPageList(state.pageIndex + 1, state.totalPages)

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TabBar view={view} setView={setView} />
      {/* No id/title search box here — nobody browsing a static catalog
       * knows its opaque item ids/titles up front, so a text filter over
       * them is close to useless: "在static catalog中的搜索几乎是没有意义的,
       * 按照ID或者名字搜索,没有人能够做到". Real page-based pagination replaces
       * it instead — the full href array is known up front, so an exact
       * page count and jump-to-page are both always possible, unlike an
       * API's opaque cursor (see CursorItemSetBrowser). */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 6,
          fontSize: 11,
          color: 'var(--color-text-muted)',
        }}
      >
        <button
          onClick={() => state.goToPage(state.pageIndex - 1)}
          disabled={state.pageIndex === 0}
          style={pagerButtonStyle(state.pageIndex === 0)}
        >
          ← Prev
        </button>
        {pageList.map((p, i) =>
          p === 'ellipsis' ? (
            <span key={`e${i}`} style={{ padding: '0 2px', color: 'var(--color-text-faint)' }}>
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => state.goToPage(p - 1)}
              style={pageNumberButtonStyle(p === state.pageIndex + 1)}
            >
              {p}
            </button>
          ),
        )}
        <button
          onClick={() => state.goToPage(state.pageIndex + 1)}
          disabled={state.pageIndex >= state.totalPages - 1}
          style={pagerButtonStyle(state.pageIndex >= state.totalPages - 1)}
        >
          Next →
        </button>
        {state.loadingPage && <Spinner size={11} />}
        <span style={{ flex: 1 }} />
        <select
          value={state.pageSize}
          onChange={(e) => state.setPageSize(Number(e.target.value))}
          style={formControlStyle}
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}/page
            </option>
          ))}
        </select>
      </div>
      {view === 'list' && (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            // Dimmed, not blanked, while a not-yet-cached page is in
            // flight — a page flip should never look like the data
            // vanished, just like a page-fetch-in-progress state anywhere
            // else in this app.
            opacity: state.loadingPage ? 0.5 : 1,
            pointerEvents: state.loadingPage ? 'none' : undefined,
          }}
        >
          {state.status === 'loading' ? (
            <LoadingState>Loading items…</LoadingState>
          ) : pageItems.length === 0 ? (
            <div style={{ padding: 8, fontSize: 12, color: 'var(--color-text-faint)' }}>no items on this page</div>
          ) : (
            pageItems.map((item) => (
              <ItemRow
                key={item.href}
                item={item}
                selected={item.href === selectedHref}
                onSelect={() => select(item.href)}
                rowRef={item.href === selectedHref ? selectedRowRef : undefined}
              />
            ))
          )}
        </div>
      )}
      {view === 'time-space' && (
        <TimeSpaceView
          items={pageItems}
          dimmedItems={state.otherLoadedItems}
          selectedHref={selectedHref ?? undefined}
          onSelect={select}
          nodeHref={node.href}
          loading={state.status === 'loading'}
          emptyMessage={() => 'no matching data on this page'}
        />
      )}
      <div style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 4 }}>
        page {state.pageIndex + 1} of {state.totalPages} — {state.totalItems} items total
      </div>
    </div>
  )
}

function pagerButtonStyle(disabled: boolean): React.CSSProperties {
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

function pageNumberButtonStyle(selected: boolean): React.CSSProperties {
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
function buildPageList(current: number, total: number): (number | 'ellipsis')[] {
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
const formControlStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 4px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  colorScheme: 'light dark',
}

// ---------------------------------------------------------------------------
// API-backed collections — a real, locally-scoped query (no pagination UI)
// ---------------------------------------------------------------------------

function toRfc3339Start(dateOnly: string): string {
  return `${dateOnly}T00:00:00Z`
}
function toRfc3339End(dateOnly: string): string {
  return `${dateOnly}T23:59:59Z`
}
function toDateInputValue(rfc3339: string | undefined): string {
  return rfc3339 ? rfc3339.slice(0, 10) : ''
}

interface QueryDraft {
  dateStart: string // yyyy-mm-dd, from <input type="date">
  dateEnd: string
  sortDirection?: 'asc' | 'desc'
  bbox?: [number, number, number, number]
}

const EMPTY_DRAFT: QueryDraft = { dateStart: '', dateEnd: '' }

function draftToFilter(draft: QueryDraft): CursorQuery {
  return {
    datetimeStart: draft.dateStart ? toRfc3339Start(draft.dateStart) : undefined,
    datetimeEnd: draft.dateEnd ? toRfc3339End(draft.dateEnd) : undefined,
    sortDirection: draft.sortDirection,
    bbox: draft.bbox,
  }
}

function isEmptyQuery(q: CursorQuery): boolean {
  return !q.datetimeStart && !q.datetimeEnd && !q.sortDirection && !q.bbox
}

function describeQuery(q: CursorQuery): string {
  const parts: string[] = []
  if (q.datetimeStart || q.datetimeEnd) {
    parts.push(`${toDateInputValue(q.datetimeStart) || '…'} → ${toDateInputValue(q.datetimeEnd) || '…'}`)
  }
  if (q.sortDirection) parts.push(q.sortDirection === 'desc' ? 'newest first' : 'oldest first')
  if (q.bbox) parts.push('bbox set')
  return parts.join(' · ')
}

function CursorItemSetBrowser({ node }: { node: StacNode & { items: { kind: 'cursor' } } }) {
  const state = useCursorQueriedItemSet(node)
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  const select = useSelectionStore((s) => s.select)
  const [view, setView] = useState<ItemSetView>('list')
  const conformsTo = useApiConformance(node)
  const sortAvailable = supportsSort(conformsTo)

  const [draft, setDraft] = useState<QueryDraft>(EMPTY_DRAFT)
  const [drawArmed, setDrawArmed] = useState(false)

  useResetShowOnLenses(node.href)
  const items = state.status === 'empty' ? [] : state.items
  usePublishVisible(node.href, items)
  const selectedRowRef = useScrollSelectedIntoView(selectedHref, items)

  // Memoized — this becomes `ItemsMap`'s `onBboxDrawn` prop, one of that
  // component's own draw-mode effect's dependencies. This component
  // re-renders whenever background scroll-triggered `loadMore` fetches
  // resolve, which can happen while a draw gesture is still in progress;
  // a fresh closure on every such render would tear the draw effect down
  // and rebuild it (detaching/reattaching the map's native mouse
  // listeners) mid-drag, discarding whatever the in-progress gesture had
  // drawn so far. Declared unconditionally, before the early return below,
  // since Hooks can't be called conditionally.
  const handleBboxDrawn = useCallback((bbox: [number, number, number, number]) => {
    setDraft((d) => ({ ...d, bbox }))
    setDrawArmed(false)
  }, [])

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    if (state.status !== 'ready' || !state.hasMore || state.loadingMore) return
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_LOAD_THRESHOLD) {
      state.loadMore()
    }
  }

  if (state.status === 'empty') return null

  // Destructured, not accessed as `state.xxx` inside the closures below —
  // narrowing away the `{status:'empty'}` branch above doesn't carry into
  // a nested function body in TS's control-flow analysis (a known
  // limitation for property narrowing across closures), but a plain
  // destructured `const` keeps its own concrete type regardless.
  const { applyQuery, clearQuery, appliedQuery } = state
  const appliedFilterActive = !isEmptyQuery(appliedQuery)
  const draftFilter = draftToFilter(draft)
  const draftDirty = JSON.stringify(draftFilter) !== JSON.stringify(appliedQuery)

  function handleSearch() {
    applyQuery(draftToFilter(draft))
  }
  function handleClear() {
    setDraft(EMPTY_DRAFT)
    clearQuery()
  }
  function handleDrawToggle() {
    if (!drawArmed) setView('time-space') // drawing needs the map actually mounted/visible
    setDrawArmed((v) => !v)
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ApiBadge />
      <TabBar view={view} setView={setView} />
      {/* The interactive bbox/datetime-range query tool that used to hang
       * off Inspector's own Space/Time Lens (a global store, "select
       * area"/"select range") was pulled out entirely in a past pass —
       * "我现在连select Area、Select Range的功能都应该不要...API查询这部分功能
       * 整个先搁置" (I don't even want the Select Area/Select Range
       * functionality anymore — the whole API-querying-by-drawing feature
       * is shelved for now). This is a deliberately different, later
       * addition: a query module scoped locally to *this* panel's own
       * state (docs/DESIGN.md §68), not a revival of that global tool — no
       * id/title text search here either, replaced entirely by this real
       * query instead ("API的话我们就用别的,纯粹基于搜索,检索,排序的方式就可以"). */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 6,
          marginBottom: 6,
          padding: '6px 8px',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-surface)',
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>From</span>
        <input
          type="date"
          value={draft.dateStart}
          onChange={(e) => setDraft((d) => ({ ...d, dateStart: e.target.value }))}
          style={formControlStyle}
        />
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>to</span>
        <input
          type="date"
          value={draft.dateEnd}
          onChange={(e) => setDraft((d) => ({ ...d, dateEnd: e.target.value }))}
          style={formControlStyle}
        />
        {/* Only rendered when the API's own conformance actually declares
         * the Sort extension — never sent as a param a server might reject
         * or silently ignore. */}
        {sortAvailable && (
          <select
            value={draft.sortDirection ?? ''}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                sortDirection: (e.target.value || undefined) as 'asc' | 'desc' | undefined,
              }))
            }
            style={formControlStyle}
          >
            <option value="">Default order</option>
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
        )}
        <button onClick={handleDrawToggle} style={pagerButtonStyle(false)}>
          {drawArmed ? 'Drawing… click map to finish' : 'Draw area on map'}
        </button>
        {draft.bbox && (
          <button
            onClick={() => setDraft((d) => ({ ...d, bbox: undefined }))}
            title="Clear the drawn bbox"
            style={pagerButtonStyle(false)}
          >
            bbox set ✕
          </button>
        )}
        <button onClick={handleSearch} disabled={state.loadingMore || !draftDirty} style={searchButtonStyle}>
          Search
        </button>
        <button
          onClick={handleClear}
          disabled={!appliedFilterActive && isEmptyQuery(draftFilter)}
          style={pagerButtonStyle(!appliedFilterActive && isEmptyQuery(draftFilter))}
        >
          Clear filters
        </button>
      </div>
      {appliedFilterActive && (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6 }}>
          filtered: {describeQuery(appliedQuery)}
        </div>
      )}
      {view === 'list' && (
        <div
          onScroll={handleScroll}
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          {state.status === 'loading' ? (
            <LoadingState>Loading items…</LoadingState>
          ) : (
            <>
              {items.map((item) => (
                <ItemRow
                  key={item.href}
                  item={item}
                  selected={item.href === selectedHref}
                  onSelect={() => select(item.href)}
                  rowRef={item.href === selectedHref ? selectedRowRef : undefined}
                />
              ))}
              {items.length === 0 && (
                <div style={{ padding: 8, fontSize: 12, color: 'var(--color-text-faint)' }}>
                  {appliedFilterActive ? 'no items match this query' : 'no items loaded'}
                </div>
              )}
              {state.loadingMore && (
                <div
                  style={{
                    padding: 8,
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    color: 'var(--color-text-muted)',
                  }}
                >
                  <Spinner size={12} />
                  Loading more…
                </div>
              )}
            </>
          )}
        </div>
      )}
      {view === 'time-space' && (
        <TimeSpaceView
          items={items}
          selectedHref={selectedHref ?? undefined}
          onSelect={select}
          nodeHref={node.href}
          loading={state.status === 'loading'}
          emptyMessage={() => (appliedFilterActive ? 'no items match this query' : 'no matching data in the loaded items')}
          // The *draft* bbox, not `appliedQuery.bbox` — shown immediately
          // once drawn, before "Search" is ever clicked. Reported directly:
          // "我绘制search范围的时候，看不见我绘制的区域，当然确实看到了bbox set"
          // (when I drew the search area, I couldn't see the area I drew,
          // though I did see "bbox set") — the temporary drawing preview
          // is removed the instant the gesture ends (by design, it's only
          // a live preview), and nothing else stood in for it until a
          // search actually ran, leaving a multi-second gap with zero
          // visual confirmation of what was just drawn. The two values
          // are identical the moment Search does commit, so this never
          // looks different from showing the applied one once submitted.
          appliedBbox={draft.bbox}
          drawMode={drawArmed}
          onBboxDrawn={handleBboxDrawn}
          appliedRange={{ start: appliedQuery.datetimeStart, end: appliedQuery.datetimeEnd }}
        />
      )}
      {state.status === 'ready' && (
        <div style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 4 }}>
          showing {items.length}
          {/* Undefined, not zero, when the source genuinely never reports a
           * total (some STAC API implementations don't). Reflects the
           * *current query's* match count, not the whole Collection's. */}
          {state.totalCount != null ? ` of ${state.totalCount}` : ''} items loaded
          {state.hasMore &&
            (view === 'list' ? ' — scroll the list to load more' : ' — switch to List view and scroll to load more')}
          {/* A narrowed area/range search often means "give me everything
           * matching this, not a trickle" — kept from the previous shared
           * hook, now firing against the filtered endpoint. */}
          {state.hasMore && (
            <button onClick={state.loadAll} disabled={state.loadingMore} style={loadAllButtonStyle(state.loadingMore)}>
              {state.loadingMore && <Spinner size={10} />}
              {state.loadingMore ? 'Loading…' : 'Load all remaining'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const searchButtonStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 10px',
  borderRadius: 999,
  border: '1px solid var(--color-selection)',
  background: 'var(--color-selection)',
  color: 'var(--color-bg)',
  cursor: 'pointer',
}

function loadAllButtonStyle(loading: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 999,
    border: '1px solid var(--color-border)',
    background: 'var(--color-surface)',
    color: 'var(--color-text-muted)',
    cursor: loading ? 'not-allowed' : 'pointer',
  }
}
