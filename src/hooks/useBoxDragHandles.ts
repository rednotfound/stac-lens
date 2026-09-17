import { useEffect, useRef } from 'react'
import { select } from 'd3-selection'
import { drag, type D3DragEvent } from 'd3-drag'

/** d3-drag wiring for one Item Set box: a move handle (its title bar) and a
 *  resize handle (its corner grip). Factored out so an API Collection's two
 *  boxes get exactly the behavior a static catalog's single box has.
 *
 *  `containerRef` is the zoom-transformed `<g>`; using it as d3-drag's
 *  `.container()` makes `event.dx`/`dy` local, zoom-corrected deltas, so
 *  callers never divide by the current scale. `showItemSetBox` re-binds
 *  when a box (re)mounts. `labelOnLeftRef` is read fresh on every drag
 *  event: when the box sits to the node's left its near edge is pinned and
 *  it grows leftward, so a rightward mouse motion on the grip must shrink
 *  it — the sign flip below. */
export function useBoxDragHandles(
  containerRef: React.RefObject<SVGGElement | null>,
  showItemSetBox: boolean,
  onDragBy: (dxLocal: number, dyLocal: number) => void,
  onResizeBy: (dxLocal: number, dyLocal: number) => void,
  labelOnLeftRef: React.RefObject<boolean>,
) {
  const boxHandleRef = useRef<HTMLDivElement | null>(null)
  const resizeHandleRef = useRef<HTMLDivElement | null>(null)
  const onDragByRef = useRef(onDragBy)
  useEffect(() => {
    onDragByRef.current = onDragBy
  })
  const onResizeByRef = useRef(onResizeBy)
  useEffect(() => {
    onResizeByRef.current = onResizeBy
  })

  useEffect(() => {
    const el = boxHandleRef.current
    if (!el) return
    const behavior = drag<HTMLDivElement, unknown>()
      .container(() => containerRef.current as unknown as SVGGElement)
      .on('drag', (event: D3DragEvent<HTMLDivElement, unknown, unknown>) => {
        onDragByRef.current(event.dx, event.dy)
      })
    const sel = select(el)
    sel.call(behavior)
    return () => {
      sel.on('.drag', null)
    }
  }, [containerRef, showItemSetBox])

  useEffect(() => {
    const el = resizeHandleRef.current
    if (!el) return
    const behavior = drag<HTMLDivElement, unknown>()
      .container(() => containerRef.current as unknown as SVGGElement)
      .on('drag', (event: D3DragEvent<HTMLDivElement, unknown, unknown>) => {
        const dx = labelOnLeftRef.current ? -event.dx : event.dx
        onResizeByRef.current(dx, event.dy)
      })
    const sel = select(el)
    sel.call(behavior)
    return () => {
      sel.on('.drag', null)
    }
    // `labelOnLeftRef` is a ref object whose identity never changes; its
    // `.current` is read inside the handler on every event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, showItemSetBox])

  return { boxHandleRef, resizeHandleRef }
}
