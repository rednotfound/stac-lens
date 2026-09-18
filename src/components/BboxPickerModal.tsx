import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { ItemsMap } from './ItemsMap'
import type { CelestialBody } from '../stac/body'
import { useIsNarrow } from '../hooks/useMediaQuery'

// A stable identity — this modal never shows any Items to click (`items`
// is always `[]`), but `onSelectItem` is still a required prop and one of
// `ItemsMap`'s own effect's dependencies; a fresh no-op every render would
// tear that effect down for no reason.
const NOOP_SELECT = () => {}

/** A generous, centered map for drawing a bbox filter — opened from the
 *  Search panel's own "Draw area on map" button instead of the earlier
 *  behavior (jump to the Results panel's own Time & Space tab and enter
 *  draw mode there, borrowing that map). An explicit request, one of two
 *  approvingly-floated ideas about surfacing spatial selection consistently
 *  across the app: clicking something opens a modal dialog and the
 *  selection is made inside it — a good interaction in its own right.
 *  Reuses `ItemsMap` (the same shared map component
 *  Inspector's own per-item Spatial field and Item Set's own Results map
 *  already use) in `drawMode`, rather than a second, separate map
 *  implementation — the "one map component, used everywhere a spatial
 *  selection or display is needed" direction the user asked to pursue.
 *  Portaled to `document.body` (same reasoning as `NodeTooltip` in
 *  `StructureTree.tsx`) so this genuinely full-size dialog is never
 *  constrained by the small Search box's own `foreignObject`/SVG transform
 *  it was opened from. */
export function BboxPickerModal({
  initialBbox,
  statedBboxes,
  body,
  onConfirm,
  onCancel,
}: {
  /** The Search panel's own current draft bbox, if any — shown as the
   *  modal's own starting point so re-opening to adjust an already-drawn
   *  area doesn't discard it. */
  initialBbox?: [number, number, number, number]
  /** The Collection's own declared extent — drawn as the usual dashed
   *  reference outline and, for a fresh draw, what the map opens framed
   *  on, so the user starts where the data actually is instead of at a
   *  whole-world view. */
  statedBboxes?: number[][]
  /** Non-Earth body, if any — the map then draws a graticule, no tiles. */
  body?: CelestialBody
  onConfirm: (bbox: [number, number, number, number]) => void
  onCancel: () => void
}) {
  const narrow = useIsNarrow()
  const [drawnBbox, setDrawnBbox] = useState<[number, number, number, number] | undefined>(initialBbox)
  // Two explicit modes, not permanent draw mode. `ItemsMap`'s draw mode
  // has to take the drag gesture away from Leaflet's own drag-to-pan (the
  // only way the two can coexist on one map), so a modal that opened
  // *already* in draw mode has no way to pan at all. This was a reported
  // problem, not a guess: losing map drag means there is no way to first
  // get somewhere, zoom in, find a place, move, and *then* draw the area.
  // Every dedicated draw
  // tool does this the same way — Leaflet.draw, Copernicus Browser's and
  // NASA Earthdata Search's area tools: the map pans/zooms normally, an
  // explicit tool button arms drawing, and drawing one shape disarms it
  // again (so the very next drag pans, rather than accidentally replacing
  // the box you just drew).
  const [drawing, setDrawing] = useState(false)
  // Memoized — this is `ItemsMap`'s own `onBboxDrawn`, one of its draw-mode
  // effect's dependencies. A fresh closure on every render (which a plain
  // inline arrow function here would be, since `setDrawnBbox` itself
  // triggers exactly that re-render once a gesture completes) would tear
  // that effect down and rebuild it — detaching/reattaching the map's
  // native mouse listeners — losing whatever an *in-progress* gesture had
  // drawn so far the moment anything else in this tree re-renders mid-drag.
  // The exact same bug this codebase already found and fixed once before
  // in the old combined Search+Results component this modal replaces.
  const handleBboxDrawn = useCallback((bbox: [number, number, number, number]) => {
    setDrawnBbox(bbox)
    setDrawing(false)
  }, [])

  const hint = drawing
    ? 'Drag on the map to draw a box'
    : drawnBbox
      ? 'Area set — Confirm to apply, or Redraw'
      : 'Drag to pan, scroll to zoom — then click Draw box'

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Draw a search area"
      // No `stopPropagation` here, deliberately. React bubbles synthetic
      // events along the *React* tree, so this portal is still a React
      // descendant of the tree node that opened it, and its mouse moves
      // used to re-show that node's own tooltip. An earlier fix stopped
      // `mousemove` right here — but React's synthetic `stopPropagation()`
      // also stops the *native* event, and it runs from the portal
      // container (`document.body`), before the event ever reaches
      // `document` — which is exactly where Leaflet's drag handler listens
      // for `mousemove`/`mouseup` (`Draggable._onDown`). Net effect: the
      // map in here could zoom but never pan. The tooltip leak is now
      // stopped where it belongs instead — the node's own hover handlers
      // ignore any event whose target isn't a real DOM descendant of that
      // node (`StructureTree.tsx`) — so nothing here fights propagation.
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
      }}
      onClick={onCancel}
    >
      <div
        // Stops a click meant for the map/buttons inside from bubbling to
        // the backdrop's own `onCancel` — the standard "click outside to
        // dismiss, click inside to interact" modal pattern.
        onClick={(e) => e.stopPropagation()}
        style={{
          width: narrow ? '100vw' : 'min(900px, 92vw)',
          height: narrow ? '100vh' : 'min(680px, 88vh)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: narrow ? 0 : 'var(--radius-md)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>Draw a search area</span>
          <span
            style={{ fontSize: 11, color: 'var(--color-text-muted)', flex: 1, textAlign: 'right', marginRight: 12 }}
          >
            {hint}
          </span>
          <button
            onClick={() => setDrawing((d) => !d)}
            aria-pressed={drawing}
            style={{
              fontSize: 12,
              padding: '4px 12px',
              borderRadius: 999,
              border: '1px solid var(--color-selection)',
              background: drawing ? 'var(--color-selection)' : 'var(--color-bg)',
              color: drawing ? 'var(--color-bg)' : 'var(--color-selection)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {drawing ? 'Cancel drawing' : drawnBbox ? 'Redraw' : 'Draw box'}
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {/* Framed once on open: on the existing box when re-editing one,
           * otherwise on the Collection's own extent (`statedBboxes` is left
           * out of the fit when re-editing, or a small drawn box would be
           * lost inside a continent-sized union). `fitKey` is constant —
           * the modal mounts fresh every time it opens. */}
          <ItemsMap
            items={[]}
            onSelectItem={NOOP_SELECT}
            drawMode={drawing}
            appliedBbox={drawnBbox}
            statedBboxes={initialBbox ? undefined : statedBboxes}
            body={body}
            fitKey="bbox-picker"
            onBboxDrawn={handleBboxDrawn}
          />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '10px 14px',
            borderTop: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
          }}
        >
          {drawnBbox && (
            <button
              onClick={() => setDrawnBbox(undefined)}
              style={{
                fontSize: 12,
                padding: '5px 12px',
                borderRadius: 999,
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
          )}
          <button
            onClick={onCancel}
            style={{
              fontSize: 12,
              padding: '5px 12px',
              borderRadius: 999,
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => drawnBbox && onConfirm(drawnBbox)}
            disabled={!drawnBbox}
            style={{
              fontSize: 12,
              padding: '5px 14px',
              borderRadius: 999,
              border: '1px solid var(--color-selection)',
              background: drawnBbox ? 'var(--color-selection)' : 'var(--color-border)',
              color: 'var(--color-bg)',
              cursor: drawnBbox ? 'pointer' : 'not-allowed',
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
