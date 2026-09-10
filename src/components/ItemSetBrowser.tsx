import { useEffect, useMemo, useRef, useState } from 'react'
import { useItemSet } from '../hooks/useItemSet'
import { useSelectionStore } from '../store/selection'
import { useItemSetStore } from '../store/itemSet'
import { useQueryStore } from '../store/query'
import { describeTemporal } from '../stac/describe'
import type { StacNode } from '../stac/types'

function formatBboxSummary(bbox: { west: number; south: number; east: number; north: number }): string {
  const f = (n: number) => n.toFixed(2)
  return `${f(bbox.west)}, ${f(bbox.south)} → ${f(bbox.east)}, ${f(bbox.north)}`
}

function formatDatetimeSummary(start: string | null, end: string | null): string {
  const f = (iso: string) => iso.slice(0, 10)
  if (start && end) return `${f(start)} → ${f(end)}`
  if (start) return `${f(start)} → …`
  if (end) return `… → ${f(end)}`
  return ''
}

const SCROLL_LOAD_THRESHOLD = 120
// Was 260 (~3-4 visible rows) — called out directly: "我们明明可能加载到上千
// 啊,一次性只能看到3个我真的无语...我们这个项目也是需要让人感受到数据的体量和
// 数量的啊" (we can load up to thousands, but only see 3 at once — this
// project needs to make people actually feel the scale of the data too).
// Matched by a corresponding increase to ITEM_SET_BOX_HEIGHT in
// StructureTree.tsx, which this list is embedded inside.
const LIST_MAX_HEIGHT = 560
const EMPTY_ITEMS: StacNode[] = []

/** A Collection's direct items, browsable as their own selectable object —
 *  distinct from drilling into Structure Lens's tree, which would mean
 *  cascading potentially thousands of item nodes into the tree layout just
 *  to reach one. Real catalogs enumerate items as one flat href array with
 *  no pagination of their own (docs/DESIGN.md §19's third update, §21) —
 *  scrolling to the bottom fetches the next slice of that array's item
 *  JSON, and the search box filters only what's been fetched so far,
 *  surfaced honestly (not silently incomplete) via the footer count. */
export function ItemSetBrowser({ node }: { node: StacNode }) {
  const state = useItemSet(node)
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  const select = useSelectionStore((s) => s.select)
  const setVisible = useItemSetStore((s) => s.setVisible)
  const [query, setQuery] = useState('')

  const isApiSearched = node.items.kind === 'cursor'
  const queryBbox = useQueryStore((s) => s.bbox)
  const queryDatetimeStart = useQueryStore((s) => s.datetimeStart)
  const queryDatetimeEnd = useQueryStore((s) => s.datetimeEnd)
  const triggerSearch = useQueryStore((s) => s.triggerSearch)
  const clearQueryDraft = useQueryStore((s) => s.clearDraft)
  const drawRequest = useQueryStore((s) => s.drawRequest)
  const requestDraw = useQueryStore((s) => s.requestDraw)
  const hasQueryDraft = !!queryBbox || !!queryDatetimeStart || !!queryDatetimeEnd

  const items = state.status === 'ready' ? state.items : EMPTY_ITEMS
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (i) => i.id.toLowerCase().includes(q) || (i.title ?? '').toLowerCase().includes(q),
    )
  }, [items, query])

  // Publish "what's actually in view here" for Time/Space Lens to read
  // (see useSelectedItems/useItemSetStore) — the searched/narrowed subset,
  // not the raw loaded set, so typing in this search box live-narrows the
  // timeline/map too.
  useEffect(() => {
    setVisible(node.href, filtered.map((i) => i.href))
  }, [node.href, filtered, setVisible])

  // Bring the selected row into view automatically — selecting an Item
  // from Space Lens or Time Lens (both driven by this same list, via
  // useItemSetStore) highlights its row here correctly, but with only a
  // handful of rows visible at once out of possibly thousands loaded, a
  // highlight with no scroll is invisible in practice. Reported directly:
  // "从地图上选择了一个具体的item之后,inspector也许是对的,但是在tree view里面
  // 没有看到选择到的item啊" (after selecting an Item from the map, Inspector
  // might be right, but I don't see the selected Item in the tree view) —
  // the row *was* highlighted, just scrolled out of view. Same pattern
  // Time Lens already uses for its own selected row.
  const selectedRowRef = useRef<HTMLDivElement | null>(null)
  const lastScrolledRef = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedHref || selectedHref === lastScrolledRef.current) return
    if (selectedRowRef.current) {
      lastScrolledRef.current = selectedHref
      selectedRowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [selectedHref, filtered])

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    if (state.status !== 'ready' || !state.hasMore || state.loadingMore) return
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_LOAD_THRESHOLD) {
      state.loadMore()
    }
  }

  if (state.status === 'empty') return null

  return (
    <div>
      {/* Same tag as Structure Lens's own tree node (StructureTree.tsx) —
       * carried through here too so it reads as one consistent signal
       * rather than something only visible before you open the panel:
       * "得有一个标签也好,highlight也好什么东西,因为你看这个Stack Browser里面,它
       * 就是有一个tag在" (it needs a tag or highlight — STAC Browser has a
       * tag for this). */}
      {isApiSearched && (
        <span
          style={{
            display: 'inline-block',
            fontSize: 10,
            fontWeight: 700,
            padding: '2px 7px',
            borderRadius: 999,
            background: 'var(--color-badge-api-bg)',
            color: 'var(--color-badge-api-text)',
            marginBottom: 6,
          }}
        >
          API
        </span>
      )}
      {/* The real search, for an API-backed node — a bbox drawn on Space
       * Lens and/or a datetime range dragged on Time Lens, applied here.
       * id/title text search (below) stays as a secondary, loaded-results-
       * only filter, not the primary way in — asked about directly:
       * "让用户搜索id和title是不现实的,因为id和title是没用的" (asking a user to
       * search by opaque, machine-generated ids/titles is unrealistic). */}
      {isApiSearched && (
        <div
          style={{
            marginBottom: 8,
            padding: 8,
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            fontSize: 11,
          }}
        >
          <div style={{ color: 'var(--color-text-muted)', marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <span style={{ flex: 1 }}>
                {queryBbox ? `area: ${formatBboxSummary(queryBbox)}` : 'area: none drawn'}
              </span>
              {/* Arms the same `drawRequest` Space Lens's own "Draw area"
               * button does (store/query.ts) — the actual drag gesture
               * still happens on the real map (a bbox-entry field here
               * would be a worse way to specify one), but starting it no
               * longer means leaving Item Set to go find that button:
               * "为什么不能将search bar...放入item set里面...一定要分两块？"
               * (why can't the search bar live inside Item Set — does it
               * have to be two separate places?). App.tsx brings Space
               * Lens on screen automatically once this arms it. */}
              <ToolButton
                active={drawRequest === 'bbox'}
                label={drawRequest === 'bbox' ? 'Drawing… (drag on map)' : queryBbox ? 'Redraw area' : 'Draw area'}
                onClick={() => requestDraw('bbox')}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ flex: 1 }}>
                {queryDatetimeStart || queryDatetimeEnd
                  ? `range: ${formatDatetimeSummary(queryDatetimeStart, queryDatetimeEnd)}`
                  : 'range: none selected'}
              </span>
              <ToolButton
                active={drawRequest === 'datetime'}
                label={
                  drawRequest === 'datetime'
                    ? 'Selecting… (drag below)'
                    : queryDatetimeStart || queryDatetimeEnd
                      ? 'Reselect range'
                      : 'Select range'
                }
                onClick={() => requestDraw('datetime')}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={triggerSearch}
              disabled={!hasQueryDraft}
              style={{
                fontSize: 11,
                padding: '3px 10px',
                borderRadius: 999,
                border: '1px solid var(--color-selection)',
                background: hasQueryDraft ? 'var(--color-selection)' : 'var(--color-surface)',
                color: hasQueryDraft ? 'var(--color-bg)' : 'var(--color-text-faint)',
                cursor: hasQueryDraft ? 'pointer' : 'not-allowed',
              }}
            >
              Search
            </button>
            {hasQueryDraft && (
              <button
                onClick={clearQueryDraft}
                style={{
                  fontSize: 11,
                  padding: '3px 10px',
                  borderRadius: 999,
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={
          isApiSearched
            ? 'Filter loaded results by id/title (optional)…'
            : 'Search loaded items by id/title…'
        }
        style={{
          width: '100%',
          boxSizing: 'border-box',
          fontSize: 12,
          padding: '5px 8px',
          marginBottom: 6,
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
        }}
      />
      <div
        onScroll={handleScroll}
        style={{
          maxHeight: LIST_MAX_HEIGHT,
          overflow: 'auto',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        {state.status === 'loading' ? (
          <div style={{ padding: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>loading…</div>
        ) : (
          <>
            {filtered.map((item) => {
              const selected = item.href === selectedHref
              return (
                <div
                  key={item.href}
                  ref={selected ? selectedRowRef : undefined}
                  onClick={() => select(item.href)}
                  style={{
                    padding: '5px 8px',
                    fontSize: 12,
                    cursor: 'pointer',
                    borderBottom: '1px solid var(--color-border)',
                    background: selected ? 'var(--color-selection)' : 'transparent',
                    color: selected ? 'var(--color-bg)' : 'var(--color-text)',
                  }}
                >
                  <div>{item.title ?? item.id}</div>
                  {item.temporal && (
                    <div
                      style={{
                        fontSize: 11,
                        color: selected ? 'var(--color-bg)' : 'var(--color-text-faint)',
                        opacity: selected ? 0.85 : 1,
                      }}
                    >
                      {describeTemporal(item.temporal)}
                    </div>
                  )}
                </div>
              )
            })}
            {filtered.length === 0 && (
              <div style={{ padding: 8, fontSize: 12, color: 'var(--color-text-faint)' }}>
                {query ? `no match among ${items.length} loaded` : 'no items loaded'}
              </div>
            )}
            {state.loadingMore && (
              <div style={{ padding: 8, fontSize: 12, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                loading more…
              </div>
            )}
          </>
        )}
      </div>
      {state.status === 'ready' && (
        <div style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 4 }}>
          showing {items.length}
          {/* Undefined, not zero, when the source genuinely never reports a
           * total (some STAC API implementations don't — see useItemSet) —
           * stay honest about "loaded so far" rather than implying a total
           * that was never actually given. */}
          {state.totalCount != null ? ` of ${state.totalCount}` : ''} items loaded
          {/* This has to fire whenever there's more to fetch, not only
           * while an id/title filter is active — the previous version only
           * hinted "scroll to load more" when `query` was non-empty, so an
           * API search (bbox/datetime, never touching that text box) saw
           * "showing 40 of 916261 items loaded" with no indication 40 was
           * just the first page, not a hard limit — reported directly:
           * "范围搜索之后,发现上限是40个item" (after a range search, found the
           * cap is 40 items) — confirmed the pagination itself was working
           * correctly all along (scrolling did fetch 80, 120, 160...); the
           * bug was purely this hint never appearing to say so. */}
          {state.hasMore &&
            (query
              ? ' — search covers loaded items only; scroll the list to load more'
              : ' — scroll the list to load more')}
          {/* A narrowed area/range search often means "give me everything
           * matching this, not a trickle" — asked about directly: "一个用户
           * 去绘制范围搜索当然是想要拿到所有的数据,而不是带page啊" (someone who
           * draws an area search obviously wants all the data, not
           * paginated). Pagination itself is a real STAC API constraint
           * (Item Search's own `limit` caps at 10000, no "everything in
           * one request" mode exists) — this is the explicit escape hatch
           * for it, not a way around it: keeps paging automatically up to
           * `LOAD_ALL_SAFETY_CAP` (useItemSet.ts) rather than requiring a
           * scroll per page. */}
          {isApiSearched && state.hasMore && (
            <button
              onClick={state.loadAll}
              disabled={state.loadingMore}
              style={{
                display: 'block',
                marginTop: 4,
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 999,
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-text-muted)',
                cursor: state.loadingMore ? 'not-allowed' : 'pointer',
              }}
            >
              {state.loadingMore ? 'loading…' : 'Load all remaining'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Mirrors Space/Time Lens's own draw/select-range button styling exactly
 *  — same tool, same visual language, regardless of which of the (now
 *  three) places it's clicked from. */
function ToolButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flexShrink: 0,
        fontSize: 10,
        padding: '2px 8px',
        borderRadius: 999,
        border: `1px solid ${active ? '#2563eb' : 'var(--color-border)'}`,
        background: active ? '#2563eb' : 'var(--color-surface)',
        color: active ? '#fff' : 'var(--color-text-muted)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}
