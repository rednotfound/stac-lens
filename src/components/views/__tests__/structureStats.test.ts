import { describe, expect, it } from 'vitest'
import type { TreeDatum } from '../../../hooks/useStructureTree'
import type { StacNode } from '../../../stac/types'
import { structureStats } from '../structureStats'

function node(href: string, type: StacNode['type'], childHrefs: string[] = []): StacNode {
  return {
    href,
    id: href,
    type,
    childHrefs,
    items: { kind: 'links', hrefs: [] },
    sourceKind: { kind: 'static-links' },
    raw: {},
    assets: [],
    declaredExtensions: [],
    propertyNamespaces: [],
  }
}

const tree: TreeDatum = {
  href: 'root',
  node: node('root', 'Catalog', ['a', 'b', 'c']),
  children: [
    {
      href: 'a',
      node: node('a', 'Catalog', ['a1', 'a2']),
      children: [
        { href: 'a1', node: node('a1', 'Collection') },
        { href: 'a2', node: node('a2', 'Collection') },
      ],
    },
    // Expandable but closed.
    { href: 'b', node: node('b', 'Catalog', ['b1']) },
    // A Catalog with nothing behind it: not "unopened", just empty.
    { href: 'c', node: node('c', 'Catalog') },
    { href: 'root#more-children', node: node('root', 'Catalog'), moreCount: 40 },
  ],
}

describe('structureStats', () => {
  it('counts only what is loaded and what could still be opened', () => {
    const expanded = new Set(['root', 'a'])
    expect(structureStats(tree, (h) => expanded.has(h))).toEqual({
      catalogs: 4,
      collections: 2,
      unopenedCatalogs: 1,
      moreLeaves: 40,
      maxDepth: 2,
    })
  })

  it('treats a node whose expansion is in flight as opened', () => {
    const expanded = new Set(['root', 'a', 'b'])
    expect(structureStats(tree, (h) => expanded.has(h)).unopenedCatalogs).toBe(0)
  })
})
