import { useEffect, useState } from 'react'
import { StructureTree } from './components/StructureTree'
import { DetailPanel } from './components/DetailPanel'
import { TimeLens } from './components/TimeLens'
import { SpaceLens } from './components/SpaceLens'
import { LandingPage } from './components/LandingPage'
import { useSelectionStore } from './store/selection'
import { useQueryStore } from './store/query'
import { useDeepLinkBootstrap, useShareableUrlSync } from './hooks/useShareableUrl'

// Time Lens hugs its own content up to this cap (scrolling past it) rather
// than stretching to match Space Lens's height; Space Lens gets a fixed,
// generous height independent of Time's — a real map benefits from
// consistent screen presence regardless of how little/much temporal data
// there is, unlike a timeline that can genuinely be very short.
const TIME_LENS_MAX_HEIGHT = 220
const SPACE_LENS_HEIGHT = 340

function App() {
  const [rootHref, setRootHref] = useState<string | null>(null)
  const select = useSelectionStore((s) => s.select)
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  // Independent per-panel visibility — Structure is the one lens that's
  // always there; Detail/Time/Space each earn their space once selected,
  // but the user may still want Structure alone as the main view and turn
  // any of the rest back off without losing the selection itself.
  const [showDetail, setShowDetail] = useState(true)
  const [showTime, setShowTime] = useState(true)
  const [showSpace, setShowSpace] = useState(true)
  const drawRequest = useQueryStore((s) => s.drawRequest)

  // Item Set's own query section (embedded in Structure Lens) can now arm
  // Space/Time Lens's draw tool directly (store/query.ts, §27) — but a
  // panel toggled off is still off, so arming a tool whose Lens is
  // currently hidden needs to actually bring it back rather than silently
  // doing nothing. Scrolls it into view too, since both live in one
  // scrollable Inspector column and Detail's own content can easily push
  // either one out of the visible area.
  useEffect(() => {
    if (drawRequest === 'bbox') setShowSpace(true)
    else if (drawRequest === 'datetime') setShowTime(true)
  }, [drawRequest])

  // Split from the effect above, not combined into one — toggling a panel
  // on and scrolling to it can't happen in the same tick: `setShowSpace`/
  // `setShowTime` there hasn't committed to the DOM yet, so the panel's
  // own element doesn't exist to scroll to until after React re-renders.
  // `requestAnimationFrame` defers just long enough for that commit to
  // land (a hidden panel was previously unmounted entirely, not just
  // display:none'd — see the note on Space Lens's mount effect).
  useEffect(() => {
    if (!drawRequest) return
    const id = drawRequest === 'bbox' ? 'space-lens-panel' : 'time-lens-panel'
    const raf = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
    return () => cancelAnimationFrame(raf)
  }, [drawRequest, showSpace, showTime])

  // A `?node=<href>` URL opens straight into that node — same idea as STAC
  // Browser's shareable links (see docs/DESIGN.md), adapted to how this app
  // already works: every node's href is already absolute, and the loader
  // can fetch one in isolation, so the URL only needs to name the leaf —
  // its catalog root and ancestor chain are found live, the same way
  // Structure Lens already reveals a selection that arrived from Time/Space
  // Lens (§10/§15's parentHref chain).
  const { booting, error: bootError, target } = useDeepLinkBootstrap()
  useEffect(() => {
    if (!target) return
    setRootHref(target.rootHref)
    if (target.selectedHref) select(target.selectedHref)
  }, [target, select])
  useShareableUrlSync(rootHref, selectedHref, booting)

  function openCatalog(href: string) {
    select(null) // a selection from a previous catalog can't mean anything here
    setRootHref(href)
  }

  if (booting) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-muted)',
          fontSize: 13,
          background: 'var(--color-bg)',
        }}
      >
        Opening shared link…
      </div>
    )
  }

  if (!rootHref) {
    return <LandingPage onOpen={openCatalog} error={bootError} />
  }

  const hasSelection = !!selectedHref

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: 'var(--color-surface)',
        }}
      >
        <button
          onClick={() => {
            select(null)
            setRootHref(null)
          }}
          style={{
            fontSize: 13,
            padding: '4px 10px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            color: 'var(--color-text)',
            cursor: 'pointer',
          }}
        >
          ← Catalogs
        </button>
        <strong style={{ fontSize: 14, flexShrink: 0 }}>STAC Lens</strong>
        <span
          style={{
            fontSize: 12,
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {rootHref}
        </span>
        {hasSelection && (
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            <PanelToggle label="Detail" on={showDetail} onClick={() => setShowDetail((v) => !v)} />
            <PanelToggle label="Time" on={showTime} onClick={() => setShowTime((v) => !v)} />
            <PanelToggle label="Space" on={showSpace} onClick={() => setShowSpace((v) => !v)} />
          </div>
        )}
      </header>
      {/* Show only what's needed right now: nothing selected means Structure
       * is the whole story so far, full width — the Inspector column only
       * earns its space once there's something for it to actually show,
       * and the user can turn any of its three sections back off
       * (PanelToggle above) to make Structure the main view again without
       * losing the selection.
       *
       * Time Lens and Space Lens live *inside* this column now, stacked
       * below Detail's own facts, not in a separate full-width row below
       * both columns — that full-width version fixed the mismatch between
       * a timeline's short natural height and a map's tall one, but grew
       * the *total* footprint and ate directly into Structure Lens's own
       * height to do it, called out immediately and rightly: "这不是占用了
       * 更多画面么" (doesn't this just take up even more screen). Folding
       * them into the Inspector column instead means their combined height
       * only affects this column's own internal scroll — Structure Lens
       * keeps its full height regardless of how much Detail/Time/Space
       * content there is to show. See docs/DESIGN.md §23's update. */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div
          style={{
            width: hasSelection && (showDetail || showTime || showSpace) ? '55%' : '100%',
            borderRight:
              hasSelection && (showDetail || showTime || showSpace)
                ? '1px solid var(--color-border)'
                : 'none',
            transition: 'width 0.25s ease',
            // The tree's own SVG doesn't clip content panned/zoomed past
            // its column's edge — normally invisible off-screen, but the
            // Item Set box (foreignObject, real HTML) can land close
            // enough to this boundary that part of it renders *inside*
            // the Inspector column's own screen area, where that column's
            // later-painted, opaque content (Detail Panel's div) silently
            // covers it — confirmed directly: a button there was
            // unclickable because `elementFromPoint` at its own center
            // resolved to Detail Panel's div, not the button, even though
            // both were "in the left column" by a few pixels' margin.
            // Clipping here is also just correct pan/zoom behavior on its
            // own terms — content panned outside a viewport should
            // disappear, not surface somewhere else.
            overflow: 'hidden',
          }}
        >
          <StructureTree key={rootHref} rootHref={rootHref} />
        </div>
        {hasSelection && (showDetail || showTime || showSpace) && (
          <div style={{ width: '45%', overflow: 'auto' }}>
            {showDetail && <DetailPanel />}
            {showTime && (
              <div
                id="time-lens-panel"
                style={{
                  maxHeight: TIME_LENS_MAX_HEIGHT,
                  overflow: 'auto',
                  borderTop: showDetail ? '1px solid var(--color-border)' : 'none',
                }}
              >
                <TimeLens />
              </div>
            )}
            {/* Mounted only while selected *and* toggled on, not just
             * collapsed to zero height — Space Lens's Leaflet map would
             * otherwise initialize inside a 0×0 container and need an
             * explicit resize fix-up once it later expands. Toggling Space
             * off and back on remounts the map fresh (losing pan/zoom
             * state) rather than hiding it in place — a deliberate
             * simplification for a first pass at panel visibility; see
             * docs/DESIGN.md. */}
            {showSpace && (
              <div
                id="space-lens-panel"
                style={{
                  height: SPACE_LENS_HEIGHT,
                  borderTop: showDetail || showTime ? '1px solid var(--color-border)' : 'none',
                }}
              >
                <SpaceLens />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function PanelToggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={`${on ? 'Hide' : 'Show'} ${label}`}
      style={{
        fontSize: 12,
        padding: '3px 10px',
        borderRadius: 999,
        border: `1px solid ${on ? 'var(--color-selection)' : 'var(--color-border)'}`,
        background: on ? 'var(--color-selection)' : 'var(--color-surface)',
        color: on ? 'var(--color-bg)' : 'var(--color-text-faint)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

export default App
