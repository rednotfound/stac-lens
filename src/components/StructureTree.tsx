import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { hierarchy, tree, type HierarchyPointNode } from 'd3-hierarchy'
import { linkHorizontal } from 'd3-shape'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type D3ZoomEvent } from 'd3-zoom'
import { drag, type D3DragEvent } from 'd3-drag'
import { useStructureTree, type TreeDatum } from '../hooks/useStructureTree'
import { useSelectionStore } from '../store/selection'
import { loader } from '../stac/loaderInstance'
import { classifyNodeShape, type StacNode } from '../stac/types'
import { LinksItemSetBrowser } from './LinksItemSetBrowser'
import { CursorItemSetPanels } from './CursorItemSetPanels'
import { Spinner } from './Spinner'
import { TypeIcon, type StacObjectKind } from './TypeIcon'
import { isInlinePreviewAsset } from '../stac/assets'

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

/** `[text](url)` → `text` — real STAC descriptions are markdown, and a
 *  link's raw `url` is dead weight in a short hover snippet specifically
 *  (see `HoverInfo.description`'s own comment). Only link syntax, not a
 *  general markdown renderer — bold/italic/etc. read fine as plain
 *  asterisks in a one-line snippet and aren't worth a heavier pass. */
function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
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

/** One box's full drag/resize geometry — used identically for the
 *  single-box (static catalog) case and each of the two independent boxes
 *  (Search/Results) a cursor-mode node gets instead. */
interface BoxGeometry {
  offset: { dxHoriz: number; dyVert: number }
  onDragBy: (dxLocal: number, dyLocal: number) => void
  size: { width: number; height: number }
  onResizeBy: (dxLocal: number, dyLocal: number) => void
}

/** One box's own drag-to-move and drag-to-resize handles — factored out so
 *  a cursor-mode node can set this up twice (Search + Results) with the
 *  exact same behavior a static catalog's single box already had, instead
 *  of duplicating the `d3.drag()` wiring inline for each. `showItemSetBox`
 *  re-binds when the box (re)mounts, same as the original single-box
 *  version did; `labelOnLeftRef` is shared across every box on a node —
 *  which edge is "near" the node doesn't differ per box. */
function useBoxDragHandles(
  containerRef: React.RefObject<SVGGElement | null>,
  showItemSetBox: boolean,
  onDragBy: (dxLocal: number, dyLocal: number) => void,
  onResizeBy: (dxLocal: number, dyLocal: number) => void,
  labelOnLeftRef: React.RefObject<boolean>,
) {
  const boxHandleRef = useRef<HTMLDivElement | null>(null)
  const resizeHandleRef = useRef<HTMLDivElement | null>(null)
  const onDragByRef = useRef(onDragBy)
  useEffect(() => {
    onDragByRef.current = onDragBy
  })
  const onResizeByRef = useRef(onResizeBy)
  useEffect(() => {
    onResizeByRef.current = onResizeBy
  })

  useEffect(() => {
    const el = boxHandleRef.current
    if (!el) return
    const behavior = drag<HTMLDivElement, unknown>()
      .container(() => containerRef.current as unknown as SVGGElement)
      .on('drag', (event: D3DragEvent<HTMLDivElement, unknown, unknown>) => {
        onDragByRef.current(event.dx, event.dy)
      })
    const sel = select(el)
    sel.call(behavior)
    return () => {
      sel.on('.drag', null)
    }
  }, [containerRef, showItemSetBox])

  useEffect(() => {
    const el = resizeHandleRef.current
    if (!el) return
    const behavior = drag<HTMLDivElement, unknown>()
      .container(() => containerRef.current as unknown as SVGGElement)
      .on('drag', (event: D3DragEvent<HTMLDivElement, unknown, unknown>) => {
        const dx = labelOnLeftRef.current ? -event.dx : event.dx
        onResizeByRef.current(dx, event.dy)
      })
    const sel = select(el)
    sel.call(behavior)
    return () => {
      sel.on('.drag', null)
    }
    // `labelOnLeftRef` is a ref object — its identity never changes across
    // renders (only `.current` does, read fresh on every drag event via
    // the closure above), so omitting it here is safe, same as every other
    // ref-only omission already in this file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, showItemSetBox])

  return { boxHandleRef, resizeHandleRef }
}

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

/** What a hovered node's tooltip actually needs to show — more than just
 *  its label, asked for directly: "hover的任何一个结点的时候可以给更多的信息！
 *  比如type之类的，如果有缩略图，就应该在hover里面也出现缩略图" (hovering any
 *  node should show more information — its type, and a thumbnail if one
 *  exists). `type` is always `Catalog`/`Collection` here (the only two
 *  kinds Structure Lens ever renders as tree nodes), reusing `TypeIcon`'s
 *  own type so the tooltip's icon matches the same glyph shown everywhere
 *  else for that type (Inspector's title, the Legend). */
interface HoverInfo {
  type: StacObjectKind
  title: string
  /** A short prefix of this node's own `description` — hovering should
   *  tell you what's actually inside before you commit to clicking in:
   *  "hover的目的是为了让人快速理解这里面可能有什么，所以，难道不应该也给一些
   *  介绍在里面么" (the whole point of hovering is to quickly understand
   *  what might be inside — shouldn't it show a description too?). Markdown
   *  *link* syntax specifically gets stripped to its link text before
   *  truncating (`stripMarkdownLinks`) — found directly while verifying
   *  against a real fixture (Planetary Computer's Sentinel-2 L2A): a
   *  `[Sentinel-2](https://sentinel.esa.int/...)` link ate most of the
   *  truncation budget on a raw URL, actively working against "understand
   *  this quickly." Inspector's own Description field still shows the
   *  untouched source text — full source fidelity matters more there than
   *  in a glanceable hover snippet, so this is a deliberately scoped
   *  exception, not a general markdown-rendering pass. */
  description?: string
  note?: string
  /** This node's own `assets.thumbnail`, if it has a browser-renderable one
   *  — same `isInlinePreviewAsset` check Inspector's own preview image
   *  uses, so "does this show a thumbnail" is answered identically in both
   *  places rather than by a second, looser heuristic here. Real, not
   *  hypothetical: confirmed directly against Microsoft Planetary
   *  Computer's own Collections, which carry exactly this. */
  thumbnailHref?: string
}

interface TooltipState extends HoverInfo {
  x: number
  y: number
}

/** Horizontal curved tree, panned/zoomed with d3-zoom (drag to pan, wheel/
 *  pinch to zoom — no sliders). d3 only owns the gesture math; every node
 *  and link is still plain React/SVG so click/hover stay ordinary React
 *  event handlers. */
export function StructureTree({ rootHref }: { rootHref: string }) {
  const { root, toggle, collapseAll, expandAllCatalogs, isLoading, rootError } = useStructureTree(rootHref)
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
  // The currently-open Item Set box is portaled here (a dedicated `<g>`
  // rendered *last* inside the zoomed canvas, after every node/link) so it
  // always paints on top of the rest of the tree, regardless of where its
  // owning node falls in `nodes`' own traversal order — real, reported
  // confusion: "items panel在有的collection 点之前 在有的之后" (the panel
  // ends up in front of some Collection dots, behind others), since SVG
  // paints purely in document order and the box previously rendered inline
  // as part of its own node's `<g>`, wherever that node happened to fall
  // in the array relative to whatever else visually overlapped it. A
  // *state* (not a plain ref) — a plain ref read during another
  // component's render wouldn't be attached yet on the very first pass
  // (refs commit after the whole tree does), so nothing could portal into
  // it until some *later*, unrelated re-render happened to occur; a
  // callback ref triggers exactly the state update needed to retry once
  // the target genuinely exists — same class of fix as `useElementSize`
  // (§44) and the timeline's own wheel listener (§61).
  const [boxLayer, setBoxLayer] = useState<SVGGElement | null>(null)

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
  // The Item Set box's own size, independently per node (same reasoning as
  // `boxOffsets`) — defaults wide enough for Temporal/Spatial to actually
  // be legible from the start, not just the List view: "明显显示时间和显示
  // 地图的部分是要更宽的panel，我宁愿你开始就给我很宽的panel，然后我可以自动拖拽
  // 右下角来改变panel的尺寸" (the Temporal/Spatial views clearly need a wider
  // panel — I'd rather it start wide, and let me drag the bottom-right
  // corner myself to resize it).
  const [boxSizes, setBoxSizes] = useState<Map<string, { width: number; height: number }>>(new Map())
  // An API-backed (`cursor`-mode) node's box splits into two genuinely
  // separate `foreignObject`s instead of one — a real, distinct
  // node-editor-style pair, not two `<div>`s sharing one box: "我指的是有
  // 纯粹的两个独立的foreignObject,一个是Search,一个是result" (I mean two
  // literally separate foreignObjects — one Search, one Result). Same
  // per-node-keyed-Map pattern as `boxOffsets`/`boxSizes` above, just one
  // more independent pair for each of the two boxes. A static catalog's
  // single box is entirely unaffected — `boxOffsets`/`boxSizes` above still
  // own that case exactly as before.
  const [searchBoxOffsets, setSearchBoxOffsets] = useState<Map<string, { dxHoriz: number; dyVert: number }>>(new Map())
  const [searchBoxSizes, setSearchBoxSizes] = useState<Map<string, { width: number; height: number }>>(new Map())
  const [resultsBoxOffsets, setResultsBoxOffsets] = useState<Map<string, { dxHoriz: number; dyVert: number }>>(
    new Map(),
  )
  const [resultsBoxSizes, setResultsBoxSizes] = useState<Map<string, { width: number; height: number }>>(new Map())

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

  /** Builds one box's `BoxGeometry` against an arbitrary offset/size Map
   *  pair — the Search and Results boxes are otherwise identical in shape
   *  to the original single-box case, just each keeping their own
   *  independent Map instead of sharing `boxOffsets`/`boxSizes`. */
  function makeBoxGeometry(
    href: string,
    offsets: Map<string, { dxHoriz: number; dyVert: number }>,
    setOffsets: React.Dispatch<React.SetStateAction<Map<string, { dxHoriz: number; dyVert: number }>>>,
    defaultOffset: { dxHoriz: number; dyVert: number },
    sizes: Map<string, { width: number; height: number }>,
    setSizes: React.Dispatch<React.SetStateAction<Map<string, { width: number; height: number }>>>,
    defaultSize: { width: number; height: number },
    minWidth: number,
    minHeight: number,
  ): BoxGeometry {
    return {
      offset: offsets.get(href) ?? defaultOffset,
      onDragBy: (dxLocal, dyLocal) => {
        setOffsets((prev) => {
          const next = new Map(prev)
          const base = prev.get(href) ?? defaultOffset
          next.set(href, { dxHoriz: base.dxHoriz + dxLocal, dyVert: base.dyVert + dyLocal })
          return next
        })
      },
      size: sizes.get(href) ?? defaultSize,
      onResizeBy: (dxLocal, dyLocal) => {
        setSizes((prev) => {
          const next = new Map(prev)
          const base = prev.get(href) ?? defaultSize
          next.set(href, {
            width: Math.max(minWidth, base.width + dxLocal),
            height: Math.max(minHeight, base.height + dyLocal),
          })
          return next
        })
      },
    }
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

  const nodes = useMemo(() => (layout?.descendants() ?? []) as HierarchyPointNode<TreeDatum>[], [layout])
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
  // only once per distinct *pan target*, so it doesn't fight a manual pan.
  //
  // Keyed on `panHref` (the Collection actually being centered on), not
  // `selectedHref` itself — a real, reported bug: clicking through several
  // Items in the same already-open, already-visible Item Set box re-panned
  // the canvas on *every single click*, since each Item has its own distinct
  // `selectedHref` even though the same Collection (and the same box) stays
  // on screen the whole time: "不知道为什么，我选择了一个item的瞬间，画面又会
  // 移动，我感觉是之前开发的功能的残留" (I don't know why, but the instant I
  // select an Item the view moves again — feels like a leftover from an
  // earlier feature). It was exactly that: this effect predates Item Set
  // living inline in the tree at all, from when a selection could only ever
  // arrive from a genuinely separate Time/Space Lens panel — panHref (not
  // selectedHref) was already the right unit of "distinct selection" the
  // comment above described; the guard just never matched it.
  useEffect(() => {
    if (!selectedHref) return
    // An Item selection has no tree node of its own to find — pan to the
    // Collection that contains it instead.
    const panHref = browsingHref ?? selectedHref
    if (panHref === lastCenteredRef.current) return
    const target = nodes.find((n) => n.data.href === panHref)
    const svgSel = svgSelRef.current
    const behavior = zoomBehaviorRef.current
    const svgEl = svgRef.current
    if (!target || !svgSel || !behavior || !svgEl) return

    // Skip the pan entirely if the target is already comfortably on
    // screen — a real, reported bug: normal exploration (clicking through
    // several already-visible sibling Collections one after another, just
    // to compare them) yanked the whole canvas on *every single click*,
    // confirmed directly by reading the tree's own `transform` attribute
    // change after each click even though none of the clicked nodes ever
    // left the viewport: "每次选中了collection对象之后tree view也还会调整
    // 视野...这种移动视野会影响我的操作和探索的连续性" (every time I select a
    // Collection the tree view still adjusts, and that movement disrupts
    // the continuity of my browsing). This effect's own comment already
    // named its actual purpose — bringing a selection *panned far outside
    // the current view* (arriving from Time/Space Lens, or not yet
    // expanded into view) back on screen — but the implementation never
    // actually checked "is it already visible," so it recentered
    // unconditionally on every distinct selection, including ones the
    // user had just clicked directly because they could already see them.
    // Using the *current* transform (before any change below) to project
    // the target's real screen position and comparing it against the
    // viewport is what actually distinguishes "genuinely off-screen,
    // needs to be brought into view" from "already exactly where the user
    // is looking."
    const currentTransform = viewTransformRef.current
    const targetPos = effectiveXY(target)
    const currentScreenX = currentTransform.x + targetPos.y * currentTransform.k
    const currentScreenY = currentTransform.y + targetPos.x * currentTransform.k
    const VISIBILITY_MARGIN = 100

    // When this target has its own open Item Set box, "already visible"
    // has to mean "the box's own side has real room too," not just "the
    // bare node isn't touching an edge" — a real, confirmed bug found
    // *because* the plain node-visibility check above already passed for
    // a node that was nowhere near any edge, yet its box (needing several
    // hundred px, not the ~100px this check has always used) still
    // drifted straight past the Structure/Inspector boundary into
    // Inspector's own screen region: "现在会出现一个框，这个框就会框住我选择的
    // 那个Collection和我的目标的这个Panel" (a frame shows up now, framing
    // both the Collection I selected and my target panel). The two checks
    // were previously unrelated — this one could short-circuit before the
    // box-fitting bias below (`BOX_SIDE_MARGIN`) ever even ran once, on
    // any node that happened to satisfy the generic 100px margin alone.
    // Sized to the box's own actual current width (its last manual
    // resize, or the default) plus a little breathing room, not a flat
    // guess — the box's real default width doubled to 640 (§59) well
    // after this margin was first tuned at 140, and was never revisited.
    const targetLabelOnLeft = !!target.children && target.depth !== 0
    const hasOpenBox = boxHref === panHref
    // A cursor-mode node's "box" is really two independent ones (Search +
    // Results, see the two-`foreignObject` split below) — both anchor
    // horizontally off the same side of the node, so the wider of the two
    // is what actually determines how much side room is needed.
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
    // Bias the pan so the node sits near whichever edge is *away* from its
    // box, leaving the box's own side the full remaining width to render
    // in — same `BOX_SIDE_MARGIN` computed above, so the target this pan
    // aims for and the check that decided a pan was even needed always
    // agree on how much room the box actually requires.
    const cx = hasOpenBox
      ? targetLabelOnLeft
        ? Math.max(svgEl.clientWidth - BOX_SIDE_MARGIN, svgEl.clientWidth / 2)
        : Math.min(BOX_SIDE_MARGIN, svgEl.clientWidth / 2)
      : svgEl.clientWidth / 2
    // `targetPos` (the *effective*, not raw layout, position — a manually-
    // dragged node's on-screen location can differ from what `tree()`
    // computed for it, §32) was already computed above for the visibility
    // check; centering follows the same value.
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
        {(dragOffsets.size > 0 ||
          boxOffsets.size > 0 ||
          boxSizes.size > 0 ||
          searchBoxOffsets.size > 0 ||
          searchBoxSizes.size > 0 ||
          resultsBoxOffsets.size > 0 ||
          resultsBoxSizes.size > 0) && (
          <button
            onClick={resetLayout}
            title="Snap every manually-dragged node and Item Set box back to its computed position/size"
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
          {/* Rendered last within this same zoomed/panned group — see
           * `boxLayer` above — so whichever node's box is currently open
           * portals its content here and always paints above every
           * ordinary node/link, on top by construction rather than by
           * traversal-order coincidence. */}
          {/* `outline: 'none'` here, not (only) on the per-node `<g>`
           * portaled inside it — confirmed directly (`document.
           * activeElement` read right after clicking a plain `onClick`
           * `<div>` row inside the box) that Chrome's click-to-focus
           * fallback, when the actual click target isn't natively
           * focusable, lands on *this* outer layer `<g>`, not the inner
           * one — Chrome draws its own default focus ring there
           * (`outlineStyle: 'auto'`), which is the exact "frame" reported:
           * "这个框正好是一个G标签的范围" (this frame exactly matches a <g>
           * tag's bounds). Firefox never focuses anything here for the
           * same click, which is why this was never visible there. */}
          <g ref={setBoxLayer} style={{ outline: 'none' }} />
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
      {tooltip && <NodeTooltip tooltip={tooltip} />}
    </div>
  )
}

const TOOLTIP_WIDTH = 240
const TOOLTIP_THUMBNAIL_HEIGHT = 140
// Long enough for a real, useful snippet (STAC descriptions run to whole
// paragraphs — confirmed directly against Planetary Computer's own
// Sentinel-2 L2A Collection, 475 real characters) without turning the
// tooltip into the full Inspector field it's deliberately not trying to
// replace.
const TOOLTIP_DESCRIPTION_MAX_CHARS = 160

/** A separate component (not inlined at the call site) mainly for the
 *  viewport clamp below — a thumbnail (or now, a longer description) can
 *  make this tooltip tall enough to run off the bottom/right edge near a
 *  screen's edge, which a fixed `cursor + offset` position (the tooltip's
 *  original, title-only behavior) never had to account for. */
function NodeTooltip({ tooltip }: { tooltip: TooltipState }) {
  const estHeight =
    34 +
    (tooltip.description ? 46 : 0) +
    (tooltip.note ? 16 : 0) +
    (tooltip.thumbnailHref ? TOOLTIP_THUMBNAIL_HEIGHT + 8 : 0)
  const margin = 8
  let left = tooltip.x + 14
  let top = tooltip.y + 12
  if (left + TOOLTIP_WIDTH > window.innerWidth - margin) left = tooltip.x - TOOLTIP_WIDTH - 14
  if (top + estHeight > window.innerHeight - margin) top = tooltip.y - estHeight - 12
  left = Math.max(margin, left)
  top = Math.max(margin, top)

  return (
    <div
      style={{
        position: 'fixed',
        left,
        top,
        width: TOOLTIP_WIDTH,
        background: 'var(--color-text)',
        color: 'var(--color-bg)',
        padding: '6px 10px',
        borderRadius: 'var(--radius-sm)',
        fontSize: 12,
        pointerEvents: 'none',
        zIndex: 10,
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          opacity: 0.7,
        }}
      >
        <TypeIcon type={tooltip.type} size={11} color="var(--color-bg)" />
        {tooltip.type}
      </div>
      <div style={{ marginTop: 3, fontWeight: 600 }}>{tooltip.title}</div>
      {tooltip.description && (
        <div style={{ marginTop: 3, opacity: 0.85, fontSize: 11, lineHeight: 1.4 }}>{tooltip.description}</div>
      )}
      {tooltip.note && <div style={{ marginTop: 3, opacity: 0.75, fontSize: 11 }}>{tooltip.note}</div>}
      {tooltip.thumbnailHref && (
        <img
          src={tooltip.thumbnailHref}
          alt=""
          style={{
            display: 'block',
            marginTop: 6,
            width: '100%',
            maxHeight: TOOLTIP_THUMBNAIL_HEIGHT,
            objectFit: 'cover',
            borderRadius: 'var(--radius-sm)',
          }}
        />
      )}
    </div>
  )
}

const LEGEND_OPEN_STORAGE_KEY = 'stac-lens.legend-open'

/** Reads once at mount, not in a `useState` initializer that reruns on
 *  every remount — same idea, just factored out so both the read (here)
 *  and the write (`setLegendOpen`) below share one key. */
function readStoredLegendOpen(): boolean {
  try {
    const stored = localStorage.getItem(LEGEND_OPEN_STORAGE_KEY)
    return stored === null ? true : stored === 'true'
  } catch {
    return true
  }
}

function Legend() {
  // Starts open the first time, not collapsed to a small preview button —
  // the whole point of a legend is to orient someone immediately: "图例面板
  // 其实一开始就可以是打开的，这样让大家很直观地明白各个节点是什么" (the legend
  // panel could just start open, so everyone immediately understands what
  // each node means). Still closeable (below) for anyone who'd rather
  // reclaim the screen space once they already know the vocabulary — and
  // once closed, it stays closed across reloads (localStorage), since
  // re-opening it unasked every visit was reported as just annoying once
  // someone's already seen it: "看过一次...其实很烦，最好让...记住这个图例".
  const [open, setOpenState] = useState(readStoredLegendOpen)

  function setOpen(next: boolean) {
    setOpenState(next)
    try {
      localStorage.setItem(LEGEND_OPEN_STORAGE_KEY, String(next))
    } catch {
      // Storage unavailable (private browsing, disabled site data, etc.) —
      // the toggle still works for this session, it just won't persist.
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Show legend"
        style={{
          position: 'absolute',
          bottom: 10,
          left: 10,
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
        // Bottom-left, not top-right — asked for directly: "图例应该放在左下
        // 角，不影响重要的信息呈现" (the legend should sit in the bottom-left
        // corner, so it doesn't get in the way of important content). The
        // tree's own nodes fan out from the left toward the right/down, and
        // an open Item Set box (§66) now always paints above everything —
        // top-right sat squarely in the path of both; bottom-left has no
        // other overlay claiming it (top-left holds the "Collapse"/"Expand
        // all" buttons).
        bottom: 10,
        left: 10,
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
      <LegendRow icon="Catalog" color="var(--color-node-catalog)" label="Catalog" />
      <LegendRow icon="Collection" color="var(--color-node-collection)" label="Collection" />
      {/* Item and Asset never appear as their own tree nodes (see
       * useStructureTree's own top-level comment) — shown here anyway, next
       * to the same two real dot colors above, so the legend doubles as the
       * one place that teaches all four icons at once, matching how they
       * already show up together in Inspector (title icon + colored border,
       * each Asset row's own icon): "我们的图例里面是不是可以加入icon，让人更好
       * 识别呢" (could we add icons to the legend too, to help people
       * recognize things better?). No dot swatch for these two — a dot here
       * would falsely imply a tree node color that doesn't exist. */}
      <LegendRow icon="Item" color="var(--color-node-item)" label="Item (Detail Panel only)" showDot={false} />
      <LegendRow icon="Asset" color="var(--color-node-asset)" label="Asset (Detail Panel only)" showDot={false} />
      <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--color-border)' }}>
        <div>● filled — has something to open (children or items)</div>
        <div>○ hollow — already open, or genuinely empty</div>
        <div>┄ dashed ring — your selected Item is inside</div>
        <div>"N items" label — browse via Detail Panel, not the tree</div>
        <div>blue "API" tag — items are live-queried, not a static list</div>
        <div>drag a label (or the Item Set panel) to rearrange freely</div>
      </div>
    </div>
  )
}

function Dot({ color }: { color: string }) {
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
}

function LegendRow({
  icon,
  color,
  label,
  showDot = true,
}: {
  icon: StacObjectKind
  color: string
  label: string
  /** Off for Item/Asset — neither is ever a real tree-node dot color (see
   *  the call sites above), so showing one here would falsely suggest a
   *  tree color that doesn't exist. */
  showDot?: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {showDot && (
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: color,
            display: 'inline-block',
          }}
        />
      )}
      <TypeIcon type={icon} size={12} color={color} />
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
  onHover: (info: HoverInfo | null, clientX: number, clientY: number) => void
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
  boxSize: { width: number; height: number }
  onBoxResizeBy: (dxLocal: number, dyLocal: number) => void
  /** Only meaningful when `node.items.kind === 'cursor'` — a static
   *  catalog's single box is fully owned by `boxOffset`/`boxSize`/
   *  `onBoxDragBy`/`onBoxResizeBy` above, unchanged. An API-backed node
   *  instead gets two independent boxes (two real `foreignObject`s, not
   *  two `<div>`s in one — see this file's own render logic below), each
   *  with the exact same shape of geometry state as the single-box case. */
  searchBox: BoxGeometry
  resultsBox: BoxGeometry
  /** Where this node's own box (connector + `foreignObject`) actually gets
   *  rendered, via a portal, instead of inline in this node's own `<g>` —
   *  see the `boxLayer` state in the parent for why. `null` for the one
   *  render before that `<g>` has mounted; this node's box simply doesn't
   *  render for that one frame rather than briefly rendering in the wrong
   *  (unlayered) place. */
  boxLayer: SVGGElement | null
}

// Was 220 (~3-4 visible rows in the list inside) — called out directly:
// "我们明明可能加载到上千啊,一次性只能看到3个我真的无语...我们这个项目也是需要
// 让人感受到数据的体量和数量的啊" (we can load up to thousands, but only see 3
// at once — this project needs to make people actually feel the scale of
// the data too). Then widened again once Item Set gained real Temporal/
// Spatial views (§58): a timeline/map needs real horizontal room to be
// legible, not just enough for a list of id/title rows — "我宁愿你开始就给我
// 很宽的panel" (I'd rather it start wide from the beginning). Both are now
// just the *default* — the box is freely resizable per node (below).
const DEFAULT_BOX_WIDTH = 640
const DEFAULT_BOX_HEIGHT = 760
// Small enough to still show a few list rows or a minimal plot, not so
// small the box becomes useless — a resize past this snaps back rather
// than shrinking further.
const MIN_BOX_WIDTH = 320
const MIN_BOX_HEIGHT = 320
// Extra horizontal gap between the node and its Item Set box, beyond the
// normal label offset — enough room to draw a real connecting curve (see
// the `linkGenerator` call below) rather than the box sitting flush
// against the node with no visible space to draw anything in at all.
const ITEM_SET_BOX_GAP = 60

// A cursor-mode node's Search box only ever holds a date range/sort/draw
// controls row plus a one-line applied-filter summary — genuinely less
// content than the combined box ever needed, so its own default height is
// much shorter, not the full `DEFAULT_BOX_HEIGHT`. Results keeps that
// original full-size default (unchanged): once a search actually runs, its
// List/Time & Space content needs exactly the same room the old combined
// box did.
const DEFAULT_SEARCH_BOX_WIDTH = 640
const DEFAULT_SEARCH_BOX_HEIGHT = 180
const DEFAULT_RESULTS_BOX_WIDTH = 640
const DEFAULT_RESULTS_BOX_HEIGHT = 760
// Vertical gap between the Search box's default bottom edge and the
// Results box's default top edge — enough to draw a visible connecting
// curve between them (see `RESULTS_CONNECTOR_TARGET_INSET` below), the
// same reasoning as `ITEM_SET_BOX_GAP` for the node→box connector.
const SEARCH_RESULTS_GAP = 40
// The Results box's own default offset — positioned below the Search box
// by default (not `ZERO_BOX_OFFSET`, unlike the node→box case, since
// there's no separate anchor to derive "below" from other than the Search
// box's own default height). Both boxes stay independently draggable after
// this — it's a starting position, not a constraint.
const DEFAULT_RESULTS_BOX_OFFSET = { dxHoriz: 0, dyVert: DEFAULT_SEARCH_BOX_HEIGHT + SEARCH_RESULTS_GAP }
// A Search box has much less natural content than Results — flooring its
// resize at the same 320px as Results would leave a large, mostly-empty
// card if someone actually drags it down that far.
const MIN_SEARCH_BOX_HEIGHT = 90
// Same "a bit into the box, near its own drag handle" convention as the
// node→box connector's own target inset (14 + 20 = 34, see below) — used
// for the Search→Results connector's target point on the Results box.
const BOX_CONNECTOR_TARGET_INSET = 20

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
  boxSize,
  onBoxResizeBy,
  searchBox,
  resultsBox,
  boxLayer,
}: TreeNodeProps) {
  const itemSetBoxRef = useRef<HTMLDivElement | null>(null)
  // A cursor-mode node's Results box is a second, independent box — its
  // own ref, checked alongside `itemSetBoxRef` by `isInsideItemSetBox`
  // below, so hovering either box (not just the Search one, which reuses
  // `itemSetBoxRef`) correctly suppresses this node's own tooltip.
  const resultsBoxRef = useRef<HTMLDivElement | null>(null)
  // Portal targets for the Search/Results panel *content* specifically —
  // `CursorItemSetPanels` (mounted once both exist) portals its two pieces
  // of rendered content into these, so the one shared hook state it owns
  // (the query, the paged results) can back two physically separate
  // `foreignObject`s at once. Same callback-ref-into-state pattern as
  // `boxLayer` above (a plain ref read during another component's render
  // wouldn't be attached yet on the very first pass).
  const [searchTargetEl, setSearchTargetEl] = useState<HTMLDivElement | null>(null)
  const [resultsTargetEl, setResultsTargetEl] = useState<HTMLDivElement | null>(null)
  // Computed early (not just where the label itself renders, further
  // down) — the resize-handle effect below needs it too, to know which
  // direction the box actually grows in.
  const labelOnLeft = hasRenderedChildren && !isRoot

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

  // Tracks an actual drag gesture in progress on *this* label specifically
  // (not the canvas-wide `dragging` state above, which is d3-zoom's own pan
  // — a different gesture entirely) — the label's cursor should read
  // `pointer` until a real drag starts, not `grab` the whole time: "更重要
  // 的是点击功能,应该让人知道这里可以点,而不是抓手形状的光标" (the more
  // important thing is the click — the cursor should say "you can click
  // here," not show a grab hand). The same tension the circle itself used
  // to have (see this component's own top comment) has simply moved to the
  // label now that drag lives here instead — same fix, applied here too:
  // don't let the drag affordance's cursor upstage the primary click
  // action's own signal.
  const [labelDragging, setLabelDragging] = useState(false)

  useEffect(() => {
    const el = labelRef.current
    if (!el) return
    const behavior = drag<SVGTextElement, unknown>()
      .container(() => containerRef.current as unknown as SVGGElement)
      .on('start', () => setLabelDragging(true))
      .on('drag', (event: D3DragEvent<SVGTextElement, unknown, unknown>) => {
        onNodeDragByRef.current(event.dx, event.dy)
      })
      .on('end', () => setLabelDragging(false))
    const sel = select(el)
    sel.call(behavior)
    return () => {
      sel.on('.drag', null)
    }
  }, [containerRef])

  // `labelOnLeft` determines which of the box's own edges is actually
  // fixed (see the `x` formula on the foreignObject below): when the box
  // sits to the *left* of its node, its near/right edge is what's pinned
  // and it grows further left as width increases — so a corner handle
  // sitting at the box's own visual right edge needs the mouse's
  // rightward motion to *shrink* width there, the mirror image of the
  // normal (box-on-the-right) case. Tracked in a ref, not just read from
  // the outer closure, so the drag callback (bound once per
  // `containerRef`/`showItemSetBox` change) always sees the current side
  // even if it flips while the box stays open. Shared across every box on
  // this node — which edge is "near" doesn't differ per box.
  const labelOnLeftRef = useRef(labelOnLeft)
  useEffect(() => {
    labelOnLeftRef.current = labelOnLeft
  })

  // The single box (static catalogs) and each of the two independent boxes
  // a cursor-mode node gets instead (Search/Results) all share the exact
  // same drag-to-move/drag-to-resize handle behavior — see
  // `useBoxDragHandles`. Called unconditionally, same as every other Hook
  // here (rules of Hooks) — a links-mode node's `searchBox`/`resultsBox`
  // handles simply never attach to any real DOM element, since that
  // node's render below never mounts those two `foreignObject`s at all.
  const mainBoxHandles = useBoxDragHandles(containerRef, showItemSetBox, onBoxDragBy, onBoxResizeBy, labelOnLeftRef)
  const searchBoxHandles = useBoxDragHandles(
    containerRef,
    showItemSetBox,
    searchBox.onDragBy,
    searchBox.onResizeBy,
    labelOnLeftRef,
  )
  const resultsBoxHandles = useBoxDragHandles(
    containerRef,
    showItemSetBox,
    resultsBox.onDragBy,
    resultsBox.onResizeBy,
    labelOnLeftRef,
  )

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
  const canExpand = node.childHrefs.length > 0 || !!node.collectionsEndpoint || !!node.childrenEndpoint
  // Classic tidy-tree convention, extended: filled = there's something
  // behind this circle you haven't opened yet (either tree children, or —
  // since a leaf-items node has no children to expand at all — its own
  // Item Set box), hollow = already opened, or a genuine dead end with
  // neither. Real gap found and reported directly: a leaf-items Collection
  // with real content (Female Empowerment Index Collection, 22 real
  // Items) read identically hollow to a totally empty leaf, the only
  // difference being the much-lower-salience "N items" caption beneath it
  // — "我以为这里得是filled的状态" (I expected this to be filled). Tracking
  // "already opened" for the item-box half isn't sticky the way expanded
  // tree children are (which stay revealed even after you look away) —
  // it directly mirrors `showItemSetBox` instead, so browsing elsewhere
  // and coming back does show filled again, deliberately: chosen over a
  // separate "ever opened" record for the honest reason that it reflects
  // "is this open right now," not a permanent memory, and needs no new
  // per-node state to do it.
  const filled = (canExpand && !hasRenderedChildren) || (hasDirectItems(node) && !showItemSetBox)

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
  // the right, regardless of expansion state. (`labelOnLeft` itself is
  // computed earlier in this component — the resize-handle effect above
  // needs it too.)
  const labelDx = labelOnLeft ? -(radius + 6) : radius + 6
  const label = node.title ?? node.id
  const labelText = truncateLabel(label)
  // Where the Item Set box's near edge (and the connecting link's target)
  // sit — past the label's own *rendered end*, not just its start
  // position, plus ITEM_SET_BOX_GAP beyond that so there's still room to
  // see the connecting curve drawn below rather than it being squeezed
  // into a few pixels.
  const labelWidth = estimateTextWidth(labelText, LABEL_FONT_SIZE)
  const boxNearX = labelOnLeft ? labelDx - labelWidth - ITEM_SET_BOX_GAP : labelDx + labelWidth + ITEM_SET_BOX_GAP

  // No clamping against Structure Lens's own visible column at all,
  // neither the box's position nor its size, default or manually resized
  // — two earlier, progressively lighter versions of this (§72's full
  // reposition+shrink clamp, §82's default-width-only cap) were both
  // removed at the user's own explicit, repeated direction. §72's own
  // clamp was built for a reported "frame" bug that turned out (§73) to
  // be an unrelated Chrome focus-outline artifact, not real overflow.
  // §82's lighter cap fixed a real, confirmed problem (a still-default
  // box's own controls landing unreachable under Inspector at an ordinary
  // window width) — but it recomputed live from the current pan position,
  // so simply dragging the canvas (moving a node's screen position closer
  // to Inspector) visibly shrank an already-open box in real time, which
  // read as distracting, over-eager behavior in its own right: "当我们拖拽
  // 画布空白的地方的时候...这两个panel跟右侧的inspector这个交互的时候,它会把
  // 那个panel的size,宽度变短嘛。这个真的是有必要的吗?在我看来,不这么做问题也
  // 不大,因为用户可以自己去拖小啊" (when we drag the canvas, these two
  // panels shrink as they get near Inspector — is that really necessary?
  // I don't think it's a big problem without it, since the user can just
  // resize them down themselves). A box now always renders at exactly its
  // own stored default or manually-set size, full stop, regardless of
  // where it currently sits on screen — Inspector's own `<div>` (a later
  // DOM sibling, painted after Structure Lens's) visually covers whatever
  // overlaps it, which both quotes above accept as the right tradeoff.
  // The Search box's own left edge and horizontal center, in local
  // (node-relative) coordinates — needed by the Search→Results connector
  // below, which draws from *the Search box itself*, not the node, so it
  // has to know where that box currently, actually is (after its own drag
  // offset).
  const searchBoxLeftX = (labelOnLeft ? boxNearX - searchBox.size.width : boxNearX) + searchBox.offset.dxHoriz
  const resultsBoxLeftX = (labelOnLeft ? boxNearX - resultsBox.size.width : boxNearX) + resultsBox.offset.dxHoriz
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
  const previewAsset = node.assets.find(isInlinePreviewAsset)
  const hoverInfo: HoverInfo = {
    type: node.type,
    title: label,
    description: node.description
      ? truncateLabel(stripMarkdownLinks(node.description), TOOLTIP_DESCRIPTION_MAX_CHARS)
      : undefined,
    note: isApiSearched ? 'API-searched — item count unknown until queried' : undefined,
    thumbnailHref: previewAsset?.href,
  }

  // Shared by both the circle and the label now — previously the label's
  // own click only selected (`onSelect()`), never expanded/collapsed,
  // which meant "click the name" behaved differently depending on the
  // node: a Collection with direct Items *looked* like clicking its name
  // opened the next level (selecting it happens to open its inline Item
  // Set box as a side effect), while a Catalog's name click visibly did
  // nothing beyond selecting it — the same click gesture meaning two
  // different things depending on a shape distinction users have no way
  // to see in advance: "catalog是必须要点圆圈才会打开下一级,而collection只要
  // 点名字就会打开下一级!就是这些困惑的操作,使得我们的UI还是不好用" (Catalog
  // requires clicking the circle to open the next level, while Collection
  // opens it just by clicking the name — this inconsistency makes the UI
  // hard to use). Unifying both click targets on the same handler makes
  // "click here to select and reveal what's next" consistent everywhere,
  // regardless of node type or shape. Safe to combine with the label's own
  // drag gesture above — d3-drag only swallows the following click when a
  // real drag actually moved the pointer past its own threshold, so a
  // plain click (no movement) still reaches this handler normally.
  function handleSelectAndToggle() {
    onSelect()
    if (canExpand) onToggle()
  }

  // The Item Set box (with its own timeline/map, each with their own
  // hover tooltips) renders as a DOM *descendant* of this node's own `<g>`
  // (nested inside the `foreignObject` below), so entering or moving over
  // it also fires this node's own `onMouseEnter`/`onMouseMove` — the node's
  // tooltip would show on top of, or get stuck behind, whatever the box's
  // own content wants to show. `e.stopPropagation()` on the box looks like
  // the fix but isn't: React 17+ stops the *native* event too, and the
  // timeline's own drag-pan listens for `mousemove` on `window` (outside
  // React entirely, added imperatively for the gesture) — stopping
  // propagation anywhere below `window` silently breaks that. So this
  // checks explicitly instead. A direct `.contains()` check against this
  // node's own `itemSetBoxRef` — not a bounded ancestor walk — since the
  // box itself is portaled into a dedicated top `<g>` (see `boxLayer`
  // below) so the open box always paints above every other tree node
  // regardless of traversal order; `.contains()` is correct regardless of
  // where in the DOM the box actually lives, unlike a walk that assumes
  // it's still nested under this node's own `<g>`.
  function isInsideItemSetBox(target: Element): boolean {
    return !!itemSetBoxRef.current?.contains(target) || !!resultsBoxRef.current?.contains(target)
  }
  // The same trap, one level further out: React bubbles synthetic events
  // along the *React* tree, and `createPortal` only moves where a
  // component renders, not its place in that tree — so `BboxPickerModal`
  // (opened from the Search box, portaled to `document.body`) is still a
  // React descendant of this `<g>`, and every mouse move over its map
  // fired `handleMove` here, re-showing this node's tooltip wherever the
  // cursor was over the modal: "在modal出来...我的那个光标会有一个collection的
  // 那个pop-up出现...当我取消了那个modal之后,就又不见了" (once the modal is
  // open a Collection popup follows my cursor; it's gone once I cancel the
  // modal). Stopping propagation at the modal instead was tried and broke
  // Leaflet's drag-to-pan inside it (see that file). Real DOM containment
  // against this very `<g>` is the honest test of "is this hover actually
  // on this node" — anything portaled elsewhere fails it by construction.
  function isNotThisNode(e: React.MouseEvent): boolean {
    const target = e.target as Element
    return !(e.currentTarget as Node).contains(target) || isInsideItemSetBox(target)
  }
  function handleEnter(e: React.MouseEvent) {
    if (isNotThisNode(e)) {
      onHover(null, 0, 0)
      return
    }
    onHover(hoverInfo, e.clientX, e.clientY)
  }
  function handleMove(e: React.MouseEvent) {
    if (isNotThisNode(e)) return
    onHover(hoverInfo, e.clientX, e.clientY)
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
        onClick={handleSelectAndToggle}
      />
      <circle
        r={radius}
        style={{ fill: filled ? color : 'var(--color-surface)', stroke: color, pointerEvents: 'none' }}
        strokeWidth={1.75}
      />
      {node.spatial?.geometryInvalid && (
        <circle r={radius + 3} fill="none" strokeDasharray="2,2" style={{ stroke: 'var(--color-node-warning)' }} />
      )}
      {selected && <circle r={radius + 4} fill="none" strokeWidth={2} style={{ stroke: 'var(--color-selection)' }} />}
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
          cursor: labelDragging ? 'grabbing' : 'pointer',
          userSelect: 'none',
        }}
        onClick={handleSelectAndToggle}
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
      {showItemSetBox &&
        boxLayer &&
        (isApiSearched ? (
          <>
            {createPortal(
              // eslint-disable-next-line react-hooks/refs
              renderBox({
                key: 'search',
                title: 'Search',
                icon: 'search',
                badge: 'API',
                connectorSource: { x: 0, y: 0 },
                connectorTarget: {
                  x: 14 + searchBox.offset.dyVert + BOX_CONNECTOR_TARGET_INSET,
                  y: boxNearX + searchBox.offset.dxHoriz,
                },
                foreignX: searchBoxLeftX,
                foreignY: 14 + searchBox.offset.dyVert,
                size: searchBox.size,
                boxHandleRef: searchBoxHandles.boxHandleRef,
                resizeHandleRef: searchBoxHandles.resizeHandleRef,
                contentRef: itemSetBoxRef,
                labelOnLeft,
                nodeXY: { x, y },
                // `display:'flex', flexDirection:'column'` here, not just
                // `flex:1, minHeight:0` — this div is a plain portal
                // target (its own content arrives later, from
                // `CursorItemSetPanels`'s own `createPortal`), but it's
                // also the direct parent the portaled content's own
                // `flex:1, minHeight:0` sizing depends on. Without
                // `display:'flex'` here, this div lays out as an ordinary
                // block box (auto height, sized to its content) — the
                // portaled child's own `flex:1` is then a no-op (flex
                // properties only mean anything inside an actual flex
                // container), so *its* height goes auto too, and so on
                // down the chain. Confirmed as the real cause of two
                // distinct-looking reports at once: the results footer
                // requiring a scroll to see (the whole column grew taller
                // than the box and only the box's own outer `overflow:
                // auto` safety net caught it), and the Time & Space tab's
                // map never actually showing (a `flex:1` map div inside an
                // auto-height ancestor collapses toward zero height,
                // rather than filling the real remaining space).
                children: (
                  <div
                    ref={setSearchTargetEl}
                    style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
                  />
                ),
              }),
              boxLayer,
            )}
            {createPortal(
              // eslint-disable-next-line react-hooks/refs
              renderBox({
                key: 'results',
                title: 'Results',
                icon: 'list',
                badge: 'API',
                // Drawn from the Search box's own current bottom edge, not
                // the node — this is the connector that reads as "data
                // flows from Search into Results" (asked for directly: "我
                // 强烈地强调要有两个panel...一个节点编辑器,它数据进入一个panel,
                // 那是一个API的search,search完了以后,这个又一个结果出来" — I want
                // two real panels, like a node editor: data goes into a
                // search panel, and once it searches, a result comes out).
                // Recomputed every render from both boxes' own *current*
                // geometry, so it stays correct regardless of how far
                // either box has been independently dragged.
                connectorSource: {
                  x: 14 + searchBox.offset.dyVert + searchBox.size.height,
                  y: searchBoxLeftX + searchBox.size.width / 2,
                },
                connectorTarget: {
                  x: 14 + resultsBox.offset.dyVert + BOX_CONNECTOR_TARGET_INSET,
                  y: resultsBoxLeftX + resultsBox.size.width / 2,
                },
                foreignX: resultsBoxLeftX,
                foreignY: 14 + resultsBox.offset.dyVert,
                size: resultsBox.size,
                boxHandleRef: resultsBoxHandles.boxHandleRef,
                resizeHandleRef: resultsBoxHandles.resizeHandleRef,
                contentRef: resultsBoxRef,
                labelOnLeft,
                nodeXY: { x, y },
                // See the matching Search-box comment above — same fix,
                // same reason.
                children: (
                  <div
                    ref={setResultsTargetEl}
                    style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
                  />
                ),
              }),
              boxLayer,
            )}
            {searchTargetEl && resultsTargetEl && (
              <CursorItemSetPanels
                node={node as StacNode & { items: { kind: 'cursor' } }}
                searchTarget={searchTargetEl}
                resultsTarget={resultsTargetEl}
              />
            )}
          </>
        ) : (
          createPortal(
            // `renderBox` is a plain function, not a component; the
            // properties below named `*Ref` forward whole ref *objects*
            // into its own returned JSX (`ref={...}` there), never
            // dereferencing `.current` here. The linter can't see through
            // that function boundary.
            // eslint-disable-next-line react-hooks/refs
            renderBox({
              key: 'main',
              title: 'Items',
              icon: 'list',
              connectorSource: { x: 0, y: 0 },
              connectorTarget: {
                x: 14 + boxOffset.dyVert + BOX_CONNECTOR_TARGET_INSET,
                y: boxNearX + boxOffset.dxHoriz,
              },
              foreignX: (labelOnLeft ? boxNearX - boxSize.width : boxNearX) + boxOffset.dxHoriz,
              foreignY: 14 + boxOffset.dyVert,
              size: boxSize,
              boxHandleRef: mainBoxHandles.boxHandleRef,
              resizeHandleRef: mainBoxHandles.resizeHandleRef,
              contentRef: itemSetBoxRef,
              labelOnLeft,
              nodeXY: { x, y },
              children: <LinksItemSetBrowser node={node as StacNode & { items: { kind: 'links' } }} />,
            }),
            boxLayer,
          )
        ))}
    </g>
  )
}

type BoxHeaderIconKind = 'search' | 'list'

/** Title-bar glyphs — tiny inline SVGs in the same stroke language as the
 *  app's own `TypeIcon` set, no icon library. */
function BoxHeaderIcon({ kind }: { kind: BoxHeaderIconKind }) {
  const common = {
    width: 12,
    height: 12,
    viewBox: '0 0 12 12',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (kind === 'search') {
    return (
      <svg {...common}>
        <circle cx="5" cy="5" r="3.5" />
        <path d="M7.7 7.7 L11 11" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M1.5 3h9M1.5 6h9M1.5 9h9" />
    </svg>
  )
}

/** One box's full rendered shape — connector line (from an arbitrary
 *  source point, in the same swapped `{x: vertical, y: horizontal}`
 *  convention `linkGenerator` already uses elsewhere in this file) plus
 *  the `foreignObject` itself (a title bar that doubles as the drag
 *  handle, arbitrary `children`, resize-handle grip). A static catalog's single box and each of a
 *  cursor-mode node's two independent boxes (Search/Results) all render
 *  through this one function — same chrome, same connector logic, just
 *  different content and a different connector source (the node's own
 *  origin for Search/main, the Search box's own current geometry for
 *  Results — see the call sites above). Not a component (no Hooks inside)
 *  — a plain JSX-producing function, safe to call multiple times per
 *  render. */
function renderBox(opts: {
  key: string
  /** Title-bar text — short, like a tool window's name ("Search",
   *  "Results", "Items"), not the Collection's own name, which the tree
   *  node and Inspector already show. */
  title: string
  icon: BoxHeaderIconKind
  /** Optional pill at the title bar's right edge — the "API" tag for the
   *  two API-mode boxes, carrying the tree node's own signal through. */
  badge?: string
  connectorSource: { x: number; y: number }
  connectorTarget: { x: number; y: number }
  foreignX: number
  foreignY: number
  size: { width: number; height: number }
  boxHandleRef: React.RefObject<HTMLDivElement | null>
  resizeHandleRef: React.RefObject<HTMLDivElement | null>
  contentRef: React.RefObject<HTMLDivElement | null>
  labelOnLeft: boolean
  nodeXY: { x: number; y: number }
  children: React.ReactNode
}) {
  const {
    title,
    icon,
    badge,
    connectorSource,
    connectorTarget,
    foreignX,
    foreignY,
    size,
    boxHandleRef,
    resizeHandleRef,
    contentRef,
    labelOnLeft,
    nodeXY,
  } = opts
  return (
    <g
      key={opts.key}
      transform={`translate(${nodeXY.y}, ${nodeXY.x})`}
      // Chrome-specific, confirmed directly (not guessed): clicking a
      // plain `onClick` `<div>` *inside* the box's `foreignObject` (e.g. a
      // List row) isn't natively focusable, so Chrome's click-to-focus
      // algorithm falls back to focusing the nearest SVG ancestor instead
      // — this exact `<g>` — and draws its own default browser focus ring
      // around it, `outline: auto 5px`. Firefox doesn't do this for
      // `foreignObject`-embedded content, which is why the same click
      // never showed anything there. Reported directly, from a real
      // screenshot, and precisely diagnosed by the user before this was
      // even confirmed here: "这个框正好是一个G标签的范围...选择的那个蓝色的
      // collection节点，作为这个框的左上角，右下角是Panel的右下角的那个框" (the
      // frame exactly matches a <g> tag's bounds — the selected Collection
      // node is its top-left corner, the Panel's own bottom-right is its
      // bottom-right). Confirmed by reading `document.activeElement` right
      // after clicking a row: it resolved to exactly this `<g>`, with
      // `outlineStyle: 'auto'` — the browser's own default focus ring, not
      // anything this app ever intentionally draws. Suppressed directly,
      // since there's nothing meaningful for this purely structural,
      // non-interactive wrapper to visibly "have focus" at all — every
      // real interactive control inside it (buttons, inputs, rows) keeps
      // its own, correct focus behavior untouched.
      style={{ outline: 'none' }}
    >
      {/* A real edge, not just adjacent placement — drawn with the same
       * `linkGenerator` (and the same stroke) used for every other
       * parent→child connection in this tree, just fed local coordinates
       * instead of global hierarchy points. The box is a floating overlay
       * (see the `layout` useMemo above) — it doesn't participate in the
       * tree's own row layout at all, so this line is the only visual tie
       * back to wherever it connects from. */}
      <path
        d={
          // Connects near the target's own top edge, not its vertical
          // center — `linkHorizontal`'s curve is shaped for spans with
          // real horizontal distance (normal node-to-node links cross
          // LEVEL_WIDTH); aimed at the center of a box that's mostly
          // *below* its source, the resulting bezier had almost no
          // horizontal component and rendered as an invisible sliver
          // hugging the boundary. A target near the top reproduces the
          // same proportions as an ordinary sibling link.
          linkGenerator({ source: connectorSource, target: connectorTarget }) ?? undefined
        }
        fill="none"
        style={{ stroke: 'var(--color-border)' }}
        strokeWidth={1.5}
      />
      <foreignObject x={foreignX} y={foreignY} width={size.width} height={size.height}>
        <div
          ref={contentRef}
          // Scrolling the list, clicking a row/button, or typing in the
          // search box inside here must never also pan the canvas —
          // `data-block-pan` is the single, central rule `zoom.filter()`
          // checks for that (see StructureTree above and docs/DESIGN.md
          // §32's update), covering wheel/mousedown/touchstart uniformly
          // instead of hand-picking event types to `stopPropagation()` on.
          data-block-pan="true"
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-selection)',
            borderRadius: 'var(--radius-sm)',
            padding: 0,
            boxSizing: 'border-box',
            boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
            cursor: 'default',
            // A flex column, not plain block flow — so the box's own
            // content (below) can genuinely fill whatever height this box
            // currently has (via `flex: 1`) rather than sitting at a fixed
            // pixel height that a resize wouldn't actually change
            // anything about.
            display: 'flex',
            flexDirection: 'column',
            // Clips the title bar's full-bleed background to the rounded
            // corners; the body wrapper below owns the overflow safety net.
            overflow: 'hidden',
          }}
        >
          {/* A real title bar, which is also the drag handle — not a bare
           * grip strip. The earlier version was a 14px grey pill above the
           * content with nothing on it, which split "what is this box" from
           * "where do I grab it" in a way no other product does: "我其实没有
           * 见过第二个产品是长这个样子的...一个正常的panel通常也是带有头,像一个窗口
           * 一样,有一个头部,头部上面有它的title,然后下面才是这个内容" (I've never
           * seen a second product that looks like this — a normal panel has
           * a head, like a window: a header with its title, and the content
           * below). Every reference checked converges on the same anatomy:
           * OS title bars (Fluent: "all empty space in the title bar or
           * space taken up by non-interactive elements like the window
           * title should be draggable"; macOS: move by dragging the frame),
           * node editors (ComfyUI/LiteGraph, Unreal Blueprints, Blender: a
           * title bar you drag, a body of ports/fields, a resize corner),
           * tool windows (JetBrains: a one-or-two-word title plus an icon),
           * and design-system cards (Fluent 2/Spectrum/Carbon: header with
           * title + badge/actions, body, footer for actions). Still a
           * dedicated handle rather than the whole box — the body is full
           * of its own click/scroll/type targets. */}
          <div
            ref={boxHandleRef}
            title="Drag to move this panel"
            style={{
              flexShrink: 0,
              height: 28,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 10px',
              borderBottom: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'grab',
              userSelect: 'none',
            }}
          >
            <span style={{ display: 'flex', color: 'var(--color-text-muted)' }}>
              <BoxHeaderIcon kind={icon} />
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
            {badge && (
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 7px',
                  borderRadius: 999,
                  background: 'var(--color-badge-api-bg)',
                  color: 'var(--color-badge-api-text)',
                }}
              >
                {badge}
              </span>
            )}
          </div>
          {/* `display:'flex', flexDirection:'column'`, not just `flex:1,
           * minHeight:0` — this wrapper is itself a flex item within the
           * box's own outer column (so it correctly shrinks to the
           * remaining space below the drag handle), but it also needs to
           * establish its own flex context for `opts.children`'s sake:
           * without it, `opts.children`'s own `flex:1`/`height:'100%'`
           * styling is meaningless (flex sizing only applies inside an
           * actual flex container; a percentage height only resolves
           * against a parent with a *definite* height, which a plain
           * auto-height block-level div here would never have) — so its
           * content renders at its own natural height instead of being
           * bounded to the box, requiring this whole wrapper's ancestor
           * (`overflow:'auto'`, above) to scroll just to reach a page's own
           * footer. Confirmed as the real cause directly: this same
           * pattern (a `flex:1, minHeight:0` div missing `display:'flex'`)
           * was found and fixed once already, one link up the chain, for
           * cursor mode's own portal-target divs — this is the second,
           * deeper occurrence of the identical mistake, affecting both
           * modes (links mode's shorter default content happened to still
           * fit without it, so this one stayed invisible until cursor
           * mode's own longer content exposed it). */}
          <div
            style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 8, overflow: 'auto' }}
          >
            {opts.children}
          </div>
          {/* A real corner grip, not a whole-edge drag — matches the same
           * "dedicated handle, not the whole box" reasoning as the
           * move-handle above, and the familiar OS-window resize
           * convention (diagonal cursor at the corner that actually
           * moves). Which corner that is depends on which side the box
           * sits on: when it's on the node's *left* (labelOnLeft), the
           * box's near/right edge is pinned and it grows further left
           * instead — so the grip sits at the bottom-*left* there, with
           * the mirrored cursor, not bottom-right; the drag effect already
           * flips the sign of `dx` to match (`useBoxDragHandles`). */}
          <div
            ref={resizeHandleRef}
            title="Drag to resize this panel"
            style={{
              position: 'absolute',
              ...(labelOnLeft ? { left: 3 } : { right: 3 }),
              bottom: 3,
              width: 12,
              height: 12,
              cursor: labelOnLeft ? 'nesw-resize' : 'nwse-resize',
              ...(labelOnLeft
                ? { borderLeft: '2px solid var(--color-text-faint)', borderRadius: '0 0 0 3px' }
                : { borderRight: '2px solid var(--color-text-faint)', borderRadius: '0 0 3px 0' }),
              borderBottom: '2px solid var(--color-text-faint)',
              opacity: 0.6,
            }}
          />
        </div>
      </foreignObject>
    </g>
  )
}
