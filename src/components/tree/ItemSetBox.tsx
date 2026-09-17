import { linkGenerator } from './treeGeometry'

export type BoxHeaderIconKind = 'search' | 'list'

/** Title-bar glyphs — tiny inline SVGs in the same stroke language as
 *  `TypeIcon`, no icon library. */
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

/** One Item Set box, fully rendered: a connector curve from an arbitrary
 *  source point (same swapped `{ x: vertical, y: horizontal }` convention as
 *  `linkGenerator` everywhere else) and a `<foreignObject>` holding a
 *  window-style panel — a title bar that is also the drag handle, the
 *  body, and a corner resize grip. A static catalog's single box and each
 *  of an API Collection's two boxes (Search, Results) render through this
 *  one function; only the content and the connector's source differ.
 *
 *  Not a component — a plain function returning JSX, so it can be called
 *  more than once per render and takes ref *objects* (forwarded into
 *  `ref={…}` below, never dereferenced here). The panel anatomy follows
 *  what OS title bars, node editors (ComfyUI, Unreal Blueprints, Blender),
 *  tool windows and design-system cards all share: title bar as identity
 *  and drag handle, body, corner grip. */
export function renderBox(opts: {
  key: string
  /** Short, like a tool window's name ("Search", "Results", "Items") — the
   *  Collection's own name is already on the tree node and in the
   *  Inspector. */
  title: string
  icon: BoxHeaderIconKind
  /** Optional pill at the title bar's right edge — the "API" tag for the two
   *  API-mode boxes. */
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
      // Chrome only: clicking a non-focusable `<div>` inside a
      // `<foreignObject>` makes Chrome focus the nearest SVG ancestor — this
      // `<g>` — and draw its default focus ring around it (`outline: auto`),
      // a frame spanning from the node to the box's far corner. Confirmed by
      // reading `document.activeElement` after a row click. Nothing here is
      // meaningfully focusable, so the ring is suppressed; controls inside
      // keep their own focus behavior.
      style={{ outline: 'none' }}
    >
      {/* A real edge, not just adjacent placement: the same generator and
       * stroke as every parent→child link, fed local coordinates. The box is
       * a floating overlay outside the tree's row layout, so this curve is
       * its only visual tie to what it belongs to. */}
      <path
        d={linkGenerator({ source: connectorSource, target: connectorTarget }) ?? undefined}
        fill="none"
        style={{ stroke: 'var(--color-border)' }}
        strokeWidth={1.5}
      />
      <foreignObject x={foreignX} y={foreignY} width={size.width} height={size.height}>
        <div
          ref={contentRef}
          // Scrolling, clicking or typing inside the box must never also pan
          // the canvas — `data-block-pan` is the one rule `zoom.filter()`
          // checks, for every event type at once.
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
            // A flex column so the body can fill whatever height the box
            // currently has (via `flex: 1`) and follow a resize.
            display: 'flex',
            flexDirection: 'column',
            // Clips the title bar's full-bleed background to the rounded
            // corners; the body wrapper below owns the overflow safety net.
            overflow: 'hidden',
          }}
        >
          {/* The title bar is the drag handle — a dedicated handle rather than
           * the whole box, because the body is full of its own click, scroll
           * and text-input targets. */}
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
          {/* `display: flex` here is load-bearing, not decorative. This
           * wrapper is a flex item of the box (so it shrinks to the space
           * below the title bar) *and* must be a flex container for the
           * children, whose own `flex: 1` / `height: 100%` sizing is
           * meaningless otherwise — flex properties only apply inside an
           * actual flex container, and a percentage height only resolves
           * against a definite height. Without it the content laid out at
           * its natural height, the footer needed a scroll to reach, and the
           * Time & Space map collapsed to zero height. */}
          <div
            style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 8, overflow: 'auto' }}
          >
            {opts.children}
          </div>
          {/* Corner resize grip — the OS-window convention. When the box sits
           * to the node's left, its near (right) edge is pinned and it grows
           * leftward, so the grip moves to the bottom-left with the mirrored
           * cursor; `useBoxDragHandles` flips the drag's sign to match. */}
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
