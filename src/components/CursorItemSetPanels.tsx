import { useEffect, useRef, useState } from 'react'
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
import { itemSetSessions } from '../store/itemSetSessions'
import {
  describeDraft,
  draftToFilter,
  EMPTY_DRAFT,
  isEmptyQuery,
  queryToDraft,
  type QueryDraft,
} from '../stac/queryDraft'
import type { StacNode } from '../stac/types'
import { declaredBboxes } from '../stac/spatial'
import { resolveBody } from '../stac/body'
import { ConditionChips, type ConditionChip } from './ConditionChips'
import { describeBboxArea } from '../stac/describe'
import { loader } from '../stac/loaderInstance'

/** An API-backed Collection's Item Set: the Search section above the
 *  Results, in one column of the Items panel. Search-first — nothing is
 *  fetched until Search is clicked (or a query arrives by URL). The
 *  Search section collapses to a one-line summary of its conditions so
 *  the results get the height. This used to be two separate boxes in the
 *  tree canvas joined by a connector, the node-editor reading; in a
 *  floating window that reading has no line to hang on, and one column
 *  with a divider says the same thing: conditions above, what they
 *  produced below (docs/DESIGN.md, "The Items panel"). One hook instance
 *  (`usePagedCursorResults`) backs both halves, so they can never
 *  disagree. */
export function CursorItemSetPanels({ node }: { node: StacNode & { items: { kind: 'cursor' } } }) {
  const initialQuery = useState(() => useItemSetStore.getState().consumePendingInitialQuery(node.href))[0]
  const state = usePagedCursorResults(node, initialQuery)
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  const select = useSelectionStore((s) => s.select)
  const session = initialQuery === undefined ? itemSetSessions.getCursor(node.href) : undefined
  const [view, setView] = useState<ItemSetView>(session?.view ?? 'list')
  const conformsTo = useApiConformance(node)
  const sortAvailable = supportsSort(conformsTo)

  const [draft, setDraft] = useState<QueryDraft>(() =>
    initialQuery !== undefined ? queryToDraft(initialQuery) : (session?.draft ?? EMPTY_DRAFT),
  )
  const [searchCollapsed, setSearchCollapsed] = useState(session?.searchCollapsed ?? false)
  useEffect(() => {
    itemSetSessions.setCursor(node.href, { view, draft, searchCollapsed })
  }, [node.href, view, draft, searchCollapsed])

  // A query arriving by URL for a Collection whose panel is already
  // mounted — a pasted link while it is open, back/forward between two
  // searches of the same Collection — is applied here; the one-shot read
  // above only covers a fresh mount.
  const pending = useItemSetStore((s) => s.pendingInitialQuery)
  const applyQueryRef = useRef<((q: CursorQuery) => void) | undefined>(undefined)
  useEffect(() => {
    applyQueryRef.current = state.status === 'empty' ? undefined : state.applyQuery
  })
  useEffect(() => {
    if (!pending || pending.forHref !== node.href) return
    const query = useItemSetStore.getState().consumePendingInitialQuery(node.href)
    if (!query) return
    // Synchronizing with the URL store's one-shot event: the draft must
    // show the query the URL brought, not what was being typed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(queryToDraft(query))
    applyQueryRef.current?.(query)
  }, [pending, node.href])
  // Drawing a bbox happens in a dedicated modal (`BboxPickerModal`), not
  // by switching Results over to its own Time & Space tab and drawing
  // there. This was an explicit request: clicking something and getting a
  // modal to work in is a good interaction. The Results box's own map keeps showing
  // `draft.bbox` as a reference overlay (below), it just isn't itself
  // interactively drawable anymore.
  const [bboxModalOpen, setBboxModalOpen] = useState(false)
  const editButtonRef = useRef<HTMLButtonElement>(null)

  useResetShowOnLenses(node.href)
  const pageItems = state.status === 'empty' ? [] : state.pageItems
  usePublishVisible(
    node.href,
    pageItems,
    state.status === 'empty' ? 0 : state.pageIndex,
    state.status === 'empty' ? 0 : state.pageSize,
  )
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
  // Before the first search of a node that waits for conditions (not a
  // Collection), `draftFilter` and `appliedQuery` are both `{}` — identical
  // — which would otherwise leave
  // Search permanently disabled. Any explicit click while `idle` goes
  // through, filters or not — that's what running a first search means. (A
  // Collection is never idle: its default search runs on open.)
  const searchDisabled = state.loadingMore || (state.status !== 'idle' && !draftDirty)

  // The conditions the results answer (applied, not the draft), each
  // removable: removing one runs the search again without it.
  // Only that condition leaves the draft too; other edits not yet
  // searched stay as they were.
  const removeFromApplied = (patch: Partial<typeof appliedQuery>, draftPatch: Partial<QueryDraft>) => {
    setDraft((d) => ({ ...d, ...draftPatch }))
    applyQuery({ ...appliedQuery, ...patch })
  }
  const appliedChips: ConditionChip[] = []
  if (appliedQuery.datetimeStart || appliedQuery.datetimeEnd) {
    appliedChips.push({
      key: 'date',
      kind: 'Date',
      value: `${appliedQuery.datetimeStart?.slice(0, 10) ?? '…'} – ${appliedQuery.datetimeEnd?.slice(0, 10) ?? '…'}`,
      onRemove: () =>
        removeFromApplied({ datetimeStart: undefined, datetimeEnd: undefined }, { dateStart: '', dateEnd: '' }),
    })
  }
  if (appliedQuery.bbox) {
    appliedChips.push({
      key: 'area',
      kind: 'Area',
      value: describeBboxArea(appliedQuery.bbox),
      onRemove: () => removeFromApplied({ bbox: undefined }, { bbox: undefined }),
    })
  }
  if (appliedQuery.sortDirection) {
    appliedChips.push({
      key: 'sort',
      kind: 'Sort',
      value: appliedQuery.sortDirection === 'desc' ? 'newest first' : 'oldest first',
      onRemove: () => removeFromApplied({ sortDirection: undefined }, { sortDirection: undefined }),
    })
  }

  function handleSearch() {
    applyQuery(draftToFilter(draft))
  }
  function handleClear() {
    setDraft(EMPTY_DRAFT)
    clearQuery()
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* One line naming the section, saying where the search stands, and
       * the way to edit or hide its conditions — a plain label and a
       * command, not an uppercase heading with a disclosure triangle,
       * which read the same as the Children list's filter while doing
       * something else: this one runs a request when Search is pressed
       * (DESIGN §128). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 0 6px', fontSize: 11.5 }}>
        <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>Search</span>
        <span
          data-search-summary
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--color-text-muted)',
          }}
        >
          {searchCollapsed ? describeDraft(draft, sortAvailable) : ''}
          {draftDirty
            ? `${searchCollapsed ? ' · ' : ''}edited, not searched`
            : state.status === 'idle'
              ? `${searchCollapsed ? ' · ' : ''}not searched yet`
              : ''}
        </span>
        <button
          type="button"
          ref={editButtonRef}
          className="stac-lens-view-command"
          onClick={() => setSearchCollapsed((c) => !c)}
          aria-expanded={!searchCollapsed}
          title={
            searchCollapsed
              ? 'Edit the search conditions'
              : 'Hide the search conditions, to give the results the height'
          }
          style={{ height: 22, flexShrink: 0 }}
        >
          {searchCollapsed ? 'Edit' : 'Hide'}
        </button>
      </div>
      {!searchCollapsed && (
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', paddingBottom: 8 }}>
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
        </div>
      )}
      <div style={{ paddingBottom: appliedChips.length ? 8 : 0 }}>
        <ConditionChips
          chips={appliedChips}
          label="Applied search conditions"
          fallbackFocus={() => editButtonRef.current?.focus()}
        />
      </div>
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
      <div style={{ borderTop: '1px solid var(--color-border)', margin: '0 -8px 8px' }} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <ItemSetResultsPanel
          view={view}
          setView={setView}
          status={state.status}
          error={state.error}
          idleMessage="Set conditions above and click Search."
          pageItems={pageItems}
          dimmedItems={state.dimmedItems}
          pageIndex={state.pageIndex}
          totalPages={state.totalPages}
          totalPagesIsLowerBound={state.totalPagesIsLowerBound}
          totalItems={state.totalItems}
          queryNote={appliedFilterActive ? undefined : "no conditions, the server's order"}
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
          // The *draft* bbox, not `appliedQuery.bbox` — shown the moment it
          // is drawn, before Search is clicked (a reported gap: a drawn
          // area was invisible until the search ran). Identical once
          // Search commits.
          appliedBbox={draft.bbox}
          appliedRange={{ start: appliedQuery.datetimeStart, end: appliedQuery.datetimeEnd }}
        />
      </div>
    </div>
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
