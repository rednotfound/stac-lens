import { describe, expect, it } from 'vitest'
import {
  collectionFacetCounts,
  EMPTY_COLLECTION_FILTER,
  filterCollections,
  isFilterActive,
  matchesCollectionText,
  toggleFacetSelection,
  type CollectionFilter,
} from '../collectionFacets'
import type { StacNode } from '../types'

function coll(id: string, extra: Partial<StacNode> = {}): StacNode {
  return {
    href: `https://x.test/collections/${id}`,
    id,
    type: 'Collection',
    childHrefs: [],
    items: { kind: 'links', hrefs: [] },
    sourceKind: { kind: 'static-links' },
    raw: {},
    assets: [],
    declaredExtensions: [],
    propertyNamespaces: [],
    localPathLinks: [],
    ...extra,
  }
}

// Shaped on Copernicus Data Space and Planetary Computer.
const s2 = coll('sentinel-2-l2a', {
  title: 'Sentinel-2 Level-2A',
  description: 'Bottom-of-atmosphere reflectance',
  keywords: ['Sentinel', 'ESA', 'Copernicus', 'satellite'],
  providers: [{ name: 'ESA' }, { name: 'Microsoft' }],
  license: 'proprietary',
  schemaHints: { summaries: { platform: ['sentinel-2a', 'sentinel-2b'], constellation: ['sentinel-2'] } },
})
const s1 = coll('sentinel-1-grd', {
  title: 'Sentinel-1 GRD',
  keywords: ['sentinel', 'ESA', 'SAR'],
  providers: [{ name: 'ESA' }],
  license: 'proprietary',
  schemaHints: { summaries: { platform: 'sentinel-1a' } },
})
const lc = coll('clms-landcover', {
  title: 'Land cover 100 m',
  keywords: ['Copernicus', 'land cover', 'global'],
  providers: [{ name: 'EC' }],
  license: 'CC-BY-4.0',
})
const all = [s2, s1, lc]
const f = (patch: Partial<CollectionFilter>): CollectionFilter => ({ ...EMPTY_COLLECTION_FILTER, ...patch })

describe('collection text filter', () => {
  it('matches title, id, description and keywords; every word must appear', () => {
    expect(matchesCollectionText(s2, 'reflectance')).toBe(true)
    expect(matchesCollectionText(s1, 'sar')).toBe(true)
    expect(matchesCollectionText(s2, 'sentinel 2a')).toBe(true)
    expect(matchesCollectionText(s2, 'sentinel sar')).toBe(false)
    expect(matchesCollectionText(lc, '')).toBe(true)
  })
})

describe('collection facets', () => {
  it('counts each declared value once per Collection, case-insensitively, most common first', () => {
    const kw = collectionFacetCounts(all, EMPTY_COLLECTION_FILTER, 'keywords')
    expect(kw.slice(0, 3)).toEqual([
      { key: 'copernicus', label: 'Copernicus', count: 2 },
      { key: 'esa', label: 'ESA', count: 2 },
      { key: 'sentinel', label: expect.stringMatching(/^[Ss]entinel$/), count: 2 },
    ])
  })

  it('reads platform and constellation from summaries, string or array', () => {
    const p = collectionFacetCounts(all, EMPTY_COLLECTION_FILTER, 'platforms').map((x) => x.key)
    expect(p.sort()).toEqual(['sentinel-1a', 'sentinel-2', 'sentinel-2a', 'sentinel-2b'])
  })

  it('keywords combine as "all of"; other facets as "any of"', () => {
    const both = toggleFacetSelection(
      toggleFacetSelection(EMPTY_COLLECTION_FILTER, 'keywords', 'esa'),
      'keywords',
      'sar',
    )
    expect(filterCollections(all, both).map((n) => n.id)).toEqual(['sentinel-1-grd'])
    const licenses = f({ selected: { ...EMPTY_COLLECTION_FILTER.selected, licenses: ['cc-by-4.0', 'proprietary'] } })
    expect(filterCollections(all, licenses)).toHaveLength(3)
  })

  it('an "any of" facet keeps offering its other values; text and other facets narrow it', () => {
    const one = f({ text: 'sentinel', selected: { ...EMPTY_COLLECTION_FILTER.selected, providers: ['esa'] } })
    const providers = collectionFacetCounts(all, one, 'providers')
    expect(providers.find((p) => p.key === 'microsoft')?.count).toBe(1)
    expect(providers.find((p) => p.key === 'ec')).toBeUndefined() // the text leaves no EC Collection
  })

  it('is active only with text or a selection', () => {
    expect(isFilterActive(EMPTY_COLLECTION_FILTER)).toBe(false)
    expect(isFilterActive(f({ text: '  ' }))).toBe(false)
    expect(isFilterActive(toggleFacetSelection(EMPTY_COLLECTION_FILTER, 'licenses', 'cc-by-4.0'))).toBe(true)
  })
})
