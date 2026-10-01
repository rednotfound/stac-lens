import { useEffect, useMemo, useRef, useState } from 'react'
import { hierarchy, tree, type HierarchyPointNode } from 'd3-hierarchy'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type D3ZoomEvent } from 'd3-zoom'
import { useStructure } from '../hooks/useStructure'
import { useSelectionStore } from '../store/selection'
import { loader } from '../stac/loaderInstance'
import { useItemSetStore } from '../store/itemSet'
import { sessionPage } from '../store/itemSetSessions'
import { ItemLeafView } from './tree/ItemLeafView'
import { withItemLeaves, type ViewDatum } from './tree/itemLeaves'
import { selectedItemUnder } from './views/selectedItem'
import { Spinner } from './Spinner'
import { Legend } from './tree/Legend'
import { NodeTooltip } from './tree/NodeTooltip'
import { TreeNodeView } from './tree/TreeNodeView'
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
 *  Items are in the Items window (`ItemsWindow`), not in this canvas. */
export function StructureTree() {
  const { root, toggle, isLoading, rootError } = useStructure()
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  const browsingHref = useSelectionStore((s) => s.browsingHref)
  const select_ = useSelectionStore((s) => s.select)

  // `browsingHref` — the Catalog/Collection being browsed, pinned across
  // Item selections inside it (see `store/selection.ts`) — is what the
  // Items window shows and reads as "contains the selection"; `selectedHref`
  // may point at one Item within it, which is never a tree node.
  const browsingNode = browsingHref ? loader.get(browsingHref) : undefined
  const windowOpen = useItemSetStore((s) => s.windowOpen)
  const setWindowOpen = useItemSetStore((s) => s.setWindowOpen)
  const itemsOpenHref =
    windowOpen && browsingHref && browsingNode && hasDirectItems(browsingNode) ? browsingHref : undefined
  // The Items window's page, to draw as leaves under the browsed
  // Collection (and the page last seen under other browsed ones).
  const windowForHref = useItemSetStore((s) => s.forHref)
  const windowHrefs = useItemSetStore((s) => s.visibleHrefs)
  const windowPageIndex = useItemSetStore((s) => s.pageIndex)

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
  // Manual position overrides on top of what `tree()` computes, keyed by
  // href so they survive re-layout on expand/collapse. Dragging a node moves
  // its whole subtree: the same delta is written into every descendant's
  // entry at drag time, so each node's effective position is one lookup.
  const [dragOffsets, setDragOffsets] = useState<Map<string, { x: number; y: number }>>(new Map())
  function resetLayout() {
    setDragOffsets(new Map())
  }

  function effectiveXY(n: HierarchyPointNode<ViewDatum>): { x: number; y: number } {
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

  // The structure plus Item leaves: the window's page under the browsed
  // Collection, ten at most, then a "+N more" leaf; the page last seen,
  // dimmed, under any other Collection that has been browsed. The same
  // reading of the shared state the outline and the icicle make.
  // The selected Item, when it belongs under the browsed Collection: drawn
  // as a leaf there even when the window's page does not hold it.
  const selectedItemNode = browsingHref ? selectedItemUnder(selectedHref, browsingHref, browsingHref) : undefined
  const viewRoot = useMemo<ViewDatum | undefined>(() => {
    if (!root) return undefined
    return withItemLeaves(root, {
      browsingHref,
      windowPage: {
        forHref: windowForHref,
        items: windowHrefs.map((h) => loader.get(h)).filter((n): n is NonNullable<typeof n> => !!n),
        pageIndex: windowPageIndex,
      },
      rememberedPage: sessionPage,
      selectedItem: selectedItemNode && browsingHref ? { node: selectedItemNode, hostHref: browsingHref } : undefined,
    })
  }, [root, browsingHref, windowForHref, windowHrefs, windowPageIndex, selectedItemNode])

  const layout = useMemo(() => {
    if (!viewRoot) return undefined
    const h = hierarchy(viewRoot, (d) => d.children)
    // Default separation. The box used to reserve row space around its node,
    // so opening a different Collection reflowed the whole tree and left a
    // gap where the previous box had been. The box is a floating overlay
    // now, outside the row layout, so opening one never moves anyone else.
    tree<ViewDatum>().nodeSize([ROW_HEIGHT, LEVEL_WIDTH])(h)
    return h
  }, [viewRoot])

  const nodes = useMemo(() => (layout?.descendants() ?? []) as HierarchyPointNode<ViewDatum>[], [layout])
  const links = useMemo(
    () =>
      (layout?.links() ?? []) as {
        source: HierarchyPointNode<ViewDatum>
        target: HierarchyPointNode<ViewDatum>
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
    // A selected Item drawn off the window's page (a reload, a link) is the
    // thing to bring into view, label and all — not just its Collection.
    // Turning the window's page away from a selected Item also makes it an
    // off-page leaf; that pans only if the leaf is off-screen, and it sits
    // first under its Collection, so it rarely is.
    const offPageLeaf = nodes.find((n) => n.data.itemLeaf?.offPage)
    const panHref = offPageLeaf?.data.href ?? browsingHref ?? selectedHref
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

    const leftMargin = VISIBILITY_MARGIN
    // A leaf's label runs to the right of its mark.
    const rightMargin = offPageLeaf ? VISIBILITY_MARGIN + 220 : VISIBILITY_MARGIN

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
    const cx = svgEl.clientWidth / 2
    svgSel.call(behavior.transform, zoomIdentity.translate(cx - targetPos.y * k, cy - targetPos.x * k).scale(k))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHref, nodes, browsingHref])

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

  const layoutCustomized = dragOffsets.size > 0

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--color-bg)' }}>
      <Legend />
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 5, display: 'flex', gap: 6 }}>
        {layoutCustomized && (
          <button
            onClick={resetLayout}
            title="Snap every manually-dragged node back to its computed position"
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
          {links.map((link) => {
            const leaf = link.target.data.itemLeaf ?? link.target.data.moreItems
            return (
              <path
                key={link.target.data.href}
                d={linkGenerator({ source: effectiveXY(link.source), target: effectiveXY(link.target) }) ?? undefined}
                fill="none"
                style={{ stroke: 'var(--color-border)' }}
                strokeWidth={leaf ? 1 : 1.5}
                strokeDasharray={leaf ? '3,3' : undefined}
                opacity={leaf && !leaf.current ? 0.55 : 1}
              />
            )
          })}
          {nodes.map((n) => {
            const pos = effectiveXY(n)
            if (n.data.itemLeaf || n.data.moreItems) {
              return (
                <ItemLeafView
                  key={n.data.href}
                  datum={n.data}
                  x={pos.x}
                  y={pos.y}
                  selected={selectedHref === n.data.node.href}
                  onSelectItem={(itemHref, hostHref, current) => {
                    // Another Collection's remembered page: browse it first
                    // so the selection store pins browsing to it.
                    if (!current) select_(hostHref)
                    select_(itemHref)
                  }}
                  onOpenWindow={(hostHref, current) => {
                    if (!current) select_(hostHref)
                    setWindowOpen(true)
                  }}
                  onHover={(info, clientX, clientY) =>
                    info ? setTooltip({ ...info, x: clientX, y: clientY }) : setTooltip(null)
                  }
                />
              )
            }
            return (
              <TreeNodeView
                key={n.data.href}
                datum={n.data}
                x={pos.x}
                y={pos.y}
                hasRenderedChildren={!!n.children?.some((c) => !c.data.itemLeaf && !c.data.moreItems)}
                isRoot={n.depth === 0}
                loading={isLoading(n.data.href)}
                selected={selectedHref === n.data.href}
                containsSelection={browsingHref === n.data.href}
                itemsOpen={itemsOpenHref === n.data.href}
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
              />
            )
          })}
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
