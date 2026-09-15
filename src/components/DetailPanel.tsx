import { useState } from 'react'
import { loader } from '../stac/loaderInstance'
import { classifyNodeShape, type StacNode } from '../stac/types'
import { useSelectionStore } from '../store/selection'
import { useItemSetStore } from '../store/itemSet'
import { KNOWN_EXTENSION_PREFIXES } from '../stac/namespaces'
import { interpretExtensionFacts, interpretCommonMetadataFacts } from '../stac/extensionFacts'
import { isInlinePreviewAsset, describeAssetType } from '../stac/assets'
import { summarizeItemSet } from '../stac/itemSetSummary'
import { TimeLens } from './TimeLens'
import { SpaceLens } from './SpaceLens'
import { TypeIcon } from './TypeIcon'
import { LoadingState } from './LoadingState'
import { TabButton } from './TabButton'
import type { ResolvedAsset } from '../stac/types'

type Tab = 'human' | 'json'

// Untuned, like every other fixed panel size in this app — just enough to
// be genuinely useful without a single field eating the whole scroll.
// Time hugs its own content up to this cap (real data is often much
// shorter than this); Space gets a fixed height since a map has no natural
// "short" state the way an empty/simple timeline does.
const INLINE_TIME_MAX_HEIGHT = 240
const INLINE_SPACE_HEIGHT = 320

/** Two tabs: "Human" (derived, readable facts) and "JSON" (the untouched
 *  source) — Time and Space briefly lived as two more tabs alongside these,
 *  then got folded a level deeper still, directly into Human's own field
 *  flow, right where "Temporal"/"Spatial" already were. Asked for
 *  directly, rejecting the tab model itself: "为什么我们不能把这个...human
 *  readable的那一个页面做成一个很长的东西,然后不同的属性进来呢,我就可以用不同的
 *  viewer...去把那个数据给渲染出来。比如说Time...就排在Description下边的
 *  Temporal的下边,就做成一个Time的UI...那我就不需要用Tag去切换Time和Space了。
 *  那么从结构和语义上面来说,那就是给人类读的。那另外一个JSON是给...机器读" (why
 *  can't the human-readable page just be one long scroll, where each
 *  property gets rendered by whatever viewer fits it — Time right where
 *  Temporal already is, made into an actual Time UI; then I wouldn't need
 *  a tab to switch between Time and Space at all. Structurally: one page
 *  for humans, JSON for machines). `TimeLens`/`SpaceLens` needed no
 *  changes to work here beyond dropping their own interactive query tool
 *  (see their own files) — both were already self-contained, reading
 *  everything from `useSelectedItems()`/global stores rather than props.
 *
 *  Everything under Human is either a direct source field or a clearly-
 *  labeled derived one — no silent interpretation. Standard STAC
 *  extensions get a human-readable rendering pass (`extensionFacts.ts`,
 *  scoped to extensions actually observed in this project's own fixtures
 *  and confirmed against the official registry); custom/unrecognized
 *  namespaces stay in "Property namespaces observed" unchanged — that's
 *  explicitly later, separate work, not this pass.
 *
 *  Deliberately no forced `height: '100%'` on the root — this is the sole
 *  occupant of its own scrollable column (App.tsx). */
export function DetailPanel() {
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  const forHref = useItemSetStore((s) => s.forHref)
  const visibleHrefs = useItemSetStore((s) => s.visibleHrefs)
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
    return <LoadingState>Loading…</LoadingState>
  }

  const shape = classifyNodeShape(node)
  const properties = (node.raw as { properties?: Record<string, unknown> } | null)?.properties
  const extensionFactGroups = interpretExtensionFacts(properties)
  const commonMetadataFacts = interpretCommonMetadataFacts(properties)
  const previewAsset = node.assets.find(isInlinePreviewAsset)
  // STAC only really has three kinds of object — Item, Catalog, Collection
  // — so each gets its own recognizable identity here rather than one
  // undifferentiated panel: "我们就应该为这三个对象设计这个对象所专有的
  // Inspector...可以做得彼此之间有识别度" (each of these three objects should
  // get its own dedicated Inspector — make them mutually recognizable).
  // Reuses the exact colors Structure Lens's own tree nodes already use for
  // the same types, so the association is immediate, not a new color to
  // learn.
  const typeColor =
    node.type === 'Catalog'
      ? 'var(--color-node-catalog)'
      : node.type === 'Collection'
        ? 'var(--color-node-collection)'
        : 'var(--color-node-item)'
  // Whatever Item Set (the tree-embedded browse panel) currently has
  // loaded/filtered for this exact Collection — used below only to
  // annotate the Declared-extensions/Property-namespaces fields with what's
  // common across the browsed set, not to render a browse UI of its own
  // here (that, and the "show on Time/Space Lens" toggle, moved out of
  // Inspector entirely — "按钮和Browse this Collection's items其实也都可以不
  // 要了,我会放在其他的部分" (the button and "Browse this Collection's
  // items" can go too — I'll put them somewhere else)).
  const browsedItems =
    node.type === 'Collection' && forHref === node.href
      ? visibleHrefs.map((h) => loader.get(h)).filter((n): n is StacNode => !!n)
      : []
  // Not `useMemo` — this runs after two early returns above, where a hook
  // can't legally sit; `summarizeItemSet` is cheap enough over a Collection
  // Inspector's own browsed-item count that memoizing it isn't worth
  // reintroducing that constraint for.
  const browsedSummary = summarizeItemSet(browsedItems)

  return (
    // `overflowWrap: 'break-word'` here, not on each individual field, is
    // deliberate — a real, reported bug: a long, unbroken URL (a real
    // Item's own `href`, e.g. a deep Capella S3 path with no spaces) has
    // no natural break point plain text-wrapping recognizes, so it forced
    // this column wider than its own assigned width — Chrome-only, per a
    // direct comparison of the same Item in both browsers: Chrome and
    // Firefox disagree on which characters (`/`, `-`) count as a normal
    // break opportunity for line-wrapping purposes, so the identical
    // markup happened to fit in Firefox and overflow in Chrome. The result
    // wasn't just a stray horizontal scrollbar — Inspector's own column
    // (`inspectorScrollRef`, App.tsx) already scrolls vertically by
    // design, so gaining unexpected *horizontal* scroll on the exact same
    // element pushed the visible content sideways, reading as "the panel
    // got shoved out of view." Setting this once, on the shared wrapper
    // every Human-tab field renders inside, guarantees it for the current
    // known offenders (this node's own href below, and the Containment
    // block's declared collection/parent hrefs) and any future field that
    // renders a long, real-world string with no guaranteed spaces — rather
    // than a narrow, easy-to-forget fix on just today's one reported spot.
    // The JSON tab's own `<pre>` is unaffected and doesn't need this: it
    // already manages its own overflow explicitly (`overflow: 'auto'`
    // below), which independently exempts it from this exact class of bug.
    <div
      style={{
        padding: 16,
        paddingLeft: 13,
        fontSize: 13,
        borderLeft: `3px solid ${typeColor}`,
        overflowWrap: 'break-word',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        {/* The icon carries the "what kind of thing is this" signal on its
         * own shape, not just color — someone who hasn't yet learned "teal
         * means Collection" still sees a stack vs. a folder vs. a photo
         * frame. Sized deliberately larger than the inline per-asset icons
         * below, since this is the one thing that should be unmissable at
         * a glance. */}
        <TypeIcon type={node.type} size={20} color={typeColor} />
        <strong>{node.title ?? node.id}</strong>
      </div>
      <div style={{ color: 'var(--color-text-muted)', marginBottom: 10 }}>
        <span style={{ color: typeColor, fontWeight: 600 }}>{node.type}</span> · {shape} ·{' '}
        <span title="canonical fetch URL">{node.href}</span>
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
          {node.description && <Field label="Description (source)">{node.description}</Field>}

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

          {/* The Temporal/Spatial source facts render as an actual Time/
           * Space UI right here, not a number or a bbox array — the whole
           * point of pulling Time/Space Lens in this deep: "我就可以用不同的
           * viewer...去把那个数据给渲染出来" (I can use a different viewer to
           * render that data). Each still degrades to an honest empty
           * state (no items, no selection) via its own existing handling —
           * nothing new needed for a Catalog or an items-less Collection. */}
          <Field label="Temporal">
            <div
              style={{
                maxHeight: INLINE_TIME_MAX_HEIGHT,
                overflow: 'auto',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <TimeLens />
            </div>
          </Field>

          <Field label="Spatial">
            <div
              style={{
                height: INLINE_SPACE_HEIGHT,
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
              }}
            >
              <SpaceLens />
            </div>
            {node.spatial?.geometryInvalid && (
              <div style={{ color: 'var(--color-node-warning)', marginTop: 4 }}>
                ⚠ raw `geometry` field is present but is not valid GeoJSON — falling back to bbox
                only.
              </div>
            )}
          </Field>

          {node.license && <Field label="License (source)">{node.license}</Field>}

          {node.keywords && node.keywords.length > 0 && (
            <Field label="Keywords (source)">{node.keywords.join(', ')}</Field>
          )}

          {node.providers && node.providers.length > 0 && (
            <Field label="Providers (source)">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {node.providers.map((p, i) => (
                  <div key={`${p.name}-${i}`}>
                    {p.url ? (
                      <a href={p.url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
                        {p.name}
                      </a>
                    ) : (
                      p.name
                    )}
                    {p.roles && p.roles.length > 0 && (
                      <span style={{ color: 'var(--color-text-muted)' }}> — {p.roles.join(', ')}</span>
                    )}
                  </div>
                ))}
              </div>
            </Field>
          )}

          {(node.created || node.updated) && (
            <Field label="Created / updated (source)">
              {node.created && <div>created: {node.created}</div>}
              {node.updated && <div>updated: {node.updated}</div>}
            </Field>
          )}

          {commonMetadataFacts.length > 0 && (
            <Field label="Common metadata">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {commonMetadataFacts.map((fact) => (
                  <div key={fact.label}>
                    <span style={{ color: 'var(--color-text-muted)' }}>{fact.label}:</span> {fact.value}
                  </div>
                ))}
              </div>
            </Field>
          )}

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
            {/* An annotation on this Collection's own field, not a separate
             * "app-provided" section any more — folded in once the old
             * derived-summary block (redundant with the Temporal/Spatial
             * widgets above, which already visualize this once toggled on)
             * and its own divider were dropped entirely. */}
            {browsedItems.length > 0 && browsedSummary.commonExtensions.length > 0 && (
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-text-muted)' }}>
                Common to the {browsedItems.length} currently browsed: {browsedSummary.commonExtensions.join(', ')}
              </div>
            )}
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
            {browsedItems.length > 0 && browsedSummary.commonNamespaces.length > 0 && (
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-text-muted)' }}>
                Common to the {browsedItems.length} currently browsed: {browsedSummary.commonNamespaces.join(', ')}
              </div>
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
          <TypeIcon type="Asset" size={13} color="var(--color-node-asset)" />
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
          {/* Compact, not a full band table — `gsd`/`raster:bands` are
           * per-asset fields (a 10m visible band vs. a 20m SWIR band on
           * the same Item, confirmed against real Earth Search assets),
           * genuinely useful at a glance without needing to expand
           * anything. */}
          {(asset.gsd != null || asset.dataType) && (
            <span style={{ flexShrink: 0, fontSize: 10, color: 'var(--color-text-faint)' }}>
              {[asset.gsd != null ? `${asset.gsd}m` : null, asset.dataType].filter(Boolean).join(' · ')}
            </span>
          )}
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
