import { Spinner } from './Spinner'
import { LoadingState } from './LoadingState'
import type { StacNode } from '../stac/types'
import {
  ItemRow,
  TabBar,
  TimeSpaceView,
  buildPageList,
  formControlStyle,
  pageNumberButtonStyle,
  pagerButtonStyle,
  useScrollSelectedIntoView,
  type ItemSetView,
} from './ItemSetBrowser'

export const RESULTS_PAGE_SIZE_OPTIONS = [20, 40, 100, 200]

export interface ItemSetResultsPanelProps {
  view: ItemSetView
  setView: (v: ItemSetView) => void
  /** `idle`: nothing to show yet because no search has been run (cursor
   *  mode, search-first — see `usePagedCursorResults`). Renders
   *  `idleMessage` in place of the pager/List/Time & Space UI entirely;
   *  links mode never passes this. */
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Shown only while `status === 'idle'`. Required in that case, unused
   *  otherwise. */
  idleMessage?: string
  /** The failure, while `status === 'error'` — rendered in place of the
   *  list, in warning color, never as an empty-result message. */
  error?: string
  pageItems: StacNode[]
  /** Every other already-loaded page's items — shown de-emphasized on the
   *  Time & Space view. Links mode: every other cached page. Cursor mode:
   *  the rest of the accumulated buffer outside the current page slice. */
  dimmedItems: StacNode[]
  pageIndex: number
  totalPages: number
  /** True when `totalPages` is a lower bound, not a confirmed final count —
   *  a cursor-mode search whose server never reports a total match count
   *  and hasn't yet been paged to exhaustion. Renders "page N of M+" and
   *  keeps Next enabled past the apparent last page (clicking it triggers
   *  the underlying hook's own catch-up fetch). */
  totalPagesIsLowerBound: boolean
  /** Exact when `!totalPagesIsLowerBound`; otherwise "at least this many"
   *  (however much is loaded so far). Omit entirely when truly unknown. */
  totalItems?: number
  pageSize: number
  setPageSize: (n: number) => void
  goToPage: (index0Based: number) => void
  /** True while the page the UI should be showing isn't in hand yet — a
   *  not-yet-cached links page, or a cursor-mode page beyond the loaded
   *  buffer still being caught up to. */
  loadingPage: boolean
  /** Optional label alongside the spinner while `loadingPage` — e.g. cursor
   *  mode's "Fetching more results…" during catch-up. Links mode passes
   *  nothing (a bare spinner already reads fine for a single local fetch). */
  loadingPageLabel?: string
  selectedHref?: string
  onSelect: (href: string) => void
  nodeHref: string
  emptyListMessage: string
  emptyLensMessage: (kind: 'temporal' | 'spatial') => string
  appliedBbox?: [number, number, number, number]
  drawMode?: boolean
  onBboxDrawn?: (bbox: [number, number, number, number]) => void
  appliedRange?: { start?: string; end?: string }
}

/** The results-presentation UI shared by both Item Set modes — a page of
 *  Items, shown as a List or as a Time & Space view, with a numbered pager
 *  underneath. Static catalogs (`LinksItemSetBrowser`) and API searches
 *  (`CursorItemSetPanels`, via `usePagedCursorResults`) both map their own
 *  differently-sourced data into this one shape: once a batch of Items
 *  exists — whether because a static catalog's full href list was known
 *  from the start, or because a query just produced a result — presenting
 *  it page-by-page is the same problem either way (docs/DESIGN.md). */
export function ItemSetResultsPanel({
  view,
  setView,
  status,
  idleMessage,
  error,
  pageItems,
  dimmedItems,
  pageIndex,
  totalPages,
  totalPagesIsLowerBound,
  totalItems,
  pageSize,
  setPageSize,
  goToPage,
  loadingPage,
  loadingPageLabel,
  selectedHref,
  onSelect,
  nodeHref,
  emptyListMessage,
  emptyLensMessage,
  appliedBbox,
  drawMode,
  onBboxDrawn,
  appliedRange,
}: ItemSetResultsPanelProps) {
  const selectedRowRef = useScrollSelectedIntoView(selectedHref, pageItems)
  const pageList = buildPageList(pageIndex + 1, totalPages)
  const atApparentLastPage = pageIndex >= totalPages - 1

  if (status === 'idle') {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 12, color: 'var(--color-text-faint)', textAlign: 'center', padding: 16 }}>
          {idleMessage}
        </div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <TabBar view={view} setView={setView} />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 6,
          fontSize: 11,
          color: 'var(--color-text-muted)',
        }}
      >
        <button
          onClick={() => goToPage(pageIndex - 1)}
          disabled={pageIndex === 0}
          style={pagerButtonStyle(pageIndex === 0)}
        >
          ← Prev
        </button>
        {pageList.map((p, i) =>
          p === 'ellipsis' ? (
            <span key={`e${i}`} style={{ padding: '0 2px', color: 'var(--color-text-faint)' }}>
              …
            </span>
          ) : (
            <button key={p} onClick={() => goToPage(p - 1)} style={pageNumberButtonStyle(p === pageIndex + 1)}>
              {p}
            </button>
          ),
        )}
        <button
          onClick={() => goToPage(pageIndex + 1)}
          disabled={atApparentLastPage && !totalPagesIsLowerBound}
          style={pagerButtonStyle(atApparentLastPage && !totalPagesIsLowerBound)}
        >
          Next →
        </button>
        {loadingPage && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Spinner size={11} />
            {loadingPageLabel}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} style={formControlStyle}>
          {RESULTS_PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}/page
            </option>
          ))}
        </select>
      </div>
      {view === 'list' && (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            // Dimmed, not blanked, while the target page isn't in hand yet —
            // a page flip should never look like the data vanished.
            opacity: loadingPage ? 0.5 : 1,
            pointerEvents: loadingPage ? 'none' : undefined,
          }}
        >
          {status === 'loading' ? (
            <LoadingState>Loading items…</LoadingState>
          ) : status === 'error' ? (
            <div style={{ padding: 8, fontSize: 12, color: 'var(--color-node-warning)' }}>
              ⚠ {error ?? 'search failed'}
            </div>
          ) : pageItems.length === 0 ? (
            <div style={{ padding: 8, fontSize: 12, color: 'var(--color-text-faint)' }}>{emptyListMessage}</div>
          ) : (
            pageItems.map((item) => (
              <ItemRow
                key={item.href}
                item={item}
                selected={item.href === selectedHref}
                onSelect={() => onSelect(item.href)}
                rowRef={item.href === selectedHref ? selectedRowRef : undefined}
              />
            ))
          )}
        </div>
      )}
      {view === 'time-space' && (
        <TimeSpaceView
          items={pageItems}
          dimmedItems={dimmedItems}
          selectedHref={selectedHref}
          onSelect={onSelect}
          nodeHref={nodeHref}
          loading={status === 'loading'}
          emptyMessage={emptyLensMessage}
          appliedBbox={appliedBbox}
          drawMode={drawMode}
          onBboxDrawn={onBboxDrawn}
          appliedRange={appliedRange}
        />
      )}
      {/* No "load all remaining" affordance — deliberately removed, not
       * just guarded harder. A confirmation dialog (an earlier version of
       * this fix) still left a real, reported danger intact: "这个 load
       * all remains 这个按钮还在,我也觉得好像不应该在,因为太危险。比如说我这份
       * 数据就还有一千四百个item,我点一下,我们的系统就瞬间爆" (that "load all
       * remaining" button is still there — I don't think it should be —
       * it's too dangerous; say there are 1,400 items remaining, one click
       * and the whole system instantly blows up). The actual cost isn't
       * the fetch itself (already capped) — it's that every loaded Item,
       * not just the current page, gets plotted on the Time & Space map/
       * timeline at once (`dimmedItems`), and a plain confirm dialog can't
       * make that rendering cost safe, only ask permission to hit it
       * anyway. Paging through the numbered pager above is the only way
       * to see everything now — slower, but never a single click away
       * from rendering thousands of markers at once. */}
      {/* Footer status line, bled out over the body's 8px padding so it
       * reads as the box's own bottom bar (matching the title bar above);
       * the pager itself deliberately stays at the top, next to the tabs. */}
      <div
        style={{
          fontSize: 11,
          color: 'var(--color-text-faint)',
          margin: '6px -8px -8px',
          padding: '4px 10px',
          borderTop: '1px solid var(--color-border)',
          background: 'var(--color-bg)',
        }}
      >
        {status === 'error' ? (
          'search failed — nothing to page through'
        ) : (
          <>
            page {pageIndex + 1} of {totalPages}
            {totalPagesIsLowerBound ? '+' : ''}
            {totalItems != null && ` — ${totalItems}${totalPagesIsLowerBound ? '+' : ''} items total`}
          </>
        )}
      </div>
    </div>
  )
}
