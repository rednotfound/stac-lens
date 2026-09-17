import { useEffect, useMemo, useRef, useState } from 'react'
import { hierarchy, tree, type HierarchyPointNode } from 'd3-hierarchy'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type D3ZoomEvent } from 'd3-zoom'
import { useStructureTree, type TreeDatum } from '../hooks/useStructureTree'
import { useSelectionStore } from '../store/selection'
import { loader } from '../stac/loaderInstance'
import { Spinner } from './Spinner'
import { Legend } from './tree/Legend'
import { NodeTooltip } from './tree/NodeTooltip'
import { TreeNodeView } from './tree/TreeNodeView'
import {
  DEFAULT_BOX_HEIGHT,
  DEFAULT_BOX_WIDTH,
  DEFAULT_RESULTS_BOX_HEIGHT,
  DEFAULT_RESULTS_BOX_OFFSET,
  DEFAULT_RESULTS_BOX_WIDTH,
  DEFAULT_SEARCH_BOX_HEIGHT,
  DEFAULT_SEARCH_BOX_WIDTH,
  makeBoxGeometry,
  MIN_BOX_HEIGHT,
  MIN_BOX_WIDTH,
  MIN_SEARCH_BOX_HEIGHT,
  ZERO_BOX_OFFSET,
  type BoxOffset,
  type BoxSize,
} from './tree/boxGeometry'
import {
  BLOCK_PAN_ATTR,
  hasDirectItems,
  LEVEL_WIDTH,
  linkGenerator,
  ROW_HEIGHT,
  type TooltipState,
} from './tree/treeGeometry'

const canvasButtonStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 999,
  padding: '4px 10px',
  fontSize: 12,
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
}

/** Structure Lens: a horizontal, curved tree over the Catalog → Collection
 *  graph, panned and zoomed with d3-zoom (drag to pan, wheel to zoom — no
 *  sliders). d3 owns only the layout math and the gesture composition;
 *  every node, link and box is ordinary React/SVG with ordinary React
 *  handlers. This component owns the canvas: layout, pan/zoom, manual node
 *  offsets, per-node box geometry, auto-pan to an off-screen selection, and
 *  the layer boxes are portaled into. A node itself is `TreeNodeView`; a
 *  box is `renderBox` (`tree/ItemSetBox.tsx`). */
export function StructureTree({ rootHref }: { rootHref: string }) {
  const { root, toggle, collapseAll, expandAllCatalogs, isLoading, rootError } = useStructureTree(rootHref)
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  const browsingHref = useSelectionStore((s) => s.browsingHref)
  const select_ = useSelectionStore((s) => s.select)

  // `browsingHref` — the Catalog/Collection being browsed, pinned across
  // Item selections inside it (see `store/selection.ts`) — is what hosts the
  // Item Set box and reads as "contains the selection"; `selectedHref` may
  // point at one Item within it, which is never a tree node.
  const browsingNode = browsingHref ? loader.get(browsingHref) : undefined
  const boxHref = browsingHref && browsingNode && hasDirectItems(browsingNode) ? browsingHref : undefined

  const svgRef = useRef<SVGSVGElement>(null)
  // The zoom-transformed group. Every d3-drag in the tree uses it as its
  // `.container()`, so drag deltas arrive in the same coordinate space
  // `tree()`'s x/y and `foreignObject`'s x/y live in, already divided by
  // the current scale.
  const zoomGRef = useRef<SVGGElement | null>(null)
  const zoomBehaviorRef = useRef<ReturnType<typeof zoom<SVGSVGElement, unknown>> | null>(null)
  const svgSelRef = useRef<ReturnType<typeof select<SVGSVGElement, unknown>> | null>(null)
  const [viewTransform, setViewTransform] = useState({ x: 80, y: 0, k: 1 })
  const viewTransformRef = useRef(viewTransform)
  const lastCenteredRef = useRef<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  // The open box is portaled into this `<g>`, rendered last inside the
  // zoomed canvas, so it always paints above every node and link — SVG
  // paints in document order, and a box rendered inline in its own node's
  // `<g>` landed above some siblings and below others. State rather than a
  // ref: a ref read during another component's render is not attached on
  // the first pass, and nothing would re-render to retry; a callback ref
  // into state triggers exactly that retry once the element exists.
  const [boxLayer, setBoxLayer] = useState<SVGGElement | null>(null)

  // Manual position overrides on top of what `tree()` computes, keyed by
  // href so they survive re-layout on expand/collapse. Dragging a node moves
  // its whole subtree: the same delta is written into every descendant's
  // entry at drag time, so each node's effective position is one lookup.
  const [dragOffsets, setDragOffsets] = useState<Map<string, { x: number; y: number }>>(new Map())
  // Per-node box geometry, remembered for the session so revisiting a
  // Collection finds its box where it was left. A static catalog has one
  // box; an API Collection has an independent Search and Results pair,
  // each with its own Maps of the same shape.
  const [boxOffsets, setBoxOffsets] = useState<Map<string, BoxOffset>>(new Map())
  const [boxSizes, setBoxSizes] = useState<Map<string, BoxSize>>(new Map())
  const [searchBoxOffsets, setSearchBoxOffsets] = useState<Map<string, BoxOffset>>(new Map())
  const [searchBoxSizes, setSearchBoxSizes] = useState<Map<string, BoxSize>>(new Map())
  const [resultsBoxOffsets, setResultsBoxOffsets] = useState<Map<string, BoxOffset>>(new Map())
  const [resultsBoxSizes, setResultsBoxSizes] = useState<Map<string, BoxSize>>(new Map())

  function resetLayout() {
    setDragOffsets(new Map())
    setBoxOffsets(new Map())
    setBoxSizes(new Map())
    setSearchBoxOffsets(new Map())
    setSearchBoxSizes(new Map())
    setResultsBoxOffsets(new Map())
    setResultsBoxSizes(new Map())
  }

  function effectiveXY(n: HierarchyPointNode<TreeDatum>): { x: number; y: number } {
    const off = dragOffsets.get(n.data.href)
    return { x: n.x + (off?.x ?? 0), y: n.y + (off?.y ?? 0) }
  }

  useEffect(() => {
    viewTransformRef.current = viewTransform
  }, [viewTransform])

  useEffect(() => {
    const svgEl = svgRef.current
    if (!svgEl) return

    const svgSel = select(svgEl)
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 4])
      // d3-zoom's default filter, plus one rule: never start a pan/zoom from
      // inside anything marked `data-block-pan`, decided here at the moment
      // a gesture would begin, for whichever event type d3-zoom is checking.
      .filter((event: Event) => {
        const target = event.target as Element | null
        if (target?.closest(`[${BLOCK_PAN_ATTR}]`)) return false
        const e = event as MouseEvent & { ctrlKey: boolean; button: number }
        return (!e.ctrlKey || event.type === 'wheel') && !e.button
      })
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
    // Default separation. The box used to reserve row space around its node,
    // so opening a different Collection reflowed the whole tree and left a
    // gap where the previous box had been. The box is a floating overlay
    // now, outside the row layout, so opening one never moves anyone else.
    tree<TreeDatum>().nodeSize([ROW_HEIGHT, LEVEL_WIDTH])(h)
    return h
  }, [root])

  const nodes = useMemo(() => (layout?.descendants() ?? []) as HierarchyPointNode<TreeDatum>[], [layout])
  const links = useMemo(
    () =>
      (layout?.links() ?? []) as {
        source: HierarchyPointNode<TreeDatum>
        target: HierarchyPointNode<TreeDatum>
      }[],
    [layout],
  )

  // Bring a selection that is off-screen into view — one that arrived from
  // the Inspector's widgets, a deep link, or a node not yet expanded into
  // view. Keyed on the Collection being panned to (`browsingHref`), not on
  // `selectedHref`: clicking through several Items in one open box must not
  // re-pan on every click. And only when the target really is off-screen:
  // clicking already-visible siblings to compare them must not yank the
  // canvas either, so the target's current screen position is projected
  // through the current transform and checked against the viewport first.
  useEffect(() => {
    if (!selectedHref) return
    const panHref = browsingHref ?? selectedHref
    if (panHref === lastCenteredRef.current) return
    const target = nodes.find((n) => n.data.href === panHref)
    const svgSel = svgSelRef.current
    const behavior = zoomBehaviorRef.current
    const svgEl = svgRef.current
    if (!target || !svgSel || !behavior || !svgEl) return

    const currentTransform = viewTransformRef.current
    const targetPos = effectiveXY(target)
    const currentScreenX = currentTransform.x + targetPos.y * currentTransform.k
    const currentScreenY = currentTransform.y + targetPos.x * currentTransform.k
    const VISIBILITY_MARGIN = 100

    // With an open box, "visible" must include room for the box on its own
    // side — sized from the box's actual current width, not a guess, and
    // the wider of the two for an API Collection's pair. The same margin
    // drives both the visibility test and the pan target below, so they
    // always agree on how much room the box needs.
    const targetLabelOnLeft = !!target.children && target.depth !== 0
    const hasOpenBox = boxHref === panHref
    const isPanTargetCursorMode = target.data.node.items.kind === 'cursor'
    const openBoxWidth = isPanTargetCursorMode
      ? Math.max(
          searchBoxSizes.get(panHref)?.width ?? DEFAULT_SEARCH_BOX_WIDTH,
          resultsBoxSizes.get(panHref)?.width ?? DEFAULT_RESULTS_BOX_WIDTH,
        )
      : (boxSizes.get(panHref)?.width ?? DEFAULT_BOX_WIDTH)
    const BOX_SIDE_MARGIN = openBoxWidth + 40
    const leftMargin = hasOpenBox && targetLabelOnLeft ? BOX_SIDE_MARGIN : VISIBILITY_MARGIN
    const rightMargin = hasOpenBox && !targetLabelOnLeft ? BOX_SIDE_MARGIN : VISIBILITY_MARGIN

    const alreadyVisible =
      currentScreenX >= leftMargin &&
      currentScreenX <= svgEl.clientWidth - rightMargin &&
      currentScreenY >= VISIBILITY_MARGIN &&
      currentScreenY <= svgEl.clientHeight - VISIBILITY_MARGIN
    if (alreadyVisible) {
      lastCenteredRef.current = panHref
      return
    }

    lastCenteredRef.current = panHref
    const k = viewTransformRef.current.k
    const cy = svgEl.clientHeight / 2
    // Bias the pan so the node sits near the edge *away* from its box,
    // leaving the box's side the full remaining width.
    const cx = hasOpenBox
      ? targetLabelOnLeft
        ? Math.max(svgEl.clientWidth - BOX_SIDE_MARGIN, svgEl.clientWidth / 2)
        : Math.min(BOX_SIDE_MARGIN, svgEl.clientWidth / 2)
      : svgEl.clientWidth / 2
    svgSel.call(behavior.transform, zoomIdentity.translate(cx - targetPos.y * k, cy - targetPos.x * k).scale(k))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHref, nodes, browsingHref, boxHref])

  if (rootError) {
    return (
      <div style={{ padding: 24, maxWidth: 480 }}>
        <div style={{ color: 'var(--color-node-warning)', fontWeight: 600, marginBottom: 8 }}>
          Failed to load this catalog
        </div>
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 8 }}>{rootError}</div>
        <div style={{ color: 'var(--color-text-faint)', fontSize: 12 }}>
          This can happen if the URL doesn't point to valid STAC JSON, the server doesn't allow cross-origin browser
          requests (CORS), or the catalog is temporarily unreachable.
        </div>
      </div>
    )
  }

  const layoutCustomized =
    dragOffsets.size > 0 ||
    boxOffsets.size > 0 ||
    boxSizes.size > 0 ||
    searchBoxOffsets.size > 0 ||
    searchBoxSizes.size > 0 ||
    resultsBoxOffsets.size > 0 ||
    resultsBoxSizes.size > 0

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--color-bg)' }}>
      <Legend />
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 5, display: 'flex', gap: 6 }}>
        <button
          onClick={collapseAll}
          title="Collapse every expanded node back down to just the root's direct children"
          style={canvasButtonStyle}
        >
          Collapse to top level
        </button>
        <button
          onClick={() => void expandAllCatalogs()}
          title="Expand every Catalog down to (but not into) Collection level"
          style={canvasButtonStyle}
        >
          Expand all catalogs
        </button>
        {layoutCustomized && (
          <button
            onClick={resetLayout}
            title="Snap every manually-dragged node and Item Set box back to its computed position/size"
            style={canvasButtonStyle}
          >
            Reset layout
          </button>
        )}
      </div>
      {/* The <svg> is always rendered, never swapped for a loading
       * placeholder: the zoom behavior binds once, on mount, to whatever
       * `svgRef` points at. */}
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ display: 'block', fontFamily: 'var(--font-sans)', cursor: dragging ? 'grabbing' : 'grab' }}
      >
        <g ref={zoomGRef} transform={`translate(${viewTransform.x}, ${viewTransform.y}) scale(${viewTransform.k})`}>
          {links.map((link) => (
            <path
              key={link.target.data.href}
              d={linkGenerator({ source: effectiveXY(link.source), target: effectiveXY(link.target) }) ?? undefined}
              fill="none"
              style={{ stroke: 'var(--color-border)' }}
              strokeWidth={1.5}
            />
          ))}
          {nodes.map((n) => {
            const pos = effectiveXY(n)
            return (
              <TreeNodeView
                key={n.data.href}
                datum={n.data}
                x={pos.x}
                y={pos.y}
                hasRenderedChildren={!!n.children}
                isRoot={n.depth === 0}
                loading={isLoading(n.data.href)}
                selected={selectedHref === n.data.href}
                containsSelection={browsingHref === n.data.href}
                showItemSetBox={boxHref === n.data.href}
                onToggle={() => toggle(n.data.href)}
                onSelect={() => select_(n.data.href)}
                onHover={(info, clientX, clientY) =>
                  info ? setTooltip({ ...info, x: clientX, y: clientY }) : setTooltip(null)
                }
                containerRef={zoomGRef}
                onNodeDragBy={(dxLocal, dyLocal) => {
                  const descendantHrefs = n.descendants().map((d) => d.data.href)
                  setDragOffsets((prev) => {
                    const next = new Map(prev)
                    for (const href of descendantHrefs) {
                      const base = prev.get(href) ?? { x: 0, y: 0 }
                      next.set(href, { x: base.x + dyLocal, y: base.y + dxLocal })
                    }
                    return next
                  })
                }}
                boxOffset={boxOffsets.get(n.data.href) ?? ZERO_BOX_OFFSET}
                onBoxDragBy={(dxLocal, dyLocal) => {
                  setBoxOffsets((prev) => {
                    const next = new Map(prev)
                    const base = prev.get(n.data.href) ?? ZERO_BOX_OFFSET
                    next.set(n.data.href, { dxHoriz: base.dxHoriz + dxLocal, dyVert: base.dyVert + dyLocal })
                    return next
                  })
                }}
                boxSize={boxSizes.get(n.data.href) ?? { width: DEFAULT_BOX_WIDTH, height: DEFAULT_BOX_HEIGHT }}
                onBoxResizeBy={(dxLocal, dyLocal) => {
                  setBoxSizes((prev) => {
                    const next = new Map(prev)
                    const base = prev.get(n.data.href) ?? { width: DEFAULT_BOX_WIDTH, height: DEFAULT_BOX_HEIGHT }
                    next.set(n.data.href, {
                      width: Math.max(MIN_BOX_WIDTH, base.width + dxLocal),
                      height: Math.max(MIN_BOX_HEIGHT, base.height + dyLocal),
                    })
                    return next
                  })
                }}
                searchBox={makeBoxGeometry(
                  n.data.href,
                  searchBoxOffsets,
                  setSearchBoxOffsets,
                  ZERO_BOX_OFFSET,
                  searchBoxSizes,
                  setSearchBoxSizes,
                  { width: DEFAULT_SEARCH_BOX_WIDTH, height: DEFAULT_SEARCH_BOX_HEIGHT },
                  MIN_BOX_WIDTH,
                  MIN_SEARCH_BOX_HEIGHT,
                )}
                resultsBox={makeBoxGeometry(
                  n.data.href,
                  resultsBoxOffsets,
                  setResultsBoxOffsets,
                  DEFAULT_RESULTS_BOX_OFFSET,
                  resultsBoxSizes,
                  setResultsBoxSizes,
                  { width: DEFAULT_RESULTS_BOX_WIDTH, height: DEFAULT_RESULTS_BOX_HEIGHT },
                  MIN_BOX_WIDTH,
                  MIN_BOX_HEIGHT,
                )}
                boxLayer={boxLayer}
              />
            )
          })}
          {/* The box layer: rendered last so an open box paints above every
           * node and link by construction. `outline: none` because Chrome's
           * click-to-focus fallback lands on this `<g>` for non-focusable
           * content inside a `<foreignObject>` and would draw a focus ring
           * around it (Firefox never does). */}
          <g ref={setBoxLayer} style={{ outline: 'none' }} />
        </g>
      </svg>
      {/* Centered, not tucked in a corner: opening a catalog is the fetch a
       * user most often sits and waits on, and it should read as "working"
       * at a glance. */}
      {!layout && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            color: 'var(--color-text-muted)',
            fontSize: 13,
          }}
        >
          <Spinner size={22} />
          Loading catalog…
        </div>
      )}
      {tooltip && <NodeTooltip tooltip={tooltip} />}
    </div>
  )
}
