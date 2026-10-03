import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

// The two docked panes — the Items panel and the Inspector — share one set
// of parts, so they read as the same kind of thing (docs/DESIGN.md §122):
// - PaneHeader: a 30 px bar naming the pane by its role — an icon, a
//   title, an optional muted context ("in Landsat Collection 2 Level-2"),
//   the pane's own badges. No hide button of its own: showing and hiding
//   has one place, the header toggles (Apple's split views);
// - PaneSplitter: a hairline divider with a wider grab zone that lights up
//   on hover after a short delay (VS Code's sash), drags by pointer
//   capture, snaps the pane hidden when dragged below its minimum, resets
//   to the default width on double-click, and follows the WAI-ARIA Window
//   Splitter pattern for keyboard use;
// - PaneToggle: the fixed show/hide switches at the header's trailing end
//   (Apple's toolbar toggles, VS Code's layout controls), each with the
//   pane's icon and its name written out — two panes, so a name is
//   cheaper than a glyph to learn.

export const PANE_HEADER_HEIGHT = 30

export function PaneHeader({
  icon,
  title,
  context,
  badges,
}: {
  icon: ReactNode
  title: string
  /** Muted, after the title, cut with an ellipsis when long. */
  context?: string
  badges?: ReactNode
}) {
  return (
    <div className="stac-lens-pane-header">
      {icon}
      <span className="stac-lens-pane-title">{title}</span>
      {context && (
        <span title={context} className="stac-lens-pane-context">
          {context}
        </span>
      )}
      {badges && (
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>{badges}</span>
      )}
    </div>
  )
}

/** Width of the splitter's grab zone; the visible line is 1 px inside it. */
export const SPLITTER_WIDTH = 8
const KEY_STEP = 16
const KEY_STEP_LARGE = 64

/** A vertical divider to the left of a pane on the right: dragging left
 *  widens the pane. `onResize` receives the new width, already clamped to
 *  [min, max]; dragging below `min` by more than a third of it hides the
 *  pane instead (`onHide`). */
export function PaneSplitter({
  width,
  min,
  max,
  defaultWidth,
  label,
  controls,
  returnFocusTo,
  onResize,
  onHide,
}: {
  width: number
  min: number
  max: number
  defaultWidth: number
  /** e.g. "Resize the Items panel". */
  label: string
  /** The id of the pane it resizes. */
  controls: string
  /** The `id` of the PaneToggle that brings the pane back — keyboard focus
   *  moves there when Enter hides the pane, instead of falling to <body>
   *  with the unmounted splitter. */
  returnFocusTo?: string
  onResize: (width: number) => void
  onHide: () => void
}) {
  const [dragging, setDragging] = useState(false)
  const start = useRef<{ x: number; width: number } | null>(null)
  const clamp = (w: number) => Math.round(Math.min(Math.max(w, min), max))

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { x: e.clientX, width }
    setDragging(true)
  }
  function endDrag() {
    start.current = null
    setDragging(false)
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!start.current) return
    // No button held: the release was missed (capture lost) — stop, don't
    // let plain hovering keep resizing.
    if (e.buttons === 0) return endDrag()
    const next = start.current.width + (start.current.x - e.clientX)
    onResize(clamp(next))
  }
  function onPointerEnd(e: PointerEvent<HTMLDivElement>) {
    if (!start.current) return
    const next = start.current.width + (start.current.x - e.clientX)
    endDrag()
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    // Dragged well past the minimum: the user is pushing the pane away.
    if (next < min - min / 3) onHide()
  }
  // WAI-ARIA Window Splitter: arrows move the splitter, Home/End to the
  // pane's minimum/maximum, Enter collapses the pane (it comes back from
  // its header toggle).
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP
    if (e.key === 'ArrowLeft') onResize(clamp(width + step))
    else if (e.key === 'ArrowRight') onResize(clamp(width - step))
    else if (e.key === 'Home') onResize(min)
    else if (e.key === 'End') onResize(max)
    else if (e.key === 'Enter') {
      onHide()
      if (returnFocusTo) {
        requestAnimationFrame(() =>
          document.querySelector<HTMLButtonElement>(`[data-pane-toggle="${returnFocusTo}"]`)?.focus(),
        )
      }
    } else return
    e.preventDefault()
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-controls={controls}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`${label} — drag; double-click for the default width`}
      className="stac-lens-splitter"
      data-dragging={dragging ? '' : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={endDrag}
      onDoubleClick={() => onResize(clamp(defaultWidth))}
      onKeyDown={onKeyDown}
    />
  )
}

/** A show/hide switch for one pane, pressed while the pane is shown: its
 *  icon and its name, so neither has to be guessed. */
export function PaneToggle({
  id,
  label,
  pressed,
  disabled,
  title,
  icon,
  onToggle,
}: {
  /** Names the toggle for `PaneSplitter.returnFocusTo`. */
  id: string
  label: string
  pressed: boolean
  disabled?: boolean
  title: string
  icon: ReactNode
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      data-pane-toggle={id}
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      onClick={onToggle}
      className="stac-lens-pane-toggle"
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

const glyph = {
  viewBox: '0 0 20 20',
  fill: 'none',
  strokeWidth: 1.4,
  strokeLinejoin: 'round' as const,
  strokeLinecap: 'round' as const,
  'aria-hidden': true,
}

/** A set of Items: four small photo frames in a grid — a page of Items,
 *  the Item glyph's frame repeated, not the Collection's stack. */
export function ItemSetIcon({ size = 14, color = 'var(--color-node-item)' }: { size?: number; color?: string }) {
  return (
    <svg {...glyph} width={size} height={size} stroke={color} style={{ flexShrink: 0 }}>
      <rect x="2.5" y="3" width="6.5" height="6" rx="1" />
      <rect x="11" y="3" width="6.5" height="6" rx="1" />
      <rect x="2.5" y="11" width="6.5" height="6" rx="1" />
      <rect x="11" y="11" width="6.5" height="6" rx="1" />
      <path d="M3.5 8 5.3 6.2 6.6 7.3 8 6" />
    </svg>
  )
}

/** The Inspector: details of what is selected — the familiar ⓘ. */
export function InspectorIcon({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg {...glyph} width={size} height={size} stroke={color} style={{ flexShrink: 0 }}>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 9v5" />
      <path d="M10 6.2v.1" strokeWidth={2} />
    </svg>
  )
}
