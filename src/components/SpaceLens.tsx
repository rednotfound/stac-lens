import { useMemo, useState } from 'react'
import { geoEquirectangular, geoPath, geoGraticule, type GeoProjection } from 'd3-geo'
import { feature } from 'topojson-client'
import type { Topology } from 'topojson-specification'
import landTopologyJson from 'world-atlas/land-110m.json'
import { useSelectionStore } from '../store/selection'
import { useSelectedItems } from '../hooks/useSelectedItems'
import { useElementSize } from '../hooks/useElementSize'
import type { StacNode } from '../stac/types'
import { EmptyState } from './EmptyState'

const FALLBACK_VIEW_WIDTH = 600
const landTopology = landTopologyJson as unknown as Topology

interface TooltipState {
  label: string
  x: number
  y: number
}

/** Bbox footprints over lightweight static coastline outlines — not a real
 *  basemap (no tiles, no pan/zoom map widget, no layer switcher), just
 *  enough geographic reference (a ~56KB bundled 110m-resolution land
 *  topology, the same data countless minimal D3 map sketches use) that a
 *  floating rectangle is actually locatable. A bare lon/lat grid with no
 *  landmass at all turned out to be too abstract in practice — asked
 *  directly by the user after seeing it. Scoped to the same selection Time
 *  Lens uses via the same shared hook.
 *
 *  The container div here must always render — see the same note in
 *  TimeLens.tsx / docs/DESIGN.md §5 about ref-measuring effects binding to
 *  a still-null ref when the ref is only attached inside a conditional
 *  branch. Width is measured from the real container so the equirectangular
 *  projection (which needs a true 2:1 ratio) never gets stretched. */
export function SpaceLens() {
  const [containerRef, { width: measuredWidth }] = useElementSize<HTMLDivElement>()
  const viewWidth = measuredWidth > 0 ? measuredWidth : FALLBACK_VIEW_WIDTH

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'auto' }}
    >
      <SpaceLensBody viewWidth={viewWidth} />
    </div>
  )
}

function SpaceLensBody({ viewWidth }: { viewWidth: number }) {
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  const select = useSelectionStore((s) => s.select)
  const target = useSelectedItems(selectedHref)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  // Equirectangular projection needs a true 2:1 width:height ratio —
  // derived from the real measured width, not stretched to fill whatever
  // height the panel happens to have.
  const viewHeight = viewWidth / 2

  const projection = useMemo(
    () => geoEquirectangular().fitSize([viewWidth, viewHeight], { type: 'Sphere' }),
    [viewWidth, viewHeight],
  )
  const pathGenerator = useMemo(() => geoPath(projection), [projection])
  const landFeature = useMemo(
    () => feature(landTopology, landTopology.objects.land),
    [],
  )
  const graticuleLines = useMemo(() => geoGraticule().step([30, 30])(), [])

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
    <>
      <div style={{ padding: '6px 16px 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
        <strong style={{ color: 'var(--color-text)' }}>{node.title ?? node.id}</strong>
        {' · '}
        {itemsWithBbox.length} item footprint{itemsWithBbox.length === 1 ? '' : 's'}
      </div>
      <svg width="100%" viewBox={`0 0 ${viewWidth} ${viewHeight}`} style={{ display: 'block' }}>
        <rect x={0} y={0} width={viewWidth} height={viewHeight} style={{ fill: 'var(--color-bg)' }} />
        <path d={pathGenerator(graticuleLines) ?? undefined} fill="none" style={{ stroke: 'var(--color-border)' }} strokeWidth={0.5} />
        <path
          d={pathGenerator(landFeature) ?? undefined}
          style={{ fill: 'var(--color-land-fill)', stroke: 'var(--color-land-stroke)' }}
          strokeWidth={0.75}
        />
        <rect x={0.5} y={0.5} width={viewWidth - 1} height={viewHeight - 1} fill="none" style={{ stroke: 'var(--color-border)' }} />
        {statedBbox && <BboxRect bbox={statedBbox} projection={projection} filled={false} color="var(--color-text-faint)" />}
        {ordered.map((item) => (
          <BboxRect
            key={item.href}
            bbox={item.spatial.bbox}
            projection={projection}
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
    </>
  )
}

interface BboxRectProps {
  bbox: number[]
  projection: GeoProjection
  filled: boolean
  color: string
  selected?: boolean
  onClick?: () => void
  onHover?: (clientX: number, clientY: number) => void
  onHoverEnd?: () => void
}

function BboxRect({ bbox, projection, filled, color, selected, onClick, onHover, onHoverEnd }: BboxRectProps) {
  const [west, south, east, north] = bbox
  const p1 = projection([west, north])
  const p2 = projection([east, south])
  if (!p1 || !p2) return null
  const [x1, y1] = p1
  const [x2, y2] = p2
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
        fillOpacity: filled ? 0.1 : undefined,
        stroke: selected ? 'var(--color-selection)' : color,
        cursor: onClick ? 'pointer' : undefined,
      }}
      strokeWidth={selected ? 2 : 1}
      strokeDasharray={!filled ? '3,2' : undefined}
      strokeOpacity={filled && !selected ? 0.5 : 1}
    />
  )
}
