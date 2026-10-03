import { useEffect, useRef, useState } from 'react'
import { select } from 'd3-selection'
import { drag, type D3DragEvent } from 'd3-drag'
import type { TreeDatum } from '../../hooks/useStructureTree'
import { Spinner } from '../Spinner'
import {
  canExpandNode,
  estimateTextWidth,
  hoverInfoFor,
  itemCountLabel,
  LABEL_FONT_SIZE,
  nodeColor,
  nodeIsFilled,
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
  /** This node's Items are open in the Items window right now — the
   *  window follows `browsingHref`, so at most one node has this. Drives
   *  the filled/hollow glyph and hides the count badge, as the embedded
   *  box used to. */
  itemsOpen: boolean
  onToggle: () => void
  onSelect: () => void
  onHover: (info: HoverInfo | null, clientX: number, clientY: number) => void
  /** The zoom-transformed `<g>`, used as `.container()` for every d3-drag in
   *  this node so deltas arrive already zoom-corrected. */
  containerRef: React.RefObject<SVGGElement | null>
  /** Incremental local delta while this node is dragged; the parent applies
   *  it to the whole subtree. */
  onNodeDragBy: (dxLocal: number, dyLocal: number) => void
}

/** One tree node: circle, label, badges, hover. The node's Items are not
 *  drawn here any more — they are in the Items window, which floats above
 *  every view (`ItemsWindow`); this node only shows that they are open.
 *  The label, not the circle, is the drag handle: the circle's one job is
 *  click-to-expand and a grab cursor on it muddied that signal; the label
 *  only ever selected, so drag fits there without conflict. d3-drag is the
 *  canonical composition with d3-zoom for "pannable canvas, draggable
 *  elements inside it"; the hand-rolled pointer handling it replaced let
 *  the canvas pan and the node move in the same gesture. */
export function TreeNodeView({
  datum,
  x,
  y,
  hasRenderedChildren,
  isRoot,
  loading,
  selected,
  containsSelection,
  itemsOpen,
  onToggle,
  onSelect,
  onHover,
  containerRef,
  onNodeDragBy,
}: TreeNodeProps) {
  // The root always labels to the right; every other node labels left once
  // its children are rendered, so the label never runs into them.
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
  // reached through the Items window, shown below as a count. A node whose
  // children come from a `/collections` or `/children` endpoint expands the
  // same way, just fetched differently.
  const canExpand = canExpandNode(node)
  // Filled/hollow per the shared convention (`nodeIsFilled`); "open" for
  // the Items half mirrors `itemsOpen` rather than a sticky "ever opened"
  // record: it reflects what is open right now.
  const filled = nodeIsFilled(node, hasRenderedChildren, itemsOpen)

  const color = nodeColor(node)
  const radius = node.type === 'Catalog' ? 7 : 6
  const isApiSearched = node.items.kind === 'cursor'
  // Never a fake 0 for an API node: `itemCountLabel` says nothing until a
  // count is known.
  const itemBadgeText = itemCountLabel(node)
  const labelDx = labelOnLeft ? -(radius + 6) : radius + 6
  const label = node.title ?? node.id
  const labelText = truncateLabel(label)
  // The "API" tag is a small pill anchored the same side as the label — a
  // real signal, like STAC Browser's own tag, not gray subtext.
  const apiTagFontSize = 9
  const apiTagPadX = 5
  const apiTagHeight = 13
  const apiTagWidth = estimateTextWidth('API', apiTagFontSize) + apiTagPadX * 2
  const apiTagX = labelOnLeft ? labelDx - apiTagWidth : labelDx
  // Computed when hovered, not on every render: every node re-renders when
  // the hover card moves, and a description's plain text is not free.

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
  // considers a descendant: `BboxPickerModal` is portaled to `document.body`
  // yet still a React descendant of this `<g>`, so its mouse moves bubble
  // here as synthetic events. Real DOM containment against this very `<g>`
  // settles it. Never `stopPropagation()`: React's synthetic version also
  // stops the native event, which the timeline's window-level drag and
  // Leaflet's document-level drag both depend on.
  function isNotThisNode(e: React.MouseEvent): boolean {
    return !(e.currentTarget as Node).contains(e.target as Element)
  }
  function handleEnter(e: React.MouseEvent) {
    if (isNotThisNode(e)) {
      onHover(null, 0, 0)
      return
    }
    onHover(hoverInfoFor(node), e.clientX, e.clientY)
  }
  function handleMove(e: React.MouseEvent) {
    if (isNotThisNode(e)) return
    onHover(hoverInfoFor(node), e.clientX, e.clientY)
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
        !itemsOpen &&
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
    </g>
  )
}
