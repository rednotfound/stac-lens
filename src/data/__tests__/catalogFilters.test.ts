import { describe, expect, it } from 'vitest'
import {
  EMPTY_SELECTION,
  facetCounts,
  filterCatalogs,
  isSelectionEmpty,
  matchesText,
  toggleFacetValue,
} from '../catalogFilters'
import type { KnownCatalog } from '../knownCatalogs'

const cats: KnownCatalog[] = [
  {
    title: 'Alpha SAR',
    description: 'radar imagery',
    href: 'https://a.example/catalog.json',
    kind: 'static',
    topics: ['eo-imagery'],
    regions: ['global'],
    publisher: 'commercial',
    addedOn: '2026-09-01',
  },
  {
    title: 'Beta DEM',
    description: 'elevation',
    href: 'https://b.example/catalog.json',
    kind: 'static',
    topics: ['elevation'],
    regions: ['europe'],
    publisher: 'government',
    addedOn: '2026-09-01',
  },
  {
    title: 'Gamma API',
    description: 'imagery and elevation',
    href: 'https://c.example/v1',
    kind: 'api',
    topics: ['eo-imagery', 'elevation'],
    regions: ['europe', 'global'],
    publisher: 'government',
    addedOn: '2026-09-01',
  },
]

describe('catalog filters', () => {
  it('text matches title, description or href, case-insensitively', () => {
    expect(matchesText(cats[0], 'alpha')).toBe(true)
    expect(matchesText(cats[0], 'RADAR')).toBe(true)
    expect(matchesText(cats[0], 'a.example')).toBe(true)
    expect(matchesText(cats[0], 'beta')).toBe(false)
    expect(matchesText(cats[0], '   ')).toBe(true)
  })

  it("text also matches the labels of a catalog's tags", () => {
    expect(matchesText(cats[1], 'elevation & terrain')).toBe(true)
    expect(matchesText(cats[1], 'europe')).toBe(true)
    expect(matchesText(cats[1], 'government')).toBe(true)
    expect(matchesText(cats[1], 'static catalog')).toBe(true)
    expect(matchesText(cats[1], 'commercial')).toBe(false)
  })

  it('unions within a facet, intersects across facets', () => {
    let sel = toggleFacetValue(EMPTY_SELECTION, 'topics', 'eo-imagery')
    expect(filterCatalogs(cats, '', sel).map((c) => c.title)).toEqual(['Alpha SAR', 'Gamma API'])
    sel = toggleFacetValue(sel, 'topics', 'elevation')
    expect(filterCatalogs(cats, '', sel)).toHaveLength(3)
    sel = toggleFacetValue(sel, 'publisher', 'government')
    expect(filterCatalogs(cats, '', sel).map((c) => c.title)).toEqual(['Beta DEM', 'Gamma API'])
    sel = toggleFacetValue(sel, 'kind', 'api')
    expect(filterCatalogs(cats, '', sel).map((c) => c.title)).toEqual(['Gamma API'])
  })

  it('toggling a selected value removes it', () => {
    const on = toggleFacetValue(EMPTY_SELECTION, 'regions', 'europe')
    expect(isSelectionEmpty(on)).toBe(false)
    expect(isSelectionEmpty(toggleFacetValue(on, 'regions', 'europe'))).toBe(true)
  })

  it("facet counts ignore the facet's own selection but respect the others", () => {
    const sel = toggleFacetValue(toggleFacetValue(EMPTY_SELECTION, 'topics', 'elevation'), 'kind', 'static')
    // topics counts: only kind=static applies → Alpha (eo) and Beta (elevation)
    expect(Object.fromEntries(facetCounts(cats, '', sel, 'topics'))).toEqual({ 'eo-imagery': 1, elevation: 1 })
    // kind counts: only topics=elevation applies → Beta (static), Gamma (api)
    expect(Object.fromEntries(facetCounts(cats, '', sel, 'kind'))).toEqual({ static: 1, api: 1 })
  })

  it('text query narrows counts too', () => {
    expect(Object.fromEntries(facetCounts(cats, 'elevation', EMPTY_SELECTION, 'publisher'))).toEqual({
      government: 2,
    })
  })
})
