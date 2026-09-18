import { useEffect, useRef, useState } from 'react'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type D3ZoomEvent } from 'd3-zoom'
import { BLOCK_PAN_ATTR } from '../components/tree/treeGeometry'

export interface ViewTransform {
  x: number
  y: number
  k: number
}

/** d3-zoom on an `<svg>`: drag to pan, wheel to zoom, the transform as
 *  React state for a `<g transform>`. The same gesture rules as the tree
 *  canvas — d3-zoom's default filter plus "never start from inside
 *  `data-block-pan`" — so a second pannable view behaves like the first.
 *  The tree keeps its own copy because its drag handles and boxes share
 *  its zoom group; this is the plain case for views without those. The
 *  `<svg>` must be rendered from the first frame (never swapped for a
 *  loading placeholder), because the behavior binds once, on mount. */
export function useSvgPanZoom({
  scaleExtent = [0.25, 4],
  initial,
}: {
  scaleExtent?: [number, number]
  /** Where to start, given the mounted element's size — e.g. its center. */
  initial?: (svg: SVGSVGElement) => ViewTransform
} = {}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [transform, setTransform] = useState<ViewTransform>({ x: 0, y: 0, k: 1 })
  const [dragging, setDragging] = useState(false)
  const initialRef = useRef(initial)
  initialRef.current = initial

  useEffect(() => {
    const svgEl = svgRef.current
    if (!svgEl) return
    const svgSel = select(svgEl)
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent(scaleExtent)
      .filter((event: Event) => {
        const target = event.target as Element | null
        if (target?.closest(`[${BLOCK_PAN_ATTR}]`)) return false
        const e = event as MouseEvent & { ctrlKey: boolean; button: number }
        return (!e.ctrlKey || event.type === 'wheel') && !e.button
      })
      .on('start', () => setDragging(true))
      .on('end', () => setDragging(false))
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        setTransform({ x: event.transform.x, y: event.transform.y, k: event.transform.k })
      })
    svgSel.call(behavior)
    const start = initialRef.current?.(svgEl) ?? { x: 0, y: 0, k: 1 }
    svgSel.call(behavior.transform, zoomIdentity.translate(start.x, start.y).scale(start.k))
    return () => {
      svgSel.on('.zoom', null)
    }
    // Bound once per mount; the extent is a constant per view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { svgRef, transform, dragging }
}
