import { loader } from '../stac/loaderInstance'
import { classifyNodeShape } from '../stac/types'
import { useSelectionStore } from '../store/selection'
import { describeTemporal } from '../stac/describe'
import { KNOWN_EXTENSION_PREFIXES } from '../stac/namespaces'

/** Bare-bones inspector: derived facts first, raw JSON always available
 *  underneath. No Human/JSON toggle yet — that needs extension-specific
 *  interpreters (v0.2+); for now everything shown is either a direct
 *  source field or a clearly-labeled derived one. */
export function DetailPanel() {
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  // Synchronous cache read — the node is already loaded by the time it's
  // selectable in Structure Lens, so this never needs its own effect.
  const node = selectedHref ? loader.get(selectedHref) : undefined

  if (!selectedHref) {
    return (
      <div style={{ padding: 16, color: 'var(--color-text-muted)', fontSize: 13 }}>
        Select a node to inspect.
      </div>
    )
  }
  if (!node) {
    return (
      <div style={{ padding: 16, color: 'var(--color-text-muted)', fontSize: 13 }}>loading…</div>
    )
  }

  const shape = classifyNodeShape(node)

  return (
    <div style={{ padding: 16, fontSize: 13, overflow: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 4 }}>
        <strong>{node.title ?? node.id}</strong>
      </div>
      <div style={{ color: 'var(--color-text-muted)', marginBottom: 12 }}>
        {node.type} · {shape} · <span title="canonical fetch URL">{node.href}</span>
      </div>

      <Field label="Temporal (source)">
        {node.temporal ? describeTemporal(node.temporal) : <em>none</em>}
      </Field>

      <Field label="Spatial (source)">
        {node.spatial ? (
          <>
            bbox: {node.spatial.bbox ? JSON.stringify(node.spatial.bbox) : <em>none</em>}
            {node.spatial.geometryInvalid && (
              <div style={{ color: 'var(--color-node-warning)' }}>
                ⚠ raw `geometry` field is present but is not valid GeoJSON — falling back to bbox
                only.
              </div>
            )}
          </>
        ) : (
          <em>none</em>
        )}
      </Field>

      {(node.declaredCollectionHref || node.declaredParentHref) && (
        <Field label="Containment (source)">
          {node.declaredCollectionHref && (
            <div>collection: {node.declaredCollectionHref}</div>
          )}
          {node.declaredParentHref && <div>parent: {node.declaredParentHref}</div>}
          {node.declaredCollectionHref &&
            node.declaredParentHref &&
            node.declaredCollectionHref !== node.declaredParentHref && (
              <div style={{ color: 'var(--color-node-warning)', marginTop: 2 }}>
                ⚠ `rel:collection` and `rel:parent` disagree — this node is
                physically reachable from one location but thematically belongs to
                another. Per STAC's own philosophy, `collection` is the authoritative
                one; the tree navigates/highlights through it.
              </div>
            )}
        </Field>
      )}

      <Field label="Declared extensions (stac_extensions)">
        {node.declaredExtensions.length ? node.declaredExtensions.join(', ') : <em>none</em>}
      </Field>

      <Field label="Property namespaces observed (derived)">
        {node.propertyNamespaces.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {node.propertyNamespaces.map((ns) => {
              const known = !!KNOWN_EXTENSION_PREFIXES[ns]
              return (
                <span
                  key={ns}
                  style={{
                    padding: '1px 6px',
                    borderRadius: 'var(--radius-sm)',
                    background: known ? 'var(--color-badge-known-bg)' : 'var(--color-badge-unknown-bg)',
                    color: known ? 'var(--color-badge-known-text)' : 'var(--color-badge-unknown-text)',
                  }}
                  title={KNOWN_EXTENSION_PREFIXES[ns] ?? 'unrecognized namespace — degrading gracefully'}
                >
                  {ns}
                </span>
              )
            })}
          </div>
        ) : (
          <em>none</em>
        )}
      </Field>

      {node.schemaHints && (
        <Field label="Schema hints (publisher-declared, non-authoritative)">
          {Object.keys(node.schemaHints).join(', ')}
        </Field>
      )}

      <div style={{ marginTop: 16 }}>
        <div style={{ color: 'var(--color-text-muted)', marginBottom: 4 }}>Source STAC JSON</div>
        <pre
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            padding: 8,
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            maxHeight: 400,
            overflow: 'auto',
          }}
        >
          {JSON.stringify(node.raw, null, 2)}
        </pre>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          color: 'var(--color-text-muted)',
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
        }}
      >
        {label}
      </div>
      <div>{children}</div>
    </div>
  )
}
