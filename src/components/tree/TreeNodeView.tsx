import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { select } from 'd3-selection'
import { drag, type D3DragEvent } from 'd3-drag'
import type { TreeDatum } from '../../hooks/useStructureTree'
import { useBoxDragHandles } from '../../hooks/useBoxDragHandles'
import { isInlinePreviewAsset } from '../../stac/assets'
import type { StacNode } from '../../stac/types'
import { CursorItemSetPanels } from '../CursorItemSetPanels'
import { LinksItemSetBrowser } from '../LinksItemSetBrowser'
import { Spinner } from '../Spinner'
import { renderBox } from './ItemSetBox'
import {
  BOX_CONNECTOR_TARGET_INSET,
  BOX_TOP_OFFSET,
  ITEM_SET_BOX_GAP,
  type BoxGeometry,
  type BoxOffset,
  type BoxSize,
} from './boxGeometry'
import {
  estimateTextWidth,
  hasDirectItems,
  LABEL_FONT_SIZE,
  stripMarkdownLinks,
  TOOLTIP_DESCRIPTION_MAX_CHARS,
  truncateLabel,
  type HoverInfo,
} from './treeGeometry'

export interface TreeNodeProps {
  datum: TreeDatum
  x: number
  y: number
  hasRenderedChildren: boolean
  isRoot: boolean
  loading: boolean
  selected: boolean
  /** The selected Item belongs to this Collection — distinct from
   *  `selected` (this exact node is selected). Items are never tree nodes,
   *  so this dashed ring is the only way an Item selection shows in the
   *  tree. */
  containsSelection: boolean
  /** Render this node's Item Set as an embedded box — only for the one node
   *  being browsed, never every node with Items (that would be dozens of
   *  concurrent fetches). The box is a floating overlay in the tree's
   *  coordinate space, real HTML in a `<foreignObject>`. */
  showItemSetBox: boolean
  onToggle: () => void
  onSelect: () => void
  onHover: (info: HoverInfo | null, clientX: number, clientY: number) => void
  /** The zoom-transformed `<g>`, used as `.container()` for every d3-drag in
   *  this node so deltas arrive already zoom-corrected. */
  containerRef: React.RefObject<SVGGElement | null>
  /** Incremental local delta while this node is dragged; the parent applies
   *  it to the whole subtree. */
  onNodeDragBy: (dxLocal: number, dyLocal: number) => void
  /** The static box's own drag offset and size, in plain `foreignObject`
   *  (horizontal, vertical) terms — independent of the node's position. */
  boxOffset: BoxOffset
  onBoxDragBy: (dxLocal: number, dyLocal: number) => void
  boxSize: BoxSize
  onBoxResizeBy: (dxLocal: number, dyLocal: number) => void
  /** Geometry of an API Collection's two boxes. Only used when
   *  `node.items.kind === 'cursor'`; a static catalog's box is fully owned
   *  by the four props above. */
  searchBox: BoxGeometry
  resultsBox: BoxGeometry
  /** Where this node's boxes are portaled — a last-rendered `<g>` in the
   *  canvas, so an open box always paints above other nodes. `null` for the
   *  single render before that `<g>` exists; the box skips that frame. */
  boxLayer: SVGGElement | null
}

/** One tree node: circle, label, badges, hover, and — for the node being
 *  browsed — its Item Set box(es). The label, not the circle, is the drag
 *  handle: the circle's one job is click-to-expand and a grab cursor on it
 *  muddied that signal; the label only ever selected, so drag fits there
 *  without conflict. d3-drag is the canonical composition with d3-zoom for
 *  "pannable canvas, draggable elements inside it"; the hand-rolled pointer
 *  handling it replaced let the canvas pan and the node move in the same
 *  gesture. */
export function TreeNodeView({
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
  // The Results box is a second independent box with its own ref, so
  // hovering either box suppresses this node's tooltip (see
  // `isInsideItemSetBox`).
  const resultsBoxRef = useRef<HTMLDivElement | null>(null)
  // Portal targets for the Search/Results *content*: `CursorItemSetPanels`
  // (mounted once both exist) portals its two pieces into these, so one
  // hook instance backs two physically separate `<foreignObject>`s. State,
  // not refs — a ref read during another component's render isn't attached
  // yet on the first pass; a callback ref into state triggers the retry.
  const [searchTargetEl, setSearchTargetEl] = useState<HTMLDivElement | null>(null)
  const [resultsTargetEl, setResultsTargetEl] = useState<HTMLDivElement | null>(null)
  // Computed early — the resize-handle effect needs it to know which way the
  // box grows. The root always labels to the right.
  const labelOnLeft = hasRenderedChildren && !isRoot

  const labelRef = useRef<SVGTextElement | null>(null)
  const onNodeDragByRef = useRef(onNodeDragBy)
  useEffect(() => {
    onNodeDragByRef.current = onNodeDragBy
  })

  // A drag in progress on *this* label (not d3-zoom's canvas pan). The
  // cursor stays `pointer` until a real drag starts: the click is the
  // primary action and the drag affordance shouldn't upstage it.
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

  // Which side the box sits on decides which edge is pinned during a resize
  // (see `useBoxDragHandles`). A ref, so a handler bound once still sees
  // the current side if it flips while the box is open. Shared by every box
  // on this node.
  const labelOnLeftRef = useRef(labelOnLeft)
  useEffect(() => {
    labelOnLeftRef.current = labelOnLeft
  })

  // All three called unconditionally (rules of Hooks); a static node's
  // Search/Results handles simply never attach to a DOM element.
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
  // Only sub-Catalogs/Collections are structural children; direct Items are
  // reached through the Item Set box, shown below as a count. A node whose
  // children come from a `/collections` or `/children` endpoint expands the
  // same way, just fetched differently.
  const canExpand = node.childHrefs.length > 0 || !!node.collectionsEndpoint || !!node.childrenEndpoint
  // Tidy-tree convention, extended: filled = something behind this circle
  // is not yet open (tree children, or — for a node with Items and no
  // children — its Item Set box); hollow = already open, or a genuine dead
  // end. "Open" for the box half mirrors `showItemSetBox` rather than a
  // sticky "ever opened" record: it reflects what is open right now.
  const filled = (canExpand && !hasRenderedChildren) || (hasDirectItems(node) && !showItemSetBox)

  const color = node.type === 'Catalog' ? 'var(--color-node-catalog)' : 'var(--color-node-collection)'
  const radius = node.type === 'Catalog' ? 7 : 6
  // A static link array has a known count; a cursor (API) node's count is
  // unknown until queried and is labeled as such, never shown as a fake 0.
  const isApiSearched = node.items.kind === 'cursor'
  const itemBadgeText =
    node.items.kind === 'links'
      ? node.items.hrefs.length > 0
        ? `${node.items.hrefs.length} item${node.items.hrefs.length === 1 ? '' : 's'}`
        : undefined
      : undefined
  const labelDx = labelOnLeft ? -(radius + 6) : radius + 6
  const label = node.title ?? node.id
  const labelText = truncateLabel(label)
  // The box's near edge (and the connector's target) sits past the label's
  // rendered *end*, plus a gap, so the connector curve has room.
  const labelWidth = estimateTextWidth(labelText, LABEL_FONT_SIZE)
  const boxNearX = labelOnLeft ? labelDx - labelWidth - ITEM_SET_BOX_GAP : labelDx + labelWidth + ITEM_SET_BOX_GAP

  // Boxes render at exactly their stored size and offset — no clamping to
  // the visible column, default or resized. Two lighter clamps were tried
  // and removed: recomputing from the current pan position made an open
  // box visibly shrink while the user merely panned. The Inspector, a later
  // DOM sibling, simply covers whatever overlaps it.
  const searchBoxLeftX = (labelOnLeft ? boxNearX - searchBox.size.width : boxNearX) + searchBox.offset.dxHoriz
  const resultsBoxLeftX = (labelOnLeft ? boxNearX - resultsBox.size.width : boxNearX) + resultsBox.offset.dxHoriz
  // The "API" tag is a small pill anchored the same side as the label — a
  // real signal, like STAC Browser's own tag, not gray subtext.
  const apiTagFontSize = 9
  const apiTagPadX = 5
  const apiTagHeight = 13
  const apiTagWidth = estimateTextWidth('API', apiTagFontSize) + apiTagPadX * 2
  const apiTagX = labelOnLeft ? labelDx - apiTagWidth : labelDx
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

  // One handler for both the circle and the label, so "click here to select
  // and reveal what's next" means the same thing on every node — the label
  // used to only select, which made Catalogs and Collections behave
  // differently for the same gesture. Safe alongside the label's drag:
  // d3-drag swallows the click only after a real drag moved the pointer.
  function handleSelectAndToggle() {
    onSelect()
    if (canExpand) onToggle()
  }

  // Hover must belong to *this node*, not to something React merely
  // considers a descendant. Two cases fail that test: the boxes (portaled
  // into `boxLayer`, so a plain `.contains()` on their refs is the right
  // check regardless of where they live in the DOM), and `BboxPickerModal`
  // (portaled to `document.body`, yet still a React descendant of this
  // `<g>`, so its mouse moves bubble here as synthetic events). Real DOM
  // containment against this very `<g>` settles both. Never
  // `stopPropagation()`: React's synthetic version also stops the native
  // event, which the timeline's window-level drag and Leaflet's document-
  // level drag both depend on.
  function isInsideItemSetBox(target: Element): boolean {
    return !!itemSetBoxRef.current?.contains(target) || !!resultsBoxRef.current?.contains(target)
  }
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

  // Both portal targets need `display: flex` themselves: each is the direct
  // parent the portaled content's `flex: 1 / minHeight: 0` sizing depends
  // on. Without it the content laid out at its natural height — the results
  // footer needed a scroll to reach and the Time & Space map collapsed to
  // zero height.
  const portalTargetStyle = { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } as const

  return (
    <g
      transform={`translate(${y}, ${x})`}
      onMouseEnter={handleEnter}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      {/* Invisible, larger click target around the small visible dot — the
       * standard SVG pattern; the dot alone was too small to hit reliably.
       * Click only (drag lives on the label), and a `pointer` cursor because
       * this control's one job is click-to-select/expand. */}
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
          // A tag only for the case that needs calling out — Items behind a
          // live query. The static case stays plain "N items" text, matching
          // STAC Browser's convention of tagging the special case.
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
                  x: BOX_TOP_OFFSET + searchBox.offset.dyVert + BOX_CONNECTOR_TARGET_INSET,
                  y: boxNearX + searchBox.offset.dxHoriz,
                },
                foreignX: searchBoxLeftX,
                foreignY: BOX_TOP_OFFSET + searchBox.offset.dyVert,
                size: searchBox.size,
                boxHandleRef: searchBoxHandles.boxHandleRef,
                resizeHandleRef: searchBoxHandles.resizeHandleRef,
                contentRef: itemSetBoxRef,
                labelOnLeft,
                nodeXY: { x, y },
                children: <div ref={setSearchTargetEl} style={portalTargetStyle} />,
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
                // from the node: the connector that reads as "data flows from
                // Search into Results", the node-editor idea the two-box
                // design comes from. Recomputed every render from both boxes'
                // current geometry, so it survives either being dragged.
                connectorSource: {
                  x: BOX_TOP_OFFSET + searchBox.offset.dyVert + searchBox.size.height,
                  y: searchBoxLeftX + searchBox.size.width / 2,
                },
                connectorTarget: {
                  x: BOX_TOP_OFFSET + resultsBox.offset.dyVert + BOX_CONNECTOR_TARGET_INSET,
                  y: resultsBoxLeftX + resultsBox.size.width / 2,
                },
                foreignX: resultsBoxLeftX,
                foreignY: BOX_TOP_OFFSET + resultsBox.offset.dyVert,
                size: resultsBox.size,
                boxHandleRef: resultsBoxHandles.boxHandleRef,
                resizeHandleRef: resultsBoxHandles.resizeHandleRef,
                contentRef: resultsBoxRef,
                labelOnLeft,
                nodeXY: { x, y },
                children: <div ref={setResultsTargetEl} style={portalTargetStyle} />,
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
            // `renderBox` is a plain function, not a component; the `*Ref`
            // properties forward whole ref objects into its JSX, never
            // `.current` — the linter can't see through the call.
            // eslint-disable-next-line react-hooks/refs
            renderBox({
              key: 'main',
              title: 'Items',
              icon: 'list',
              connectorSource: { x: 0, y: 0 },
              connectorTarget: {
                x: BOX_TOP_OFFSET + boxOffset.dyVert + BOX_CONNECTOR_TARGET_INSET,
                y: boxNearX + boxOffset.dxHoriz,
              },
              foreignX: (labelOnLeft ? boxNearX - boxSize.width : boxNearX) + boxOffset.dxHoriz,
              foreignY: BOX_TOP_OFFSET + boxOffset.dyVert,
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
