import { useEffect, useRef, useState } from 'react'

export type SheetSnap = 'peek' | 'half' | 'full'

const PEEK_HEIGHT = 56
const SNAP_FRACTION: Record<SheetSnap, number> = { peek: 0, half: 0.5, full: 0.9 }

function snapHeight(snap: SheetSnap, viewport: number): number {
  return snap === 'peek' ? PEEK_HEIGHT : Math.round(viewport * SNAP_FRACTION[snap])
}

/** A bottom sheet for the phone layout: the Inspector drawn up over the
 *  Structure canvas rather than beside it, the standard form for a detail
 *  panel over a map or canvas on a phone. Three snap heights — peek (the
 *  title bar only), half, and full — reached by dragging the handle or
 *  tapping it; the parent owns the snap state so it can pop the sheet to
 *  half when a new node is selected.
 *
 *  Only the handle drags. The content below scrolls on its own, which on a
 *  fixed-position sheet is the expected behavior (the page behind does not
 *  scroll at all in the explorer), not the nested-scroll problem the
 *  landing sidebar avoids. Pointer events, so mouse and touch share one
 *  path; `touch-action: none` on the handle keeps the browser from
 *  scrolling or zooming the page during the gesture. */
export function BottomSheet({
  snap,
  onSnapChange,
  peek,
  scrollKey,
  children,
}: {
  snap: SheetSnap
  onSnapChange: (snap: SheetSnap) => void
  /** What the peek state shows: one line, the selected object's name. */
  peek: React.ReactNode
  /** Changes when the sheet's subject changes; the content scrolls back to
   *  the top so the new subject's title is what appears, not wherever the
   *  previous one had been scrolled to. */
  scrollKey?: string | null
  children: React.ReactNode
}) {
  const [viewport, setViewport] = useState(() => window.innerHeight)
  useEffect(() => {
    const onResize = () => setViewport(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // While dragging, the height follows the pointer directly (no
  // transition); on release it animates to the nearest snap.
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const dragStart = useRef<{ y: number; height: number; moved: boolean } | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [scrollKey])

  const height = dragHeight ?? snapHeight(snap, viewport)

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    dragStart.current = { y: e.clientY, height, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const start = dragStart.current
    if (!start) return
    const next = Math.max(PEEK_HEIGHT, Math.min(viewport * 0.95, start.height + (start.y - e.clientY)))
    if (Math.abs(e.clientY - start.y) > 4) start.moved = true
    setDragHeight(next)
  }
  function onPointerUp() {
    const start = dragStart.current
    dragStart.current = null
    if (!start) return
    if (!start.moved) {
      // A tap on the handle steps the sheet up one stop, or back to peek
      // from full — a no-drag way to move it.
      onSnapChange(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'peek')
      setDragHeight(null)
      return
    }
    const current = dragHeight ?? start.height
    const candidates: SheetSnap[] = ['peek', 'half', 'full']
    const nearest = candidates.reduce((best, s) =>
      Math.abs(snapHeight(s, viewport) - current) < Math.abs(snapHeight(best, viewport) - current) ? s : best,
    )
    setDragHeight(null)
    onSnapChange(nearest)
  }

  return (
    <div
      role="dialog"
      aria-label="Inspector"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        height,
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-surface)',
        borderTop: '1px solid var(--color-border)',
        borderRadius: '12px 12px 0 0',
        boxShadow: '0 -6px 24px rgba(0,0,0,0.18)',
        transition: dragHeight === null ? 'height 200ms ease-out' : 'none',
      }}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label={snap === 'peek' ? 'Expand Inspector' : 'Resize Inspector'}
        style={{
          flexShrink: 0,
          height: PEEK_HEIGHT,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '0 16px',
          cursor: 'grab',
          touchAction: 'none',
          userSelect: 'none',
        }}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--color-border)' }} aria-hidden />
        <div
          style={{
            width: '100%',
            fontSize: 13,
            color: 'var(--color-text)',
            textAlign: 'center',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {peek}
        </div>
      </div>
      <div
        ref={contentRef}
        style={{ flex: 1, minHeight: 0, overflow: 'auto', borderTop: '1px solid var(--color-border)' }}
      >
        {children}
      </div>
    </div>
  )
}
