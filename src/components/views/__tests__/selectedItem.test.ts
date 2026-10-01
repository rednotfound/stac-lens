import { describe, expect, it } from 'vitest'
import { loader } from '../../../stac/loaderInstance'
import type { StacNode } from '../../../stac/types'
import { selectedItemOffPage, selectedItemUnder } from '../selectedItem'

function node(href: string, type: StacNode['type'], parentHref?: string): StacNode {
  return {
    href,
    id: href,
    type,
    parentHref,
    childHrefs: [],
    items: { kind: 'links', hrefs: [] },
    sourceKind: { kind: 'static-links' },
    raw: {},
    assets: [],
    declaredExtensions: [],
    propertyNamespaces: [],
  }
}

loader.cachePreFetched(node('test://a/item-1', 'Item', 'test://a'))
loader.cachePreFetched(node('test://b/item-2', 'Item', 'test://b'))
loader.cachePreFetched(node('test://a/no-parent', 'Item'))
loader.cachePreFetched(node('test://a', 'Collection'))

describe('selectedItemUnder', () => {
  it('is the selected Item under the Collection being browsed', () => {
    expect(selectedItemUnder('test://a/item-1', 'test://a', 'test://a')?.href).toBe('test://a/item-1')
  })

  it('is nothing under a Collection that is not being browsed', () => {
    expect(selectedItemUnder('test://a/item-1', 'test://a', 'test://b')).toBeUndefined()
  })

  it("is nothing under a browsed Collection that is not the Item's own parent", () => {
    // Browsing can lag behind a selection made elsewhere.
    expect(selectedItemUnder('test://b/item-2', 'test://a', 'test://a')).toBeUndefined()
  })

  it('trusts browsing when the Item names no parent', () => {
    expect(selectedItemUnder('test://a/no-parent', 'test://a', 'test://a')?.href).toBe('test://a/no-parent')
  })

  it('is nothing for a selected Collection, an unknown href, or no selection', () => {
    expect(selectedItemUnder('test://a', 'test://a', 'test://a')).toBeUndefined()
    expect(selectedItemUnder('test://a/not-loaded', 'test://a', 'test://a')).toBeUndefined()
    expect(selectedItemUnder(null, 'test://a', 'test://a')).toBeUndefined()
  })
})

describe('selectedItemOffPage', () => {
  it('is the selected Item only when the drawn Items do not include it', () => {
    expect(selectedItemOffPage('test://a/item-1', 'test://a', 'test://a', [])?.href).toBe('test://a/item-1')
    expect(
      selectedItemOffPage('test://a/item-1', 'test://a', 'test://a', [{ href: 'test://a/item-1' }]),
    ).toBeUndefined()
  })
})
