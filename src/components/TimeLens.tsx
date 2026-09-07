import { useEffect, useMemo, useRef, useState } from 'react'
import { scaleUtc } from 'd3-scale'
import { useSelectionStore } from '../store/selection'
import { useSelectedItems } from '../hooks/useSelectedItems'
import { useElementSize } from '../hooks/useElementSize'
import { temporalBounds } from '../stac/temporal'
import type { StacNode, TemporalShape } from '../stac/types'
import { EmptyState } from './EmptyState'

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
 *  docs/DESIGN.md §5. */
export function TimeLens() {
  const [containerRef, { width: measuredWidth }] = useElementSize<HTMLDivElement>()
  const viewWidth = measuredWidth > 0 ? measuredWidth : FALLBACK_VIEW_WIDTH

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'auto' }}
    >
      <TimeLensBody viewWidth={viewWidth} />
    </div>
  )
}

function TimeLensBody({ viewWidth }: { viewWidth: number }) {
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  const select = useSelectionStore((s) => s.select)
  const target = useSelectedItems(selectedHref)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const items = target.status === 'ready' ? target.items : EMPTY_ITEMS
  const node = target.status === 'ready' ? target.node : undefined

  const sortedItems = useMemo(() => [...items].sort((a, b) => sortKey(a) - sortKey(b)), [items])

  const statedBounds = node?.temporal ? temporalBounds(node.temporal) : undefined

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
  const assignments = useMemo(() => (domain ? packLanes(groups, domain) : []), [groups, domain])

  const highlightHref = target.status === 'ready' ? target.highlightHref : undefined
  const selectedItem = highlightHref ? sortedItems.find((i) => i.href === highlightHref) : undefined

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
  if (target.status === 'loading' || !domain) {
    return <EmptyState>loading…</EmptyState>
  }

  const x = scaleUtc().domain(domain).range([LABEL_WIDTH, viewWidth - RIGHT_PAD])
  // Scale tick count with available width so labels never crowd together
  // at narrow panel widths (~110px per label is comfortable for a date).
  const tickCount = Math.max(2, Math.floor((viewWidth - LABEL_WIDTH) / 110))
  const ticks = x.ticks(tickCount)

  // Compare the collection's stated extent against the actual range of the
  // (possibly bounded) loaded items — a real, not hypothetical, conflict:
  // Adaptation Atlas's hazard_timeseries_mean_annual states 1995–2020 while
  // its own Items run to 2060.
  const actualDates: Date[] = []
  for (const item of sortedItems) {
    if (!item.temporal) continue
    const [s, e] = temporalBounds(item.temporal)
    if (s) actualDates.push(s)
    if (e) actualDates.push(e)
  }
  const actualMin = actualDates.length ? new Date(Math.min(...actualDates.map((d) => d.getTime()))) : undefined
  const actualMax = actualDates.length ? new Date(Math.max(...actualDates.map((d) => d.getTime()))) : undefined
  const conflict =
    statedBounds &&
    actualMin &&
    actualMax &&
    ((statedBounds[0] && actualMin < statedBounds[0]) || (statedBounds[1] && actualMax > statedBounds[1]))

  const laneCount = assignments.length ? Math.max(...assignments.map((a) => a.lane)) + 1 : 0
  const statedRowY = AXIS_HEIGHT
  const itemsStartY = AXIS_HEIGHT + (node?.temporal ? STATED_ROW_HEIGHT + 8 : 0)
  const height = itemsStartY + laneCount * ROW_HEIGHT + 12

  return (
    <>
      <div style={{ padding: '6px 16px 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
        <strong style={{ color: 'var(--color-text)' }}>{node?.title ?? node?.id}</strong>
        {' · '}
        showing {sortedItems.length}
        {target.status === 'ready' && target.totalItemCount > sortedItems.length
          ? ` of ${target.totalItemCount} items`
          : ' items'}
        {groups.length !== sortedItems.length && (
          <span style={{ marginLeft: 8 }}>· grouped into {groups.length} distinct timings</span>
        )}
        {conflict && (
          <span style={{ color: 'var(--color-node-warning)', marginLeft: 8 }}>
            ⚠ actual Item range extends beyond the collection's stated extent
          </span>
        )}
        {selectedItem && (
          <div style={{ marginTop: 2 }}>
            selected:{' '}
            <strong style={{ color: 'var(--color-selection)' }}>
              {selectedItem.title ?? selectedItem.id}
            </strong>
          </div>
        )}
      </div>
      <svg width="100%" viewBox={`0 0 ${viewWidth} ${height}`} style={{ display: 'block' }}>
        {/* axis */}
        {ticks.map((t) => (
          <g key={t.getTime()} transform={`translate(${x(t)}, 0)`}>
            <line y1={0} y2={height} style={{ stroke: 'var(--color-border)' }} strokeWidth={1} />
            <text y={14} fontSize={10} textAnchor="middle" style={{ fill: 'var(--color-text-faint)' }}>
              {formatDate(t)}
            </text>
          </g>
        ))}

        {/* stated extent reference row */}
        {node?.temporal && statedBounds && (
          <g transform={`translate(0, ${statedRowY})`}>
            <text x={0} y={13} fontSize={11} style={{ fill: 'var(--color-text-muted)' }}>
              stated extent (source)
            </text>
            <TemporalMark
              shape={node.temporal}
              x={x}
              y={STATED_ROW_HEIGHT / 2}
              domain={domain}
              color={conflict ? 'var(--color-node-warning)' : 'var(--color-text-faint)'}
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
          return (
            <g
              key={shapeKey(group.shape)}
              ref={selected ? selectedRowRef : undefined}
              transform={`translate(0, ${y})`}
            >
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
              <TemporalMark
                shape={group.shape}
                x={x}
                y={ROW_HEIGHT / 2}
                domain={domain}
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
            zIndex: 10,
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
