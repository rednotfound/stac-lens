import { useState } from 'react'
import type { TreeDatum } from '../hooks/useStructureTree'
import { useStructure } from '../hooks/useStructure'
import { PHONE_ITEM_LIMIT, PHONE_ITEM_WINDOW, usePhoneItems } from '../hooks/usePhoneItems'
import { describeTemporal } from '../stac/describe'
import type { StacNode } from '../stac/types'
import { useSelectionStore } from '../store/selection'
import { Spinner } from './Spinner'
import { TypeIcon } from './TypeIcon'
import { hasDirectItems } from './tree/treeGeometry'

/** The phone's Structure view: the same Catalog → Collection graph as the
 *  desktop tree — the same hook, the same lazy expansion, the same
 *  "+N more" leaf — laid out as a document outline instead of a pannable
 *  canvas. A free-form node-link tree is a desktop instrument (drag,
 *  wheel, two columns, floating panels); on a phone the honest need is to
 *  *read*: what is in here, how it nests, tap for detail. So each node is
 *  a row — disclosure chevron, type icon, title, badges — indented by
 *  depth, and tapping a title selects it exactly as clicking a tree label
 *  does, which opens the bottom-sheet Inspector. Nothing is invented for
 *  the phone: it is a second rendering of the same state.
 *
 *  Items are part of the document too: a Collection opens to its first
 *  ten Items as rows (`usePhoneItems`), then one line saying how many
 *  there are and that the rest — search, paging, everything — is on the
 *  desktop. Functions complete, data truncated: tapping an Item shows its
 *  full Inspector; the Collection's Temporal and Spatial widgets plot
 *  those ten. */
export function OutlineView() {
  const { root, toggle, isLoading, rootError } = useStructure()
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  const browsingHref = useSelectionStore((s) => s.browsingHref)
  const select = useSelectionStore((s) => s.select)

  if (rootError) {
    return (
      <div style={{ padding: 20 }}>
        <div style={{ color: 'var(--color-node-warning)', fontWeight: 600, marginBottom: 8 }}>
          Failed to load this catalog
        </div>
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{rootError}</div>
      </div>
    )
  }
  if (!root) {
    return (
      <div style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--color-text-muted)' }}>
        <Spinner size={18} /> Loading catalog…
      </div>
    )
  }

  return (
    <div role="tree" aria-label="Catalog structure" style={{ padding: '6px 8px 16px' }}>
      <OutlineRow
        datum={root}
        depth={0}
        toggle={toggle}
        isLoading={isLoading}
        selectedHref={selectedHref}
        browsingHref={browsingHref}
        onSelect={select}
      />
    </div>
  )
}

function OutlineRow({
  datum,
  depth,
  toggle,
  isLoading,
  selectedHref,
  browsingHref,
  onSelect,
}: {
  datum: TreeDatum
  depth: number
  toggle: (href: string) => void
  isLoading: (href: string) => boolean
  selectedHref: string | null
  browsingHref: string | null
  onSelect: (href: string) => void
}) {
  const { node } = datum
  const canExpand = node.childHrefs.length > 0 || !!node.collectionsEndpoint || !!node.childrenEndpoint
  const expanded = !!datum.children
  const hasItems = hasDirectItems(node)
  const loading = isLoading(datum.href)
  const selected = selectedHref === datum.href
  // Items open with the node: the selected node's Items show by default
  // (a shared link lands on a Collection with its Items visible, as the
  // desktop opens its box), the chevron toggles children and Items
  // together, and tapping the title selects *and* opens (never closes) —
  // "open a Collection, see its Items" in one gesture. `manual` records a
  // choice made by hand; until then the default follows the selection.
  const [manual, setManual] = useState<boolean | null>(null)
  const itemsOpen = manual ?? selected
  const openable = canExpand || hasItems
  const isOpen = (canExpand && expanded) || (hasItems && itemsOpen)
  function onChevron() {
    if (canExpand) toggle(datum.href)
    if (hasItems) setManual(!itemsOpen)
  }
  function onTitle() {
    onSelect(datum.href)
    if (canExpand && !expanded) toggle(datum.href)
    if (hasItems) setManual(true)
  }
  const contains = !selected && browsingHref === datum.href
  const color = node.type === 'Catalog' ? 'var(--color-node-catalog)' : 'var(--color-node-collection)'
  const isApi = node.items.kind === 'cursor'

  if (datum.moreCount) {
    return (
      <div
        style={{
          padding: '6px 8px 6px',
          paddingLeft: 8 + depth * 18 + 28,
          fontSize: 12,
          color: 'var(--color-text-faint)',
        }}
      >
        +{datum.moreCount} more (not loaded)
      </div>
    )
  }
  const itemCount = node.items.kind === 'links' ? node.items.hrefs.length : 0

  return (
    <div role="treeitem" aria-expanded={openable ? isOpen : undefined} aria-selected={selected}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          minHeight: 40,
          paddingLeft: depth * 18,
          borderRadius: 'var(--radius-sm)',
          background: selected ? 'var(--color-selection-bg)' : 'none',
          boxShadow: contains ? 'inset 0 0 0 1px var(--color-selection)' : 'none',
        }}
      >
        {/* Disclosure: a 40px target of its own, separate from the title,
         * so expanding and selecting are two gestures as on the desktop. */}
        <button
          type="button"
          onClick={onChevron}
          disabled={!openable}
          aria-label={isOpen ? 'Collapse' : 'Expand'}
          style={{
            width: 32,
            height: 40,
            flexShrink: 0,
            border: 'none',
            background: 'none',
            color: openable ? 'var(--color-text-muted)' : 'transparent',
            cursor: openable ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
        >
          {loading ? (
            <Spinner size={12} color="var(--color-text-faint)" />
          ) : (
            <svg
              width={10}
              height={10}
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }}
              aria-hidden
            >
              <path d="M3.5 2 L6.5 5 L3.5 8" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={onTitle}
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 8px 6px 0',
            border: 'none',
            background: 'none',
            textAlign: 'left',
            cursor: 'pointer',
            color: 'var(--color-text)',
          }}
        >
          <span style={{ display: 'flex', flexShrink: 0, color }}>
            <TypeIcon type={node.type} size={14} color={color} />
          </span>
          <span
            style={{
              fontSize: 14,
              fontWeight: selected ? 600 : 400,
              color: selected ? 'var(--color-selection)' : 'var(--color-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {node.title ?? node.id}
          </span>
          {isApi && (
            <span
              style={{
                flexShrink: 0,
                fontSize: 10,
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: 999,
                background: 'var(--color-badge-api-bg)',
                color: 'var(--color-badge-api-text)',
              }}
            >
              API
            </span>
          )}
          {!isApi && hasDirectItems(node) && itemCount > 0 && (
            <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--color-text-faint)' }}>
              {itemCount} item{itemCount === 1 ? '' : 's'}
            </span>
          )}
        </button>
      </div>
      {expanded &&
        datum.children!.map((child) => (
          <OutlineRow
            key={child.href + (child.moreCount ? ':more' : '')}
            datum={child}
            depth={depth + 1}
            toggle={toggle}
            isLoading={isLoading}
            selectedHref={selectedHref}
            browsingHref={browsingHref}
            onSelect={onSelect}
          />
        ))}
      {hasItems && itemsOpen && (
        <ItemRows node={node} depth={depth + 1} selectedHref={selectedHref} onSelect={onSelect} />
      )}
    </div>
  )
}

/** A Collection's first Items as outline rows, then the line that says
 *  what was left out and where it is. */
function ItemRows({
  node,
  depth,
  selectedHref,
  onSelect,
}: {
  node: StacNode
  depth: number
  selectedHref: string | null
  onSelect: (href: string) => void
}) {
  const state = usePhoneItems(node)
  const pad = 8 + depth * 18
  if (state.status === 'loading') {
    return (
      <div style={{ ...noteStyle, paddingLeft: pad + 28 }}>
        <Spinner size={11} color="var(--color-text-faint)" /> Loading items…
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div style={{ ...noteStyle, paddingLeft: pad + 28, color: 'var(--color-node-warning)' }}>⚠ {state.error}</div>
    )
  }
  const shown = state.items.length
  const total = state.total
  const totalText = total !== undefined ? total.toLocaleString() : undefined
  const isApi = node.items.kind === 'cursor'
  const first = state.windowStart + 1
  const last = state.windowStart + shown
  // The line after the rows: which rows these are of how many, that the
  // window slid if it did, and "load more" while there is more.
  const tail =
    shown === 0
      ? 'No items.'
      : state.windowStart > 0
        ? `Items ${first}–${last}${totalText ? ` of ${totalText}` : ''}; earlier rows unloaded to keep the list light (${PHONE_ITEM_WINDOW} at a time).`
        : !state.hasMore
          ? isApi
            ? `All ${shown} item${shown === 1 ? '' : 's'} the API returned.`
            : `All ${shown} item${shown === 1 ? '' : 's'}.`
          : totalText
            ? `Showing ${shown} of ${totalText} items.`
            : `First ${shown} items in the API's default order.`
  return (
    <div role="group">
      {state.items.map((item) => {
        const selected = selectedHref === item.href
        const when = item.temporal ? describeTemporal(item.temporal) : undefined
        return (
          <div key={item.href} role="treeitem" aria-selected={selected}>
            <button
              type="button"
              onClick={() => onSelect(item.href)}
              style={{
                width: '100%',
                minHeight: 40,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 8px 4px 0',
                paddingLeft: pad + 28,
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                background: selected ? 'var(--color-selection-bg)' : 'none',
                textAlign: 'left',
                cursor: 'pointer',
                color: 'var(--color-text)',
              }}
            >
              <span style={{ display: 'flex', flexShrink: 0 }}>
                <TypeIcon type="Item" size={13} color="var(--color-node-item)" />
              </span>
              <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: selected ? 600 : 400,
                    color: selected ? 'var(--color-selection)' : 'var(--color-text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.title ?? item.id}
                </span>
                {when && <span style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>{when}</span>}
              </span>
            </button>
          </div>
        )
      })}
      <div style={{ ...noteStyle, paddingLeft: pad + 28, flexWrap: 'wrap' }}>
        <span>{tail}</span>
        {state.hasMore && (
          <button
            type="button"
            onClick={state.loadMore}
            disabled={state.loadingMore}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 999,
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-text)',
              cursor: state.loadingMore ? 'default' : 'pointer',
            }}
          >
            {state.loadingMore && <Spinner size={10} color="var(--color-text-faint)" />}
            {state.loadingMore ? 'Loading…' : `Load ${PHONE_ITEM_LIMIT} more`}
          </button>
        )}
      </div>
    </div>
  )
}

const noteStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 8px 10px',
  fontSize: 12,
  lineHeight: 1.4,
  color: 'var(--color-text-faint)',
}
