import { useEffect, useMemo, useRef, useState } from 'react'
import { scaleUtc } from 'd3-scale'
import { temporalBounds } from '../stac/temporal'
import type { StacNode, TemporalShape } from '../stac/types'

const ROW_HEIGHT = 20
const AXIS_HEIGHT = 28
const STATED_ROW_HEIGHT = 24
const LABEL_WIDTH = 220
const RIGHT_PAD = 24
const LABEL_MAX_CHARS = 26

function truncateLabel(label: string): string {
  return label.length > LABEL_MAX_CHARS ? `${label.slice(0, LABEL_MAX_CHARS - 1)}…` : label
}

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
  highlightHref,
  statedShape,
  viewWidth,
  onSelectItem,
  focusOnSelection = false,
}: {
  items: StacNode[]
  highlightHref?: string
  /** A reference extent to show as its own row above the Item rows (e.g.
   *  a Collection's own declared `extent.temporal`) — omit when there's
   *  nothing meaningful to compare against in this context. */
  statedShape?: TemporalShape
  viewWidth: number
  onSelectItem: (href: string) => void
  /** Narrow the displayed axis to a padded window around `highlightHref`'s
   *  own range, instead of the full domain — right for Inspector's
   *  single-Item view (there are no neighbors to lose; without this, a
   *  single day-long Item is an invisible sliver on a decades-wide axis),
   *  wrong for a multi-item batch view (narrowing there would hide every
   *  other item just to focus on the one clicked, defeating the point of
   *  looking at the batch at all). Off by default for that reason. */
  focusOnSelection?: boolean
}) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const sortedItems = useMemo(() => [...items].sort((a, b) => sortKey(a) - sortKey(b)), [items])

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

  // A lane can hold several groups that don't overlap in time (that's the
  // whole point of packing), but the label column is a fixed-x gutter, not
  // positioned per-mark — cap it at one label per lane, preferring
  // whichever group contains the current selection.
  const laneLabelKey = useMemo(() => {
    const byLane = new Map<number, string>()
    for (const { group, lane } of assignments) {
      const isSelected = !!highlightHref && group.items.some((i) => i.href === highlightHref)
      if (isSelected) byLane.set(lane, shapeKey(group.shape))
      else if (!byLane.has(lane)) byLane.set(lane, shapeKey(group.shape))
    }
    return byLane
  }, [assignments, highlightHref])

  // Bring the selected row into view automatically — once per distinct
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

  if (!domain || !displayDomain) return null

  const x = scaleUtc().domain(displayDomain).range([LABEL_WIDTH, viewWidth - RIGHT_PAD])
  const tickCount = Math.max(2, Math.floor((viewWidth - LABEL_WIDTH) / 110))
  const ticks = x.ticks(tickCount)

  const laneCount = assignments.length ? Math.max(...assignments.map((a) => a.lane)) + 1 : 0
  const statedRowY = AXIS_HEIGHT
  const itemsStartY = AXIS_HEIGHT + (statedShape ? STATED_ROW_HEIGHT + 8 : 0)
  const height = itemsStartY + laneCount * ROW_HEIGHT + 12

  return (
    <>
      <svg width="100%" viewBox={`0 0 ${viewWidth} ${height}`} style={{ display: 'block' }}>
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
            <text
              x={LABEL_WIDTH - 10}
              y={13}
              textAnchor="end"
              fontSize={11}
              style={{ fill: 'var(--color-text-muted)' }}
            >
              stated extent (source)
            </text>
            <TemporalMark shape={statedShape} x={x} y={STATED_ROW_HEIGHT / 2} domain={displayDomain} color="var(--color-text-faint)" filled={false} />
          </g>
        )}

        {assignments.map(({ group, lane }) => {
          const y = itemsStartY + lane * ROW_HEIGHT
          const selected = !!highlightHref && group.items.some((i) => i.href === highlightHref)
          const label = groupLabel(group)
          const tooltipText = groupTooltip(group)
          const hasInvalidGeometry = group.items.some((i) => i.spatial?.geometryInvalid)
          const clickHref = group.items[0].href
          const showLabel = laneLabelKey.get(lane) === shapeKey(group.shape)
          return (
            <g key={shapeKey(group.shape)} ref={selected ? selectedRowRef : undefined} transform={`translate(0, ${y})`}>
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
                  onClick={() => onSelectItem(clickHref)}
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
                onClick={() => onSelectItem(clickHref)}
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
 *  fades toward an arrow for an open-ended bound. */
function TemporalMark({ shape, x, y, domain, color, filled, selected, onClick, onHover, onHoverEnd }: TemporalMarkProps) {
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
