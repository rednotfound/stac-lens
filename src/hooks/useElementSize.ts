import { useEffect, useRef, useState } from 'react'

/** Tracks an element's real rendered size via ResizeObserver, so SVG
 *  viewBoxes can match actual pixel dimensions 1:1 instead of being
 *  stretched from a fixed logical width — a fixed width distorts bar/
 *  projection proportions whenever the container's real size differs. */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return [ref, size] as const
}
