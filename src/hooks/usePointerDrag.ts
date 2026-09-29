import { useRef } from 'react'

/** Pointer-event drag for screen-space elements — the Items window's title
 *  bar and resize grip. One code path for mouse, touch and pen: the
 *  pointer is captured on down, deltas are measured from the down point
 *  (so a caller applies them to a snapshot it took at start), and a
 *  release that never moved past the threshold reports as a tap. Taken
 *  from `BottomSheet`'s handle. No d3-drag: nothing here lives inside a
 *  zoomed canvas, so raw client pixels are the right unit. */
export function usePointerDrag({
  onStart,
  onMove,
  onEnd,
}: {
  onStart?: () => void
  /** Total offset from the pointer-down point, in client pixels. */
  onMove: (dx: number, dy: number) => void
  onEnd: (moved: boolean) => void
}) {
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  return {
    onPointerDown(e: React.PointerEvent<HTMLElement>) {
      if (e.button !== 0 && e.pointerType === 'mouse') return
      // A control inside the handle (the title bar's collapse and close
      // buttons) is not a grab: capturing the pointer here would retarget
      // its click to the handle and the button would never fire. Decided
      // by DOM containment, never by `stopPropagation` on the button.
      if ((e.target as Element).closest('button, input, select, a, textarea')) return
      start.current = { x: e.clientX, y: e.clientY, moved: false }
      e.currentTarget.setPointerCapture(e.pointerId)
      onStart?.()
    },
    onPointerMove(e: React.PointerEvent<HTMLElement>) {
      const s = start.current
      if (!s) return
      const dx = e.clientX - s.x
      const dy = e.clientY - s.y
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) s.moved = true
      onMove(dx, dy)
    },
    onPointerUp() {
      const s = start.current
      start.current = null
      if (!s) return
      onEnd(s.moved)
    },
    onPointerCancel() {
      const s = start.current
      start.current = null
      if (!s) return
      onEnd(s.moved)
    },
  }
}
