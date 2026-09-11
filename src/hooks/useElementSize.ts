import { useCallback, useRef, useState } from 'react'

/** Tracks an element's real rendered size via ResizeObserver, so SVG
 *  viewBoxes can match actual pixel dimensions 1:1 instead of being
 *  stretched from a fixed logical width — a fixed width distorts bar/
 *  projection proportions whenever the container's real size differs.
 *
 *  A callback ref, not a plain object ref plus a `useEffect(..., [])` (an
 *  earlier version of this) — that version's effect ran exactly once, on
 *  the calling component's own first mount, and simply never created a
 *  `ResizeObserver` at all if the ref'd element didn't exist yet at that
 *  exact moment (real, not hypothetical: confirmed directly when App.tsx
 *  started using this for a div that only renders once a catalog is open,
 *  after the component's own first mount — `containerWidth` silently
 *  stayed `0` forever, and a drag-to-resize divider built on top of it
 *  kept clamping every resize back to a hardcoded fallback). A callback
 *  ref is invoked by React exactly when the node attaches or detaches,
 *  regardless of how many renders happen first or how late the element
 *  starts actually existing — the correct fix, not a same-effect patch. */
export function useElementSize<T extends HTMLElement>() {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const observerRef = useRef<ResizeObserver | null>(null)

  const ref = useCallback((el: T | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })
    observer.observe(el)
    observerRef.current = observer
  }, [])

  return [ref, size] as const
}
