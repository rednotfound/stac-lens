import { useEffect, useMemo, useRef, useState } from 'react'
import { hierarchy, tree, type HierarchyPointNode } from 'd3-hierarchy'
import { linkHorizontal } from 'd3-shape'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type D3ZoomEvent } from 'd3-zoom'
import { drag, type D3DragEvent } from 'd3-drag'
import { useStructureTree, type TreeDatum } from '../hooks/useStructureTree'
import { useSelectionStore } from '../store/selection'
import { loader } from '../stac/loaderInstance'
import { classifyNodeShape, type StacNode } from '../stac/types'
import { ItemSetBrowser } from './ItemSetBrowser'
import { Spinner } from './Spinner'

/** True when a node has direct Items to browse via Item Set — either a
 *  known, non-empty flat `rel:item` array, or a `cursor` (API-searched)
 *  source, whose real count is unknown until queried and so is assumed
 *  non-empty (same convention `classifyNodeShape` already uses). */
function hasDirectItems(node: StacNode): boolean {
  const shape = classifyNodeShape(node)
  return shape === 'leaf-items' || shape === 'mixed'
}

// Was 26 — measured directly against real rendered content (not
// eyeballed): a node's label + its own badge/tag line together span ~31px
// (label top to badge bottom), so a 26px row spacing meant every adjacent
// pair of nodes with a badge/tag genuinely overlapped by 5px, confirmed by
// reading real `getBoundingClientRect()`s off Earth Search's own root
// (10 API-tagged siblings, each one -5px against the next). Reported
// directly: "我们现在的这个每个节点和节点上下高度之间又隔得太近了...彼此间压得
// 有点厉害" (the vertical spacing between nodes is too tight, they're
// visibly crowding into each other) — bumped to 38 for real clearance
// (31px content + ~7px of actual breathing room), not just barely
// non-overlapping. See docs/DESIGN.md §34's update.
const ROW_HEIGHT = 38
const LEVEL_WIDTH = 320
const LABEL_MAX_CHARS = 40

function truncateLabel(label: string, maxChars: number = LABEL_MAX_CHARS): string {
  return label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label
}

const LABEL_FONT_SIZE = 12
// A rough average character width for a proportional sans-serif font at
// this size — not pixel-perfect (some glyphs are wider than others), but
// enough to keep the Item Set box from landing on top of a long
// Collection title. A fixed gap measured from the label's own *start*
// position couldn't guarantee that: a 40-character title reaches roughly
// 280px past that point, which the box's old fixed 60px gap never
// accounted for — confirmed directly: "collection的文字比较长...导致所有的
// collection文字呢,就是这样子盖在了这个items的panel上面" (long Collection
// titles ended up covered by the Item Set panel).
const AVG_CHAR_WIDTH_RATIO = 0.6
function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * AVG_CHAR_WIDTH_RATIO
}

const linkGenerator = linkHorizontal<unknown, { x: number; y: number }>()
  .x((d) => d.y)
  .y((d) => d.x)

// Deliberately a different shape than node offsets (`dragOffsets`) —
// node offsets are in d3-hierarchy's own (x=vertical, y=horizontal)
// convention (matched by `effectiveXY`/`linkGenerator`), while the box is
// positioned via plain SVG `foreignObject` x/y attributes (horizontal,
// vertical) directly, inside its node's own already-transformed `<g>`.
// Naming them differently (`dxHoriz`/`dyVert` vs. `x`/`y`) is intentional —
// reusing the same `{x, y}` shape for both would invite exactly the kind
// of swapped-axis bug this file has already hit once with `linkGenerator`.
const ZERO_BOX_OFFSET = { dxHoriz: 0, dyVert: 0 }

// The single, central rule for "should d3-zoom's own pan/zoom gesture
// engage here" — set on every element that has its own competing gesture
// (a node's drag hit-target, the Item Set box's drag handle, and the box's
// whole content, so scrolling/clicking/typing inside it doesn't also pan
// or zoom the canvas). d3-zoom's `.filter()` checks this once, at the
// point a gesture would *start*, for every event type it listens to
// (mousedown, wheel, touchstart) — this replaces an earlier, less reliable
// approach of manually calling `stopPropagation()` on a hand-picked list of
// event types from inside each competing element, which missed whichever
// event type(s) d3-zoom's own internal listeners actually used and let the
// canvas pan *at the same time* as a node was being dragged (confirmed
// directly: "我觉得这个是某种程度上...很可能是由于我同时在移动画布,同时又在移动
// 节点" — I suspect this is because I was moving the canvas and the node at
// the same time). See docs/DESIGN.md §33.
const BLOCK_PAN_ATTR = 'data-block-pan'

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
  const { root, toggle, collapseAll, expandAllCatalogs, isLoading, rootError } =
    useStructureTree(rootHref)
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  const browsingHref = useSelectionStore((s) => s.browsingHref)
  const select_ = useSelectionStore((s) => s.select)

  // Items are never their own tree node (see useStructureTree's top-level
  // comment) — `browsingHref` (the Collection/Catalog actually being
  // browsed, pinned across Item selections within it — see store/
  // selection.ts and docs/DESIGN.md §21) is what reads as "contains the
  // current selection" and hosts the embedded Item Set box, distinct from
  // `selectedHref` itself which can point at one specific Item within it.
  const browsingNode = browsingHref ? loader.get(browsingHref) : undefined
  const boxHref = browsingHref && browsingNode && hasDirectItems(browsingNode) ? browsingHref : undefined

  const svgRef = useRef<SVGSVGElement>(null)
  // The zoom-transformed group — d3-drag's `.container()` for every
  // draggable element points here, so its own coordinate math (already
  // correctly divides by the current zoom scale, no manual `/k` needed)
  // lines up with the same coordinate space `tree()`'s own x/y values and
  // `foreignObject`'s x/y attributes already live in.
  const zoomGRef = useRef<SVGGElement | null>(null)
  const zoomBehaviorRef = useRef<ReturnType<typeof zoom<SVGSVGElement, unknown>> | null>(null)
  const svgSelRef = useRef<ReturnType<typeof select<SVGSVGElement, unknown>> | null>(null)
  const [viewTransform, setViewTransform] = useState({ x: 80, y: 0, k: 1 })
  const viewTransformRef = useRef(viewTransform)
  const lastCenteredRef = useRef<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  // Manual position overrides, on top of whatever `tree()` computes — the
  // free-drag exploration asked for directly: "我更愿意用户可以具体地拖拽一些
  // 东西...我也可以再拉一拉,拖一拖之类的" (I'd rather users could drag things
  // around specifically — and pull/drag them again later). Keyed by href so
  // a node's manual position survives re-renders (layout is recomputed on
  // every expand/collapse) without needing to touch the layout algorithm
  // itself — `tree()` still computes the "true" position; this is purely
  // additive. Dragging a node moves its *whole subtree* together (an
  // explicit choice — see docs/DESIGN.md §32): the same delta gets written
  // into every descendant's own entry at drag time, so each node's
  // effective position is a single direct lookup, no ancestor-walk needed
  // at render/link time.
  const [dragOffsets, setDragOffsets] = useState<Map<string, { x: number; y: number }>>(new Map())
  // The Item Set box's own drag offset, independently, keyed by the href of
  // the node it belongs to — so revisiting the same Collection later in
  // the session remembers where its box was left, rather than resetting
  // every time browsingHref changes.
  const [boxOffsets, setBoxOffsets] = useState<Map<string, { dxHoriz: number; dyVert: number }>>(new Map())

  function resetLayout() {
    setDragOffsets(new Map())
    setBoxOffsets(new Map())
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
      // The default filter is `(!event.ctrlKey || event.type === 'wheel')
      // && !event.button` (d3-zoom's own docs) — preserved here, with one
      // addition: never start a pan/zoom gesture from inside anything
      // marked `data-block-pan`, at the same point d3-zoom decides whether
      // to engage at all, regardless of which underlying event type
      // (mousedown/pointerdown/wheel/touchstart) it happens to be checking.
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
    // No separation() override — the Item Set box used to reserve extra
    // row-space around whichever node showed it (§21, §27), pushing every
    // sibling apart to make room. That meant switching from browsing one
    // Collection to another didn't just relocate the box — it perturbed
    // the *entire tree's* layout, leaving a large empty gap wherever the
    // previously-browsed Collection's reserved space used to be. Reported
    // directly: "当我开另外一个collection了以后,上一个collection关闭以后,
    // 下面留了一个巨大的空间在那里...这个就不够灵活" (after opening a different
    // collection, the previous one closes and leaves a huge empty space
    // below — not flexible). Since only one Collection is ever browsed at
    // a time, the box is now a floating overlay instead: positioned off
    // its node same as before, but no longer part of the tree's own row
    // layout, so it can never leave a stale gap behind, and opening a
    // different Collection never reflows anyone else. Default d3-hierarchy
    // separation (1 row-unit between siblings, 2 between cousins) is exactly
    // right on its own.
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
    // An Item selection has no tree node of its own to find — pan to the
    // Collection that contains it instead.
    const panHref = browsingHref ?? selectedHref
    const target = nodes.find((n) => n.data.href === panHref)
    const svgSel = svgSelRef.current
    const behavior = zoomBehaviorRef.current
    const svgEl = svgRef.current
    if (!target || !svgSel || !behavior || !svgEl) return

    lastCenteredRef.current = selectedHref
    const k = viewTransformRef.current.k
    const cy = svgEl.clientHeight / 2
    // Centering the node itself in the middle of the column leaves only
    // half the column's width for its Item Set box (§27's fan + box,
    // together comfortably over 400px wide) to fit in before hitting the
    // Structure/Inspector column boundary — confirmed directly: a real
    // "Draw area" button inside that box rendered at a screen position
    // whose center resolved (via `elementFromPoint`) to Detail Panel's
    // own div, not the button, because the box had drifted past the
    // boundary into the Inspector column's own screen region (a sibling
    // box, not something the tree's own overflow clipping — see App.tsx —
    // could make clickable again by itself). Bias the pan instead so the
    // node sits near whichever edge is *away* from its box, leaving the
    // box's own side the full remaining width to render in.
    const targetLabelOnLeft = !!target.children && target.depth !== 0
    const BOX_SIDE_MARGIN = 140
    const cx =
      boxHref === panHref
        ? targetLabelOnLeft
          ? Math.max(svgEl.clientWidth - BOX_SIDE_MARGIN, svgEl.clientWidth / 2)
          : Math.min(BOX_SIDE_MARGIN, svgEl.clientWidth / 2)
        : svgEl.clientWidth / 2
    // Effective position, not the raw layout position — a manually-dragged
    // node's on-screen location can differ from what `tree()` computed for
    // it (§32), and centering should follow where it actually is.
    const targetPos = effectiveXY(target)
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
          This can happen if the URL doesn't point to valid STAC JSON, the server doesn't allow
          cross-origin browser requests (CORS), or the catalog is temporarily unreachable.
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--color-bg)' }}>
      <Legend />
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 5, display: 'flex', gap: 6 }}>
        <button
          onClick={collapseAll}
          title="Collapse every expanded node back down to just the root's direct children"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 999,
            padding: '4px 10px',
            fontSize: 12,
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
          }}
        >
          Collapse to top level
        </button>
        <button
          onClick={() => void expandAllCatalogs()}
          title="Expand every Catalog down to (but not into) Collection level"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 999,
            padding: '4px 10px',
            fontSize: 12,
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
          }}
        >
          Expand all catalogs
        </button>
        {(dragOffsets.size > 0 || boxOffsets.size > 0) && (
          <button
            onClick={resetLayout}
            title="Snap every manually-dragged node and Item Set box back to its computed position"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 999,
              padding: '4px 10px',
              fontSize: 12,
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
            }}
          >
            Reset layout
          </button>
        )}
      </div>
      {/* The <svg> must always be in the tree (not swapped for a "loading"
       * placeholder) — the one-time zoom-behavior effect binds to whatever
       * DOM node svgRef points to on mount, and won't retry later. */}
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ display: 'block', fontFamily: 'var(--font-sans)', cursor: dragging ? 'grabbing' : 'grab' }}
      >
        <g
          ref={zoomGRef}
          transform={`translate(${viewTransform.x}, ${viewTransform.y}) scale(${viewTransform.k})`}
        >
          {links.map((link) => (
            <path
              key={link.target.data.href}
              d={
                linkGenerator({ source: effectiveXY(link.source), target: effectiveXY(link.target) }) ??
                undefined
              }
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
                onHover={(label, clientX, clientY) =>
                  label ? setTooltip({ label, x: clientX, y: clientY }) : setTooltip(null)
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
              />
            )
          })}
        </g>
      </svg>
      {/* Centered, not tucked in a corner — this is the fetch a user is
       * most likely to actually sit and wait on (opening a whole new
       * catalog, sometimes a slow API root), so it needs to read as "the
       * app is working on it" at a glance, not a small note easy to miss:
       * "当打开一份数据的时候,常常需要加载很久,所以加载的时候需要有加载的UI,
       * 动画等等" (opening a dataset often takes a long time — loading needs
       * a real UI and an animation). */}
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
      <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--color-border)' }}>
        <div>● filled — click to expand</div>
        <div>○ hollow — expanded, or nothing to expand into</div>
        <div>┄ dashed ring — your selected Item is inside</div>
        <div>"N items" label — browse via Detail Panel, not the tree</div>
        <div>blue "API" tag — items are live-queried, not a static list</div>
        <div>drag a label (or the Item Set panel) to rearrange freely</div>
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
  /** The currently-selected Item belongs to this Collection — distinct from
   *  `selected` (this exact node is what's selected). Items are never their
   *  own tree node (see useStructureTree), so this is the only way an Item
   *  selection shows up in Structure Lens at all: a dashed ring on its
   *  Collection, not a rendered leaf. */
  containsSelection: boolean
  /** Render this node's Item Set inline, as a rich embedded box — only for
   *  the exact node currently being browsed, never every leaf-items node
   *  at once (would mean dozens of concurrent Item Set fetches/renders
   *  just because they're visible in the tree). A floating overlay, not
   *  part of the tree's own row layout (§31) — real scrollable/
   *  interactive HTML via SVG `foreignObject`, kept from fighting d3-
   *  zoom's own wheel/drag handling via native (non-React-synthetic)
   *  listeners — see docs/DESIGN.md §21. */
  showItemSetBox: boolean
  onToggle: () => void
  onSelect: () => void
  onHover: (label: string | null, clientX: number, clientY: number) => void
  /** The zoom-transformed `<g>` — passed to every `d3.drag().container()`
   *  call in this node so its coordinate math (dx/dy already correctly
   *  divided by the current zoom scale) lines up with `tree()`'s own x/y
   *  convention and `foreignObject`'s x/y attributes, without this
   *  component needing to know the current zoom scale itself at all. */
  containerRef: React.RefObject<SVGGElement | null>
  /** Called with an incremental *local* (already zoom-corrected, via
   *  d3-drag) delta while this node is being dragged — applies to this
   *  node's whole subtree, not just itself (docs/DESIGN.md §32). */
  onNodeDragBy: (dxLocal: number, dyLocal: number) => void
  /** The Item Set box's own manual drag offset, local to this node's own
   *  `<g>` — independent of the node's own position, so dragging the box
   *  doesn't move the node and vice versa. Plain (horizontal, vertical)
   *  SVG-attribute convention, matching `foreignObject`'s own x/y — not
   *  the swapped (vertical, horizontal) convention node offsets use. */
  boxOffset: { dxHoriz: number; dyVert: number }
  onBoxDragBy: (dxLocal: number, dyLocal: number) => void
}

const ITEM_SET_BOX_WIDTH = 320
// Was 220 (~3-4 visible rows in the list inside) — called out directly:
// "我们明明可能加载到上千啊,一次性只能看到3个我真的无语...我们这个项目也是需要
// 让人感受到数据的体量和数量的啊" (we can load up to thousands, but only see 3
// at once — this project needs to make people actually feel the scale of
// the data too). Sized generously enough to fit the search input, a much
// taller list (`LIST_MAX_HEIGHT` in ItemSetBrowser.tsx), and the footer
// without the box's own wrapper needing to scroll in the common case.
const ITEM_SET_BOX_HEIGHT = 760
// Extra horizontal gap between the node and its Item Set box, beyond the
// normal label offset — enough room to draw a real connecting curve (see
// the `linkGenerator` call below) rather than the box sitting flush
// against the node with no visible space to draw anything in at all.
const ITEM_SET_BOX_GAP = 60

function TreeNodeView({
  datum,
  x,
  y,
  hasRenderedChildren,
  isRoot,
  loading,
  selected,
  containsSelection,
  showItemSetBox,
  onToggle,
  onSelect,
  onHover,
  containerRef,
  onNodeDragBy,
  boxOffset,
  onBoxDragBy,
}: TreeNodeProps) {
  const itemSetBoxRef = useRef<HTMLDivElement | null>(null)

  // The label text, not the circle, is the node's drag handle — moved
  // here deliberately, not left on the circle. The circle already has a
  // strong, frequent, pre-existing job (click to expand/collapse — the
  // classic filled/hollow tidy-tree convention this project has used
  // since v0.1), and giving it a `grab` cursor on top of that muddied its
  // one clear signal: "我圆圈你挪上去了以后...那只手用于这个抓着拖拽的那只手。
  // 但是其实你也需要告诉用户这个是可以点击的...现在这个光标的这个操作还是让人
  // 非常的迷糊" (once the cursor becomes a grab hand over the circle, it no
  // longer tells the user it's also clickable to open the next level —
  // the cursor is genuinely confusing right now). The label has never had
  // a competing job — it has only ever selected, never expanded/collapsed
  // — so adding drag there doesn't create the same conflict, and it's
  // already a comfortably large target on its own (no invisible hit-area
  // trick needed, unlike the small dot). `d3.drag()` here is the standard,
  // canonical d3-zoom/d3-drag composition for "pannable canvas,
  // individually draggable elements within it" (their own docs recommend
  // exactly this pairing) — not hand-rolled pointerdown/move/up plumbing,
  // which this used to be and which had a real, confirmed bug: it only
  // stopped propagation on `pointerdown`, but nothing guarantees that's
  // the *only* event type d3-zoom's own internal listeners react to, so
  // the canvas pan and the node drag could both engage from the same
  // gesture at once — reported directly: "我觉得这个是某种程度上...很可能是
  // 由于我同时在移动画布,同时又在移动节点" (I suspect this is because I was
  // moving the canvas and the node at the same time). `zoom.filter()` (see
  // StructureTree above) now excludes anything marked `data-block-pan` at
  // the point a gesture would *start*, for whichever event type d3-zoom
  // actually listens to — this element carries that attribute instead of
  // trying to guess/cover every relevant event type by hand. d3-drag's own
  // `dx`/`dy` are already local, zoom-corrected deltas (via
  // `.container()`), so no manual division by the current zoom scale is
  // needed here either. See docs/DESIGN.md §32's update.
  const labelRef = useRef<SVGTextElement | null>(null)
  const onNodeDragByRef = useRef(onNodeDragBy)
  useEffect(() => {
    onNodeDragByRef.current = onNodeDragBy
  })

  useEffect(() => {
    const el = labelRef.current
    if (!el) return
    const behavior = drag<SVGTextElement, unknown>()
      .container(() => containerRef.current as unknown as SVGGElement)
      .on('drag', (event: D3DragEvent<SVGTextElement, unknown, unknown>) => {
        onNodeDragByRef.current(event.dx, event.dy)
      })
    const sel = select(el)
    sel.call(behavior)
    return () => {
      sel.on('.drag', null)
    }
  }, [containerRef])

  // The box's own drag handle — same `d3.drag()` pattern, simpler (no
  // click behavior to disambiguate against; the handle exists only to
  // drag).
  const boxHandleRef = useRef<HTMLDivElement | null>(null)
  const onBoxDragByRef = useRef(onBoxDragBy)
  useEffect(() => {
    onBoxDragByRef.current = onBoxDragBy
  })

  useEffect(() => {
    const el = boxHandleRef.current
    if (!el) return
    const behavior = drag<HTMLDivElement, unknown>()
      .container(() => containerRef.current as unknown as SVGGElement)
      .on('drag', (event: D3DragEvent<HTMLDivElement, unknown, unknown>) => {
        onBoxDragByRef.current(event.dx, event.dy)
      })
    const sel = select(el)
    sel.call(behavior)
    return () => {
      sel.on('.drag', null)
    }
  }, [containerRef, showItemSetBox])

  if (datum.moreCount) {
    return (
      <g transform={`translate(${y}, ${x})`}>
        <circle r={3} fill="none" strokeDasharray="2,2" style={{ stroke: 'var(--color-text-faint)' }} />
        <text x={9} y={4} fontSize={11} style={{ fill: 'var(--color-text-faint)' }}>
          +{datum.moreCount} more (not loaded)
        </text>
      </g>
    )
  }

  const { node } = datum
  // Only sub-Catalogs/Collections are structural children here — direct
  // Items never are (see useStructureTree's top-level comment), so a
  // Collection that's all Items (Capella's SLC, say) has nothing to expand
  // into; its content is reached via Item Set (Detail Panel), shown below
  // as a count, not a click-to-expand affordance. `collectionsEndpoint` is
  // the fallback discovery path for a node with no static `rel:child`
  // links at all (Microsoft Planetary Computer's root, e.g.) — expandable
  // exactly the same way once found, just fetched differently.
  const canExpand = node.childHrefs.length > 0 || !!node.collectionsEndpoint
  // Classic tidy-tree convention: filled = collapsed with more to reveal,
  // hollow = already expanded or a genuine leaf with nothing further.
  const filled = canExpand && !hasRenderedChildren

  const color = node.type === 'Catalog' ? 'var(--color-node-catalog)' : 'var(--color-node-collection)'
  const radius = node.type === 'Catalog' ? 7 : 6
  // Known count for a static link array; for an API-searched (`cursor`)
  // node the true count is unknown until queried — labeled distinctly
  // rather than showing a fake "0" or omitting the badge entirely.
  const isApiSearched = node.items.kind === 'cursor'
  const itemBadgeText =
    node.items.kind === 'links'
      ? node.items.hrefs.length > 0
        ? `${node.items.hrefs.length} item${node.items.hrefs.length === 1 ? '' : 's'}`
        : undefined
      : undefined
  // The root has nothing to its left to collide with — always label it to
  // the right, regardless of expansion state.
  const labelOnLeft = hasRenderedChildren && !isRoot
  const labelDx = labelOnLeft ? -(radius + 6) : radius + 6
  const label = node.title ?? node.id
  const labelText = truncateLabel(label)
  // Where the Item Set box's near edge (and the connecting link's target)
  // sit — past the label's own *rendered end*, not just its start
  // position, plus ITEM_SET_BOX_GAP beyond that so there's still room to
  // see the connecting curve drawn below rather than it being squeezed
  // into a few pixels.
  const labelWidth = estimateTextWidth(labelText, LABEL_FONT_SIZE)
  const boxNearX = labelOnLeft
    ? labelDx - labelWidth - ITEM_SET_BOX_GAP
    : labelDx + labelWidth + ITEM_SET_BOX_GAP
  // The "API" tag's own geometry — a small pill, not plain text, so it
  // reads as a real, distinct signal rather than something to skim past:
  // "得有一个标签也好,highlight也好什么东西,因为你看这个Stack Browser里面,它就
  // 是有一个tag在" (it needs a tag or highlight — STAC Browser has a tag for
  // this). Anchored the same direction as the label itself.
  const apiTagFontSize = 9
  const apiTagPadX = 5
  const apiTagHeight = 13
  const apiTagWidth = estimateTextWidth('API', apiTagFontSize) + apiTagPadX * 2
  const apiTagX = labelOnLeft ? labelDx - apiTagWidth : labelDx
  // Hovering anywhere on the node (not just the tag itself) surfaces the
  // fuller explanation — simpler than a second, tag-scoped hover zone, and
  // still answers the real question directly: is this one static or live?
  const tooltipText = isApiSearched
    ? `${label} — API-searched, item count unknown until queried`
    : label

  function handleCircleClick() {
    onSelect()
    if (canExpand) onToggle()
  }

  function handleEnter(e: React.MouseEvent) {
    onHover(tooltipText, e.clientX, e.clientY)
  }
  function handleMove(e: React.MouseEvent) {
    onHover(tooltipText, e.clientX, e.clientY)
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
      {/* Invisible, larger hit target — the visible dot alone (radius
       * 6-7) was reported as too small to reliably click from: "我发现
       * 能够拖拽的范围非常小,好像是只有那个圆点的周围一点点" (the clickable area
       * is really small, seems like only right around the dot). A wider,
       * transparent circle at the same center is the standard SVG pattern
       * for "small visual mark, bigger click target" (the same idea as a
       * thicker invisible stroke on a thin line for easier hovering).
       * Click-only — no drag behavior here anymore; see `labelRef` above
       * for why dragging moved to the label instead. Cursor stays a plain
       * pointer, not `grab`: this control's one job is click-to-select/
       * expand, and it should look like it. */}
      <circle
        data-block-pan="true"
        r={radius + 10}
        fill="transparent"
        style={{ cursor: 'pointer' }}
        onClick={handleCircleClick}
      />
      <circle
        r={radius}
        style={{ fill: filled ? color : 'var(--color-surface)', stroke: color, pointerEvents: 'none' }}
        strokeWidth={1.75}
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
      {!selected && containsSelection && (
        <circle
          r={radius + 4}
          fill="none"
          strokeWidth={2}
          strokeDasharray="3,2"
          style={{ stroke: 'var(--color-selection)' }}
        />
      )}
      <text
        ref={labelRef}
        data-block-pan="true"
        dx={labelDx}
        dy={4}
        textAnchor={labelOnLeft ? 'end' : 'start'}
        fontSize={LABEL_FONT_SIZE}
        fontWeight={selected ? 600 : 400}
        style={{
          fill: selected ? 'var(--color-selection)' : 'var(--color-text)',
          cursor: 'grab',
          userSelect: 'none',
        }}
        onClick={onSelect}
      >
        {labelText}
      </text>
      {loading ? (
        <>
          <Spinner size={10} color="var(--color-text-faint)" x={labelOnLeft ? labelDx - 10 : labelDx} y={11} />
          <text
            dx={labelOnLeft ? labelDx - 14 : labelDx + 14}
            dy={18}
            textAnchor={labelOnLeft ? 'end' : 'start'}
            fontSize={10}
            style={{ fill: 'var(--color-text-faint)' }}
          >
            Loading…
          </text>
        </>
      ) : (
        !showItemSetBox &&
        (isApiSearched ? (
          // A real tag, not plain gray subtext — only for the case that
          // actually needs calling out (data behind a live query, not
          // already sitting in a static file). The default/static case
          // stays as plain "N items" text below; it doesn't need a badge
          // to be unambiguous, since STAC Browser's own convention (what
          // was asked to match) tags the special case, not the default one.
          <g>
            <rect
              x={apiTagX}
              y={11}
              width={apiTagWidth}
              height={apiTagHeight}
              rx={apiTagHeight / 2}
              style={{ fill: 'var(--color-badge-api-bg)' }}
            />
            <text
              x={apiTagX + apiTagWidth / 2}
              y={11 + apiTagHeight / 2 + 3}
              textAnchor="middle"
              fontSize={apiTagFontSize}
              fontWeight={700}
              style={{ fill: 'var(--color-badge-api-text)' }}
            >
              API
            </text>
          </g>
        ) : (
          itemBadgeText && (
            <text
              dx={labelDx}
              dy={18}
              textAnchor={labelOnLeft ? 'end' : 'start'}
              fontSize={10}
              style={{ fill: 'var(--color-text-faint)' }}
            >
              {itemBadgeText}
            </text>
          )
        ))
      )}
      {showItemSetBox && (
        <>
          {/* A real edge, not just adjacent placement — drawn with the
           * same `linkGenerator` (and the same stroke) used for every
           * other parent→child connection in this tree, just fed local
           * coordinates (node at its own origin) instead of global
           * hierarchy points. The box is a floating overlay now (see the
           * `layout` useMemo above) — it doesn't participate in the tree's
           * own row layout at all, so this line is the only visual tie
           * back to the node it belongs to. */}
          <path
            d={
              // Connects to just below the box's top edge, not its
              // vertical center — `linkHorizontal`'s curve is shaped for
              // spans with real horizontal distance (normal node-to-node
              // links cross LEVEL_WIDTH); aimed at the center of a box
              // that's mostly *below* the node, the resulting bezier had
              // almost no horizontal component and rendered as an
              // invisible sliver hugging the node/box boundary. A target
              // near the top reproduces the same proportions as an
              // ordinary sibling link.
              linkGenerator({
                source: { x: 0, y: 0 },
                // Follows the box's own drag offset (docs/DESIGN.md §32) —
                // otherwise the line would stay pointing at where the box
                // *used to be* the moment it's dragged anywhere else.
                target: { x: 34 + boxOffset.dyVert, y: boxNearX + boxOffset.dxHoriz },
              }) ?? undefined
            }
            fill="none"
            style={{ stroke: 'var(--color-border)' }}
            strokeWidth={1.5}
          />
          <foreignObject
            x={(labelOnLeft ? boxNearX - ITEM_SET_BOX_WIDTH : boxNearX) + boxOffset.dxHoriz}
            y={14 + boxOffset.dyVert}
            width={ITEM_SET_BOX_WIDTH}
            height={ITEM_SET_BOX_HEIGHT}
          >
            <div
              ref={itemSetBoxRef}
              // Scrolling the list, clicking a row/button, or typing in
              // the search box inside here must never also pan the
              // canvas — `data-block-pan` is the single, central rule
              // `zoom.filter()` checks for that (see StructureTree above
              // and docs/DESIGN.md §32's update), covering wheel/mousedown/
              // touchstart uniformly instead of hand-picking event types
              // to `stopPropagation()` on.
              data-block-pan="true"
              style={{
                width: '100%',
                height: '100%',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-selection)',
                borderRadius: 'var(--radius-sm)',
                padding: 8,
                boxSizing: 'border-box',
                boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
                cursor: 'default',
                // Safety net, not the primary mechanism — the list inside
                // scrolls on its own (LIST_MAX_HEIGHT); this only kicks in
                // if the box's other content (search input, footer) ever
                // pushes the total past ITEM_SET_BOX_HEIGHT.
                overflow: 'auto',
              }}
            >
              {/* A dedicated grip, not the whole box — the box is full of
               * its own click/scroll/type targets (rows, buttons, a text
               * input), so making the entire card draggable would fight
               * all of them. Asked for directly: "我可以拖拽这个item的
               * panel...这样子自由度...就是这个样子" (I want to be able to
               * drag the item panel — that kind of freedom is what I'm
               * after). */}
              <div
                ref={boxHandleRef}
                title="Drag to move this panel"
                style={{
                  height: 14,
                  marginBottom: 6,
                  borderRadius: 999,
                  background: 'var(--color-border)',
                  opacity: 0.7,
                  cursor: 'grab',
                }}
              />
              <ItemSetBrowser node={node} />
            </div>
          </foreignObject>
        </>
      )}
    </g>
  )
}
