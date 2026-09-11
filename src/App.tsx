import { useEffect, useState } from 'react'
import { StructureTree } from './components/StructureTree'
import { DetailPanel } from './components/DetailPanel'
import { LandingPage } from './components/LandingPage'
import { useSelectionStore } from './store/selection'
import { useDeepLinkBootstrap, useShareableUrlSync } from './hooks/useShareableUrl'

function App() {
  const [rootHref, setRootHref] = useState<string | null>(null)
  const select = useSelectionStore((s) => s.select)
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  // Time/Space used to be their own always-visible panels stacked below
  // Detail's facts, each with its own on/off toggle here, then briefly a
  // pair of Inspector tabs — now folded directly into the Human tab's own
  // field flow instead (DetailPanel.tsx: an inline timeline right where
  // "Temporal" is, an inline map right where "Spatial" is), so there is
  // only ever one panel to show/hide here: "为什么我们不能把这个...human
  // readable的那一个页面做成一个很长的东西,然后不同的属性...用不同的viewer...去把
  // 那个数据给渲染出来" (why can't the human-readable page just be one long
  // scroll, with each property rendered by whatever viewer fits it). The
  // interactive bbox/datetime query tool that used to live alongside
  // Time/Space Lens was dropped entirely in the same pass, not folded in
  // here either — see DetailPanel.tsx/ItemSetBrowser.tsx.
  const [showDetail, setShowDetail] = useState(true)

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
            <PanelToggle label="Inspector" on={showDetail} onClick={() => setShowDetail((v) => !v)} />
          </div>
        )}
      </header>
      {/* Show only what's needed right now: nothing selected means Structure
       * is the whole story so far, full width — the Inspector column only
       * earns its space once there's something for it to actually show,
       * and the user can turn it back off (PanelToggle above) to make
       * Structure the main view again without losing the selection.
       *
       * Time/Space used to live in this column as their own stacked
       * sections below Detail's facts, each independently toggleable, then
       * briefly as Inspector's own tabs — now folded a level deeper still,
       * directly into Inspector's Human tab (DetailPanel.tsx), so there is
       * exactly one thing to show/hide here regardless of what's rendering
       * inside Inspector. */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div
          style={{
            width: hasSelection && showDetail ? '55%' : '100%',
            borderRight: hasSelection && showDetail ? '1px solid var(--color-border)' : 'none',
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
        {hasSelection && showDetail && (
          <div style={{ width: '45%', overflow: 'auto' }}>
            <DetailPanel />
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
