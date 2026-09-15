import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { ItemsMap } from './ItemsMap'

// A stable identity — this modal never shows any Items to click (`items`
// is always `[]`), but `onSelectItem` is still a required prop and one of
// `ItemsMap`'s own effect's dependencies; a fresh no-op every render would
// tear that effect down for no reason.
const NOOP_SELECT = () => {}

/** A generous, centered map for drawing a bbox filter — opened from the
 *  Search panel's own "Draw area on map" button instead of the earlier
 *  behavior (jump to the Results panel's own Time & Space tab and enter
 *  draw mode there, borrowing that map). Asked for directly, as one of two
 *  approvingly-floated ideas about surfacing spatial selection consistently
 *  across the app: "每个点了以后出了一个modal,出了一个模态对话框,然后在里面
 *  选择。对我来说这也是非常好的一个交互" (clicking something opens a modal — a
 *  dialog box — and you make your selection inside it; that's a very good
 *  interaction for me). Reuses `ItemsMap` (the same shared map component
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
  onConfirm,
  onCancel,
}: {
  /** The Search panel's own current draft bbox, if any — shown as the
   *  modal's own starting point so re-opening to adjust an already-drawn
   *  area doesn't discard it. */
  initialBbox?: [number, number, number, number]
  onConfirm: (bbox: [number, number, number, number]) => void
  onCancel: () => void
}) {
  const [drawnBbox, setDrawnBbox] = useState<[number, number, number, number] | undefined>(initialBbox)
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
  }, [])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Draw a search area"
      // Stops React's own *synthetic* event bubbling here — deliberately
      // not a DOM-nesting concern (this whole subtree lives under
      // `document.body`, nowhere near the SVG canvas, so no real native/
      // window-level listener there — d3-zoom's pan gesture, a box's own
      // drag handles — is affected by this at all). React bubbles
      // synthetic events along the *React component tree*, not the actual
      // DOM tree, and `createPortal` only changes where a component
      // renders, not its place in that React tree: this modal is still a
      // React descendant of whichever tree node's own `<g onMouseEnter/
      // onMouseMove>` opened it (via `CursorItemSetPanels`), so every
      // mouse move over the map here was bubbling straight up to that
      // node's own hover handler and re-showing *its* tooltip, positioned
      // wherever the cursor was over the modal instead. Confirmed
      // directly: "在modal出来...我一旦我绘制结束以后...我的那个光标会有一个
      // collection的那个pop-up出现...当我取消了那个modal之后,就又不见了" (once
      // the modal is open, a Collection popup appears near my cursor —
      // it disappears once I cancel the modal). The existing
      // `isInsideItemSetBox` DOM-containment check (`StructureTree.tsx`)
      // can't catch this — this modal's real DOM position is never inside
      // either box's own ref — so it's stopped here instead, at the
      // actual source.
      onMouseEnter={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
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
          width: 'min(900px, 92vw)',
          height: 'min(680px, 88vh)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
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
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            {drawnBbox ? 'Area set — drag again to redraw, or Confirm to apply' : 'Drag on the map to draw a box'}
          </span>
        </div>
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <ItemsMap items={[]} onSelectItem={NOOP_SELECT} drawMode appliedBbox={drawnBbox} onBboxDrawn={handleBboxDrawn} />
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
