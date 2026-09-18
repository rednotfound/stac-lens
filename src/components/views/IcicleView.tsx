import { useMemo, useState } from 'react'
import { hierarchy, partition, type HierarchyRectangularNode } from 'd3-hierarchy'
import type { TreeDatum } from '../../hooks/useStructureTree'
import { useElementSize } from '../../hooks/useElementSize'
import { useSelectionStore } from '../../store/selection'
import { useStructure } from '../../hooks/useStructure'
import { TypeIcon } from '../TypeIcon'
import { NodeTooltip } from '../tree/NodeTooltip'
import {
  canExpandNode,
  estimateTextWidth,
  hoverInfoFor,
  itemCountLabel,
  nodeColor,
  type TooltipState,
} from '../tree/treeGeometry'
import { OverviewBar } from './OverviewBar'
import { StructureFallback } from './StructureFallback'

/** One layer of the hierarchy per row; tall enough for a title and a
 *  second line of counts. */
const ROW = 44
/** Below this width a cell gets no label — the tooltip has the name. */
const MIN_LABEL_WIDTH = 56
const LABEL_FONT = 12
const SUB_FONT = 10.5

type Rect = HierarchyRectangularNode<TreeDatum>

/** Icicle: the loaded Catalog → Collection hierarchy as space-filling
 *  layers, root on top, one row per depth. Width is share of *loaded
 *  leaves* — every leaf counts one — never an Item count: an API
 *  Collection's Items are unknown until searched, and a static list's
 *  count is a fact about links, not a size to sum up the tree. Known
 *  counts appear as text in the cell instead. So the picture is the
 *  publisher's shape: a flat root of 422 Collections is one wide row of
 *  thin cells; Capella's year → month → day catalogs are a staircase.
 *
 *  Chosen over a treemap (inner nodes disappear inside the nesting) and a
 *  sunburst (angles are hard to compare, outer labels tilt) on the
 *  evidence of the hierarchy-visualization studies cited in
 *  docs/DESIGN.md, "Views beyond the tree". Zoomable in the usual way:
 *  clicking a node that has children makes it the focus and its subtree
 *  fills the width; the breadcrumb goes back up. Clicking a closed node
 *  opens it (the same lazy expansion as the tree); clicking anything
 *  selects it, so the Inspector follows. */
export function IcicleView() {
  const { root, toggle, expandAllCatalogs, isLoading, isExpanded, rootError } = useStructure()
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  const browsingHref = useSelectionStore((s) => s.browsingHref)
  const select = useSelectionStore((s) => s.select)
  const [containerRef, { width }] = useElementSize<HTMLDivElement>()
  const [focusHref, setFocusHref] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const layout = useMemo(() => {
    if (!root) return undefined
    const h = hierarchy(root, (d) => d.children).count()
    // Unit coordinates: x in [0, 1] is share of leaves, y is the depth
    // index; both are mapped to pixels per render, so a resize or a
    // focus change is arithmetic, not a re-layout.
    partition<TreeDatum>().size([1, h.height + 1])(h)
    return h as Rect
  }, [root])

  if (!root || !layout) return <StructureFallback rootError={rootError} />

  const all = layout.descendants()
  const focus = all.find((n) => n.data.href === focusHref) ?? layout
  const span = focus.x1 - focus.x0 || 1
  const px = (v: number) => ((v - focus.x0) / span) * width
  const visible = focus.descendants().filter((n) => px(n.x1) - px(n.x0) >= 0.75)
  const rows = layout.height - focus.depth + 1
  const crumbs = focus.ancestors().reverse()

  function onCellClick(n: Rect) {
    const { data } = n
    if (data.moreCount) return
    select(data.href)
    if (canExpandNode(data.node) && !data.children) toggle(data.href)
    if (data.children && data.children.length > 0) setFocusHref(data.href)
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)' }}>
      <OverviewBar root={root} isExpanded={isExpanded} expandAllCatalogs={expandAllCatalogs} />
      <nav
        aria-label="Icicle focus"
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 4,
          padding: '6px 12px',
          fontSize: 12,
          color: 'var(--color-text-muted)',
        }}
      >
        {crumbs.map((c, i) => (
          <span key={c.data.href} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {i > 0 && <span aria-hidden="true">›</span>}
            <button
              type="button"
              onClick={() => setFocusHref(i === 0 ? null : c.data.href)}
              aria-current={c === focus ? 'location' : undefined}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                border: 'none',
                background: 'none',
                padding: '2px 4px',
                font: 'inherit',
                fontWeight: c === focus ? 600 : 400,
                color: c === focus ? 'var(--color-text)' : 'var(--color-text-muted)',
                cursor: c === focus ? 'default' : 'pointer',
              }}
            >
              <TypeIcon type={c.data.node.type} size={12} color={nodeColor(c.data.node)} />
              {c.data.node.title ?? c.data.node.id}
            </button>
          </span>
        ))}
      </nav>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 12px' }}>
        {width > 0 && (
          <svg
            width={width}
            height={rows * ROW}
            style={{ display: 'block', fontFamily: 'var(--font-sans)' }}
            onMouseLeave={() => setTooltip(null)}
          >
            <defs>
              <pattern
                id="icicle-not-loaded"
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-text-faint)" strokeWidth="1" />
              </pattern>
            </defs>
            {visible.map((n) => {
              const x = px(n.x0)
              const w = Math.max(0.75, px(n.x1) - px(n.x0) - 1)
              const y = (n.depth - focus.depth) * ROW
              const { data } = n
              const { node } = data
              if (data.moreCount) {
                return (
                  <g key={data.href} transform={`translate(${x}, ${y})`}>
                    <rect width={w} height={ROW - 1} fill="url(#icicle-not-loaded)" opacity={0.6} />
                    {w >= MIN_LABEL_WIDTH && (
                      <text x={6} y={ROW / 2 + 4} fontSize={SUB_FONT} style={{ fill: 'var(--color-text-faint)' }}>
                        +{data.moreCount} more (not loaded)
                      </text>
                    )}
                  </g>
                )
              }
              const selected = selectedHref === data.href
              const contains = !selected && browsingHref === data.href
              const closed = canExpandNode(node) && !data.children
              const loading = isLoading(data.href)
              const title = node.title ?? node.id
              const label = fitLabel(title, w - 12, LABEL_FONT)
              const sub = [itemCountLabel(node), data.children?.length ? `${data.children.length} children` : undefined]
                .filter(Boolean)
                .join(' · ')
              return (
                <g
                  key={data.href}
                  data-href={data.href}
                  transform={`translate(${x}, ${y})`}
                  onClick={() => onCellClick(n)}
                  onMouseMove={(e) => setTooltip({ ...hoverInfoFor(node), x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setTooltip(null)}
                  style={{ cursor: 'pointer', opacity: loading ? 0.55 : 1 }}
                >
                  <rect
                    width={w}
                    height={ROW - 1}
                    rx={2}
                    fill={nodeColor(node)}
                    fillOpacity={node.type === 'Catalog' ? 0.16 : 0.22}
                    stroke={selected || contains ? 'var(--color-selection)' : 'var(--color-surface)'}
                    strokeWidth={selected ? 2 : 1}
                    strokeDasharray={contains ? '3,2' : undefined}
                  />
                  {closed && (
                    // Filled dot at the cell's foot, the tree's "more to
                    // reveal" glyph, and a dashed baseline: this row
                    // stops here only because it has not been opened.
                    <>
                      <line
                        x1={0}
                        y1={ROW - 1.5}
                        x2={w}
                        y2={ROW - 1.5}
                        stroke={nodeColor(node)}
                        strokeDasharray="2,3"
                      />
                      <circle cx={w - 7} cy={ROW - 9} r={3} fill={nodeColor(node)} />
                    </>
                  )}
                  {label && (
                    <text x={6} y={sub ? 17 : ROW / 2 + 4} fontSize={LABEL_FONT} style={{ fill: 'var(--color-text)' }}>
                      {label}
                    </text>
                  )}
                  {label && sub && (
                    <text x={6} y={31} fontSize={SUB_FONT} style={{ fill: 'var(--color-text-muted)' }}>
                      {fitLabel(sub, w - 12, SUB_FONT)}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        )}
      </div>
      <div
        style={{
          padding: '6px 12px',
          fontSize: 11,
          color: 'var(--color-text-faint)',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        Width = share of loaded leaves, never an Item count · counts appear as text where known · dot and dashed
        baseline = not opened yet · hatched = children not loaded · click a node with children to focus on it
      </div>
      {tooltip && <NodeTooltip tooltip={tooltip} />}
    </div>
  )
}

/** As much of the text as fits the width, with an ellipsis; nothing when
 *  even a few characters would not fit. */
function fitLabel(text: string, widthPx: number, fontSize: number): string | undefined {
  if (widthPx < MIN_LABEL_WIDTH - 12) return undefined
  if (estimateTextWidth(text, fontSize) <= widthPx) return text
  const perChar = estimateTextWidth('n', fontSize)
  const chars = Math.max(0, Math.floor(widthPx / perChar) - 1)
  return chars >= 3 ? `${text.slice(0, chars)}…` : undefined
}
