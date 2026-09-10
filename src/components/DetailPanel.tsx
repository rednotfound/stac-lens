import { loader } from '../stac/loaderInstance'
import { classifyNodeShape } from '../stac/types'
import { useSelectionStore } from '../store/selection'
import { describeTemporal } from '../stac/describe'
import { KNOWN_EXTENSION_PREFIXES } from '../stac/namespaces'

/** Bare-bones inspector: derived facts first, raw JSON always available
 *  underneath. No Human/JSON toggle yet — that needs extension-specific
 *  interpreters (v0.2+); for now everything shown is either a direct
 *  source field or a clearly-labeled derived one.
 *
 *  Deliberately no forced `height: '100%'` on the root — this renders as
 *  one section of a scrollable column shared with Time/Space Lens
 *  (App.tsx), not the sole occupant of its container; forcing full height
 *  here would claim all of that column's space and leave none for the
 *  sections stacked after it. See docs/DESIGN.md §23's update. */
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
    <div style={{ padding: 16, fontSize: 13 }}>
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

      {(node.items.kind === 'links' ? node.items.hrefs.length > 0 : true) && (
        <Field
          label={
            <>
              Items in this collection
              {node.items.kind === 'cursor' && (
                // Same tag as Structure Lens's own tree node and Item Set
                // panel (StructureTree.tsx/ItemSetBrowser.tsx) — one
                // consistent signal across every surface that shows it:
                // "得有一个标签也好,highlight也好什么东西" (it needs a tag or
                // highlight of some kind).
                <span
                  style={{
                    display: 'inline-block',
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: 999,
                    background: 'var(--color-badge-api-bg)',
                    color: 'var(--color-badge-api-text)',
                    marginLeft: 6,
                  }}
                >
                  API
                </span>
              )}
              {node.items.kind === 'links' && ` (${node.items.hrefs.length})`}
            </>
          }
        >
          <span style={{ color: 'var(--color-text-muted)' }}>
            {node.items.kind === 'cursor' && (
              <>
                No static <code>rel:item</code> links here — this node is API-searched (
                <span title={node.items.endpoint}>{new URL(node.items.endpoint).host}</span>), count
                unknown until queried. {' '}
              </>
            )}
            Browse and search them inline in Structure Lens — selecting this node opens an Item Set
            box right at its position in the tree, not duplicated here.
          </span>
        </Field>
      )}

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

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
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
