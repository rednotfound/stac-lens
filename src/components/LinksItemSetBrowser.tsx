import { useState } from 'react'
import { useLinksPagedItemSet } from '../hooks/useLinksPagedItemSet'
import { useSelectionStore } from '../store/selection'
import { ItemSetResultsPanel } from './ItemSetResultsPanel'
import { useResetShowOnLenses, usePublishVisible, type ItemSetView } from './ItemSetBrowser'
import type { StacNode } from '../stac/types'

/** Static catalogs — the full href array is known up front, so this is a
 *  thin adapter from `useLinksPagedItemSet`'s own shape onto the shared
 *  `ItemSetResultsPanel`. No search/query concept applies here at all: "在
 *  static catalog中的搜索几乎是没有意义的,按照ID或者名字搜索,没有人能够做到" (a
 *  text search over a static catalog is nearly meaningless — nobody knows
 *  its opaque item ids/titles up front) — real page-based pagination
 *  replaces it instead. */
export function LinksItemSetBrowser({ node }: { node: StacNode & { items: { kind: 'links' } } }) {
  const state = useLinksPagedItemSet(node)
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  const select = useSelectionStore((s) => s.select)
  const [view, setView] = useState<ItemSetView>('list')

  useResetShowOnLenses(node.href)
  const pageItems = state.status === 'empty' ? [] : state.pageItems
  usePublishVisible(node.href, pageItems)

  if (state.status === 'empty') return null

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ItemSetResultsPanel
        view={view}
        setView={setView}
        status={state.status}
        pageItems={pageItems}
        dimmedItems={state.otherLoadedItems}
        pageIndex={state.pageIndex}
        totalPages={state.totalPages}
        totalPagesIsLowerBound={false}
        totalItems={state.totalItems}
        pageSize={state.pageSize}
        setPageSize={state.setPageSize}
        goToPage={state.goToPage}
        loadingPage={state.loadingPage}
        selectedHref={selectedHref ?? undefined}
        onSelect={select}
        nodeHref={node.href}
        emptyListMessage="no items on this page"
        emptyLensMessage={() => 'no matching data on this page'}
      />
    </div>
  )
}
