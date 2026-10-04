import { loader } from '../stac/loaderInstance'
import type { StacNode } from '../stac/types'
import { useCollectionListStore } from '../store/collectionList'
import { useSelectionStore } from '../store/selection'
import { CollectionsList } from './collections/CollectionsList'
import { CursorItemSetPanels } from './CursorItemSetPanels'
import { LinksItemSetBrowser } from './LinksItemSetBrowser'
import { ChildrenIcon, ItemSetIcon, PaneHeader } from './panes'
import { TabButton } from './TabButton'

export type PaneMode = 'collections' | 'items'

/** The docked column between the views and the Inspector: what the browsed
 *  node contains (DESIGN §128). A Collection's Items ("Items in …": a
 *  static catalog's paged list, or an API Collection's Search and Results
 *  — DESIGN §121), or a Catalog's children ("Children of …": the
 *  Collections list, filtered by text and by what each Collection
 *  declares). A node with both — an API root and its search across every
 *  Collection, a static Catalog with Items of its own — gets two tabs.
 *  Named by its role, the browsed node only its context. Reached from a
 *  Collections list row's "Items →", the header offers the way back. Width
 *  and placement belong to `App`; the body is the only scroll region. */
export function ContentsPane({
  rootHref,
  node,
  mode,
  hasItems,
  hasChildren,
  childCount,
}: {
  rootHref: string
  node: StacNode
  mode: PaneMode
  hasItems: boolean
  hasChildren: boolean
  childCount?: number
}) {
  const title = node.title ?? node.id
  const isApiItems = node.items.kind === 'cursor'
  const setTab = useCollectionListStore((s) => s.setTab)
  const origin = useCollectionListStore((s) => s.origin)
  const select = useSelectionStore((s) => s.select)
  const originNode = origin && origin !== node.href && node.parentHref === origin ? origin : null
  const itemsLabel = 'Items'
  return (
    <section
      id="stac-lens-items-pane"
      aria-label={`${mode === 'collections' ? 'Children' : 'Items'} of ${title}`}
      data-items-panel={mode === 'items' || undefined}
      data-contents-pane={mode}
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-surface)',
        minWidth: 0,
      }}
    >
      <PaneHeader
        icon={mode === 'collections' ? <ChildrenIcon /> : <ItemSetIcon />}
        title={mode === 'collections' ? 'Children' : itemsLabel}
        context={`${mode === 'collections' ? 'of' : 'in'} ${title}`}
        badges={
          (mode === 'items' && isApiItems) || (mode === 'collections' && !!node.collectionsEndpoint) ? (
            <span
              title={mode === 'items' ? 'Items come from the API’s search' : 'Listed by the API’s /collections'}
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 7px',
                borderRadius: 999,
                background: 'var(--color-badge-api-bg)',
                color: 'var(--color-badge-api-text)',
              }}
            >
              API
            </span>
          ) : undefined
        }
      />
      {originNode && mode === 'items' && (
        <button
          type="button"
          data-collections-back
          // Back as it was: the root's list is shown while nothing is
          // selected (the root browsed), so returning there selects nothing
          // rather than opening the Inspector on the root.
          onClick={() => select(originNode === rootHref ? null : originNode)}
          className="stac-lens-view-command"
          title="Back to the list this Collection was opened from, with its filter"
          style={{ alignSelf: 'stretch', justifyContent: 'flex-start', margin: '4px 6px 0', minWidth: 0 }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            ‹ Children of {nodeTitle(originNode)}
          </span>
        </button>
      )}
      {hasItems && hasChildren && (
        <div
          role="tablist"
          style={{ display: 'flex', gap: 4, padding: '0 8px', borderBottom: '1px solid var(--color-border)' }}
        >
          <TabButton
            label={`Children${childCount != null ? ` ${childCount}` : ''}`}
            active={mode === 'collections'}
            onClick={() => setTab(node.href, 'collections')}
          />
          <TabButton label={itemsLabel} active={mode === 'items'} onClick={() => setTab(node.href, 'items')} />
        </div>
      )}
      {/* `display: flex` is load-bearing: the content's own `flex: 1` /
       * `height: 100%` sizing only resolves inside a flex container with a
       * definite height (the Time & Space map collapses to zero without). */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 8, overflow: 'auto' }}>
        {mode === 'collections' ? (
          <CollectionsList key={node.href} container={node} />
        ) : isApiItems ? (
          <CursorItemSetPanels key={node.href} node={node as StacNode & { items: { kind: 'cursor' } }} />
        ) : (
          <LinksItemSetBrowser key={node.href} node={node as StacNode & { items: { kind: 'links' } }} />
        )}
      </div>
    </section>
  )
}

function nodeTitle(href: string): string {
  const n = loader.get(href)
  return n ? (n.title ?? n.id) : href
}
