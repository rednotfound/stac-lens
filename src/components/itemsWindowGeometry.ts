/** Where the Items window is and how big — pure geometry so the defaults
 *  and the clamps are testable without a browser. Screen pixels, top-left
 *  origin, like `position: fixed`. */
export interface WindowGeometry {
  x: number
  y: number
  width: number
  height: number
  /** Only the title bar shows; `height` keeps the size to restore. */
  collapsed: boolean
}

export interface Viewport {
  width: number
  height: number
}

/** The area the window should open inside by default — the explorer's
 *  left column, so it does not cover the Inspector. */
export interface Area {
  left: number
  top: number
  right: number
  bottom: number
}

export const DEFAULT_WINDOW_WIDTH = 640
export const DEFAULT_WINDOW_HEIGHT = 760
export const MIN_WINDOW_WIDTH = 320
export const MIN_WINDOW_HEIGHT = 240
export const TITLE_BAR_HEIGHT = 28
/** Space kept between the window and the area's edges on first open. */
export const WINDOW_MARGIN = 24
/** How much of the window must stay on screen when it is dragged or the
 *  viewport shrinks — enough title bar to grab it back. */
const GRAB_MIN = 80

/** First-open placement: bottom-right of the area, as large as the
 *  defaults allow inside it. The tree grows from the top-left, so this
 *  corner is the one it reaches last. */
export function defaultGeometry(viewport: Viewport, area: Area): WindowGeometry {
  const areaWidth = Math.max(0, area.right - area.left)
  const areaHeight = Math.max(0, area.bottom - area.top)
  const width = Math.max(
    MIN_WINDOW_WIDTH,
    Math.min(DEFAULT_WINDOW_WIDTH, areaWidth - 2 * WINDOW_MARGIN, viewport.width),
  )
  const height = Math.max(
    MIN_WINDOW_HEIGHT,
    Math.min(DEFAULT_WINDOW_HEIGHT, areaHeight - 2 * WINDOW_MARGIN, viewport.height - 120),
  )
  const x = Math.max(area.left + WINDOW_MARGIN, area.right - WINDOW_MARGIN - width)
  const y = Math.max(area.top + WINDOW_MARGIN, area.bottom - WINDOW_MARGIN - height)
  return clampToViewport({ x, y, width, height, collapsed: false }, viewport, area.top)
}

/** Keeps the window usable whatever happened to the viewport since it was
 *  placed: never wider or taller than the screen, never below the minimum,
 *  and always with enough of its title bar on screen to drag it back. */
export function clampToViewport(g: WindowGeometry, viewport: Viewport, headerBottom = 0): WindowGeometry {
  const width = Math.max(Math.min(MIN_WINDOW_WIDTH, viewport.width), Math.min(g.width, viewport.width))
  const maxHeight = Math.max(MIN_WINDOW_HEIGHT, viewport.height - headerBottom)
  const height = Math.max(Math.min(MIN_WINDOW_HEIGHT, maxHeight), Math.min(g.height, maxHeight))
  const x = Math.min(Math.max(g.x, -(width - GRAB_MIN)), viewport.width - GRAB_MIN)
  const y = Math.min(Math.max(g.y, headerBottom), viewport.height - TITLE_BAR_HEIGHT)
  return { x, y, width, height, collapsed: g.collapsed }
}

/** Which edge or corner a resize drags. `n` is the thin strip above the
 *  title bar; the title bar itself moves the window. */
export type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const RESIZE_DIRS: ResizeDir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

/** A resize by (dx, dy) from the pointer-down point, applied to the
 *  geometry at drag start. The edge opposite the one being dragged stays
 *  put — dragging the left edge past the minimum width pins the right
 *  edge, as every OS window does — and the result is clamped to the
 *  viewport by the caller. */
export function applyResize(start: WindowGeometry, dir: ResizeDir, dx: number, dy: number): WindowGeometry {
  let { x, y, width, height } = start
  if (dir.includes('e')) width = Math.max(MIN_WINDOW_WIDTH, start.width + dx)
  if (dir.includes('w')) {
    width = Math.max(MIN_WINDOW_WIDTH, start.width - dx)
    x = start.x + start.width - width
  }
  if (dir.includes('s')) height = Math.max(MIN_WINDOW_HEIGHT, start.height + dy)
  if (dir.includes('n')) {
    height = Math.max(MIN_WINDOW_HEIGHT, start.height - dy)
    y = start.y + start.height - height
  }
  return { ...start, x, y, width, height }
}

/** The pointer cursor for a resize direction, in CSS terms. */
export function resizeCursor(dir: ResizeDir): string {
  switch (dir) {
    case 'n':
    case 's':
      return 'ns-resize'
    case 'e':
    case 'w':
      return 'ew-resize'
    case 'ne':
    case 'sw':
      return 'nesw-resize'
    default:
      return 'nwse-resize'
  }
}
