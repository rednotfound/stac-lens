import { useState } from 'react'
import { useSelectionStore } from '../store/selection'
import { useSelectedItems } from '../hooks/useSelectedItems'
import type { StacNode } from '../stac/types'
import { EmptyState } from './EmptyState'

const VIEW_WIDTH = 720
const VIEW_HEIGHT = 360

function project(lon: number, lat: number): [number, number] {
  return [((lon + 180) / 360) * VIEW_WIDTH, ((90 - lat) / 180) * VIEW_HEIGHT]
}

interface TooltipState {
  label: string
  x: number
  y: number
}

/** Deliberately not a real basemap — bbox footprints against a bare
 *  lon/lat graticule, matching "space is not just a basemap." Scoped to
 *  the same selection Time Lens uses, via the same shared hook: selecting
 *  a Collection shows all its Items' footprints; selecting an Item
 *  highlights it among its siblings. Many STAC datasets share one
 *  continent-wide bbox across every Item — overlapping translucent fills
 *  make that visible as a single darker region rather than hiding it. */
export function SpaceLens() {
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  const select = useSelectionStore((s) => s.select)
  const target = useSelectedItems(selectedHref)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  if (target.status === 'empty') {
    return (
      <EmptyState>
        {target.reason === 'no-selection'
          ? 'Select a Collection or Item in Structure to see where it is.'
          : 'This node has no Items directly — drill into a sub-collection.'}
      </EmptyState>
    )
  }
  if (target.status === 'loading') {
    return <EmptyState>loading…</EmptyState>
  }

  const { node, items, highlightHref } = target
  const statedBbox = node.spatial?.bbox
  const itemsWithBbox = items.filter((i): i is StacNode & { spatial: { bbox: number[] } } => !!i.spatial?.bbox)

  if (itemsWithBbox.length === 0 && !statedBbox) {
    return <EmptyState>No spatial data available.</EmptyState>
  }

  // Render the selected item's footprint last so its outline isn't buried
  // under the translucent stack of its siblings.
  const ordered = highlightHref
    ? [...itemsWithBbox.filter((i) => i.href !== highlightHref), ...itemsWithBbox.filter((i) => i.href === highlightHref)]
    : itemsWithBbox

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'auto' }}>
      <div style={{ padding: '6px 16px 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
        <strong style={{ color: 'var(--color-text)' }}>{node.title ?? node.id}</strong>
        {' · '}
        {itemsWithBbox.length} item footprint{itemsWithBbox.length === 1 ? '' : 's'}
      </div>
      <svg width="100%" viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} style={{ display: 'block' }}>
        <Graticule />
        {statedBbox && <BboxRect bbox={statedBbox} filled={false} color="var(--color-text-faint)" />}
        {ordered.map((item) => (
          <BboxRect
            key={item.href}
            bbox={item.spatial.bbox}
            filled
            color="var(--color-node-item)"
            selected={highlightHref === item.href}
            onClick={() => select(item.href)}
            onHover={(x, y) => setTooltip({ label: item.title ?? item.id, x, y })}
            onHoverEnd={() => setTooltip(null)}
          />
        ))}
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

function Graticule() {
  const lons = [-180, -120, -60, 0, 60, 120, 180]
  const lats = [-90, -60, -30, 0, 30, 60, 90]
  return (
    <g>
      <rect
        x={0}
        y={0}
        width={VIEW_WIDTH}
        height={VIEW_HEIGHT}
        fill="none"
        style={{ stroke: 'var(--color-border)' }}
      />
      {lons.map((lon) => {
        const [x] = project(lon, 0)
        return (
          <line
            key={lon}
            x1={x}
            y1={0}
            x2={x}
            y2={VIEW_HEIGHT}
            style={{ stroke: 'var(--color-border)' }}
            strokeWidth={lon === 0 ? 1 : 0.5}
            opacity={lon === 0 ? 0.6 : 0.3}
          />
        )
      })}
      {lats.map((lat) => {
        const [, y] = project(0, lat)
        return (
          <line
            key={lat}
            x1={0}
            y1={y}
            x2={VIEW_WIDTH}
            y2={y}
            style={{ stroke: 'var(--color-border)' }}
            strokeWidth={lat === 0 ? 1 : 0.5}
            opacity={lat === 0 ? 0.6 : 0.3}
          />
        )
      })}
    </g>
  )
}

interface BboxRectProps {
  bbox: number[]
  filled: boolean
  color: string
  selected?: boolean
  onClick?: () => void
  onHover?: (clientX: number, clientY: number) => void
  onHoverEnd?: () => void
}

function BboxRect({ bbox, filled, color, selected, onClick, onHover, onHoverEnd }: BboxRectProps) {
  const [west, south, east, north] = bbox
  const [x1, y1] = project(west, north)
  const [x2, y2] = project(east, south)
  const width = Math.max(1, x2 - x1)
  const height = Math.max(1, y2 - y1)

  const handlers = onHover
    ? {
        onMouseEnter: (e: React.MouseEvent) => onHover(e.clientX, e.clientY),
        onMouseMove: (e: React.MouseEvent) => onHover(e.clientX, e.clientY),
        onMouseLeave: () => onHoverEnd?.(),
      }
    : {}

  return (
    <rect
      x={x1}
      y={y1}
      width={width}
      height={height}
      onClick={onClick}
      {...handlers}
      style={{
        fill: filled ? color : 'none',
        fillOpacity: filled ? 0.06 : undefined,
        stroke: selected ? 'var(--color-selection)' : filled ? 'none' : color,
        cursor: onClick ? 'pointer' : undefined,
      }}
      strokeWidth={selected ? 2 : filled ? 0 : 1}
      strokeDasharray={!filled ? '3,2' : undefined}
    />
  )
}
