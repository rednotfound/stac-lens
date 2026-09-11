import { useEffect, useMemo, useRef, useState } from 'react'
import { useItemSet } from '../hooks/useItemSet'
import { useSelectionStore } from '../store/selection'
import { useItemSetStore } from '../store/itemSet'
import { describeTemporal } from '../stac/describe'
import { Spinner } from './Spinner'
import { LoadingState } from './LoadingState'
import type { StacNode } from '../stac/types'

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
  const setShowOnLenses = useItemSetStore((s) => s.setShowOnLenses)
  const [query, setQuery] = useState('')

  const isApiSearched = node.items.kind === 'cursor'

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

  // This component only ever exists while `browsingHref` points at this
  // exact node (StructureTree.tsx's `showItemSetBox`) — it fully unmounts
  // the moment browsing moves elsewhere and remounts fresh if you come
  // back, regardless of whether the Collection(s) in between had any
  // direct items of their own. That makes "on mount" the right place to
  // reset the "show on Time/Space Lens" toggle back to off, rather than
  // trying to detect the change in the store itself — browsing through a
  // Collection with no items never calls `setVisible` at all, which left a
  // stale `showOnLenses: true` surviving a round trip back to the same
  // Collection (confirmed directly before this fix).
  useEffect(() => {
    setShowOnLenses(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.href])

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
      {/* The "show on Time/Space Lens" toggle used to live here as a
       * button, then moved into the Collection Inspector's "Provided by
       * this app" section — which was then removed entirely once it
       * turned out redundant with the always-on Temporal/Spatial widgets
       * it fed (docs/DESIGN.md §41): "按钮和Browse this Collection's
       * items其实也都可以不要了,我会放在其他的部分" (the button can go too —
       * I'll put it somewhere else). There is currently no UI anywhere
       * that sets `showOnLenses` to `true`. This component still owns its
       * reset-on-remount (below) regardless, since that's tied to *this*
       * component's own lifecycle, not wherever the toggle eventually
       * lands. */}
      {/* The interactive bbox/datetime-range query tool (draw on Space
       * Lens / drag on Time Lens, "Search"/"Clear") that used to live here
       * has been pulled out entirely, not just moved: "我现在连select Area、
       * Select Range的功能都应该不要...API查询这部分功能整个先搁置" (I don't
       * even want the Select Area/Select Range functionality anymore — the
       * whole API-querying-by-drawing feature is shelved for now) — folded
       * into the same still-open question as the "API sources may need an
       * entirely different UI/navigation paradigm" thread (docs/DESIGN.md),
       * rather than kept half-working here. For an API-searched node, only
       * whatever the API's own default (unfiltered) first page returns is
       * browsable below, via scroll/load-more/load-all — same id/title text
       * filter as always, now the *only* way to narrow what's shown. */}
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
          <LoadingState>Loading items…</LoadingState>
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
              <div
                style={{
                  padding: 8,
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  color: 'var(--color-text-muted)',
                }}
              >
                <Spinner size={12} />
                Loading more…
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
                display: 'flex',
                alignItems: 'center',
                gap: 5,
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
              {state.loadingMore && <Spinner size={10} />}
              {state.loadingMore ? 'Loading…' : 'Load all remaining'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
