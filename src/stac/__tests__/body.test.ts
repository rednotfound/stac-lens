import { describe, expect, it } from 'vitest'
import { bodyKey, describeBody, isEarth, resolveBody } from '../body'
import type { StacNode } from '../types'

function node(href: string, extra: Partial<StacNode> = {}): StacNode {
  return {
    href,
    id: href,
    type: 'Collection',
    childHrefs: [],
    items: { kind: 'links', hrefs: [] },
    assets: [],
    links: [],
    declaredExtensions: [],
    propertyNamespaces: [],
    raw: {},
    ...extra,
  } as unknown as StacNode
}

describe('resolveBody', () => {
  const lookup = (nodes: StacNode[]) => ({ get: (h: string) => nodes.find((n) => n.href === h) })

  it('is undefined for ordinary Earth data (no ssys fields)', () => {
    expect(resolveBody(node('a'), lookup([]))).toBeUndefined()
  })

  it('reads a declaration on the node itself (Rosetta: Collection and Items both declare 67P)', () => {
    const n = node('rosetta', { ssysTargets: ['67P/Churyumov-Gerasimenko'], ssysTargetClass: 'comet' })
    const body = resolveBody(n, lookup([]))
    expect(body?.targets).toEqual(['67P/Churyumov-Gerasimenko'])
    expect(body?.declaredOn.href).toBe('rosetta')
    expect(describeBody(body!)).toBe('67P/Churyumov-Gerasimenko (comet)')
  })

  it('inherits from an ancestor (Cassini VIMS: the root Catalog declares Titan)', () => {
    const root = node('root', { type: 'Catalog', ssysTargets: ['Titan'] } as Partial<StacNode>)
    const coll = node('titan', { parentHref: 'root' })
    const item = node('item', { type: 'Item', parentHref: 'titan' } as Partial<StacNode>)
    const body = resolveBody(item, lookup([root, coll, item]))
    expect(body?.targets).toEqual(['Titan'])
    expect(body?.declaredOn.href).toBe('root')
    expect(describeBody(body!)).toBe('Titan')
  })

  it('nearest declaration wins, and an explicit Earth is the default world', () => {
    const root = node('root', { ssysTargets: ['Mars'] })
    const coll = node('c', { parentHref: 'root', ssysTargets: ['Earth'] })
    expect(resolveBody(coll, lookup([root, coll]))).toBeUndefined()
    expect(isEarth(['earth'])).toBe(true)
    expect(isEarth(['Earth', 'Moon'])).toBe(false)
  })

  it('survives a parent cycle and an ancestor missing from the cache', () => {
    const a = node('a', { parentHref: 'b' })
    const b = node('b', { parentHref: 'a' })
    expect(resolveBody(a, lookup([a, b]))).toBeUndefined()
    expect(resolveBody(node('x', { parentHref: 'gone' }), lookup([]))).toBeUndefined()
  })

  it('bodyKey is stable per body and distinct from Earth', () => {
    expect(bodyKey(undefined)).toBe('earth')
    expect(bodyKey({ targets: ['Titan'], declaredOn: node('r') })).toBe('body:Titan')
  })
})
