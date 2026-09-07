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

  function openCatalog(href: string) {
    select(null) // a selection from a previous catalog can't mean anything here
    setRootHref(href)
  }

  if (!rootHref) {
    return <LandingPage onOpen={openCatalog} />
  }

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
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ width: '55%', borderRight: '1px solid var(--color-border)' }}>
          <StructureTree key={rootHref} rootHref={rootHref} />
        </div>
        <div style={{ width: '45%', overflow: 'auto' }}>
          <DetailPanel />
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          height: 280,
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
    </div>
  )
}

export default App
