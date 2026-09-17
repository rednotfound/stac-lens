import { TypeIcon } from '../TypeIcon'
import type { TooltipState } from './treeGeometry'

const TOOLTIP_WIDTH = 240
const TOOLTIP_THUMBNAIL_HEIGHT = 140

/** The hover card for a tree node. A component of its own mainly for the
 *  viewport clamp: with a thumbnail or a description the card is tall
 *  enough to run off the bottom or right edge, which a plain cursor-plus-
 *  offset position never had to consider. Rendered by `StructureTree` at
 *  the top level (outside the zoomed `<g>`), so `position: fixed` really
 *  means the viewport — inside a transformed SVG ancestor it would not. */
export function NodeTooltip({ tooltip }: { tooltip: TooltipState }) {
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
