import type { SearchFilter } from './apiSearch'

/** The Search panel's editable form state — dates as `<input type="date">`
 *  strings, a sort direction, a drawn bbox — and the pure conversions to
 *  and from the `SearchFilter` actually sent to the API. Pure so the draft
 *  can live in a session cache and round-trip a query restored from a
 *  shareable URL. */
export interface QueryDraft {
  dateStart: string // yyyy-mm-dd
  dateEnd: string
  sortDirection?: 'asc' | 'desc'
  bbox?: [number, number, number, number]
}

export const EMPTY_DRAFT: QueryDraft = { dateStart: '', dateEnd: '' }

function toRfc3339Start(dateOnly: string): string {
  return `${dateOnly}T00:00:00Z`
}
function toRfc3339End(dateOnly: string): string {
  return `${dateOnly}T23:59:59Z`
}
function toDateInputValue(rfc3339: string | undefined): string {
  return rfc3339 ? rfc3339.slice(0, 10) : ''
}

export function draftToFilter(draft: QueryDraft): SearchFilter {
  return {
    datetimeStart: draft.dateStart ? toRfc3339Start(draft.dateStart) : undefined,
    datetimeEnd: draft.dateEnd ? toRfc3339End(draft.dateEnd) : undefined,
    sortDirection: draft.sortDirection,
    bbox: draft.bbox,
  }
}

/** Inverse of `draftToFilter` — pre-fills the controls from a query
 *  restored off a shareable URL, so the date inputs, sort select and bbox
 *  chip visibly match on load, not just the results list. */
export function queryToDraft(q: SearchFilter): QueryDraft {
  return {
    dateStart: toDateInputValue(q.datetimeStart),
    dateEnd: toDateInputValue(q.datetimeEnd),
    sortDirection: q.sortDirection,
    bbox: q.bbox,
  }
}

export function isEmptyQuery(q: SearchFilter): boolean {
  return !q.datetimeStart && !q.datetimeEnd && !q.sortDirection && !q.bbox
}

/** One line saying what a draft asks for — the collapsed Search section's
 *  summary. Says "everything" when there are no conditions rather than
 *  showing nothing. */
export function describeDraft(draft: QueryDraft, sortAvailable: boolean): string {
  const parts: string[] = []
  if (draft.dateStart || draft.dateEnd) parts.push(`${draft.dateStart || '…'} – ${draft.dateEnd || '…'}`)
  if (draft.bbox) parts.push('area drawn')
  if (sortAvailable && draft.sortDirection) parts.push(draft.sortDirection === 'desc' ? 'newest first' : 'oldest first')
  return parts.length ? parts.join(' · ') : 'No conditions — everything, in the server’s order'
}
