import type { StacNode } from '../stac/types'
import { CursorItemSetPanels } from './CursorItemSetPanels'
import { LinksItemSetBrowser } from './LinksItemSetBrowser'
import { ItemSetIcon, PaneHeader } from './panes'

/** The Items panel: a docked column between the views and the Inspector,
 *  showing the Item Set of the Collection being browsed — named by its
 *  role ("Items"), the Collection only its context ("in …"), with the
 *  Item-set glyph, not the Collection's — a static
 *  catalog's paged list, or an API Collection's Search and Results. The
 *  three columns read left to right as the selection flows: a Collection
 *  in a view, an Item here, its details in the Inspector (the mail
 *  client's navigation | list | detail). It replaced a floating window
 *  that covered the very part of the canvas where a Collection's Item
 *  leaves are drawn (docs/DESIGN.md §121). It follows `browsingHref`;
 *  each Collection's query, page and buffer live in `itemSetSessions`, so
 *  closing the panel or browsing elsewhere and coming back finds it as it
 *  was. Width and placement belong to `App`; the body's results list is
 *  the only scroll region inside. */
export function ItemsPanel({ node }: { node: StacNode }) {
  const isApi = node.items.kind === 'cursor'
  const title = node.title ?? node.id
  return (
    <section
      id="stac-lens-items-pane"
      aria-label={`Items of ${title}`}
      data-items-panel
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-surface)',
        minWidth: 0,
      }}
    >
      <PaneHeader
        icon={<ItemSetIcon />}
        title="Items"
        context={`in ${title}`}
        badges={
          isApi ? (
            <span
              title="Items come from the API's search"
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
      {/* `display: flex` is load-bearing: the content's own `flex: 1` /
       * `height: 100%` sizing only resolves inside a flex container with a
       * definite height (the Time & Space map collapses to zero without). */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 8, overflow: 'auto' }}>
        {isApi ? (
          <CursorItemSetPanels key={node.href} node={node as StacNode & { items: { kind: 'cursor' } }} />
        ) : (
          <LinksItemSetBrowser key={node.href} node={node as StacNode & { items: { kind: 'links' } }} />
        )}
      </div>
    </section>
  )
}
