import { useEffect, useMemo, useRef, useState } from 'react'
import { hierarchy, tree, type HierarchyPointNode } from 'd3-hierarchy'
import { linkHorizontal } from 'd3-shape'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type D3ZoomEvent } from 'd3-zoom'
import { useStructureTree, type TreeDatum } from '../hooks/useStructureTree'
import { classifyNodeShape } from '../stac/types'
import { useSelectionStore } from '../store/selection'

const ROW_HEIGHT = 26
const LEVEL_WIDTH = 320
const LABEL_MAX_CHARS = 40

function truncateLabel(label: string): string {
  return label.length > LABEL_MAX_CHARS ? `${label.slice(0, LABEL_MAX_CHARS - 1)}…` : label
}

const linkGenerator = linkHorizontal<unknown, { x: number; y: number }>()
  .x((d) => d.y)
  .y((d) => d.x)

interface TooltipState {
  label: string
  x: number
  y: number
}

/** Horizontal curved tree, panned/zoomed with d3-zoom (drag to pan, wheel/
 *  pinch to zoom — no sliders). d3 only owns the gesture math; every node
 *  and link is still plain React/SVG so click/hover stay ordinary React
 *  event handlers. */
export function StructureTree({ rootHref }: { rootHref: string }) {
  const { root, toggle, isLoading, rootError } = useStructureTree(rootHref)
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  const select_ = useSelectionStore((s) => s.select)

  const svgRef = useRef<SVGSVGElement>(null)
  const zoomBehaviorRef = useRef<ReturnType<typeof zoom<SVGSVGElement, unknown>> | null>(null)
  const svgSelRef = useRef<ReturnType<typeof select<SVGSVGElement, unknown>> | null>(null)
  const [viewTransform, setViewTransform] = useState({ x: 80, y: 0, k: 1 })
  const viewTransformRef = useRef(viewTransform)
  const lastCenteredRef = useRef<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  useEffect(() => {
    viewTransformRef.current = viewTransform
  }, [viewTransform])

  useEffect(() => {
    const svgEl = svgRef.current
    if (!svgEl) return

    const svgSel = select(svgEl)
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 4])
      .on('start', () => setDragging(true))
      .on('end', () => setDragging(false))
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        setViewTransform({ x: event.transform.x, y: event.transform.y, k: event.transform.k })
      })

    svgSel.call(behavior)
    svgSel.call(behavior.transform, zoomIdentity.translate(80, svgEl.clientHeight / 2 || 300))
    zoomBehaviorRef.current = behavior
    svgSelRef.current = svgSel

    return () => {
      svgSel.on('.zoom', null)
    }
  }, [])

  const layout = useMemo(() => {
    if (!root) return undefined
    const h = hierarchy(root, (d) => d.children)
    tree<TreeDatum>().nodeSize([ROW_HEIGHT, LEVEL_WIDTH])(h)
    return h
  }, [root])

  const nodes = useMemo(
    () => (layout?.descendants() ?? []) as HierarchyPointNode<TreeDatum>[],
    [layout],
  )
  const links = useMemo(
    () =>
      (layout?.links() ?? []) as {
        source: HierarchyPointNode<TreeDatum>
        target: HierarchyPointNode<TreeDatum>
      }[],
    [layout],
  )

  // Selection can arrive from Time Lens or Space Lens, panned far outside
  // the current view (or not yet expanded into view at all — see the
  // ancestor-auto-expand effect in useStructureTree). Once the selected
  // node actually appears among the rendered nodes, recenter on it — but
  // only once per distinct selection, so it doesn't fight a manual pan.
  useEffect(() => {
    if (!selectedHref || selectedHref === lastCenteredRef.current) return
    const target = nodes.find((n) => n.data.href === selectedHref)
    const svgSel = svgSelRef.current
    const behavior = zoomBehaviorRef.current
    const svgEl = svgRef.current
    if (!target || !svgSel || !behavior || !svgEl) return

    lastCenteredRef.current = selectedHref
    const k = viewTransformRef.current.k
    const cx = svgEl.clientWidth / 2
    const cy = svgEl.clientHeight / 2
    svgSel.call(behavior.transform, zoomIdentity.translate(cx - target.y * k, cy - target.x * k).scale(k))
  }, [selectedHref, nodes])

  if (rootError) {
    return (
      <div style={{ padding: 24, maxWidth: 480 }}>
        <div style={{ color: 'var(--color-node-warning)', fontWeight: 600, marginBottom: 8 }}>
          Failed to load this catalog
        </div>
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 8 }}>{rootError}</div>
        <div style={{ color: 'var(--color-text-faint)', fontSize: 12 }}>
          This can happen if the URL doesn't point to valid STAC JSON, the server doesn't allow
          cross-origin browser requests (CORS), or the catalog is temporarily unreachable.
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--color-bg)' }}>
      <Legend />
      {/* The <svg> must always be in the tree (not swapped for a "loading"
       * placeholder) — the one-time zoom-behavior effect binds to whatever
       * DOM node svgRef points to on mount, and won't retry later. */}
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ display: 'block', fontFamily: 'var(--font-sans)', cursor: dragging ? 'grabbing' : 'grab' }}
      >
        <g transform={`translate(${viewTransform.x}, ${viewTransform.y}) scale(${viewTransform.k})`}>
          {links.map((link) => (
            <path
              key={link.target.data.href}
              d={linkGenerator({ source: link.source, target: link.target }) ?? undefined}
              fill="none"
              style={{ stroke: 'var(--color-border)' }}
              strokeWidth={1.5}
            />
          ))}
          {nodes.map((n) => (
            <TreeNodeView
              key={n.data.href}
              datum={n.data}
              x={n.x}
              y={n.y}
              hasRenderedChildren={!!n.children}
              isRoot={n.depth === 0}
              loading={isLoading(n.data.href)}
              selected={selectedHref === n.data.href}
              onToggle={() => toggle(n.data.href)}
              onSelect={() => select_(n.data.href)}
              onHover={(label, clientX, clientY) =>
                label ? setTooltip({ label, x: clientX, y: clientY }) : setTooltip(null)
              }
            />
          ))}
        </g>
      </svg>
      {!layout && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            color: 'var(--color-text-muted)',
            fontSize: 13,
          }}
        >
          loading…
        </div>
      )}
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

function Legend() {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Show legend"
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          zIndex: 5,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 999,
          padding: '4px 8px',
          cursor: 'pointer',
        }}
      >
        <Dot color="var(--color-node-catalog)" />
        <Dot color="var(--color-node-collection)" />
        <Dot color="var(--color-node-item)" />
      </button>
    )
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        zIndex: 5,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '8px 12px',
        fontSize: 11,
        color: 'var(--color-text-muted)',
        lineHeight: 1.7,
      }}
    >
      <button
        onClick={() => setOpen(false)}
        title="Hide legend"
        style={{
          position: 'absolute',
          top: 4,
          right: 6,
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          color: 'var(--color-text-muted)',
          fontSize: 12,
        }}
      >
        ✕
      </button>
      <LegendRow color="var(--color-node-catalog)" label="Catalog" />
      <LegendRow color="var(--color-node-collection)" label="Collection" />
      <LegendRow color="var(--color-node-item)" label="Item" />
      <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--color-border)' }}>
        <div>● filled — click to expand</div>
        <div>○ hollow — expanded / nothing further</div>
      </div>
    </div>
  )
}

function Dot({ color }: { color: string }) {
  return (
    <span
      style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }}
    />
  )
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
          display: 'inline-block',
        }}
      />
      {label}
    </div>
  )
}

interface TreeNodeProps {
  datum: TreeDatum
  x: number
  y: number
  hasRenderedChildren: boolean
  isRoot: boolean
  loading: boolean
  selected: boolean
  onToggle: () => void
  onSelect: () => void
  onHover: (label: string | null, clientX: number, clientY: number) => void
}

function TreeNodeView({
  datum,
  x,
  y,
  hasRenderedChildren,
  isRoot,
  loading,
  selected,
  onToggle,
  onSelect,
  onHover,
}: TreeNodeProps) {
  if (datum.moreCount) {
    return (
      <g transform={`translate(${y}, ${x})`}>
        <circle r={3} fill="none" strokeDasharray="2,2" style={{ stroke: 'var(--color-text-faint)' }} />
        <text x={9} y={4} fontSize={11} style={{ fill: 'var(--color-text-faint)' }}>
          +{datum.moreCount} more {datum.moreKind ?? 'items'} (not loaded)
        </text>
      </g>
    )
  }

  const { node, isItem } = datum
  const shape = classifyNodeShape(node)
  const canExpand = !isItem && shape !== 'leaf-empty'
  // Classic tidy-tree convention: filled = collapsed with more to reveal,
  // hollow = already expanded or a genuine leaf with nothing further.
  const filled = canExpand && !hasRenderedChildren

  const color = isItem
    ? 'var(--color-node-item)'
    : node.type === 'Catalog'
      ? 'var(--color-node-catalog)'
      : 'var(--color-node-collection)'

  const radius = isItem ? 3.5 : node.type === 'Catalog' ? 7 : 6
  // The root has nothing to its left to collide with — always label it to
  // the right, regardless of expansion state.
  const labelOnLeft = hasRenderedChildren && !isRoot
  const labelDx = labelOnLeft ? -(radius + 6) : radius + 6
  const label = node.title ?? node.id

  function handleCircleClick() {
    onSelect()
    if (canExpand) onToggle()
  }

  function handleEnter(e: React.MouseEvent) {
    onHover(label, e.clientX, e.clientY)
  }
  function handleMove(e: React.MouseEvent) {
    onHover(label, e.clientX, e.clientY)
  }
  function handleLeave() {
    onHover(null, 0, 0)
  }

  return (
    <g
      transform={`translate(${y}, ${x})`}
      onMouseEnter={handleEnter}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      <circle
        r={radius}
        style={{ fill: filled ? color : 'var(--color-surface)', stroke: color, cursor: 'pointer' }}
        strokeWidth={1.75}
        onClick={handleCircleClick}
      />
      {node.spatial?.geometryInvalid && (
        <circle
          r={radius + 3}
          fill="none"
          strokeDasharray="2,2"
          style={{ stroke: 'var(--color-node-warning)' }}
        />
      )}
      {selected && (
        <circle r={radius + 4} fill="none" strokeWidth={2} style={{ stroke: 'var(--color-selection)' }} />
      )}
      <text
        dx={labelDx}
        dy={4}
        textAnchor={labelOnLeft ? 'end' : 'start'}
        fontSize={12}
        fontWeight={selected ? 600 : 400}
        style={{
          fill: selected ? 'var(--color-selection)' : 'var(--color-text)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={onSelect}
      >
        {truncateLabel(label)}
      </text>
      {loading && (
        <text
          dx={labelDx}
          dy={18}
          textAnchor={labelOnLeft ? 'end' : 'start'}
          fontSize={10}
          style={{ fill: 'var(--color-text-faint)' }}
        >
          loading…
        </text>
      )}
    </g>
  )
}
