import { describe, expect, it } from 'vitest'
import { resolveApiConformance, resolveSearchTarget, supportsSort } from '../conformance'
import { buildNode } from '../graph'
import { loader } from '../loaderInstance'
import type { StacNode } from '../types'

// The shared loader singleton is real here — nodes are inserted through
// `cachePreFetched`, exactly as a /collections listing would, under hrefs
// unique to this file.
const ROOT = 'https://conformance.test/v1/'

function apiRoot(conformsTo: string[]): StacNode {
  return buildNode(ROOT, {
    type: 'Catalog',
    conformsTo,
    links: [
      { rel: 'search', href: './search', method: 'GET' },
      { rel: 'search', href: './search', method: 'POST' },
      { rel: 'data', href: './collections' },
    ],
  })
}

function collectionUnder(rootHref: string | undefined, id: string) {
  return buildNode(`${ROOT}collections/${id}`, {
    type: 'Collection',
    id,
    extent: {},
    links: [{ rel: 'items', href: `./${id}/items` }, ...(rootHref ? [{ rel: 'root', href: rootHref }] : [])],
  }) as StacNode & { items: { kind: 'cursor' } }
}

describe('supportsSort', () => {
  it('accepts either spec version and either surface', () => {
    expect(supportsSort(['https://api.stacspec.org/v1.0.0/item-search#sort'])).toBe(true)
    expect(supportsSort(['https://api.stacspec.org/v1.1.0/ogcapi-features#sort'])).toBe(true)
    expect(supportsSort(['https://api.stacspec.org/v1.0.0/item-search'])).toBe(false)
    expect(supportsSort(undefined)).toBe(false)
  })
})

describe('resolveApiConformance', () => {
  it("reads a nested Collection's capabilities off its root, where conformsTo actually lives", async () => {
    loader.cachePreFetched(apiRoot(['https://api.stacspec.org/v1.0.0/item-search#sort']))
    const col = collectionUnder(ROOT, 'c-conf')
    expect(col.declaredConformsTo).toBeUndefined()
    expect(await resolveApiConformance(col)).toEqual(['https://api.stacspec.org/v1.0.0/item-search#sort'])
  })

  it('is undefined — not empty — when there is no root to ask', async () => {
    expect(await resolveApiConformance(collectionUnder(undefined, 'c-noroot'))).toBeUndefined()
  })
})

describe('resolveSearchTarget', () => {
  it("prefers the root's GET /search scoped by collections= over the Collection's own rel:items", async () => {
    loader.cachePreFetched(apiRoot(['https://api.stacspec.org/v1.0.0/item-search']))
    const target = await resolveSearchTarget(collectionUnder(ROOT, 'c-search'))
    expect(target).toEqual({ endpoint: `${ROOT}search`, collections: ['c-search'] })
  })

  it('falls back to rel:items when the Collection has no known root', async () => {
    const col = collectionUnder(undefined, 'c-items')
    expect(await resolveSearchTarget(col)).toEqual({ endpoint: `${ROOT}collections/c-items/items` })
  })

  it('searches an API root through its own endpoint, unscoped', async () => {
    const root = apiRoot(['https://api.stacspec.org/v1.0.0/item-search']) as StacNode & { items: { kind: 'cursor' } }
    expect(root.items.kind).toBe('cursor')
    expect(await resolveSearchTarget(root)).toEqual({ endpoint: `${ROOT}search` })
  })
})
