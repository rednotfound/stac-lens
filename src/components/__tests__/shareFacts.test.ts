import { describe, expect, it } from 'vitest'
import type { StacNode } from '../../stac/types'
import { describeShare } from '../shareFacts'

function node(id: string, type: StacNode['type'], cursor = false): StacNode {
  return {
    href: `https://x.test/${id}`,
    id,
    title: `${id} title`,
    type,
    childHrefs: [],
    items: cursor ? { kind: 'cursor', endpoint: 'https://x.test/items' } : { kind: 'links', hrefs: [] },
    sourceKind: { kind: 'static-links' },
    raw: {},
    assets: [],
    declaredExtensions: [],
    propertyNamespaces: [],
    localPathLinks: [],
  }
}
const base = {
  rootTitle: 'Root',
  selected: null,
  view: 'tree' as const,
  browsed: null,
  query: undefined,
  page: undefined,
  narrow: false,
}

describe('describeShare — what a shared link opens, in words', () => {
  it('only the catalog for a link with nothing beyond the defaults', () => {
    expect(describeShare(base)).toEqual([{ label: 'Catalog', value: 'Root' }])
  })

  it('names the selection, and the view unless it is the tree or the phone', () => {
    const facts = describeShare({ ...base, selected: node('s2', 'Collection'), view: 'icicle' })
    expect(facts).toContainEqual({ label: 'Selected', value: 's2 title · Collection' })
    expect(facts).toContainEqual({ label: 'View', value: 'Icicle' })
    expect(describeShare({ ...base, view: 'icicle', narrow: true }).some((f) => f.label === 'View')).toBe(false)
  })

  it('a search only when it has conditions, said in words, with the Collection', () => {
    const browsed = node('landsat', 'Collection', true)
    expect(describeShare({ ...base, browsed, query: {} }).some((f) => f.label === 'Search')).toBe(false)
    const s = describeShare({
      ...base,
      browsed,
      query: { datetimeStart: '2024-01-01T00:00:00Z', sortDirection: 'desc' },
    })
    expect(s.find((f) => f.label === 'Search')).toMatchObject({
      value: '2024-01-01 – … · newest first',
      note: 'in landsat title',
    })
  })

  it('the Items page, with the drift caveat only for an API search', () => {
    const api = describeShare({
      ...base,
      browsed: node('landsat', 'Collection', true),
      page: { page: 3, pageSize: 40 },
    })
    expect(api.find((f) => f.label === 'Items')).toMatchObject({ value: 'page 3, 40 per page — landsat title' })
    expect(api.find((f) => f.label === 'Items')?.note).toMatch(/runs again/)
    const stat = describeShare({ ...base, browsed: node('static', 'Collection'), page: { page: 2, pageSize: 20 } })
    expect(stat.find((f) => f.label === 'Items')?.note).toBeUndefined()
  })
})
