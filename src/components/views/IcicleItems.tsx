import { loader } from '../../stac/loaderInstance'
import type { StacNode } from '../../stac/types'
import { useItemSetStore } from '../../store/itemSet'
import { sessionPage } from '../../store/itemSetSessions'
import { OFF_PAGE_NOTE, selectedItemOffPage } from './selectedItem'
import { estimateTextWidth, hoverInfoFor, knownItemCount, type HoverInfo } from '../tree/treeGeometry'

/** The Item row under a browsed Collection: for the Items window's
 *  subject, the page the window is showing right now, drawn as equal cells
 *  in the window's order with a last cell that says how many there are in
 *  all (and opens the window when it is closed); for any other Collection
 *  that has been browsed, the page last seen there, dimmed, with a last
 *  cell that browses it again. One state, two renderings — paging,
 *  searching and the counts happen in the window; this row only shows
 *  where in the shape those Items sit. */
export function IcicleItems({
  node,
  current,
  x,
  y,
  width,
  height,
  selectedHref,
  onSelect,
  onHover,
}: {
  node: StacNode
  /** This Collection is the Items window's subject: its row is the live
   *  page, full color. Otherwise the row is the page last seen, dimmed. */
  current: boolean
  x: number
  y: number
  width: number
  height: number
  selectedHref: string | null
  onSelect: (href: string) => void
  onHover: (info: HoverInfo | null, clientX: number, clientY: number) => void
}) {
  const forHref = useItemSetStore((s) => s.forHref)
  const visibleHrefs = useItemSetStore((s) => s.visibleHrefs)
  const windowOpen = useItemSetStore((s) => s.windowOpen)
  const setWindowOpen = useItemSetStore((s) => s.setWindowOpen)
  const remembered = current ? undefined : sessionPage(node)
  const items = current
    ? forHref === node.href
      ? visibleHrefs.map((h) => loader.get(h)).filter((n): n is StacNode => !!n)
      : []
    : (remembered?.items ?? [])
  // The selected Item when the page does not hold it: the first cell,
  // marked (outlined as selected, its title says why it is there).
  const offPage = selectedItemOffPage(selectedHref, node.href, current ? node.href : null, items)
  const drawn = offPage ? [offPage, ...items] : items
  const total = knownItemCount(node)
  const tailText = !current
    ? `Page ${(remembered?.pageIndex ?? 0) + 1} as last seen · select to browse`
    : !windowOpen
      ? 'Open the Items window'
      : items.length === 0
        ? node.items.kind === 'cursor'
          ? 'Search in the Items window'
          : 'Loading…'
        : total !== undefined
          ? `${items.length} of ${total.toLocaleString()} shown · Items window`
          : `${items.length} shown · Items window`
  // An Item in another Collection's remembered row: browse that Collection
  // first, so the selection store pins browsing to it (an Item selection
  // alone keeps the current Collection pinned), then the Item.
  const selectItem = (href: string) => {
    if (!current) onSelect(node.href)
    onSelect(href)
  }
  const tailWidth = Math.min(Math.max(estimateTextWidth(tailText, 10.5) + 14, 60), drawn.length ? width * 0.35 : width)
  const cellWidth = drawn.length ? Math.max(1, (width - tailWidth) / drawn.length) : 0

  return (
    <g
      transform={`translate(${x}, ${y})`}
      opacity={current ? 1 : 0.5}
      data-items-row={current ? 'current' : 'remembered'}
    >
      {drawn.map((item, i) => {
        const cx = i * cellWidth
        const w = Math.max(1, cellWidth - 1)
        const selected = selectedHref === item.href
        const text = w >= 48 ? fit(item.title ?? item.id, w - 8) : undefined
        return (
          <g
            key={item.href}
            data-item-href={item.href}
            data-off-page={item === offPage ? '' : undefined}
            transform={`translate(${cx}, 0)`}
            onClick={() => selectItem(item.href)}
            onMouseMove={(e) => onHover(hoverInfoFor(item), e.clientX, e.clientY)}
            onMouseLeave={(e) => onHover(null, e.clientX, e.clientY)}
            style={{ cursor: 'pointer' }}
          >
            <rect
              width={w}
              height={height - 1}
              rx={1.5}
              fill="var(--color-node-item)"
              fillOpacity={0.35}
              stroke={selected ? 'var(--color-selection)' : 'var(--color-surface)'}
              strokeWidth={selected ? 2 : 1}
            />
            {item === offPage && <title>{`${item.title ?? item.id} — ${OFF_PAGE_NOTE}`}</title>}
            {text && (
              <text x={4} y={height / 2 + 4} fontSize={10.5} style={{ fill: 'var(--color-text)' }}>
                {text}
              </text>
            )}
          </g>
        )
      })}
      <g
        data-item-tail
        transform={`translate(${width - tailWidth}, 0)`}
        onClick={() => (current ? setWindowOpen(true) : onSelect(node.href))}
        style={{ cursor: 'pointer' }}
      >
        <rect width={tailWidth - 1} height={height - 1} fill="url(#icicle-not-loaded)" opacity={0.6} />
        <title>
          {!current
            ? 'The page last seen in the Items window — click to browse this Collection again'
            : windowOpen
              ? 'The Items window shows this page; page and search there'
              : 'Open the Items window'}
        </title>
        <text x={7} y={height / 2 + 4} fontSize={10.5} style={{ fill: 'var(--color-text-muted)' }}>
          {fit(tailText, tailWidth - 12) ?? '…'}
        </text>
      </g>
    </g>
  )
}

function fit(text: string, widthPx: number): string | undefined {
  if (estimateTextWidth(text, 10.5) <= widthPx) return text
  const chars = Math.floor(widthPx / estimateTextWidth('n', 10.5)) - 1
  return chars >= 3 ? `${text.slice(0, chars)}…` : undefined
}
