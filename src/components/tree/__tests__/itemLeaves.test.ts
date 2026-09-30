import { describe, expect, it } from 'vitest'
import type { TreeDatum } from '../../../hooks/useStructureTree'
import type { StacNode } from '../../../stac/types'
import { TREE_ITEM_LEAVES, withItemLeaves } from '../itemLeaves'

function node(href: string, type: StacNode['type'], itemHrefs: string[] = []): StacNode {
  return {
    href,
    id: href,
    type,
    childHrefs: [],
    items: { kind: 'links', hrefs: itemHrefs },
    sourceKind: { kind: 'static-links' },
    raw: {},
    assets: [],
    declaredExtensions: [],
    propertyNamespaces: [],
  }
}
const item = (id: string) => node(id, 'Item')
const items = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => item(`${prefix}${i}`))

const root: TreeDatum = {
  href: 'root',
  node: node('root', 'Catalog'),
  children: [
    { href: 'a', node: node('a', 'Collection', ['x']) },
    { href: 'b', node: node('b', 'Collection', ['y']) },
    { href: 'c', node: node('c', 'Collection', ['z']) },
  ],
}

describe('withItemLeaves', () => {
  it('adds the window page under the browsed Collection, capped, with a "more" leaf', () => {
    const out = withItemLeaves(root, {
      browsingHref: 'a',
      windowPage: { forHref: 'a', items: items(40, 'a-'), pageIndex: 1 },
      rememberedPage: () => undefined,
    })
    const a = out.children![0]
    expect(a.children).toHaveLength(TREE_ITEM_LEAVES + 1)
    expect(a.children![0].itemLeaf).toEqual({ current: true, hostHref: 'a' })
    expect(a.children![TREE_ITEM_LEAVES].moreItems).toEqual({
      current: true,
      hostHref: 'a',
      remaining: 30,
      pageIndex: 1,
      pageTotal: 40,
    })
    expect(out.children![1].children).toBeUndefined()
  })

  it('adds a remembered page, dimmed, under another browsed Collection and nothing under the rest', () => {
    const out = withItemLeaves(root, {
      browsingHref: 'a',
      windowPage: { forHref: 'a', items: items(3, 'a-'), pageIndex: 0 },
      rememberedPage: (n) => (n.href === 'b' ? { items: items(2, 'b-'), pageIndex: 3 } : undefined),
    })
    expect(out.children![0].children).toHaveLength(3)
    expect(out.children![1].children!.map((c) => c.itemLeaf?.current)).toEqual([false, false])
    expect(out.children![2].children).toBeUndefined()
  })

  it('leaves the browsed Collection alone while the window has not published its page', () => {
    const out = withItemLeaves(root, {
      browsingHref: 'a',
      windowPage: { forHref: null, items: [], pageIndex: 0 },
      rememberedPage: () => undefined,
    })
    expect(out.children![0].children).toBeUndefined()
  })
})
