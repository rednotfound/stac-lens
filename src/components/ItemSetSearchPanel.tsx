import { describeBboxArea, describeBboxCoords } from '../stac/describe'
import { formControlStyle, pagerButtonStyle } from './ItemSetBrowser'
import type { QueryDraft } from './CursorItemSetPanels'

const searchButtonStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '3px 12px',
  borderRadius: 999,
  border: '1px solid var(--color-selection)',
  background: 'var(--color-selection)',
  color: 'var(--color-bg)',
  cursor: 'pointer',
}

const rowLabelStyle: React.CSSProperties = {
  width: 40,
  flexShrink: 0,
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--color-text-muted)',
}

/** One condition's own row — a label, its current value/control, aligned
 *  the same way across every row so the whole panel reads as a real list
 *  of stacked conditions (the structure real multi-condition search UIs
 *  consistently use — Notion/Linear's own filter rows, and dedicated EO
 *  data search tools like Copernicus Browser/NASA Earthdata Search, which
 *  list Temporal/Spatial/etc. as their own separate, clearly-labeled
 *  sections rather than one undifferentiated control strip), replacing an
 *  earlier version that crammed every control into a single wrapping row
 *  with no visual grouping at all — reported directly as "太粗糙,我实在是
 *  有点受不了" (way too crude, I really can't stand it). */
function ConditionRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 24 }}>
      <span style={rowLabelStyle}>{label}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
        {children}
      </div>
    </div>
  )
}

export interface ItemSetSearchPanelProps {
  draft: QueryDraft
  setDraft: (updater: (d: QueryDraft) => QueryDraft) => void
  sortAvailable: boolean
  /** Opens `BboxPickerModal` — drawing itself no longer happens inline in
   *  this panel or in Results' own map (see `CursorItemSetPanels`). Also
   *  used to *re*-open it for an already-drawn area (the Area row's own
   *  "Edit" button), pre-filled from the current draft. */
  onDrawArea: () => void
  onClearBbox: () => void
  onSearch: () => void
  onClear: () => void
  searchDisabled: boolean
  clearDisabled: boolean
  /** True when the draft differs from whatever's actually applied right
   *  now — surfaced as a small inline hint next to Search, replacing an
   *  earlier flat "filtered: …" recap line that duplicated exactly what
   *  each condition row now already shows directly. */
  draftDirty: boolean
}

/** API mode's query controls — date range, sort, an area condition —
 *  rendered by `CursorItemSetPanels` into its own dedicated Search
 *  `foreignObject` (a genuinely separate box from Results, not a div
 *  sharing one — see `StructureTree.tsx`'s two-box render logic), alongside
 *  the `ApiBadge`. The interactive bbox/datetime-range tool that used to
 *  hang off Inspector's own Space/Time Lens (a global store) was pulled out
 *  entirely in a past pass — this is a deliberately different, later
 *  addition: a query module scoped locally to *this* panel's own state
 *  (docs/DESIGN.md §68), not a revival of that global tool. No id/title
 *  text search either — replaced entirely by this real query instead. */
export function ItemSetSearchPanel({
  draft,
  setDraft,
  sortAvailable,
  onDrawArea,
  onClearBbox,
  onSearch,
  onClear,
  searchDisabled,
  clearDisabled,
  draftDirty,
}: ItemSetSearchPanelProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <ConditionRow label="Date">
        <input
          type="date"
          value={draft.dateStart}
          onChange={(e) => setDraft((d) => ({ ...d, dateStart: e.target.value }))}
          style={formControlStyle}
        />
        <span style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>to</span>
        <input
          type="date"
          value={draft.dateEnd}
          onChange={(e) => setDraft((d) => ({ ...d, dateEnd: e.target.value }))}
          style={formControlStyle}
        />
      </ConditionRow>

      {/* Only rendered when the API's own conformance actually declares
       * the Sort extension — never sent as a param a server might reject
       * or silently ignore. */}
      {sortAvailable && (
        <ConditionRow label="Sort">
          <select
            value={draft.sortDirection ?? ''}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                sortDirection: (e.target.value || undefined) as 'asc' | 'desc' | undefined,
              }))
            }
            style={formControlStyle}
          >
            <option value="">Default order</option>
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
        </ConditionRow>
      )}

      <ConditionRow label="Area">
        {draft.bbox ? (
          // The area's own real value, not a bare "bbox set" label —
          // asked for directly: "那那个search范围就是在我们的UI里面仅仅是一个
          // filter的Bbox and set,对吧?你有没有可能给一些更多的信息呢" (that
          // search area is just a bare "bbox set" filter in our UI, right?
          // could you show more information?). Faceted-search UI practice
          // agrees: an active filter should show its own applied *value*
          // ("Price: $50–$200"), not just which filter is on. An approximate
          // ground area plus the four edge coordinates (each labeled with
          // its own hemisphere, not a bare signed number) answers "roughly
          // how big, and roughly where" without needing a live map preview
          // or an external geocoding lookup.
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--color-text)' }}>{describeBboxArea(draft.bbox)}</div>
            <div style={{ fontSize: 10.5, color: 'var(--color-text-faint)', fontFamily: 'var(--font-mono)' }}>
              {describeBboxCoords(draft.bbox)}
            </div>
          </div>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>Not set</span>
        )}
        <button onClick={onDrawArea} style={pagerButtonStyle(false)}>
          {draft.bbox ? 'Edit' : 'Draw on map'}
        </button>
        {draft.bbox && (
          <button onClick={onClearBbox} title="Clear the area filter" style={pagerButtonStyle(false)}>
            Clear
          </button>
        )}
      </ConditionRow>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 4,
          paddingTop: 6,
          borderTop: '1px solid var(--color-border)',
        }}
      >
        <button onClick={onSearch} disabled={searchDisabled} style={searchButtonStyle}>
          Search
        </button>
        <button onClick={onClear} disabled={clearDisabled} style={pagerButtonStyle(clearDisabled)}>
          Clear filters
        </button>
        {draftDirty && (
          <span style={{ fontSize: 10.5, color: 'var(--color-text-faint)', fontStyle: 'italic' }}>
            unapplied changes
          </span>
        )}
      </div>
    </div>
  )
}
