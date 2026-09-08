import { useState } from 'react'
import { StructureTree } from './components/StructureTree'
import { DetailPanel } from './components/DetailPanel'
import { TimeLens } from './components/TimeLens'
import { SpaceLens } from './components/SpaceLens'
import { LandingPage } from './components/LandingPage'
import { useSelectionStore } from './store/selection'

function App() {
  const [rootHref, setRootHref] = useState<string | null>(null)
  const select = useSelectionStore((s) => s.select)
  const selectedHref = useSelectionStore((s) => s.selectedHref)

  function openCatalog(href: string) {
    select(null) // a selection from a previous catalog can't mean anything here
    setRootHref(href)
  }

  if (!rootHref) {
    return <LandingPage onOpen={openCatalog} />
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
      </header>
      {/* Show only what's needed right now: nothing selected means Structure
       * is the whole story so far, full width — Detail/Time/Space only earn
       * their space once there's something for them to actually show. */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div
          style={{
            width: hasSelection ? '55%' : '100%',
            borderRight: hasSelection ? '1px solid var(--color-border)' : 'none',
            transition: 'width 0.25s ease',
          }}
        >
          <StructureTree key={rootHref} rootHref={rootHref} />
        </div>
        {hasSelection && (
          <div style={{ width: '45%', overflow: 'auto' }}>
            <DetailPanel />
          </div>
        )}
      </div>
      {/* Mounted only once something's selected, not just collapsed to zero
       * height — Space Lens's Leaflet map would otherwise initialize inside
       * a 0×0 container and need an explicit resize fix-up once it later
       * expands. Selection never reverts to "nothing" within a session
       * short of leaving the catalog entirely (which unmounts this whole
       * tree anyway), so this only ever mounts once. */}
      {hasSelection && (
        <div
          style={{
            display: 'flex',
            height: 280,
            flexShrink: 0,
            borderTop: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
          }}
        >
          <div style={{ width: '62%', borderRight: '1px solid var(--color-border)' }}>
            <TimeLens />
          </div>
          <div style={{ width: '38%' }}>
            <SpaceLens />
          </div>
        </div>
      )}
    </div>
  )
}

export default App
