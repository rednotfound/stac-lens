import { describe, expect, it } from 'vitest'
import {
  applyResize,
  clampToViewport,
  defaultGeometry,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  TITLE_BAR_HEIGHT,
} from '../itemsWindowGeometry'

const viewport = { width: 1400, height: 900 }
const area = { left: 0, top: 56, right: 940, bottom: 900 }

describe('itemsWindowGeometry', () => {
  it('opens at the bottom-right of the area with the default size', () => {
    const g = defaultGeometry(viewport, area)
    expect(g).toEqual({ x: 940 - 24 - 640, y: 900 - 24 - g.height, width: 640, height: 760, collapsed: false })
  })

  it('shrinks the default to a small area but never below the minimum', () => {
    const g = defaultGeometry({ width: 800, height: 500 }, { left: 0, top: 56, right: 500, bottom: 500 })
    expect(g.width).toBe(452)
    expect(g.height).toBe(Math.max(MIN_WINDOW_HEIGHT, 500 - 120))
    expect(g.x).toBe(24)
  })

  it('keeps a grabbable title bar on screen after the viewport shrinks', () => {
    const g = clampToViewport({ x: 1500, y: 880, width: 640, height: 760, collapsed: false }, viewport, 56)
    expect(g.x).toBe(1400 - 80)
    expect(g.y).toBe(900 - TITLE_BAR_HEIGHT)
    const off = clampToViewport({ x: -900, y: -100, width: 640, height: 760, collapsed: false }, viewport, 56)
    expect(off.x).toBe(-(640 - 80))
    expect(off.y).toBe(56)
  })

  it('clamps the size to the viewport and to the minimum', () => {
    const big = clampToViewport({ x: 0, y: 0, width: 5000, height: 5000, collapsed: false }, viewport, 56)
    expect(big.width).toBe(1400)
    expect(big.height).toBe(900 - 56)
    const tiny = clampToViewport({ x: 0, y: 0, width: 10, height: 10, collapsed: true }, viewport)
    expect(tiny).toMatchObject({ width: MIN_WINDOW_WIDTH, height: MIN_WINDOW_HEIGHT, collapsed: true })
  })

  it('resizes from any edge, keeping the opposite edge in place', () => {
    const start = { x: 100, y: 100, width: 400, height: 300, collapsed: false }
    expect(applyResize(start, 'e', 50, 999)).toMatchObject({ x: 100, width: 450, height: 300 })
    expect(applyResize(start, 'w', -50, 0)).toMatchObject({ x: 50, width: 450 })
    expect(applyResize(start, 's', 0, 40)).toMatchObject({ y: 100, height: 340 })
    expect(applyResize(start, 'n', 0, -40)).toMatchObject({ y: 60, height: 340 })
    expect(applyResize(start, 'nw', -10, -20)).toMatchObject({ x: 90, y: 80, width: 410, height: 320 })
    // Past the minimum the far edge stays put: the right edge is x + width.
    const shrunk = applyResize(start, 'w', 300, 0)
    expect(shrunk.width).toBe(MIN_WINDOW_WIDTH)
    expect(shrunk.x + shrunk.width).toBe(500)
    const shrunkUp = applyResize(start, 'n', 0, 500)
    expect(shrunkUp.height).toBe(MIN_WINDOW_HEIGHT)
    expect(shrunkUp.y + shrunkUp.height).toBe(400)
  })
})
