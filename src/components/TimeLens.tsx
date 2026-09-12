import { useEffect, useMemo, useRef, useState } from 'react'
import { scaleUtc } from 'd3-scale'
import { useSelectionStore } from '../store/selection'
import { useSelectedItems } from '../hooks/useSelectedItems'
import { useElementSize } from '../hooks/useElementSize'
import { temporalBounds } from '../stac/temporal'
import type { StacNode, TemporalShape } from '../stac/types'
import { EmptyState } from './EmptyState'
import { LoadingState } from './LoadingState'

const ROW_HEIGHT = 20
const AXIS_HEIGHT = 28
const STATED_ROW_HEIGHT = 24
const LABEL_WIDTH = 220
const RIGHT_PAD = 24
const FALLBACK_VIEW_WIDTH = 800
const LABEL_MAX_CHARS = 26

function truncateLabel(label: string): string {
  return label.length > LABEL_MAX_CHARS ? `${label.slice(0, LABEL_MAX_CHARS - 1)}…` : label
}

const EMPTY_ITEMS: StacNode[] = []

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

/** Does this group's own range fall anywhere within `domain` — used to
 *  filter down to "what's actually visible" when the axis is focused on a
 *  selected Item (see `displayDomain`/`computeFocusDomain`). Open bounds are
 *  treated as unbounded, not clamped to some other domain, so an
 *  open-ended group is "visible" from wherever it starts/ends onward. */
function groupIntersectsDomain(group: TimeGroup, domain: readonly [Date, Date]): boolean {
  const [s, e] = temporalBounds(group.shape)
  const startMs = s ? s.getTime() : -Infinity
  const endMs = e ? e.getTime() : Infinity
  return endMs >= domain[0].getTime() && startMs <= domain[1].getTime()
}

/** Classic greedy interval-packing ("minimum meeting rooms"): each group
 *  goes in the first lane whose previous occupant has already ended, so
 *  groups that don't overlap in time share a row instead of every group
 *  getting its own. This is what keeps panel height sane even before any
 *  exact-duplicate grouping kicks in — e.g. yearly non-overlapping data
 *  packs into very few lanes regardless of how many Items there are. */
function packLanes(
  groups: TimeGroup[],
  domain: readonly [Date, Date],
): { group: TimeGroup; lane: number }[] {
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

/** The same scale problem Space Lens had with tiny bboxes, applied to time:
 *  a Collection can span decades while one selected Item covers a single
 *  day, and the axis defaulting to the full collection range makes that
 *  Item an invisible sliver. Mirrors Space Lens's flyToBounds — narrows the
 *  displayed domain around the selected Item's own range (padded so its
 *  mark isn't flush against the edges), clamped to never exceed the full
 *  collection extent (an Item that already spans most of it, like Atlas's
 *  65-year aggregate rollup, naturally ends up close to the full view
 *  rather than an arbitrarily wider one). */
function computeFocusDomain(
  shape: TemporalShape,
  fullDomain: readonly [Date, Date],
): readonly [Date, Date] {
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

function groupLabel(group: TimeGroup): string {
  if (group.items.length === 1) {
    const item = group.items[0]
    return item.title ?? item.id
  }
  return `${group.items.length} items, identical timing`
}

/** Full detail for the hover tooltip — the label truncates/summarizes,
 *  the tooltip always lists what's actually in the group. */
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

/** Wayback-Machine-style availability view, scoped to whatever's selected
 *  in Structure Lens — never global, since a collection can hold tens of
 *  thousands of items. Instant / closed-interval / open-ended temporal
 *  shapes render distinctly rather than being normalized to one point, and
 *  the collection's stated extent renders as its own reference row so a
 *  stated-vs-actual mismatch is directly visible rather than computed only
 *  in a report.
 *
 *  The container div here must always render (only its *contents* are
 *  conditional on data being ready) — the size-measuring effect below binds
 *  once on mount, and if the ref were only attached inside a conditional
 *  branch it could bind to a still-null ref on first render and never
 *  retry. Same class of bug as the Structure Lens pan/zoom fix; see
 *  docs/DESIGN.md §5.
 *
 *  Deliberately `height: 'auto'`, not `100%` — this component hugs
 *  whatever height its own content (an EmptyState message, or the SVG's
 *  own data-driven height) actually needs; App.tsx's wrapper caps that at
 *  a max height with scroll, rather than this div stretching to fill a
 *  fixed-size slot sized for Space Lens's map instead (see docs/DESIGN.md
 *  §23). */
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
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const items = target.status === 'ready' ? target.items : EMPTY_ITEMS
  const node = target.status === 'ready' ? target.node : undefined

  const sortedItems = useMemo(() => [...items].sort((a, b) => sortKey(a) - sortKey(b)), [items])

  const highlightHref = target.status === 'ready' ? target.highlightHref : undefined
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
  const statedBounds = !highlightHref && node?.temporal ? temporalBounds(node.temporal) : undefined

  const domain = useMemo(() => {
    const dates: Date[] = []
    for (const item of sortedItems) {
      if (!item.temporal) continue
      const [s, e] = temporalBounds(item.temporal)
      if (s) dates.push(s)
      if (e) dates.push(e)
    }
    if (statedBounds) {
      if (statedBounds[0]) dates.push(statedBounds[0])
      if (statedBounds[1]) dates.push(statedBounds[1])
    }
    if (dates.length === 0) return undefined
    const min = new Date(Math.min(...dates.map((d) => d.getTime())))
    const max = new Date(Math.max(...dates.map((d) => d.getTime())))
    if (min.getTime() === max.getTime()) {
      // Degenerate single-instant domain — pad so a point is visible.
      return [new Date(min.getTime() - 86400000), new Date(max.getTime() + 86400000)] as const
    }
    return [min, max] as const
  }, [sortedItems, statedBounds])

  const groups = useMemo(() => groupByTemporalShape(sortedItems), [sortedItems])

  const selectedItem = highlightHref ? sortedItems.find((i) => i.href === highlightHref) : undefined

  // What's actually displayed on the axis — the full collection range by
  // default, narrowed to a padded window around the selected Item's own
  // range once one is selected.
  const displayDomain = useMemo(() => {
    if (!domain) return undefined
    if (selectedItem?.temporal) return computeFocusDomain(selectedItem.temporal, domain)
    return domain
  }, [domain, selectedItem])

  const isFocused = !!selectedItem?.temporal

  // Lane packing over *every* loaded group (rather than just what's inside
  // displayDomain) is exactly right for the unfocused, whole-collection
  // overview — that's the point of packing, showing the full shape of
  // availability in minimal vertical space. But once focused on one Item, a
  // Collection loaded with 100 Items still packed *all* of them in, most of
  // them off in some other decade — real, dense, all-instant data (Capella's
  // near-daily SAR captures) packs unrelated Items into the same lane purely
  // because zero-duration events never "overlap," which then collide at the
  // label layer (below) and clutter the view with marks nobody asked to see.
  // Repacking over only what's actually visible in the focused window fixes
  // both at once — see docs/DESIGN.md.
  const visibleGroups = useMemo(() => {
    if (!isFocused || !displayDomain) return groups
    return groups.filter((g) => groupIntersectsDomain(g, displayDomain))
  }, [groups, isFocused, displayDomain])

  const assignments = useMemo(() => {
    if (!domain) return []
    return isFocused && displayDomain
      ? packLanes(visibleGroups, displayDomain)
      : packLanes(groups, domain)
  }, [groups, visibleGroups, domain, displayDomain, isFocused])

  // A lane can hold several groups that don't overlap in time (that's the
  // whole point of packing), but the label column is a fixed-x gutter, not
  // positioned per-mark — so more than one label per lane would render at
  // the exact same pixel, unreadable (confirmed directly against Capella's
  // near-daily captures: distinct Item names literally overlapping). Cap it
  // at one label per lane, preferring whichever group contains the current
  // selection; the rest stay identifiable via hover/click on their mark,
  // same as before.
  const laneLabelKey = useMemo(() => {
    const byLane = new Map<number, string>()
    for (const { group, lane } of assignments) {
      const isSelected = !!highlightHref && group.items.some((i) => i.href === highlightHref)
      if (isSelected) byLane.set(lane, shapeKey(group.shape))
      else if (!byLane.has(lane)) byLane.set(lane, shapeKey(group.shape))
    }
    return byLane
  }, [assignments, highlightHref])

  // Bring the selected row into view automatically — a selection made
  // elsewhere (Structure Lens, Space Lens) shouldn't require manually
  // scrolling this panel to find where it landed. Once per distinct
  // selection, so it doesn't fight a manual scroll.
  const selectedRowRef = useRef<SVGGElement | null>(null)
  const lastScrolledRef = useRef<string | null>(null)
  useEffect(() => {
    if (!highlightHref || highlightHref === lastScrolledRef.current) return
    if (selectedRowRef.current) {
      lastScrolledRef.current = highlightHref
      selectedRowRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [highlightHref, assignments])

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
  if (!domain || !displayDomain) {
    // Reachable only once loading is done: no stated extent on the
    // Collection itself, and nothing yet visible in Item Set (Detail Panel)
    // to derive a range from either — not a timing artifact, an honest
    // "nothing to plot yet" (see docs/DESIGN.md §21).
    return (
      <EmptyState>
        No stated temporal extent, and no items visible yet — open Detail Panel to browse this
        collection's items.
      </EmptyState>
    )
  }

  const x = scaleUtc().domain(displayDomain).range([LABEL_WIDTH, viewWidth - RIGHT_PAD])
  // Scale tick count with available width so labels never crowd together
  // at narrow panel widths (~110px per label is comfortable for a date).
  const tickCount = Math.max(2, Math.floor((viewWidth - LABEL_WIDTH) / 110))
  const ticks = x.ticks(tickCount)

  const laneCount = assignments.length ? Math.max(...assignments.map((a) => a.lane)) + 1 : 0
  const statedRowY = AXIS_HEIGHT
  const itemsStartY = AXIS_HEIGHT + (statedBounds ? STATED_ROW_HEIGHT + 8 : 0)
  const height = itemsStartY + laneCount * ROW_HEIGHT + 12

  return (
    <>
      <div
        style={{
          padding: '6px 16px 0',
          fontSize: 12,
          color: 'var(--color-text-muted)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
        }}
      >
        {/* Names whichever object Temporal is actually describing —
         * the selected Item itself if there is one, otherwise the
         * Collection. Used to also print an item count ("showing 1 of 4
         * items") and a "scoped to just this Item, not its neighbors"
         * qualifier — both stale leftovers from before Item Set's own
         * aggregate multi-item display was retired (§21/§41): with that
         * gone, exactly one Item (itself) or zero Items ever populate this
         * view, so "of N" and "not its neighbors" were never describing a
         * real alternative any more, just noise. Asked about directly:
         * "我觉得这难道不还是之前开发的遗留信息么？我们现在的Temporal和Spatial
         * 难道不是就都是专注在选中的那个么" (isn't this leftover from earlier
         * development? aren't Temporal/Spatial both scoped to just the
         * selected object now?) — confirmed by tracing `useSelectedItems`:
         * yes, and yes. */}
        <div style={{ flex: 1 }}>
          <strong style={{ color: 'var(--color-text)' }}>
            {selectedItem ? (selectedItem.title ?? selectedItem.id) : (node?.title ?? node?.id)}
          </strong>
        </div>
      </div>
      <svg ref={svgRef} width="100%" viewBox={`0 0 ${viewWidth} ${height}`} style={{ display: 'block' }}>
        {/* axis */}
        {ticks.map((t) => (
          <g key={t.getTime()} transform={`translate(${x(t)}, 0)`}>
            <line y1={0} y2={height} style={{ stroke: 'var(--color-border)' }} strokeWidth={1} />
            <text y={14} fontSize={10} textAnchor="middle" style={{ fill: 'var(--color-text-faint)' }}>
              {formatDate(t)}
            </text>
          </g>
        ))}

        {/* stated extent reference row — right-aligned ending at
         * LABEL_WIDTH - 10, matching every item row's own label below it
         * (see the `assignments.map` block). This one used to sit at a
         * hardcoded `x={0}`, flush against the container's own left edge
         * with no padding at all — the only label in this whole view
         * without one — called out directly as looking cramped/"顶头"
         * (jammed right up against the edge). */}
        {statedBounds && node?.temporal && (
          <g transform={`translate(0, ${statedRowY})`}>
            <text
              x={LABEL_WIDTH - 10}
              y={13}
              textAnchor="end"
              fontSize={11}
              style={{ fill: 'var(--color-text-muted)' }}
            >
              stated extent (source)
            </text>
            <TemporalMark
              shape={node.temporal}
              x={x}
              y={STATED_ROW_HEIGHT / 2}
              domain={displayDomain}
              color="var(--color-text-faint)"
              filled={false}
            />
          </g>
        )}

        {/* grouped, lane-packed rows — see groupByTemporalShape/packLanes.
         * A row can be one Item, or several that share an exact timing
         * signature; lanes are only as numerous as the actual overlap in
         * time requires, not one per Item. */}
        {assignments.map(({ group, lane }) => {
          const y = itemsStartY + lane * ROW_HEIGHT
          const selected =
            target.status === 'ready' && group.items.some((i) => i.href === target.highlightHref)
          const label = groupLabel(group)
          const tooltipText = groupTooltip(group)
          const hasInvalidGeometry = group.items.some((i) => i.spatial?.geometryInvalid)
          // Multi-item groups don't map to one node — clicking selects the
          // first member as a representative; Structure Lens is still the
          // place to browse the rest by identity.
          const clickHref = group.items[0].href
          const showLabel = laneLabelKey.get(lane) === shapeKey(group.shape)
          return (
            <g
              key={shapeKey(group.shape)}
              ref={selected ? selectedRowRef : undefined}
              transform={`translate(0, ${y})`}
            >
              {showLabel && (
                <text
                  x={LABEL_WIDTH - 10}
                  y={ROW_HEIGHT / 2 + 4}
                  textAnchor="end"
                  fontSize={11}
                  fontWeight={selected ? 600 : 400}
                  style={{
                    fill: selected ? 'var(--color-selection)' : 'var(--color-text)',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                  onClick={() => select(clickHref)}
                  onMouseEnter={(e) => setTooltip({ label: tooltipText, x: e.clientX, y: e.clientY })}
                  onMouseMove={(e) => setTooltip({ label: tooltipText, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setTooltip(null)}
                >
                  {truncateLabel(label)}
                </text>
              )}
              <TemporalMark
                shape={group.shape}
                x={x}
                y={ROW_HEIGHT / 2}
                domain={displayDomain}
                color={hasInvalidGeometry ? 'var(--color-node-warning)' : 'var(--color-node-item)'}
                filled
                selected={selected}
                onClick={() => select(clickHref)}
                onHover={(clientX, clientY) => setTooltip({ label: tooltipText, x: clientX, y: clientY })}
                onHoverEnd={() => setTooltip(null)}
              />
            </g>
          )
        })}
      </svg>
      {tooltip && (
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
            // Space Lens's Leaflet map uses z-index up to 1000 internally
            // (controls) for its own panes — this tooltip is `position:
            // fixed` and paints in the same root stacking context, so it
            // must clear that or the map visually covers it whenever the
            // cursor is near the Time/Space Lens boundary (confirmed: the
            // tooltip was being cut off exactly at that boundary).
            zIndex: 2000,
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          }}
        >
          {tooltip.label}
        </div>
      )}
    </>
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
 *  fades toward an arrow for an open-ended bound — deliberately not
 *  normalized to a single point, per the heterogeneous temporal shapes
 *  real STAC Items actually use. */
function TemporalMark({
  shape,
  x,
  y,
  domain,
  color,
  filled,
  selected,
  onClick,
  onHover,
  onHoverEnd,
}: TemporalMarkProps) {
  const handlers = onHover
    ? {
        onMouseEnter: (e: React.MouseEvent) => onHover(e.clientX, e.clientY),
        onMouseMove: (e: React.MouseEvent) => onHover(e.clientX, e.clientY),
        onMouseLeave: () => onHoverEnd?.(),
      }
    : {}

  if (shape.kind === 'instant') {
    const cx = x(new Date(shape.at))
    return (
      <g onClick={onClick} {...handlers} style={{ cursor: onClick ? 'pointer' : undefined }}>
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
    <g onClick={onClick} {...handlers} style={{ cursor: onClick ? 'pointer' : undefined }}>
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
      {openStart && <text x={x1 - 6} y={y + 4} fontSize={10} textAnchor="end" style={{ fill: color }}>←</text>}
      {openEnd && <text x={x2 + 6} y={y + 4} fontSize={10} style={{ fill: color }}>→</text>}
    </g>
  )
}
