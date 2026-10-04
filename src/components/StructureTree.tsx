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
import { useCollectionHighlight } from './collections/useCollectionHighlight'
import { DIMMED_OPACITY } from './collections/dimming'
import { usePaneState } from './collections/usePaneMode'
import { RootLoadError } from './views/StructureFallback'
import { BLOCK_PAN_ATTR, LEVEL_WIDTH, linkGenerator, ROW_HEIGHT, type TooltipState } from './tree/treeGeometry'

const resetLayoutButtonStyle: React.CSSProperties = {
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
 *  Items are in the contents pane (`ContentsPane`), and their page shows here as leaves. */
export function StructureTree() {
  const { rootHref, root, toggle, isLoading, rootError } = useStructure()
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  const browsingHref = useSelectionStore((s) => s.browsingHref)
  const select_ = useSelectionStore((s) => s.select)

  // `browsingHref` — the Catalog/Collection being browsed, pinned across
  // Item selections inside it (see `store/selection.ts`) — is what the
  // Items panel shows and reads as "contains the selection"; `selectedHref`
  // may point at one Item within it, which is never a tree node.
  const panelOpen = useItemSetStore((s) => s.panelOpen)
  const setPanelOpen = useItemSetStore((s) => s.setPanelOpen)
  // Open only while the contents pane shows its Items — for a node with
  // children too, the pane may be showing its Collections list instead.
  const pane = usePaneState()
  const itemsOpenHref = panelOpen && pane.mode === 'items' && pane.itemsNode ? pane.itemsNode.href : undefined
  // The Items panel's page, to draw as leaves under the browsed
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
  // Item leaves are not stable nodes — they are the Items panel's page,
  // replaced whenever the page turns or a search runs — so they never get
  // entries of their own. A Collection's leaves move as one group: their
  // position is the Collection's own offset plus the group's, keyed by the
  // Collection, so the next page appears where the last one was put
  // (DESIGN §120).
  const [leafGroupOffsets, setLeafGroupOffsets] = useState<Map<string, { x: number; y: number }>>(new Map())
  function resetLayout() {
    setDragOffsets(new Map())
    setLeafGroupOffsets(new Map())
  }

  function effectiveXY(n: HierarchyPointNode<ViewDatum>): { x: number; y: number } {
    const host = n.data.itemLeaf?.hostHref ?? n.data.moreItems?.hostHref
    if (host) {
      const hostOff = dragOffsets.get(host)
      const groupOff = leafGroupOffsets.get(host)
      return {
        x: n.x + (hostOff?.x ?? 0) + (groupOff?.x ?? 0),
        y: n.y + (hostOff?.y ?? 0) + (groupOff?.y ?? 0),
      }
    }
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
      // d3-zoom's default filter, plus one rule: never start a pan (or a
      // double-click zoom) from inside anything marked `data-block-pan` — a
      // node's circle and label, which have their own click and drag. The
      // wheel is exempt: it is not a drag, and zooming with the pointer
      // resting on a node is what a canvas is expected to do (reported:
      // the wheel did nothing while hovering a node).
      .filter((event: Event) => {
        const target = event.target as Element | null
        if (event.type !== 'wheel' && target?.closest(`[${BLOCK_PAN_ATTR}]`)) return false
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

  // The structure plus Item leaves: the panel's page under the browsed
  // Collection, ten at most, then a "+N more" leaf; the page last seen,
  // dimmed, under any other Collection that has been browsed. The same
  // reading of the shared state the outline and the icicle make.
  // The selected Item, when it belongs under the browsed Collection: drawn
  // as a leaf there even when the panel's page does not hold it.
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
  // The Collections list's filter: the browsed node's non-matching
  // children, and everything drawn under them, are dimmed (DESIGN §128).
  const highlight = useCollectionHighlight()
  // The dashed ring means "the selected Item is in here" — not a Collection
  // picked from the Children list while its container stays browsed.
  const selectedIsItemNode = !!selectedHref && loader.get(selectedHref)?.type === 'Item'
  function isDimmed(n: HierarchyPointNode<ViewDatum>): boolean {
    if (!highlight) return false
    for (let a: HierarchyPointNode<ViewDatum> | null = n; a?.parent; a = a.parent) {
      if (a.parent.data.href === highlight.containerHref) {
        // The container's own Item leaves are not children being filtered.
        if (a.data.itemLeaf || a.data.moreItems) return false
        return !highlight.matches.has(a.data.href)
      }
    }
    return false
  }
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
    // A selected Item drawn off the panel's page (a reload, a link) is the
    // thing to bring into view, label and all — not just its Collection.
    // Turning the panel's page away from a selected Item also makes it an
    // off-page leaf; that pans only if the leaf is off-screen, and it sits
    // first under its Collection, so it rarely is.
    const offPageLeaf = nodes.find((n) => n.data.itemLeaf?.offPage)
    // An Item is never a node: pan to the Collection it is browsed in. A
    // Catalog/Collection picked from the Children list is selected without
    // being browsed (the container stays browsed), so it is panned to itself.
    const selectedIsItem = loader.get(selectedHref)?.type === 'Item'
    const panHref = offPageLeaf?.data.href ?? (selectedIsItem ? (browsingHref ?? selectedHref) : selectedHref)
    // The browsed Collection's Item leaves arrive after it does (its default
    // search is a request), and they must be seen too — a docked Items
    // panel narrows the canvas enough to push them off its right edge. So
    // their arrival is a reason to look again.
    const hasLeaves = nodes.some((n) => (n.data.itemLeaf ?? n.data.moreItems)?.hostHref === browsingHref)
    const panKey = `${panHref}${hasLeaves ? '#leaves' : ''}`
    if (panKey === lastCenteredRef.current) return
    const target = nodes.find((n) => n.data.href === panHref)
    const svgSel = svgSelRef.current
    const behavior = zoomBehaviorRef.current
    const svgEl = svgRef.current
    if (!target || !svgSel || !behavior || !svgEl) return

    const currentTransform = viewTransformRef.current
    const k = currentTransform.k
    const targetPos = effectiveXY(target)
    const currentScreenX = currentTransform.x + targetPos.y * k
    const currentScreenY = currentTransform.y + targetPos.x * k
    const width = svgEl.clientWidth
    const VISIBILITY_MARGIN = 100
    // How far a leaf's label runs to the right of its mark.
    const LEAF_LABEL = 220

    const leftMargin = VISIBILITY_MARGIN
    // The target's own right margin; with leaves under it, the whole leaf
    // column — one level to its right, label and all — has to fit.
    const rightMargin = offPageLeaf
      ? VISIBILITY_MARGIN + LEAF_LABEL
      : hasLeaves
        ? LEVEL_WIDTH * k + LEAF_LABEL
        : VISIBILITY_MARGIN

    const alreadyVisible =
      currentScreenX >= leftMargin &&
      currentScreenX <= width - rightMargin &&
      currentScreenY >= VISIBILITY_MARGIN &&
      currentScreenY <= svgEl.clientHeight - VISIBILITY_MARGIN
    lastCenteredRef.current = panKey
    if (alreadyVisible) return

    const cy = svgEl.clientHeight / 2
    // Centered when there is room; with leaves, as far left as it takes for
    // their column to fit — and no further left than a small margin, so on
    // a very narrow canvas the Collection stays in view and the leaves'
    // labels are the part cut off.
    const screenX = hasLeaves && !offPageLeaf ? Math.max(24, Math.min(width / 2, width - rightMargin)) : width / 2
    svgSel.call(behavior.transform, zoomIdentity.translate(screenX - targetPos.y * k, cy - targetPos.x * k).scale(k))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHref, nodes, browsingHref])

  if (rootError) return <RootLoadError rootHref={rootHref} error={rootError} />

  const layoutCustomized = dragOffsets.size > 0 || leafGroupOffsets.size > 0

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--color-bg)' }}>
      <Legend />
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 5, display: 'flex', gap: 6 }}>
        {layoutCustomized && (
          <button
            onClick={resetLayout}
            title="Snap every manually-dragged node back to its computed position"
            style={resetLayoutButtonStyle}
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
        data-structure-canvas
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
                opacity={(leaf && !leaf.current ? 0.55 : 1) * (isDimmed(link.target) ? DIMMED_OPACITY : 1)}
              />
            )
          })}
          {nodes.map((n) => {
            const pos = effectiveXY(n)
            if (n.data.itemLeaf || n.data.moreItems) {
              return (
                <ItemLeafView
                  key={n.data.href}
                  dimmed={isDimmed(n)}
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
                  onOpenPanel={(hostHref, current) => {
                    if (!current) select_(hostHref)
                    setPanelOpen(true)
                  }}
                  onHover={(info, clientX, clientY) =>
                    info ? setTooltip({ ...info, x: clientX, y: clientY }) : setTooltip(null)
                  }
                  containerRef={zoomGRef}
                  onGroupDragBy={(hostHref, dxLocal, dyLocal) => {
                    // The layout is transposed (layout x is screen y), as
                    // for a node's own drag below.
                    setLeafGroupOffsets((prev) => {
                      const next = new Map(prev)
                      const base = prev.get(hostHref) ?? { x: 0, y: 0 }
                      next.set(hostHref, { x: base.x + dyLocal, y: base.y + dxLocal })
                      return next
                    })
                  }}
                />
              )
            }
            return (
              <TreeNodeView
                key={n.data.href}
                datum={n.data}
                dimmed={isDimmed(n)}
                x={pos.x}
                y={pos.y}
                hasRenderedChildren={!!n.children?.some((c) => !c.data.itemLeaf && !c.data.moreItems)}
                isRoot={n.depth === 0}
                loading={isLoading(n.data.href)}
                selected={selectedHref === n.data.href}
                containsSelection={selectedIsItemNode && browsingHref === n.data.href}
                itemsOpen={itemsOpenHref === n.data.href}
                onToggle={() => toggle(n.data.href)}
                onSelect={() => select_(n.data.href)}
                onHover={(info, clientX, clientY) =>
                  info ? setTooltip({ ...info, x: clientX, y: clientY }) : setTooltip(null)
                }
                containerRef={zoomGRef}
                onNodeDragBy={(dxLocal, dyLocal) => {
                  // Structural descendants only: Item leaves follow their
                  // Collection through `effectiveXY`, whichever page shows.
                  const descendantHrefs = n
                    .descendants()
                    .filter((d) => !d.data.itemLeaf && !d.data.moreItems)
                    .map((d) => d.data.href)
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
