import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { scaleUtc, type ScaleTime } from 'd3-scale'
import { temporalBounds } from '../stac/temporal'
import type { StacNode, TemporalShape } from '../stac/types'

const ROW_HEIGHT = 20
const AXIS_HEIGHT = 28
const STATED_ROW_HEIGHT = 24
// Was a fixed 220px-wide *reserved* gutter for a permanent per-row name
// label, regardless of whether that row currently had one — on the
// default ~640px-wide Item Set box this was routinely a third or more of
// the whole width sitting unused, worse once the box could be resized
// wider still: "timeline需要一直显示name么？导致左侧的2/5都是没用的被浪费的
// 空间" (does the timeline need to always show the name? — the left 2/5
// ends up as wasted, unused space). Removed entirely — a name is exactly
// one hover away (the tooltip below already showed the full, untruncated
// name; there's no information loss, only a naming *convenience* traded
// for real width), the same "hover for identity, no permanent on-canvas
// label" convention `ItemsMap`'s own footprints already use — now that
// both live together in one Time & Space tab, this also makes the two
// halves consistent with each other where they weren't before. What's
// left is just a small left inset so a mark flush against t=domain-start
// isn't drawn right on the edge.
const LEFT_PAD = 12
const RIGHT_PAD = 24

function sortKey(node: StacNode): number {
  if (!node.temporal) return Infinity
  const [start, at] = temporalBounds(node.temporal)
  return (start ?? at)?.getTime() ?? Infinity
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

interface TimeGroup {
  shape: TemporalShape
  items: StacNode[]
}

function shapeKey(shape: TemporalShape): string {
  if (shape.kind === 'instant') return `instant:${shape.at}`
  return `interval:${shape.start ?? ''}:${shape.end ?? ''}`
}

/** Items with the exact same [start, end] (or the same instant) collapse
 *  into one row instead of one apiece — not just a density optimization:
 *  Adaptation Atlas has a real copy-paste metadata bug where many Items
 *  claim identical timing despite different IDs, so grouping surfaces that
 *  cluster directly rather than hiding it behind 50 visually-identical bars. */
function groupByTemporalShape(items: StacNode[]): TimeGroup[] {
  const groups = new Map<string, TimeGroup>()
  for (const item of items) {
    if (!item.temporal) continue
    const key = shapeKey(item.temporal)
    const existing = groups.get(key)
    if (existing) existing.items.push(item)
    else groups.set(key, { shape: item.temporal, items: [item] })
  }
  return [...groups.values()]
}

function groupBoundsMs(group: TimeGroup, domain: readonly [Date, Date]): [number, number] {
  const [s, e] = temporalBounds(group.shape)
  return [(s ?? domain[0]).getTime(), (e ?? domain[1]).getTime()]
}

/** Classic greedy interval-packing ("minimum meeting rooms"): each group
 *  goes in the first lane whose previous occupant has already ended, so
 *  groups that don't overlap in time share a row instead of every group
 *  getting its own. */
function packLanes(groups: TimeGroup[], domain: readonly [Date, Date]): { group: TimeGroup; lane: number }[] {
  const withBounds = groups
    .map((group) => ({ group, bounds: groupBoundsMs(group, domain) }))
    .sort((a, b) => a.bounds[0] - b.bounds[0])

  const laneEnds: number[] = []
  const assignments: { group: TimeGroup; lane: number }[] = []
  for (const { group, bounds } of withBounds) {
    let lane = laneEnds.findIndex((end) => end <= bounds[0])
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(bounds[1])
    } else {
      laneEnds[lane] = bounds[1]
    }
    assignments.push({ group, lane })
  }
  return assignments
}

/** Does this group's own range fall anywhere within `domain` — used to
 *  filter down to "what's actually visible" once the axis is focused on a
 *  selected Item (`focusOnSelection`). Open bounds are treated as
 *  unbounded, not clamped to some other domain. */
function groupIntersectsDomain(group: TimeGroup, domain: readonly [Date, Date]): boolean {
  const [s, e] = temporalBounds(group.shape)
  const startMs = s ? s.getTime() : -Infinity
  const endMs = e ? e.getTime() : Infinity
  return endMs >= domain[0].getTime() && startMs <= domain[1].getTime()
}

/** A Collection can span decades while one selected Item covers a single
 *  day — defaulting the axis to the full range makes that Item an
 *  invisible sliver. Narrows the displayed domain around the selected
 *  Item's own range (padded so its mark isn't flush against the edges),
 *  clamped to never exceed the full domain. */
function computeFocusDomain(shape: TemporalShape, fullDomain: readonly [Date, Date]): readonly [Date, Date] {
  const [s, e] = temporalBounds(shape)
  const startMs = (s ?? e)?.getTime()
  const endMs = (e ?? s)?.getTime()
  if (startMs == null || endMs == null) return fullDomain

  const fullSpanMs = fullDomain[1].getTime() - fullDomain[0].getTime()
  const duration = Math.max(endMs - startMs, 0)
  const pad = Math.max(duration * 0.4, fullSpanMs * 0.05)

  const start = Math.max(startMs - pad, fullDomain[0].getTime())
  const end = Math.min(endMs + pad, fullDomain[1].getTime())
  if (start >= end) return fullDomain
  return [new Date(start), new Date(end)]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Applies a `{k, x}` zoom/pan transform to a base time scale, replicating
 *  d3-zoom's own `ZoomTransform.rescaleX` algorithm (a new scale whose
 *  domain is adjusted so the *same range* now reads the zoomed/panned
 *  view) without depending on d3-zoom itself — see the real, hands-on
 *  investigation in docs/DESIGN.md §61's update for why this hand-rolled
 *  version replaced a d3-zoom-based one that turned out not to fire at
 *  all once nested this deep inside Structure Lens's own zoom-bound
 *  canvas, despite being wired identically to that already-working
 *  pattern. */
function rescaleX(base: ScaleTime<number, number>, k: number, tx: number): ScaleTime<number, number> {
  return base.copy().domain(base.range().map((r) => base.invert((r - tx) / k)))
}

/** The hover tooltip's own text — the only place a group's identity is
 *  shown now that there's no permanent on-canvas label (see `LEFT_PAD`'s
 *  own comment above). */
function groupTooltip(group: TimeGroup): string {
  if (group.items.length === 1) return group.items[0].title ?? group.items[0].id
  const ids = group.items.map((i) => i.id)
  const shown = ids.slice(0, 8).join(', ')
  return ids.length > 8 ? `${shown}, +${ids.length - 8} more` : shown
}

interface TooltipState {
  label: string
  x: number
  y: number
}

const IDENTITY_TRANSFORM = { k: 1, x: 0 }

/** The pure "given some Items, draw their temporal shape" visualization —
 *  extracted out of `TimeLens.tsx` so it can be shared between Inspector's
 *  own single-object-scoped Temporal field (still driven by
 *  `useSelectedItems()`) and Item Set's own multi-item batch view (§59):
 *  "因为不管是时间还是空间都是看待同一批数据的另一种方式而已" (time and space
 *  are both just another way of looking at the same batch of data). No
 *  selection-scoping logic lives here at all — a caller decides what
 *  `items`/`highlightHref` mean in its own context; this component only
 *  ever plots exactly what it's given. */
export function ItemsTimeline({
  items,
  dimmedItems,
  highlightHref,
  statedShape,
  viewWidth,
  onSelectItem,
  focusOnSelection = false,
  zoomable = false,
  scrollSelectedIntoView = false,
  appliedRange,
}: {
  items: StacNode[]
  /** Marks from pages/batches already fetched but not currently the
   *  "active" set — plotted on the same shared axis/lanes as `items` (so
   *  nothing overlaps), but muted and unclickable. Same feature as
   *  `ItemsMap`'s own `dimmedItems` prop, asked for together: "已经加载过的
   *  page的数据就留在...timeline和地图都一样，比如说灰色的之类的，但是需要能够被
   *  看见" (already-loaded pages' data should stay on both the timeline
   *  and the map — grayed out, but visible). Omit when there's no such
   *  secondary set. */
  dimmedItems?: StacNode[]
  highlightHref?: string
  /** A reference extent to show as its own row above the Item rows (e.g.
   *  a Collection's own declared `extent.temporal`) — omit when there's
   *  nothing meaningful to compare against in this context. */
  statedShape?: TemporalShape
  viewWidth: number
  onSelectItem: (href: string) => void
  /** A currently-applied query's own datetime range — drawn as a low-
   *  opacity background band spanning start→end (open sides fall back to
   *  the domain edge) so "why did the mark set narrow" is visible directly
   *  on the axis. Pure display: no drag/select gesture lives here (see
   *  the file-level rationale in docs/DESIGN.md for why the range filter
   *  itself is two plain date inputs elsewhere, not a canvas drag). */
  appliedRange?: { start?: string; end?: string }
  /** Narrow the displayed axis to a padded window around `highlightHref`'s
   *  own range, instead of the full domain — right for Inspector's
   *  single-Item view (there are no neighbors to lose; without this, a
   *  single day-long Item is an invisible sliver on a decades-wide axis),
   *  wrong for a multi-item batch view (narrowing there would hide every
   *  other item just to focus on the one clicked, defeating the point of
   *  looking at the batch at all). Off by default for that reason. */
  focusOnSelection?: boolean
  /** Lets the axis itself be zoomed/panned (wheel to zoom, drag to pan) —
   *  the same direct-manipulation language Structure Lens's own canvas and
   *  Space Lens's map already use elsewhere in this app, not a slider:
   *  "如果items很多话，我觉得timeline完全可以zoom in zoom out，就像很多ui做到
   *  的那样的" (when there are many items, the timeline should support zoom
   *  in/out, the way plenty of UIs already do). Off by default — Inspector's
   *  own single-object embedded widget wasn't asked for this and already
   *  has `focusOnSelection` doing similar work; only Item Set's own
   *  multi-item batch view (§62) turns it on. */
  zoomable?: boolean
  /** Auto-scroll the selected row into view on selection — right for Item
   *  Set's own multi-item batch view, where only a handful of rows are
   *  visible out of possibly thousands and a highlight with no scroll is
   *  invisible in practice; meaningless (and actively disruptive) for
   *  Inspector's own single-object widget, which always shows exactly one
   *  row already sitting in its natural, already-visible position inline
   *  in the page. A real, confirmed bug: `scrollIntoView` has no way to
   *  target only *this* component's own local scroll container — it walks
   *  every scrollable ancestor between the target and the viewport, so
   *  this unconditionally fired call was also scrolling Inspector's own
   *  outer column to "center" a tiny SVG row that was already on screen,
   *  visibly yanking the whole panel on every selection for no reason.
   *  Off by default for that reason; Item Set turns it on explicitly. */
  scrollSelectedIntoView?: boolean
}) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const activeHrefs = useMemo(() => new Set(items.map((i) => i.href)), [items])
  // Combined so dimmed marks share the exact same domain/grouping/lane
  // layout as active ones — never overlapping, never off the visible
  // axis — with `activeHrefs` (above) the only thing distinguishing how a
  // given group ends up styled once rendered, below.
  const sortedItems = useMemo(() => {
    const dimmed = (dimmedItems ?? []).filter((i) => !activeHrefs.has(i.href))
    return [...items, ...dimmed].sort((a, b) => sortKey(a) - sortKey(b))
  }, [items, dimmedItems, activeHrefs])

  const domain = useMemo(() => {
    const dates: Date[] = []
    for (const item of sortedItems) {
      if (!item.temporal) continue
      const [s, e] = temporalBounds(item.temporal)
      if (s) dates.push(s)
      if (e) dates.push(e)
    }
    if (statedShape) {
      const [s, e] = temporalBounds(statedShape)
      if (s) dates.push(s)
      if (e) dates.push(e)
    }
    if (dates.length === 0) return undefined
    const min = new Date(Math.min(...dates.map((d) => d.getTime())))
    const max = new Date(Math.max(...dates.map((d) => d.getTime())))
    if (min.getTime() === max.getTime()) {
      // Degenerate single-instant domain — pad so a point is visible.
      return [new Date(min.getTime() - 86400000), new Date(max.getTime() + 86400000)] as const
    }
    return [min, max] as const
  }, [sortedItems, statedShape])

  const groups = useMemo(() => groupByTemporalShape(sortedItems), [sortedItems])

  const selectedItem = highlightHref ? sortedItems.find((i) => i.href === highlightHref) : undefined
  const displayDomain = useMemo(() => {
    if (!domain) return undefined
    if (focusOnSelection && selectedItem?.temporal) return computeFocusDomain(selectedItem.temporal, domain)
    return domain
  }, [domain, focusOnSelection, selectedItem])
  const isFocused = focusOnSelection && !!selectedItem?.temporal

  // Lane packing over *every* loaded group is right for the unfocused
  // overview — that's the point of packing, showing the full shape of
  // availability in minimal vertical space. Once focused on one Item
  // though, repacking over only what's actually visible in the narrowed
  // window keeps unrelated groups (some other decade) from cluttering the
  // label layer at the same lane.
  const visibleGroups = useMemo(() => {
    if (!isFocused || !displayDomain) return groups
    return groups.filter((g) => groupIntersectsDomain(g, displayDomain))
  }, [groups, isFocused, displayDomain])

  const assignments = useMemo(() => {
    if (!domain) return []
    return isFocused && displayDomain ? packLanes(visibleGroups, displayDomain) : packLanes(groups, domain)
  }, [groups, visibleGroups, domain, displayDomain, isFocused])

  // Bring the selected row into view automatically — once per distinct
  // selection, so it doesn't fight a manual scroll. Gated on
  // `scrollSelectedIntoView` (see its own doc comment above) — never runs
  // for Inspector's single-object widget.
  const selectedRowRef = useRef<SVGGElement | null>(null)
  const lastScrolledRef = useRef<string | null>(null)
  useEffect(() => {
    if (!scrollSelectedIntoView || !highlightHref || highlightHref === lastScrolledRef.current) return
    if (selectedRowRef.current) {
      lastScrolledRef.current = highlightHref
      selectedRowRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [scrollSelectedIntoView, highlightHref, assignments])

  // Wheel-to-zoom, drag-to-pan on the time axis — hand-rolled with plain
  // React event handlers + native window listeners, the exact same
  // mousedown/mousemove/mouseup composition App.tsx's own Inspector-width
  // divider already uses. This replaced a first attempt built on d3-zoom
  // (the same library/pattern Structure Lens's own canvas already uses
  // successfully) after real, hands-on investigation found it silently
  // never fired once nested this deep inside Structure Lens's own
  // zoom-bound outer `<svg>` — see `rescaleX`'s own comment above and
  // docs/DESIGN.md §61's update for the full account, including how a
  // plain React `onMouseDown`/`onWheel` was confirmed (via direct testing)
  // to fire reliably in the exact same spot d3-zoom's own directly-attached
  // native listener mysteriously did not.
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [transform, setTransform] = useState(IDENTITY_TRANSFORM)
  const transformRef = useRef(transform)
  useEffect(() => {
    transformRef.current = transform
  })

  // A native (non-React-synthetic), non-passive listener specifically for
  // wheel — needed so `preventDefault()` actually suppresses the page's
  // own scroll during a zoom gesture, which React's own synthetic
  // `onWheel` cannot reliably do (attached passively at the root by
  // default). Zooms centered on the cursor's own position: solves for the
  // pan offset that keeps the date currently under the pointer fixed in
  // place as the scale changes, the standard "zoom toward cursor" idiom.
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const svgEl = svgRef.current
    if (!svgEl) return
    const mouseX = e.clientX - svgEl.getBoundingClientRect().left
    const prev = transformRef.current
    const factor = Math.exp(-e.deltaY * 0.002)
    const newK = clamp(prev.k * factor, 1, 200)
    const u = (mouseX - prev.x) / prev.k
    setTransform({ k: newK, x: mouseX - newK * u })
  }, [])

  // Callback ref, not a plain ref + fixed-deps effect — the same class of
  // timing bug already documented in this codebase (§44's `useElementSize`)
  // for a ref target that might not exist yet at a fixed-deps effect's own
  // first run; a callback ref instead fires exactly on attach/detach
  // regardless of timing, and is what correctly (re)attaches this native
  // listener whenever the underlying DOM node changes.
  const svgCallbackRef = useCallback(
    (el: SVGSVGElement | null) => {
      svgRef.current?.removeEventListener('wheel', handleWheel)
      svgRef.current = el
      if (el && zoomable) el.addEventListener('wheel', handleWheel, { passive: false })
    },
    [zoomable, handleWheel],
  )

  const [panning, setPanning] = useState(false)

  function handleMouseDown(e: React.MouseEvent) {
    if (!zoomable) return
    // Same opt-out convention as everywhere else in this app: a click
    // starting on an interactive label/mark should never also start a
    // pan gesture. Deliberately *not* `target.closest('[data-block-pan]')`
    // — a real, confirmed bug found while fixing this feature: this
    // timeline lives nested inside Structure Lens's own Item Set box,
    // whose *outer* wrapper div also carries `data-block-pan="true"` (for
    // an entirely unrelated reason — keeping the tree's own canvas zoom
    // from engaging inside the box at all). `.closest()` walks all the way
    // up regardless of which layer set the attribute, so it matched that
    // outer div on literally every mousedown anywhere in this component,
    // permanently blocking every pan gesture before it could ever start.
    // Walking manually and stopping at this component's own `<svg>` root
    // scopes the check to only *this* component's own marked descendants.
    let el: Element | null = e.target as Element
    while (el && el !== svgRef.current) {
      if (el.hasAttribute('data-block-pan')) return
      el = el.parentElement
    }
    e.preventDefault()
    const startClientX = e.clientX
    const startX = transformRef.current.x
    setPanning(true)
    function onMove(ev: MouseEvent) {
      setTransform((prev) => ({ ...prev, x: startX + (ev.clientX - startClientX) }))
    }
    function onUp() {
      setPanning(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const resetZoom = () => setTransform(IDENTITY_TRANSFORM)

  if (!domain || !displayDomain) return null

  const baseX = scaleUtc().domain(displayDomain).range([LEFT_PAD, viewWidth - RIGHT_PAD])
  // The zoomed/panned view of the same scale — used for every position
  // below instead of `baseX` directly; `displayDomain` itself never
  // changes from zooming alone, so lane-packing (already computed above)
  // stays correct regardless of the current zoom level — only where
  // things are drawn moves, not which lane they're in.
  const x = zoomable ? rescaleX(baseX, transform.k, transform.x) : baseX
  const tickCount = Math.max(2, Math.floor((viewWidth - LEFT_PAD) / 110))
  const ticks = x.ticks(tickCount)

  const laneCount = assignments.length ? Math.max(...assignments.map((a) => a.lane)) + 1 : 0
  const statedRowY = AXIS_HEIGHT
  const itemsStartY = AXIS_HEIGHT + (statedShape ? STATED_ROW_HEIGHT + 8 : 0)
  const height = itemsStartY + laneCount * ROW_HEIGHT + 12

  return (
    <div style={{ position: 'relative' }}>
      <svg
        ref={svgCallbackRef}
        width="100%"
        viewBox={`0 0 ${viewWidth} ${height}`}
        style={{ display: 'block', cursor: zoomable ? (panning ? 'grabbing' : 'grab') : undefined }}
        onMouseDown={handleMouseDown}
      >
        {appliedRange &&
          (() => {
            const [domainStart, domainEnd] = displayDomain
            const rangeStart = appliedRange.start ? new Date(appliedRange.start) : domainStart
            const rangeEnd = appliedRange.end ? new Date(appliedRange.end) : domainEnd
            const bandX1 = x(rangeStart)
            const bandX2 = Math.max(bandX1 + 1, x(rangeEnd))
            return (
              <rect
                x={bandX1}
                y={0}
                width={bandX2 - bandX1}
                height={height}
                style={{ fill: 'var(--color-selection)', opacity: 0.06 }}
              />
            )
          })()}
        {ticks.map((t) => (
          <g key={t.getTime()} transform={`translate(${x(t)}, 0)`}>
            <line y1={0} y2={height} style={{ stroke: 'var(--color-border)' }} strokeWidth={1} />
            <text y={14} fontSize={10} textAnchor="middle" style={{ fill: 'var(--color-text-faint)' }}>
              {formatDate(t)}
            </text>
          </g>
        ))}

        {statedShape && (
          <g transform={`translate(0, ${statedRowY})`}>
            <TemporalMark
              shape={statedShape}
              x={x}
              y={STATED_ROW_HEIGHT / 2}
              domain={displayDomain}
              color="var(--color-text-faint)"
              filled={false}
              onHover={(clientX, clientY) =>
                setTooltip({ label: 'stated extent (source)', x: clientX, y: clientY })
              }
              onHoverEnd={() => setTooltip(null)}
            />
          </g>
        )}

        {assignments.map(({ group, lane }) => {
          const y = itemsStartY + lane * ROW_HEIGHT
          const selected = !!highlightHref && group.items.some((i) => i.href === highlightHref)
          const tooltipText = groupTooltip(group)
          const hasInvalidGeometry = group.items.some((i) => i.spatial?.geometryInvalid)
          const clickHref = group.items[0].href
          // A group mixing an active item with a dimmed one (a real
          // possibility — Adaptation Atlas has genuine duplicate-timestamp
          // Items that already collapse into one group regardless of page)
          // counts as active: it has something clickable in it, so it
          // should look and behave like any other active mark.
          const isActive = group.items.some((i) => activeHrefs.has(i.href))
          return (
            <g key={shapeKey(group.shape)} ref={selected ? selectedRowRef : undefined} transform={`translate(0, ${y})`}>
              <TemporalMark
                shape={group.shape}
                x={x}
                y={ROW_HEIGHT / 2}
                domain={displayDomain}
                color={
                  !isActive
                    ? 'var(--color-text-faint)'
                    : hasInvalidGeometry
                      ? 'var(--color-node-warning)'
                      : 'var(--color-node-item)'
                }
                filled
                selected={selected}
                onClick={isActive ? () => onSelectItem(clickHref) : undefined}
                onHover={(clientX, clientY) => setTooltip({ label: tooltipText, x: clientX, y: clientY })}
                onHoverEnd={() => setTooltip(null)}
              />
            </g>
          )
        })}
      </svg>
      {tooltip &&
        createPortal(
          // A portal to `document.body`, not a plain sibling `<div>` — this
          // component lives nested inside Structure Lens's own zoomed/panned
          // tree canvas (a `foreignObject` inside a `<g transform="...
          // scale(k)">`), and an SVG ancestor's `transform` attribute
          // establishes a new containing block for `position: fixed`
          // descendants nested in that `foreignObject`, same as a CSS
          // `transform` would. Without escaping via a portal, "fixed"
          // silently became "positioned relative to that scaled/translated
          // `<g>`" instead of the real viewport — explaining a real user
          // report of two symptoms at once: the tooltip landing ~100px from
          // the cursor (its `left`/`top` used real `clientX`/`clientY`, but
          // against the wrong containing block), and its font visibly
          // shrinking/growing as the *tree's* canvas was zoomed, even
          // though nothing here sets a font size relative to that zoom.
          <div
            style={{
              position: 'fixed',
              left: tooltip.x + 14,
              top: tooltip.y + 12,
              background: 'var(--color-text)',
              color: 'var(--color-bg)',
              padding: '4px 8px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 12,
              maxWidth: 380,
              pointerEvents: 'none',
              zIndex: 2000,
              boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
            }}
          >
            {tooltip.label}
          </div>,
          document.body,
        )}
      {/* Only shown once there's actually something to reset — same
       * precedent as Structure Lens's own "Reset layout" button, which is
       * likewise conditional on real drag/resize state existing. */}
      {zoomable && (transform.k !== 1 || transform.x !== 0) && (
        <button
          onClick={resetZoom}
          title="Reset the timeline's zoom/pan"
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 999,
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
          }}
        >
          Reset zoom
        </button>
      )}
    </div>
  )
}

interface TemporalMarkProps {
  shape: TemporalShape
  x: (d: Date) => number
  y: number
  domain: readonly [Date, Date]
  color: string
  filled: boolean
  selected?: boolean
  onClick?: () => void
  onHover?: (clientX: number, clientY: number) => void
  onHoverEnd?: () => void
}

/** Renders one temporal shape as a mark on the shared axis: a small
 *  diamond for an instant, a bar for a closed interval, and a bar that
 *  fades toward an arrow for an open-ended bound. */
function TemporalMark({ shape, x, y, domain, color, filled, selected, onClick, onHover, onHoverEnd }: TemporalMarkProps) {
  const handlers = onHover
    ? {
        onMouseEnter: (e: React.MouseEvent) => onHover(e.clientX, e.clientY),
        onMouseMove: (e: React.MouseEvent) => onHover(e.clientX, e.clientY),
        onMouseLeave: () => onHoverEnd?.(),
      }
    : {}

  // Only actually-clickable marks (real Item groups, not the passive
  // stated-extent reference bar) opt out of a pan/zoom gesture starting on
  // them — blocking it on the reference bar too would remove a large,
  // otherwise-harmless area to start a drag from, for no real benefit
  // (there's nothing to click there in the first place).
  const blockPan = onClick ? { 'data-block-pan': 'true' } : {}

  if (shape.kind === 'instant') {
    const cx = x(new Date(shape.at))
    return (
      <g onClick={onClick} {...handlers} {...blockPan} style={{ cursor: onClick ? 'pointer' : undefined }}>
        {selected && <circle cx={cx} cy={y} r={7} fill="none" strokeWidth={2} style={{ stroke: 'var(--color-selection)' }} />}
        <circle cx={cx} cy={y} r={4} style={{ fill: filled ? color : 'none', stroke: color }} strokeWidth={1.5} />
      </g>
    )
  }

  const [domainStart, domainEnd] = domain
  const startDate = shape.start ? new Date(shape.start) : domainStart
  const endDate = shape.end ? new Date(shape.end) : domainEnd
  const x1 = x(startDate)
  const x2 = Math.max(x1 + 2, x(endDate))
  const openStart = shape.start === null
  const openEnd = shape.end === null

  return (
    <g onClick={onClick} {...handlers} {...blockPan} style={{ cursor: onClick ? 'pointer' : undefined }}>
      {selected && (
        <rect x={x1 - 2} y={y - 7} width={x2 - x1 + 4} height={14} rx={3} fill="none" strokeWidth={2} style={{ stroke: 'var(--color-selection)' }} />
      )}
      <rect
        x={x1}
        y={y - 4}
        width={x2 - x1}
        height={8}
        rx={2}
        style={{ fill: filled ? color : 'none', stroke: color, opacity: filled ? 0.85 : 1 }}
        strokeWidth={filled ? 0 : 1.5}
        strokeDasharray={openStart || openEnd ? '3,2' : undefined}
      />
      {openStart && (
        <text x={x1 - 6} y={y + 4} fontSize={10} textAnchor="end" style={{ fill: color }}>
          ←
        </text>
      )}
      {openEnd && (
        <text x={x2 + 6} y={y + 4} fontSize={10} style={{ fill: color }}>
          →
        </text>
      )}
    </g>
  )
}
