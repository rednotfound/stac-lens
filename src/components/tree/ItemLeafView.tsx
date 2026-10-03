import { useEffect, useRef, useState, type RefObject } from 'react'
import { drag } from 'd3-drag'
import { select } from 'd3-selection'
import type { HoverInfo } from './treeGeometry'
import { hoverInfoFor, LABEL_FONT_SIZE, truncateLabel } from './treeGeometry'
import type { ViewDatum } from './itemLeaves'
import { describeTemporal } from '../../stac/describe'
import { OFF_PAGE_NOTE } from '../views/selectedItem'

/** One Item leaf in the tree, or the trailing "+N more" leaf: a sketch of
 *  where the Items panel's page sits in the structure. A small square in
 *  the Item color (the legend's Item glyph), the title, the date under it;
 *  dimmed when it is a page last seen rather than the panel's page.
 *  Clicking an Item selects it — through its Collection first when that
 *  Collection is not the one being browsed, so the panel follows. The
 *  "+N more" leaf opens or refocuses the panel. Nothing here pages or
 *  searches: that is the panel's job. */
export function ItemLeafView({
  datum,
  x,
  y,
  selected,
  onSelectItem,
  onOpenPanel,
  onHover,
  containerRef,
  onGroupDragBy,
}: {
  datum: ViewDatum
  x: number
  y: number
  selected: boolean
  onSelectItem: (itemHref: string, hostHref: string, current: boolean) => void
  onOpenPanel: (hostHref: string, current: boolean) => void
  onHover: (info: HoverInfo | null, clientX: number, clientY: number) => void
  /** The zoomed `<g>`, as d3-drag's container (drag deltas in its space). */
  containerRef: RefObject<SVGGElement | null>
  /** Dragging any leaf moves its Collection's whole group of leaves. */
  onGroupDragBy: (hostHref: string, dxLocal: number, dyLocal: number) => void
}) {
  const hostHref = (datum.itemLeaf ?? datum.moreItems)!.hostHref
  const gRef = useRef<SVGGElement>(null)
  const [dragging, setDragging] = useState(false)
  const onGroupDragByRef = useRef(onGroupDragBy)
  useEffect(() => {
    onGroupDragByRef.current = onGroupDragBy
  }, [onGroupDragBy])
  // The same d3-drag composition as a node's label: a real drag moves the
  // group (and d3-drag swallows the click that would end it); a click
  // without movement still selects. The canvas does not pan meanwhile.
  useEffect(() => {
    const el = gRef.current
    if (!el) return
    const behavior = drag<SVGGElement, unknown>()
      .container(() => containerRef.current as unknown as SVGGElement)
      .on('start', () => setDragging(true))
      .on('drag', (event) => onGroupDragByRef.current(hostHref, event.dx, event.dy))
      .on('end', () => setDragging(false))
    const sel = select(el)
    sel.call(behavior)
    return () => {
      sel.on('.drag', null)
    }
  }, [containerRef, hostHref])
  const cursor = dragging ? 'grabbing' : 'pointer'

  if (datum.moreItems) {
    const m = datum.moreItems
    return (
      <g
        ref={gRef}
        data-block-pan="true"
        transform={`translate(${y}, ${x})`}
        data-item-more-leaf
        opacity={m.current ? 1 : 0.55}
        onClick={() => onOpenPanel(m.hostHref, m.current)}
        style={{ cursor }}
      >
        <rect
          x={-4}
          y={-4}
          width={8}
          height={8}
          fill="none"
          strokeDasharray="2,2"
          style={{ stroke: 'var(--color-text-faint)' }}
        />
        <text x={10} y={4} fontSize={11} style={{ fill: 'var(--color-text-faint)' }}>
          +{m.remaining} more on this page · page {m.pageIndex + 1} · {m.current ? 'Items panel' : 'as last seen'}
        </text>
      </g>
    )
  }
  const leaf = datum.itemLeaf!
  const { node } = datum
  const title = node.title ?? node.id
  const when = node.temporal ? describeTemporal(node.temporal) : undefined
  return (
    <g
      ref={gRef}
      data-block-pan="true"
      transform={`translate(${y}, ${x})`}
      data-item-leaf={node.href}
      data-off-page={leaf.offPage ? '' : undefined}
      opacity={leaf.current ? 1 : 0.55}
      onClick={() => onSelectItem(node.href, leaf.hostHref, leaf.current)}
      onMouseEnter={(e) => onHover(hoverInfoFor(node), e.clientX, e.clientY)}
      onMouseMove={(e) => onHover(hoverInfoFor(node), e.clientX, e.clientY)}
      onMouseLeave={() => onHover(null, 0, 0)}
      style={{ cursor }}
    >
      <circle r={12} fill="transparent" />
      {selected && <circle r={8} fill="none" strokeWidth={1.5} style={{ stroke: 'var(--color-selection)' }} />}
      <rect x={-4} y={-4} width={8} height={8} rx={1} fill="var(--color-node-item)" />
      <text
        dx={11}
        dy={4}
        fontSize={LABEL_FONT_SIZE}
        fontWeight={selected ? 600 : 400}
        style={{ fill: selected ? 'var(--color-selection)' : 'var(--color-text)', userSelect: 'none' }}
      >
        {truncateLabel(title)}
      </text>
      {leaf.offPage ? (
        <text dx={11} dy={18} fontSize={10} style={{ fill: 'var(--color-selection)' }}>
          {OFF_PAGE_NOTE}
        </text>
      ) : (
        when && (
          <text dx={11} dy={18} fontSize={10} style={{ fill: 'var(--color-text-faint)' }}>
            {when}
          </text>
        )
      )}
    </g>
  )
}
