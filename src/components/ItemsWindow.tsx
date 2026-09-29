import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePointerDrag } from '../hooks/usePointerDrag'
import type { StacNode } from '../stac/types'
import { useItemSetStore } from '../store/itemSet'
import { CursorItemSetPanels } from './CursorItemSetPanels'
import {
  applyResize,
  clampToViewport,
  defaultGeometry,
  RESIZE_DIRS,
  resizeCursor,
  TITLE_BAR_HEIGHT,
  type ResizeDir,
  type WindowGeometry,
} from './itemsWindowGeometry'
import { LinksItemSetBrowser } from './LinksItemSetBrowser'
import { TypeIcon } from './TypeIcon'

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight }
}

/** The Items window: one floating, non-modal panel above every view,
 *  showing the Item Set of the Collection being browsed — a static
 *  catalog's paged list, or an API Collection's Search and Results. It
 *  replaced the boxes that used to hang off a tree node, because the Item
 *  Set turned out to be a cross-view thing: the same search and paging
 *  are wanted from the outline and the icicle, not only from the tree
 *  (docs/DESIGN.md, "The Items window"). The window follows
 *  `browsingHref`; each Collection's query, page and buffer live in
 *  `itemSetSessions`, so closing the window or browsing elsewhere and
 *  coming back finds it as it was.
 *
 *  Window behavior follows the floating-panel conventions the design
 *  systems agree on: the title bar drags, the corner grip resizes, a
 *  minimum size, the placement is remembered, and after the viewport
 *  shrinks enough of the title bar always stays on screen to grab it
 *  back. Pointer events for mouse, touch and pen alike; the body's own
 *  scrolling is the only scroll region inside. */
export function ItemsWindow({
  node,
  areaRef,
  headerRef,
  onClose,
}: {
  node: StacNode
  /** The explorer's left column, for the first-open placement. */
  areaRef: React.RefObject<HTMLElement | null>
  /** The app header — the window never goes above its bottom edge. */
  headerRef: React.RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const stored = useItemSetStore((s) => s.windowGeometry)
  const setStored = useItemSetStore((s) => s.setWindowGeometry)
  // Placed in a layout effect, where the refs can be read: the remembered
  // geometry re-clamped to today's viewport, else the default inside the
  // left column. Nothing paints until then.
  const [geometry, setGeometry] = useState<WindowGeometry | null>(null)
  const headerBottomRef = useRef(0)
  useLayoutEffect(() => {
    headerBottomRef.current = headerRef.current?.getBoundingClientRect().bottom ?? 0
    const rect = areaRef.current?.getBoundingClientRect()
    setGeometry(
      stored
        ? clampToViewport(stored, viewport(), headerBottomRef.current)
        : defaultGeometry(
            viewport(),
            rect
              ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
              : { left: 0, top: headerBottomRef.current, right: window.innerWidth, bottom: window.innerHeight },
          ),
    )
    // Only on mount: later geometry changes come from the user's own drags.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Re-clamp when the viewport changes, so a window left near an edge is
  // still reachable after the browser shrinks.
  useEffect(() => {
    const onResize = () => {
      headerBottomRef.current = headerRef.current?.getBoundingClientRect().bottom ?? 0
      setGeometry((g) => (g ? clampToViewport(g, viewport(), headerBottomRef.current) : g))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [headerRef])

  const startRef = useRef<WindowGeometry | null>(null)
  const geometryRef = useRef<WindowGeometry | null>(geometry)
  useEffect(() => {
    geometryRef.current = geometry
  })
  const move = usePointerDrag({
    onStart: () => {
      startRef.current = geometryRef.current
    },
    onMove: (dx, dy) => {
      const s = startRef.current
      if (!s) return
      setGeometry(clampToViewport({ ...s, x: s.x + dx, y: s.y + dy }, viewport(), headerBottomRef.current))
    },
    onEnd: (moved) => {
      if (moved && geometryRef.current) setStored(geometryRef.current)
    },
  })
  // Every edge and corner resizes (the OS-window convention), through
  // one handle component per direction; the far edge stays put and the
  // whole thing is clamped to the viewport. Collapsed, only the width can
  // change: the height is the title bar's.
  function resizeBy(dir: ResizeDir, dx: number, dy: number) {
    const s = startRef.current
    if (!s) return
    const effective: ResizeDir | null = s.collapsed
      ? dir === 'e' || dir === 'ne' || dir === 'se'
        ? 'e'
        : dir === 'w' || dir === 'nw' || dir === 'sw'
          ? 'w'
          : null
      : dir
    if (!effective) return
    setGeometry(clampToViewport(applyResize(s, effective, dx, dy), viewport(), headerBottomRef.current))
  }
  function resizeStart() {
    startRef.current = geometryRef.current
  }
  function resizeEnd(moved: boolean) {
    if (moved && geometryRef.current) setStored(geometryRef.current)
  }

  // A new subject — browsing moved to another Collection while the window
  // was open — is announced, not swapped in silently: the window plays a
  // short re-appearance (fade + a flash of its border) and, if it was
  // collapsed, expands, so the eye has somewhere to land. Two identical
  // keyframes alternate so the animation restarts on every change.
  const [pulse, setPulse] = useState(0)
  const subjectRef = useRef(node.href)
  useEffect(() => {
    if (subjectRef.current === node.href) return
    subjectRef.current = node.href
    setPulse((n) => n + 1)
    const g = geometryRef.current
    if (g?.collapsed) {
      const next = { ...g, collapsed: false }
      setGeometry(next)
      setStored(next)
    }
  }, [node.href, setStored])

  function toggleCollapsed() {
    const g = geometryRef.current
    if (!g) return
    const next = { ...g, collapsed: !g.collapsed }
    setGeometry(next)
    setStored(next)
  }

  const isApi = node.items.kind === 'cursor'
  const title = node.title ?? node.id
  if (!geometry) return null
  const { x, y, width, collapsed } = geometry
  const height = collapsed ? TITLE_BAR_HEIGHT : geometry.height

  return createPortal(
    <section
      role="dialog"
      aria-label={`Items of ${title}`}
      data-items-window
      style={{
        position: 'fixed',
        left: x,
        top: y,
        width,
        height,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-selection)',
        borderRadius: 'var(--radius-sm)',
        boxShadow: '0 6px 24px rgba(0,0,0,0.22)',
        overflow: 'hidden',
        boxSizing: 'border-box',
        animation: pulse > 0 ? `stac-lens-window-${pulse % 2 ? 'a' : 'b'} 420ms ease-out` : undefined,
      }}
      data-subject-changes={pulse}
    >
      {/* The title bar is the drag handle — a dedicated handle rather than
       * the whole window, because the body is full of its own click,
       * scroll and text-input targets. */}
      <div
        {...move}
        title="Drag to move this panel"
        style={{
          flexShrink: 0,
          height: TITLE_BAR_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 6px 0 10px',
          borderBottom: collapsed ? 'none' : '1px solid var(--color-border)',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'grab',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        <TypeIcon type="Collection" size={13} color="var(--color-node-collection)" />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        <span style={{ fontWeight: 400, color: 'var(--color-text-faint)', whiteSpace: 'nowrap' }}>· Items</span>
        {isApi && (
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
            API
          </span>
        )}
        <span style={{ marginLeft: isApi ? 0 : 'auto', display: 'flex', gap: 2 }}>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand the Items window' : 'Collapse the Items window to its title bar'}
            title={collapsed ? 'Expand' : 'Collapse to the title bar'}
            style={windowButtonStyle}
          >
            {collapsed ? '▢' : '▁'}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the Items window"
            title="Close (browse a Collection or use the Items button to reopen)"
            style={windowButtonStyle}
          >
            ×
          </button>
        </span>
      </div>
      {!collapsed && (
        <>
          {/* `display: flex` here is load-bearing: the content's own
           * `flex: 1` / `height: 100%` sizing only resolves inside a flex
           * container with a definite height (the Time & Space map used to
           * collapse to zero height without it). */}
          <div
            style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 8, overflow: 'auto' }}
          >
            {isApi ? (
              <CursorItemSetPanels key={node.href} node={node as StacNode & { items: { kind: 'cursor' } }} />
            ) : (
              <LinksItemSetBrowser key={node.href} node={node as StacNode & { items: { kind: 'links' } }} />
            )}
          </div>
        </>
      )}
      {RESIZE_DIRS.map((dir) => (
        <ResizeHandle key={dir} dir={dir} onStart={resizeStart} onMove={resizeBy} onEnd={resizeEnd} />
      ))}
      {!collapsed && (
        // The visible grip mark in the corner — a hint, not the only place
        // to grab; every edge and corner has an invisible handle.
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: 3,
            bottom: 3,
            width: 12,
            height: 12,
            borderRight: '2px solid var(--color-text-faint)',
            borderBottom: '2px solid var(--color-text-faint)',
            borderRadius: '0 0 3px 0',
            opacity: 0.6,
            pointerEvents: 'none',
          }}
        />
      )}
    </section>,
    document.body,
  )
}

const windowButtonStyle: React.CSSProperties = {
  border: 'none',
  background: 'none',
  width: 22,
  height: 22,
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-muted)',
  fontSize: 14,
  lineHeight: '22px',
  cursor: 'pointer',
  padding: 0,
}

/** Thickness of the invisible resize zones along the edges; corners are
 *  squares of the same size where two edges meet. */
const EDGE = 6

function ResizeHandle({
  dir,
  onStart,
  onMove,
  onEnd,
}: {
  dir: ResizeDir
  onStart: () => void
  onMove: (dir: ResizeDir, dx: number, dy: number) => void
  onEnd: (moved: boolean) => void
}) {
  const drag = usePointerDrag({ onStart, onMove: (dx, dy) => onMove(dir, dx, dy), onEnd })
  // Inside the window's box, not straddling its edge: the window clips
  // its overflow (for the rounded corners), so a handle hanging half
  // outside is only hittable on its inner half — the right and bottom
  // edges could not be grabbed at all until this sat inside.
  const style: React.CSSProperties = { position: 'absolute', cursor: resizeCursor(dir), touchAction: 'none', zIndex: 1 }
  if (dir.includes('n')) style.top = 0
  if (dir.includes('s')) style.bottom = 0
  if (dir.includes('e')) style.right = 0
  if (dir.includes('w')) style.left = 0
  if (dir === 'n' || dir === 's') {
    style.left = EDGE
    style.right = EDGE
    style.height = EDGE
  } else if (dir === 'e' || dir === 'w') {
    style.top = EDGE
    style.bottom = EDGE
    style.width = EDGE
  } else {
    style.width = EDGE * 2
    style.height = EDGE * 2
  }
  return <div {...drag} data-resize={dir} title="Drag to resize this panel" style={style} />
}
