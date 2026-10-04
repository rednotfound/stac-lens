import { useState } from 'react'
import { loader } from '../stac/loaderInstance'
import { describeBody, resolveBody } from '../stac/body'
import { classifyNodeShape, type StacNode } from '../stac/types'
import { useSelectionStore } from '../store/selection'
import { useItemSetStore } from '../store/itemSet'
import { KNOWN_EXTENSION_PREFIXES } from '../stac/namespaces'
import { interpretExtensionFacts, interpretCommonMetadataFacts } from '../stac/extensionFacts'
import { previewImageHref } from '../stac/assets'
import { summarizeItemSet } from '../stac/itemSetSummary'
import { TimeLens } from './TimeLens'
import { SpaceLens } from './SpaceLens'
import { TypeIcon } from './TypeIcon'
import { LoadingState } from './LoadingState'
import { TabButton } from './TabButton'
import { accessSourceOf } from '../stac/assetAccess'
import { AssetList } from './AssetList'
import { Description } from './Description'
import { AccessImage } from './AccessImage'

type Tab = 'human' | 'json'

// Untuned, like every other fixed panel size in this app — just enough to
// be genuinely useful without a single field eating the whole scroll.
// Time hugs its own content up to this cap (real data is often much
// shorter than this); Space gets a fixed height since a map has no natural
// "short" state the way an empty/simple timeline does.
const INLINE_TIME_MAX_HEIGHT = 240
const INLINE_SPACE_HEIGHT = 320

/** Two tabs: "Human" (derived, readable facts) and "JSON" (the untouched
 *  source) — Time and Space are not two more tabs alongside these; they sit
 *  directly in Human's own field flow, right where "Temporal"/"Spatial"
 *  already are. This was an explicit request that rejected the tab model
 *  itself: the human-readable page should be one long scroll, where each
 *  property gets rendered by whatever viewer fits it — Time right where
 *  Temporal already is, made into an actual Time UI — so no tab is needed
 *  to switch between Time and Space at all. Structurally: one page for
 *  humans, JSON for machines. `TimeLens`/`SpaceLens` needed no
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
    return <div style={{ padding: 16, color: 'var(--color-text-muted)', fontSize: 13 }}>Select a node to inspect.</div>
  }
  if (!node) {
    return <LoadingState>Loading…</LoadingState>
  }

  const shape = classifyNodeShape(node)
  const properties = (node.raw as { properties?: Record<string, unknown> } | null)?.properties
  const extensionFactGroups = interpretExtensionFacts(properties)
  const commonMetadataFacts = interpretCommonMetadataFacts(properties)
  const previewHref = previewImageHref(node)
  // STAC only really has three kinds of object — Item, Catalog, Collection
  // — so each gets its own recognizable identity here rather than one
  // undifferentiated panel. This was an explicit request: each of these
  // three objects should get its own dedicated Inspector, made mutually
  // recognizable.
  // Reuses the exact colors Structure Lens's own tree nodes already use for
  // the same types, so the association is immediate, not a new color to
  // learn.
  const typeColor =
    node.type === 'Catalog'
      ? 'var(--color-node-catalog)'
      : node.type === 'Collection'
        ? 'var(--color-node-collection)'
        : 'var(--color-node-item)'
  // Whatever Item Set (the Items panel's panel) currently has
  // loaded/filtered for this exact Collection — used below only to
  // annotate the Declared-extensions/Property-namespaces fields with what's
  // common across the browsed set, not to render a browse UI of its own
  // here (that, and the "show on Time/Space Lens" toggle, live outside
  // Inspector entirely — an explicit request: the button and "Browse this
  // Collection's items" don't belong here and go somewhere else).
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
            // No scroll box of its own: the Inspector already scrolls, and a
            // scroll inside a scroll is a trap (house rule, see
            // docs/DESIGN.md, "No scroll inside the Inspector"). Long lines
            // — hrefs, geometry — wrap instead of scrolling sideways.
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            margin: 0,
          }}
        >
          {JSON.stringify(node.raw, null, 2)}
        </pre>
      ) : (
        <>
          {node.description && (
            <Field label="Description (source)">
              <Description key={node.href} text={node.description} baseHref={node.href} clamp />
            </Field>
          )}

          {previewHref && (
            <div style={{ marginBottom: 12 }}>
              <AccessImage
                href={previewHref}
                source={accessSourceOf(node)}
                alt="preview"
                placeholderHeight={140}
                errorText="The preview image could not be loaded."
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
           * point of pulling Time/Space Lens in this deep is that each
           * kind of data gets rendered by the viewer that fits it. Each
           * still degrades to an honest empty state (no items, no
           * selection) via its own existing handling — nothing new needed
           * for a Catalog or an items-less Collection. */}
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
            {(() => {
              const body = resolveBody(node, loader)
              if (!body) return null
              const inherited = body.declaredOn.href !== node.href
              return (
                <div style={{ color: 'var(--color-text-muted)', marginTop: 4 }}>
                  Coordinates are on <strong style={{ color: 'var(--color-text)' }}>{describeBody(body)}</strong>, not
                  Earth — declared by <code>ssys:targets</code>
                  {inherited ? ` on ${body.declaredOn.title ?? body.declaredOn.id}` : ''}. Drawn on a plain lon/lat
                  grid; an Earth basemap would be misleading.
                </div>
              )
            })()}
            {node.spatial?.geometryInvalid && (
              <div style={{ color: 'var(--color-node-warning)', marginTop: 4 }}>
                ⚠ raw `geometry` field is present but is not valid GeoJSON — falling back to bbox only.
              </div>
            )}
            {node.spatial?.bboxCount === 2 && (
              <div style={{ color: 'var(--color-node-warning)', marginTop: 4 }}>
                ⚠ source declares exactly two spatial bboxes — STAC 1.1 reports that as invalid (the first must be the
                overall extent of the rest). Both are drawn above
                {node.spatial.firstBboxIsUnion === false && '; the first does not contain the second'}.
              </div>
            )}
            {node.spatial?.bboxCount != null &&
              node.spatial.bboxCount > 2 &&
              node.spatial.firstBboxIsUnion === false && (
                <div style={{ color: 'var(--color-node-warning)', marginTop: 4 }}>
                  ⚠ source declares {node.spatial.bboxCount} spatial bboxes, but the first is not their overall extent —
                  the spec expects it to contain the rest. All {node.spatial.bboxes?.length ?? node.spatial.bboxCount}{' '}
                  are drawn above.
                </div>
              )}
            {node.spatial?.bboxCount != null &&
              node.spatial.bboxCount > 2 &&
              node.spatial.firstBboxIsUnion !== false && (
                <div style={{ color: 'var(--color-text-muted)', marginTop: 4 }}>
                  source declares {node.spatial.bboxCount} spatial bboxes — the overall extent (lighter) and{' '}
                  {node.spatial.bboxCount - 1} sub-extents, all drawn above.
                </div>
              )}
          </Field>

          {node.license && (
            <Field label="License (source)">
              {node.license}
              {(node.license === 'proprietary' || node.license === 'various') && (
                <span style={{ color: 'var(--color-text-muted)' }}>
                  {' '}
                  — deprecated value since STAC 1.1 (an SPDX expression or `other` is expected)
                </span>
              )}
            </Field>
          )}

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
                    {p.description && (
                      <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                        <Description text={p.description} baseHref={node.href} mode="inline" />
                      </div>
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

          {(node.declaredCollectionHref || node.declaredParentHref || node.localPathLinks.length > 0) && (
            <Field label="Containment (source)">
              {node.declaredCollectionHref && <div>collection: {node.declaredCollectionHref}</div>}
              {node.declaredParentHref && <div>parent: {node.declaredParentHref}</div>}
              {node.declaredCollectionHref &&
                node.declaredParentHref &&
                node.declaredCollectionHref !== node.declaredParentHref && (
                  <div style={{ color: 'var(--color-node-warning)', marginTop: 2 }}>
                    ⚠ `rel:collection` and `rel:parent` disagree — this node is physically reachable from one location
                    but thematically belongs to another. Per STAC's own philosophy, `collection` is the authoritative
                    one; the tree navigates/highlights through it.
                  </div>
                )}
              {node.localPathLinks.length > 0 && (
                <div data-local-path-links style={{ color: 'var(--color-node-warning)', marginTop: 4 }}>
                  ⚠ {node.localPathLinks.length === 1 ? 'A link is' : `${node.localPathLinks.length} links are`} written
                  as a local file path from the publisher’s machine, unreachable on the web (health rule L-07):
                  <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>
                    {node.localPathLinks.map((l, i) => (
                      <li key={i} style={{ overflowWrap: 'anywhere' }}>
                        <code>{l.rel}</code> → <code>{l.href}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Field>
          )}

          {node.assets.length > 0 && (
            <Field label={`Assets (${node.assets.length})`}>
              <AssetList key={node.href} assets={node.assets} node={node} />
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
