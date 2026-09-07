import { useMemo, useState } from 'react'
import { scaleUtc } from 'd3-scale'
import { useSelectionStore } from '../store/selection'
import { useSelectedItems } from '../hooks/useSelectedItems'
import { temporalBounds } from '../stac/temporal'
import type { StacNode, TemporalShape } from '../stac/types'
import { EmptyState } from './EmptyState'

const ROW_HEIGHT = 20
const AXIS_HEIGHT = 28
const STATED_ROW_HEIGHT = 24
const LABEL_WIDTH = 220
const RIGHT_PAD = 24
const VIEW_WIDTH = 1400
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
 *  in a report. */
export function TimeLens() {
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

  const x = scaleUtc().domain(domain).range([LABEL_WIDTH, VIEW_WIDTH - RIGHT_PAD])
  const ticks = x.ticks(6)

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

  const statedRowY = AXIS_HEIGHT
  const itemsStartY = AXIS_HEIGHT + (node?.temporal ? STATED_ROW_HEIGHT + 8 : 0)
  const height = itemsStartY + sortedItems.length * ROW_HEIGHT + 12

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'auto' }}>
      <div style={{ padding: '6px 16px 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
        <strong style={{ color: 'var(--color-text)' }}>{node?.title ?? node?.id}</strong>
        {' · '}
        showing {sortedItems.length}
        {target.status === 'ready' && target.totalItemCount > sortedItems.length
          ? ` of ${target.totalItemCount} items`
          : ' items'}
        {conflict && (
          <span style={{ color: 'var(--color-node-warning)', marginLeft: 8 }}>
            ⚠ actual Item range extends beyond the collection's stated extent
          </span>
        )}
      </div>
      <svg width="100%" viewBox={`0 0 ${VIEW_WIDTH} ${height}`} style={{ display: 'block' }}>
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

        {/* item rows */}
        {sortedItems.map((item, i) => {
          const y = itemsStartY + i * ROW_HEIGHT
          const selected = target.status === 'ready' && target.highlightHref === item.href
          const label = item.title ?? item.id
          return (
            <g key={item.href} transform={`translate(0, ${y})`}>
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
                onClick={() => select(item.href)}
                onMouseEnter={(e) => setTooltip({ label, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => setTooltip({ label, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setTooltip(null)}
              >
                {truncateLabel(label)}
              </text>
              {item.temporal && (
                <TemporalMark
                  shape={item.temporal}
                  x={x}
                  y={ROW_HEIGHT / 2}
                  domain={domain}
                  color={
                    item.spatial?.geometryInvalid ? 'var(--color-node-warning)' : 'var(--color-node-item)'
                  }
                  filled
                  selected={selected}
                  onClick={() => select(item.href)}
                  onHover={(clientX, clientY) => setTooltip({ label, x: clientX, y: clientY })}
                  onHoverEnd={() => setTooltip(null)}
                />
              )}
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
