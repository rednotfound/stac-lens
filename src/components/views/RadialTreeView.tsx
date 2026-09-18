import { useMemo, useState } from 'react'
import { hierarchy, tree, type HierarchyPointNode } from 'd3-hierarchy'
import { linkRadial } from 'd3-shape'
import type { TreeDatum } from '../../hooks/useStructureTree'
import { useElementSize } from '../../hooks/useElementSize'
import { useSvgPanZoom } from '../../hooks/useSvgPanZoom'
import { useSelectionStore } from '../../store/selection'
import { Spinner } from '../Spinner'
import { useStructure } from '../../hooks/useStructure'
import { NodeTooltip } from '../tree/NodeTooltip'
import {
  canExpandNode,
  hoverInfoFor,
  nodeColor,
  nodeIsFilled,
  truncateLabel,
  type TooltipState,
} from '../tree/treeGeometry'
import { canvasButtonStyle } from './canvasButton'
import { OverviewBar } from './OverviewBar'
import { StructureFallback } from './StructureFallback'

/** Above this many nodes the labels come off: a radial layout's job here
 *  is the shape (one ring per depth, breadth as arc), and names are read
 *  in the tree or the outline, or on hover. */
const MAX_LABELED_NODES = 60

type PointNode = HierarchyPointNode<TreeDatum>

const radialLink = linkRadial<{ source: PointNode; target: PointNode }, PointNode>()
  .angle((d) => d.x)
  .radius((d) => d.y)

function toXY(n: PointNode): { x: number; y: number } {
  const a = n.x - Math.PI / 2
  return { x: n.y * Math.cos(a), y: n.y * Math.sin(a) }
}

/** The same tidy tree as the Tree view, in polar coordinates: the root at
 *  the center, each depth a ring, siblings spread around the arc their
 *  parent owns. Rejected long ago as the *main* tree (docs/DESIGN.md §5:
 *  strict parent-child order reads poorly at depth), it is kept here for
 *  what it does well as an overview — a flat root of hundreds of
 *  Collections becomes one full ring, a deep catalog becomes many thin
 *  ones — with the tree's own vocabulary: type colors, filled = more to
 *  reveal, solid ring = selected, dashed ring = contains the selection.
 *  Click selects and, on a closed node, opens it — the tree's gesture. */
export function RadialTreeView() {
  const { root, toggle, collapseAll, expandAllCatalogs, isLoading, isExpanded, rootError } = useStructure()
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  const browsingHref = useSelectionStore((s) => s.browsingHref)
  const select = useSelectionStore((s) => s.select)
  const [containerRef, { width, height }] = useElementSize<HTMLDivElement>()
  const { svgRef, transform, dragging } = useSvgPanZoom({
    initial: (svg) => ({ x: svg.clientWidth / 2, y: svg.clientHeight / 2, k: 1 }),
  })
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const radius = Math.max(120, Math.min(width, height) / 2 - 80)
  const layout = useMemo(() => {
    if (!root) return undefined
    const h = hierarchy(root, (d) => d.children)
    tree<TreeDatum>()
      .size([2 * Math.PI, radius])
      .separation((a, b) => (a.parent === b.parent ? 1 : 2) / a.depth)(h)
    return h as PointNode
  }, [root, radius])

  const nodes = layout?.descendants() ?? []
  const links = layout?.links() ?? []
  const labeled = nodes.length <= MAX_LABELED_NODES

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)' }}>
      {root && (
        <OverviewBar root={root} isExpanded={isExpanded} expandAllCatalogs={expandAllCatalogs}>
          <button
            type="button"
            onClick={collapseAll}
            title="Collapse every expanded node back down to just the root's direct children"
            style={canvasButtonStyle}
          >
            Collapse to top level
          </button>
        </OverviewBar>
      )}
      {!root && <StructureFallback rootError={rootError} />}
      {/* The <svg> is always rendered: the zoom behavior binds on mount. */}
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          style={{ display: 'block', fontFamily: 'var(--font-sans)', cursor: dragging ? 'grabbing' : 'grab' }}
          onMouseLeave={() => setTooltip(null)}
        >
          <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
            {links.map((l) => (
              <path
                key={`${l.source.data.href}→${l.target.data.href}`}
                d={radialLink(l) ?? undefined}
                fill="none"
                stroke="var(--color-border)"
                strokeWidth={1.2}
              />
            ))}
            {nodes.map((n) => {
              const { data } = n
              const { x, y } = toXY(n)
              if (data.moreCount) {
                return (
                  <g key={data.href} transform={`translate(${x}, ${y})`}>
                    <circle r={3} fill="none" strokeDasharray="2,2" style={{ stroke: 'var(--color-text-faint)' }} />
                    {labeled && (
                      <text x={7} y={4} fontSize={10} style={{ fill: 'var(--color-text-faint)' }}>
                        +{data.moreCount} more
                      </text>
                    )}
                  </g>
                )
              }
              const { node } = data
              const selected = selectedHref === data.href
              const contains = !selected && browsingHref === data.href
              const filled = nodeIsFilled(node, !!data.children, false)
              const color = nodeColor(node)
              const r = node.type === 'Catalog' ? 5 : 4
              const loading = isLoading(data.href)
              const isRoot = n.depth === 0
              // Labels point outward along the radius; on the left half the
              // text is flipped so it never reads upside down.
              const deg = (n.x * 180) / Math.PI - 90
              const flip = n.x >= Math.PI
              return (
                <g
                  key={data.href}
                  data-href={data.href}
                  transform={`translate(${x}, ${y})`}
                  onClick={() => {
                    select(data.href)
                    if (canExpandNode(node)) toggle(data.href)
                  }}
                  onMouseMove={(e) => setTooltip({ ...hoverInfoFor(node), x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setTooltip(null)}
                  style={{ cursor: 'pointer' }}
                >
                  {node.spatial?.geometryInvalid && (
                    <circle
                      r={r + 3}
                      fill="none"
                      strokeDasharray="2,2"
                      style={{ stroke: 'var(--color-node-warning)' }}
                    />
                  )}
                  {(selected || contains) && (
                    <circle
                      r={r + 4}
                      fill="none"
                      strokeWidth={1.5}
                      strokeDasharray={contains ? '3,2' : undefined}
                      style={{ stroke: 'var(--color-selection)' }}
                    />
                  )}
                  <circle
                    r={r}
                    fill={filled ? color : 'var(--color-bg)'}
                    stroke={color}
                    strokeWidth={1.5}
                    opacity={loading ? 0.5 : 1}
                  />
                  {loading && <Spinner size={10} color="var(--color-text-faint)" x={r + 4} y={-5} />}
                  {labeled &&
                    (isRoot ? (
                      <text
                        y={-(r + 8)}
                        textAnchor="middle"
                        fontSize={12}
                        fontWeight={600}
                        style={{ fill: 'var(--color-text)' }}
                      >
                        {truncateLabel(node.title ?? node.id, 32)}
                      </text>
                    ) : (
                      <text
                        transform={`rotate(${deg}) translate(${r + 6}, 0) ${flip ? 'rotate(180)' : ''}`}
                        textAnchor={flip ? 'end' : 'start'}
                        dy="0.32em"
                        fontSize={11}
                        style={{ fill: 'var(--color-text)' }}
                      >
                        {truncateLabel(node.title ?? node.id, 28)}
                      </text>
                    ))}
                </g>
              )
            })}
          </g>
        </svg>
        {nodes.length > MAX_LABELED_NODES && (
          <div
            style={{
              position: 'absolute',
              left: 12,
              bottom: 10,
              fontSize: 11,
              color: 'var(--color-text-faint)',
              pointerEvents: 'none',
            }}
          >
            {nodes.length} nodes — labels off at this size; hover a node for its name, or read them in Tree / Outline
          </div>
        )}
      </div>
      {tooltip && <NodeTooltip tooltip={tooltip} />}
    </div>
  )
}
