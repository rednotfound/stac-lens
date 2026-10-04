import { describe, expect, it } from 'vitest'
import type { TreeDatum } from '../../../hooks/useStructureTree'
import type { StacNode } from '../../../stac/types'
import { useCollectionListStore, filterFor } from '../../../store/collectionList'
import { EMPTY_COLLECTION_FILTER } from '../../../stac/collectionFacets'
import { containerChildren } from '../containerChildren'
import { decidePane } from '../usePaneMode'

function node(href: string, type: StacNode['type'], extra: Partial<StacNode> = {}): StacNode {
  return {
    href,
    id: href,
    type,
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
const yes = () => true
const no = () => false

describe("containerChildren — the structure's loaded children, and whether that is all", () => {
  const root = (rootNode: StacNode, children: TreeDatum[]): TreeDatum => ({
    href: rootNode.href,
    node: rootNode,
    children,
  })

  it('says not-open / loading before the node is opened', () => {
    const r = root(node('r', 'Catalog', { childHrefs: ['a'] }), [])
    expect(containerChildren(r, 'r', no, no, 2000).status).toBe('not-open')
    expect(containerChildren(r, 'r', no, yes, 2000).status).toBe('loading')
    expect(containerChildren(r, 'r', yes, yes, 2000).status).toBe('loading')
  })

  it('a static first page ("+N more") is incomplete, with the declared total', () => {
    const r = root(node('r', 'Catalog', { childHrefs: ['a', 'b', 'c'] }), [
      { href: 'a', node: node('a', 'Collection') },
      { href: 'r#more', node: node('r', 'Catalog'), moreCount: 2 },
    ])
    expect(containerChildren(r, 'r', yes, no, 2000)).toMatchObject({
      status: 'ready',
      complete: false,
      declaredTotal: 3,
    })
    expect(containerChildren(r, 'r', yes, no, 2000).children.map((n) => n.href)).toEqual(['a'])
  })

  it('static child links continuing on a rel:next page are incomplete, with no total (NASA CMR ALL)', () => {
    const r = root(node('r', 'Catalog', { childHrefs: ['a'], childPagesNext: 'r?cursor=1' }), [
      { href: 'a', node: node('a', 'Collection') },
    ])
    const kids = containerChildren(r, 'r', yes, no, 2000)
    expect(kids.complete).toBe(false)
    expect(kids.declaredTotal).toBeUndefined()
  })

  it('a list endpoint is complete below the cap and incomplete at it', () => {
    const api = node('r', 'Catalog', { collectionsEndpoint: 'r/collections' })
    const kids = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ href: `c${i}`, node: node(`c${i}`, 'Collection') }))
    expect(containerChildren(root(api, kids(3)), 'r', yes, no, 5).complete).toBe(true)
    expect(containerChildren(root(api, kids(5)), 'r', yes, no, 5).complete).toBe(false)
  })

  it('never lists Items as children', () => {
    const r = root(node('r', 'Catalog', { childHrefs: ['a', 'i'] }), [
      { href: 'a', node: node('a', 'Collection') },
      { href: 'i', node: node('i', 'Item') },
    ])
    expect(containerChildren(r, 'r', yes, no, 2000).children.map((n) => n.href)).toEqual(['a'])
  })
})

describe('decidePane — what the docked column shows for the browsed node', () => {
  const catalog = node('cat', 'Catalog', { childHrefs: ['a'] })
  const collection = node('col', 'Collection', { items: { kind: 'links', hrefs: ['i1'] } })
  const both = node('both', 'Catalog', { childHrefs: ['a'], items: { kind: 'links', hrefs: ['i1'] } })
  const base = { childInfo: undefined, tab: undefined, linkedSearchFor: undefined }

  it('children only → the Children list; opens by itself only with ten or more', () => {
    expect(decidePane({ ...base, browsingNode: catalog })).toMatchObject({ mode: 'collections', toShow: false })
    expect(decidePane({ ...base, browsingNode: catalog, childInfo: { count: 10 } })).toMatchObject({
      mode: 'collections',
      toShow: true,
    })
  })

  it('Items only → Items, always shown', () => {
    expect(decidePane({ ...base, browsingNode: collection })).toMatchObject({ mode: 'items', toShow: true })
  })

  it('both → Items by default, the list with many children, the tab when chosen, Items when a link names them', () => {
    expect(decidePane({ ...base, browsingNode: both }).mode).toBe('items')
    expect(decidePane({ ...base, browsingNode: both, childInfo: { count: 12 } }).mode).toBe('collections')
    expect(decidePane({ ...base, browsingNode: both, childInfo: { count: 12 }, tab: 'items' }).mode).toBe('items')
    expect(decidePane({ ...base, browsingNode: both, childInfo: { count: 12 }, linkedSearchFor: 'both' }).mode).toBe(
      'items',
    )
  })

  it('nothing to list → no pane', () => {
    expect(decidePane({ ...base, browsingNode: node('empty', 'Catalog') }).node).toBeUndefined()
    expect(decidePane({ ...base, browsingNode: undefined }).node).toBeUndefined()
  })
})

describe('collectionList store', () => {
  it('clear() forgets every per-catalog choice (not the child count); filterFor falls back to the empty filter', () => {
    const s = useCollectionListStore.getState()
    s.setFilter('x', { ...EMPTY_COLLECTION_FILTER, text: 'sar' })
    s.setOrigin('x')
    s.setTab('x', 'items')
    s.setServerResults('x', { q: 'sar', hrefs: ['a'], more: false })
    s.setBrowsedChildren({ href: 'x', count: 3 })
    s.clear()
    const after = useCollectionListStore.getState()
    expect(after.filters).toEqual({})
    expect(after.origin).toBeNull()
    expect(after.tab).toEqual({})
    expect(after.serverResults).toEqual({})
    // The browsed node's child count names its node and survives: clearing
    // it raced the bridge that publishes it (DESIGN §128, review H3).
    expect(after.browsedChildren).toEqual({ href: 'x', count: 3 })
    expect(filterFor(after.filters, 'x')).toBe(EMPTY_COLLECTION_FILTER)
    expect(filterFor(after.filters, null)).toBe(EMPTY_COLLECTION_FILTER)
  })
})
