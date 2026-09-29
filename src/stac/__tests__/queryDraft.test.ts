import { describe, expect, it } from 'vitest'
import { describeDraft, draftToFilter, isEmptyQuery, queryToDraft } from '../queryDraft'

describe('queryDraft', () => {
  it('round-trips a query through the draft', () => {
    const q = {
      datetimeStart: '2024-01-01T00:00:00Z',
      datetimeEnd: '2024-06-30T23:59:59Z',
      sortDirection: 'desc' as const,
      bbox: [1, 2, 3, 4] as [number, number, number, number],
    }
    expect(draftToFilter(queryToDraft(q))).toEqual(q)
    expect(isEmptyQuery(draftToFilter({ dateStart: '', dateEnd: '' }))).toBe(true)
    expect(isEmptyQuery(q)).toBe(false)
  })

  it('describes a draft in one line', () => {
    expect(describeDraft({ dateStart: '', dateEnd: '' }, true)).toMatch(/No conditions/)
    expect(
      describeDraft({ dateStart: '2024-01-01', dateEnd: '', bbox: [0, 0, 1, 1], sortDirection: 'desc' }, true),
    ).toBe('2024-01-01 – … · area drawn · newest first')
    expect(describeDraft({ dateStart: '', dateEnd: '', sortDirection: 'asc' }, false)).toMatch(/No conditions/)
  })
})
