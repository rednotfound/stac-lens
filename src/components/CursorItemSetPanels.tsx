import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePagedCursorResults } from '../hooks/usePagedCursorResults'
import type { CursorQuery } from '../hooks/useCursorQueriedItemSet'
import { useApiConformance } from '../hooks/useApiConformance'
import { supportsSort } from '../stac/conformance'
import { useSelectionStore } from '../store/selection'
import { useItemSetStore } from '../store/itemSet'
import { ItemSetResultsPanel } from './ItemSetResultsPanel'
import { ItemSetSearchPanel } from './ItemSetSearchPanel'
import { BboxPickerModal } from './BboxPickerModal'
import { useResetShowOnLenses, usePublishVisible, type ItemSetView } from './ItemSetBrowser'
import type { StacNode } from '../stac/types'
import { declaredBboxes } from '../stac/spatial'
import { resolveBody } from '../stac/body'
import { loader } from '../stac/loaderInstance'

function toRfc3339Start(dateOnly: string): string {
  return `${dateOnly}T00:00:00Z`
}
function toRfc3339End(dateOnly: string): string {
  return `${dateOnly}T23:59:59Z`
}
function toDateInputValue(rfc3339: string | undefined): string {
  return rfc3339 ? rfc3339.slice(0, 10) : ''
}

export interface QueryDraft {
  dateStart: string // yyyy-mm-dd, from <input type="date">
  dateEnd: string
  sortDirection?: 'asc' | 'desc'
  bbox?: [number, number, number, number]
}

const EMPTY_DRAFT: QueryDraft = { dateStart: '', dateEnd: '' }

function draftToFilter(draft: QueryDraft): CursorQuery {
  return {
    datetimeStart: draft.dateStart ? toRfc3339Start(draft.dateStart) : undefined,
    datetimeEnd: draft.dateEnd ? toRfc3339End(draft.dateEnd) : undefined,
    sortDirection: draft.sortDirection,
    bbox: draft.bbox,
  }
}

/** Inverse of `draftToFilter` — used to pre-fill the draft controls from a
 *  query restored off a shareable URL, so the date inputs/sort select/bbox
 *  chip visibly match on load, not just the results list. */
function queryToDraft(q: CursorQuery): QueryDraft {
  return {
    dateStart: toDateInputValue(q.datetimeStart),
    dateEnd: toDateInputValue(q.datetimeEnd),
    sortDirection: q.sortDirection,
    bbox: q.bbox,
  }
}

function isEmptyQuery(q: CursorQuery): boolean {
  return !q.datetimeStart && !q.datetimeEnd && !q.sortDirection && !q.bbox
}

/** API-backed Collections get two genuinely independent boxes — a real
 *  node-editor-style pair, not two `<div>`s sharing one `foreignObject`.
 *  This was an explicit request: two literally separate foreignObjects,
 *  one Search, one Result.
 *  `StructureTree.tsx` renders those two `foreignObject`s (each with its
 *  own independent drag/resize handles and a connecting line between them)
 *  and gives this component two plain target `<div>`s, one inside each —
 *  this is the single place the shared state (the query, the paged
 *  results) actually lives, portaled out into both targets via
 *  `createPortal` so one hook instance backs two physically separate
 *  places in the DOM. `usePagedCursorResults` adapts the underlying
 *  cursor/accumulation hook into the same paged shape `LinksItemSetBrowser`
 *  gets from `useLinksPagedItemSet`, so once a query has produced a
 *  result, both modes present it through `ItemSetResultsPanel`
 *  identically. */
export function CursorItemSetPanels({
  node,
  searchTarget,
  resultsTarget,
}: {
  node: StacNode & { items: { kind: 'cursor' } }
  searchTarget: HTMLDivElement
  resultsTarget: HTMLDivElement
}) {
  const initialQuery = useState(() => useItemSetStore.getState().consumePendingInitialQuery(node.href))[0]
  const state = usePagedCursorResults(node, initialQuery)
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  const select = useSelectionStore((s) => s.select)
  const [view, setView] = useState<ItemSetView>('list')
  const conformsTo = useApiConformance(node)
  const sortAvailable = supportsSort(conformsTo)

  const [draft, setDraft] = useState<QueryDraft>(() => queryToDraft(initialQuery ?? {}))
  // Drawing a bbox happens in a dedicated modal (`BboxPickerModal`), not
  // by switching Results over to its own Time & Space tab and drawing
  // there. This was an explicit request: clicking something and getting a
  // modal to work in is a good interaction. The Results box's own map keeps showing
  // `draft.bbox` as a reference overlay (below), it just isn't itself
  // interactively drawable anymore.
  const [bboxModalOpen, setBboxModalOpen] = useState(false)

  useResetShowOnLenses(node.href)
  const pageItems = state.status === 'empty' ? [] : state.pageItems
  usePublishVisible(node.href, pageItems)
  // `undefined` while `idle` too, not just `empty` — nothing has actually
  // been searched yet, so there's nothing to persist into the shareable
  // URL (an idle `appliedQuery` is just `{}`, a placeholder, not a real
  // applied filter).
  usePublishAppliedQuery(
    node.href,
    state.status === 'empty' || state.status === 'idle' ? undefined : state.appliedQuery,
  )

  if (state.status === 'empty') return null

  // Destructured, not accessed as `state.xxx` inside the closures below —
  // narrowing away the `{status:'empty'}` branch above doesn't carry into
  // a nested function body in TS's control-flow analysis (a known
  // limitation for property narrowing across closures), but a plain
  // destructured `const` keeps its own concrete type regardless.
  const { applyQuery, clearQuery, appliedQuery } = state
  const appliedFilterActive = !isEmptyQuery(appliedQuery)
  const draftFilter = draftToFilter(draft)
  const draftDirty = JSON.stringify(draftFilter) !== JSON.stringify(appliedQuery)
  // Before the very first search, `draftFilter` and `appliedQuery` are both
  // `{}` — identical — which would otherwise leave Search permanently
  // disabled and no way to ever trigger that first search at all (search-
  // first mode has no auto-load to fall back on). Any explicit click before
  // `status !== 'idle'` should go through, filters or not — that's exactly
  // what running a search for the first time means.
  const searchDisabled = state.loadingMore || (state.status !== 'idle' && !draftDirty)

  function handleSearch() {
    applyQuery(draftToFilter(draft))
  }
  function handleClear() {
    setDraft(EMPTY_DRAFT)
    clearQuery()
  }

  return (
    <>
      {createPortal(
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <ItemSetSearchPanel
            draft={draft}
            setDraft={setDraft}
            sortAvailable={sortAvailable}
            onDrawArea={() => setBboxModalOpen(true)}
            onClearBbox={() => setDraft((d) => ({ ...d, bbox: undefined }))}
            onSearch={handleSearch}
            onClear={handleClear}
            searchDisabled={searchDisabled}
            clearDisabled={!appliedFilterActive && isEmptyQuery(draftFilter)}
            draftDirty={draftDirty}
          />
        </div>,
        searchTarget,
      )}
      {bboxModalOpen && (
        <BboxPickerModal
          initialBbox={draft.bbox}
          statedBboxes={declaredBboxes(node.spatial)}
          body={resolveBody(node, loader)}
          onConfirm={(bbox) => {
            setDraft((d) => ({ ...d, bbox }))
            setBboxModalOpen(false)
          }}
          onCancel={() => setBboxModalOpen(false)}
        />
      )}
      {createPortal(
        <ItemSetResultsPanel
          view={view}
          setView={setView}
          status={state.status}
          error={state.error}
          idleMessage="Set your search filters above and click Search to see results."
          pageItems={pageItems}
          dimmedItems={state.dimmedItems}
          pageIndex={state.pageIndex}
          totalPages={state.totalPages}
          totalPagesIsLowerBound={state.totalPagesIsLowerBound}
          totalItems={state.totalItems}
          pageSize={state.pageSize}
          setPageSize={state.setPageSize}
          goToPage={state.goToPage}
          loadingPage={state.loadingPage}
          loadingPageLabel={state.loadingPageLabel}
          selectedHref={selectedHref ?? undefined}
          onSelect={select}
          nodeHref={node.href}
          emptyListMessage={appliedFilterActive ? 'no items match this query' : 'no items loaded'}
          emptyLensMessage={() =>
            appliedFilterActive ? 'no items match this query' : 'no matching data in the loaded items'
          }
          // The *draft* bbox, not `appliedQuery.bbox` — shown immediately
          // once drawn, before "Search" is ever clicked. This was a reported
          // problem, not a guess: after drawing a search area, the drawn area
          // was invisible even though "bbox set" appeared — the temporary drawing preview is
          // removed the instant the gesture ends (by design, it's only a
          // live preview), and nothing else stood in for it until a search
          // actually ran, leaving a multi-second gap with zero visual
          // confirmation of what was just drawn. The two values are
          // identical the moment Search does commit, so this never looks
          // different from showing the applied one once submitted.
          appliedBbox={draft.bbox}
          appliedRange={{ start: appliedQuery.datetimeStart, end: appliedQuery.datetimeEnd }}
        />,
        resultsTarget,
      )}
    </>
  )
}

/** Publishes the currently-applied query so `App.tsx` can encode it into
 *  the shareable URL. Cursor-only: static catalogs have no query concept,
 *  so this hook exists here rather than as one of `ItemSetBrowser.tsx`'s
 *  shared bits. Declared *after* `usePublishVisible` at the call site so
 *  both effects commit in the same pass, right before `setVisible`'s own
 *  `forHref`-changed guard would otherwise briefly show a mismatched pair
 *  (see `store/itemSet.ts`'s `setVisible`). */
function usePublishAppliedQuery(nodeHref: string, appliedQuery: CursorQuery | undefined) {
  const setAppliedQuery = useItemSetStore((s) => s.setAppliedQuery)
  useEffect(() => {
    setAppliedQuery(nodeHref, appliedQuery)
  }, [nodeHref, appliedQuery, setAppliedQuery])
}
