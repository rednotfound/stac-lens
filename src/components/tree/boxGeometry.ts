export interface BoxOffset {
  dxHoriz: number
  dyVert: number
}
export interface BoxSize {
  width: number
  height: number
}

/** Box offsets are deliberately not shaped like node offsets. Node offsets
 *  use d3-hierarchy's convention (x vertical, y horizontal, see
 *  `linkGenerator`); a box is positioned by plain `foreignObject` x/y
 *  attributes (horizontal, vertical). Sharing one `{ x, y }` shape for both
 *  invited exactly the swapped-axis bug the tree once had. */
export const ZERO_BOX_OFFSET: BoxOffset = { dxHoriz: 0, dyVert: 0 }

/** One box's drag-to-move and drag-to-resize geometry — identical for a
 *  static catalog's single box and each of an API Collection's two boxes. */
export interface BoxGeometry {
  offset: BoxOffset
  onDragBy: (dxLocal: number, dyLocal: number) => void
  size: BoxSize
  onResizeBy: (dxLocal: number, dyLocal: number) => void
}

/** Default size of a static catalog's Item Set box. Wide from the start —
 *  the Time & Space view needs horizontal room to be legible, not just a
 *  list of ids — and tall enough to show a real page of rows rather than
 *  three. Only defaults: every box is freely resizable. */
export const DEFAULT_BOX_WIDTH = 640
export const DEFAULT_BOX_HEIGHT = 760
/** Resize floors: still enough for a few rows or a minimal plot. A resize
 *  past these snaps back rather than shrinking further. */
export const MIN_BOX_WIDTH = 320
export const MIN_BOX_HEIGHT = 320
/** Horizontal gap between the end of a node's label and its box, so the
 *  connector curve has room to be seen instead of being squeezed into a
 *  few pixels. */
export const ITEM_SET_BOX_GAP = 60
/** Vertical drop from the node's own baseline to a box's top edge. */
export const BOX_TOP_OFFSET = 14

/** An API Collection's Search box holds three condition rows and a footer
 *  — far less than Results, which keeps the full default height. */
export const DEFAULT_SEARCH_BOX_WIDTH = 640
export const DEFAULT_SEARCH_BOX_HEIGHT = 180
export const DEFAULT_RESULTS_BOX_WIDTH = 640
export const DEFAULT_RESULTS_BOX_HEIGHT = 760
/** Vertical gap between the Search box's default bottom edge and the
 *  Results box's default top edge — room to draw the Search→Results
 *  connector, same reasoning as `ITEM_SET_BOX_GAP`. */
export const SEARCH_RESULTS_GAP = 40
/** Results starts below Search by default (there is no other anchor to
 *  derive "below" from than the Search box's default height). A starting
 *  position only; both boxes are independently draggable afterwards. */
export const DEFAULT_RESULTS_BOX_OFFSET: BoxOffset = {
  dxHoriz: 0,
  dyVert: DEFAULT_SEARCH_BOX_HEIGHT + SEARCH_RESULTS_GAP,
}
/** A Search box has little natural content; flooring it at the general
 *  320px would leave a mostly empty card if someone dragged it that far. */
export const MIN_SEARCH_BOX_HEIGHT = 90
/** Connectors aim a little inside a box's top edge, near its title bar,
 *  rather than at its vertical center: `linkHorizontal`'s curve is shaped
 *  for spans with real horizontal distance, and aimed at the center of a
 *  box sitting mostly below its source it degenerated into an invisible
 *  sliver hugging the box edge. */
export const BOX_CONNECTOR_TARGET_INSET = 20

/** Builds one box's `BoxGeometry` over a per-node offset/size Map pair.
 *  The static box and the two API boxes are identical in shape; each just
 *  keeps its own Maps. Pure — the setters come from the caller's state. */
export function makeBoxGeometry(
  href: string,
  offsets: Map<string, BoxOffset>,
  setOffsets: React.Dispatch<React.SetStateAction<Map<string, BoxOffset>>>,
  defaultOffset: BoxOffset,
  sizes: Map<string, BoxSize>,
  setSizes: React.Dispatch<React.SetStateAction<Map<string, BoxSize>>>,
  defaultSize: BoxSize,
  minWidth: number,
  minHeight: number,
): BoxGeometry {
  return {
    offset: offsets.get(href) ?? defaultOffset,
    onDragBy: (dxLocal, dyLocal) => {
      setOffsets((prev) => {
        const next = new Map(prev)
        const base = prev.get(href) ?? defaultOffset
        next.set(href, { dxHoriz: base.dxHoriz + dxLocal, dyVert: base.dyVert + dyLocal })
        return next
      })
    },
    size: sizes.get(href) ?? defaultSize,
    onResizeBy: (dxLocal, dyLocal) => {
      setSizes((prev) => {
        const next = new Map(prev)
        const base = prev.get(href) ?? defaultSize
        next.set(href, {
          width: Math.max(minWidth, base.width + dxLocal),
          height: Math.max(minHeight, base.height + dyLocal),
        })
        return next
      })
    },
  }
}

/** Default box sizes, clamped to the viewport. The desktop defaults
 *  (640 wide, 760 tall) are wider than a phone; on a narrow screen a box
 *  takes the width that is there (minus a margin to see it is a box) and
 *  about half the height, so the tree above it stays reachable. Read at
 *  the moment a box first opens — only defaults; every box stays freely
 *  resizable, and a remembered size is never overridden. */
export function defaultBoxSize(kind: 'main' | 'search' | 'results'): BoxSize {
  const vw = typeof window === 'undefined' ? 1600 : window.innerWidth
  const vh = typeof window === 'undefined' ? 1000 : window.innerHeight
  const width = Math.max(
    MIN_BOX_WIDTH - 40,
    Math.min(kind === 'search' ? DEFAULT_SEARCH_BOX_WIDTH : DEFAULT_BOX_WIDTH, vw - 24),
  )
  if (kind === 'search') return { width, height: vw < 720 ? 220 : DEFAULT_SEARCH_BOX_HEIGHT }
  const height = Math.max(MIN_BOX_HEIGHT, Math.min(DEFAULT_BOX_HEIGHT, Math.round(vh * 0.5)))
  return { width, height }
}

/** Results sits below Search by default; the gap is the same wherever the
 *  Search box's default height lands. */
export function defaultResultsOffset(): BoxOffset {
  return { dxHoriz: 0, dyVert: defaultBoxSize('search').height + SEARCH_RESULTS_GAP }
}
