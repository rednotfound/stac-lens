import { useEffect, type RefObject } from 'react'

/** Closes an open disclosure (a popover or a panel opened by a button) on
 *  Escape — handing focus back to its button — and on a press outside both
 *  the button and the panel. Outside is decided by DOM containment, never
 *  `stopPropagation`. Shared by the Share panel and the Children filter's
 *  value lists. */
export function useDismiss(
  open: boolean,
  refs: { button: RefObject<HTMLElement | null>; panel: RefObject<HTMLElement | null> },
  close: (returnFocus: boolean) => void,
): void {
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node
      if (refs.panel.current?.contains(t) || refs.button.current?.contains(t)) return
      close(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close(true)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable; `close` is read fresh through the closure each open
  }, [open])
}
