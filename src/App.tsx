import { useState } from 'react'
import { StructureTree } from './components/StructureTree'
import { DetailPanel } from './components/DetailPanel'
import { TimeLens } from './components/TimeLens'
import { SpaceLens } from './components/SpaceLens'

const FIXTURES = {
  atlas: 'https://digital-atlas.s3.amazonaws.com/stac/public_stac/catalog.json',
  specExample: 'https://raw.githubusercontent.com/radiantearth/stac-spec/master/examples/catalog.json',
}

function App() {
  const [rootHref, setRootHref] = useState<string>(FIXTURES.atlas)

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
        <strong style={{ fontSize: 14 }}>STAC Lens</strong>
        <select
          value={rootHref}
          onChange={(e) => setRootHref(e.target.value)}
          style={{
            fontSize: 13,
            padding: '4px 8px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            color: 'var(--color-text)',
          }}
        >
          <option value={FIXTURES.atlas}>Africa Adaptation Atlas</option>
          <option value={FIXTURES.specExample}>STAC spec example (minimal)</option>
        </select>
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
