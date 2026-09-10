import { useState } from 'react'
import { loader } from '../stac/loaderInstance'
import { classifyNodeShape } from '../stac/types'
import { useSelectionStore } from '../store/selection'
import { describeTemporal } from '../stac/describe'
import { KNOWN_EXTENSION_PREFIXES } from '../stac/namespaces'
import { interpretExtensionFacts } from '../stac/extensionFacts'
import { isInlinePreviewAsset, describeAssetType } from '../stac/assets'
import type { ResolvedAsset } from '../stac/types'

type Tab = 'human' | 'json'

/** Two tabs: "Human" (derived, readable facts — the default) and "JSON"
 *  (the untouched source, always one click away — "很重要,因为整个STAC都是
 *  base在这个逻辑里面的" (important, since the whole STAC spec's logic is
 *  based on this)). Everything under Human is either a direct source field
 *  or a clearly-labeled derived one — no silent interpretation. Standard
 *  STAC extensions get a human-readable rendering pass (`extensionFacts.ts`,
 *  scoped to extensions actually observed in this project's own fixtures
 *  and confirmed against the official registry); custom/unrecognized
 *  namespaces stay in "Property namespaces observed" unchanged — that's
 *  explicitly later, separate work, not this pass.
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
  const [tab, setTab] = useState<Tab>('human')

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
  const properties = (node.raw as { properties?: Record<string, unknown> } | null)?.properties
  const extensionFactGroups = interpretExtensionFacts(properties)
  const previewAsset = node.assets.find(isInlinePreviewAsset)

  return (
    <div style={{ padding: 16, fontSize: 13 }}>
      <div style={{ marginBottom: 4 }}>
        <strong>{node.title ?? node.id}</strong>
      </div>
      <div style={{ color: 'var(--color-text-muted)', marginBottom: 10 }}>
        {node.type} · {shape} · <span title="canonical fetch URL">{node.href}</span>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid var(--color-border)' }}>
        <TabButton label="Human" active={tab === 'human'} onClick={() => setTab('human')} />
        <TabButton label="JSON" active={tab === 'json'} onClick={() => setTab('json')} />
      </div>

      {tab === 'json' ? (
        <pre
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            padding: 8,
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            maxHeight: 600,
            overflow: 'auto',
          }}
        >
          {JSON.stringify(node.raw, null, 2)}
        </pre>
      ) : (
        <>
          {previewAsset && (
            <div style={{ marginBottom: 12 }}>
              <img
                src={previewAsset.href}
                alt={previewAsset.title ?? 'thumbnail'}
                style={{
                  maxWidth: '100%',
                  maxHeight: 220,
                  display: 'block',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                }}
              />
            </div>
          )}

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

          {extensionFactGroups.map((group) => (
            <Field key={group.prefix} label={`${group.title} (${group.prefix})`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {group.facts.map((fact) => (
                  <div key={fact.label}>
                    <span style={{ color: 'var(--color-text-muted)' }}>{fact.label}:</span> {fact.value}
                  </div>
                ))}
              </div>
            </Field>
          ))}

          {(node.items.kind === 'links' ? node.items.hrefs.length > 0 : true) && (
            <Field
              label={
                <>
                  Items in this collection
                  {node.items.kind === 'cursor' && (
                    // Same tag as Structure Lens's own tree node and Item
                    // Set panel (StructureTree.tsx/ItemSetBrowser.tsx) — one
                    // consistent signal across every surface that shows it:
                    // "得有一个标签也好,highlight也好什么东西" (it needs a tag
                    // or highlight of some kind).
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

          {node.assets.length > 0 && (
            <Field label={`Assets (${node.assets.length})`}>
              <AssetList assets={node.assets} />
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
        </>
      )}
    </div>
  )
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        background: 'none',
        border: 'none',
        borderBottom: active ? '2px solid var(--color-selection)' : '2px solid transparent',
        color: active ? 'var(--color-selection)' : 'var(--color-text-muted)',
        cursor: 'pointer',
        marginBottom: -1,
      }}
    >
      {label}
    </button>
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

/** Compact rows, not a full metadata dump — each asset's actual job here is
 *  "give me a link I can trust and copy," not re-displaying every field
 *  already visible in the JSON tab. `href` is always the already-resolved
 *  absolute URL (`ResolvedAsset` — see stac/graph.ts's `buildAssets`), never
 *  the raw, possibly-relative JSON value: "这东西其实我们都要判别一下,才能够
 *  保证用户粘贴的那个是可以直接使用的那个才行" (we have to account for that so
 *  whatever the user pastes actually works). */
function AssetList({ assets }: { assets: ResolvedAsset[] }) {
  const [copyState, setCopyState] = useState<{ key: string; ok: boolean } | null>(null)

  async function handleCopy(asset: ResolvedAsset) {
    const ok = await copyToClipboard(asset.href)
    setCopyState({ key: asset.key, ok })
    setTimeout(() => setCopyState((s) => (s?.key === asset.key ? null : s)), 1500)
  }

  if (assets.length === 0) return <em style={{ color: 'var(--color-text-faint)' }}>none</em>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflow: 'auto' }}>
      {assets.map((asset) => (
        <div key={asset.key}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 6px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border)',
            fontSize: 12,
          }}
        >
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {asset.title ?? asset.key}
          </span>
          <span
            style={{
              flexShrink: 0,
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 999,
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
            }}
          >
            {describeAssetType(asset.type)}
          </span>
          <button
            onClick={() => handleCopy(asset)}
            title={asset.href}
            style={{
              flexShrink: 0,
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 999,
              border: `1px solid ${copyState?.key === asset.key && !copyState.ok ? 'var(--color-node-warning)' : 'var(--color-border)'}`,
              background: 'var(--color-surface)',
              color:
                copyState?.key === asset.key && !copyState.ok
                  ? 'var(--color-node-warning)'
                  : 'var(--color-text-muted)',
              cursor: 'pointer',
            }}
          >
            {copyState?.key === asset.key ? (copyState.ok ? 'Copied' : 'Copy failed — select below') : 'Copy link'}
          </button>
          <a
            href={asset.href}
            target="_blank"
            rel="noreferrer"
            style={{
              flexShrink: 0,
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 999,
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
              textDecoration: 'none',
            }}
          >
            Open
          </a>
        </div>
        {/* Only appears when both the modern Clipboard API and the legacy
         * execCommand fallback failed (see `copyToClipboard` below) — a
         * real, focused-and-selected, read-only input the user can copy
         * from with a plain Ctrl/Cmd+C, not just a promise that a button
         * "did something." Reported directly: "点了Copy link按钮好像也没
         * 反应,也不知道有没有复制成功" (clicking Copy link seemed to do
         * nothing, no idea whether it actually copied) — the previous
         * version's empty `catch {}` gave no feedback either way. */}
        {copyState?.key === asset.key && !copyState.ok && (
          <input
            readOnly
            autoFocus
            value={asset.href}
            onFocus={(e) => e.currentTarget.select()}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              marginTop: 3,
              padding: '3px 6px',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-node-warning)',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
            }}
          />
        )}
        </div>
      ))}
    </div>
  )
}

/** Tries the modern Clipboard API first (works in any secure context —
 *  `https://` or `localhost`), then falls back to the legacy
 *  `execCommand('copy')` technique, which still works over a plain `http://`
 *  origin (e.g. testing over a LAN IP like `http://192.168.x.x:5173`,
 *  a real, reported scenario this session — `navigator.clipboard` is
 *  often unavailable entirely in that kind of insecure context, and the
 *  previous version's empty `catch {}` swallowed that failure silently).
 *  Returns whether it actually succeeded, so the caller can show real
 *  feedback instead of assuming. */
async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to the legacy fallback below
    }
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}
