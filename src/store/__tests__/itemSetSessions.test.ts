import { beforeEach, describe, expect, it } from 'vitest'
import { itemSetSessions, MAX_SESSIONS, sessionPage } from '../itemSetSessions'
import type { StacNode } from '../../stac/types'

describe('itemSetSessions', () => {
  beforeEach(() => itemSetSessions.clear())

  it('fills defaults, merges patches and remembers the page size as a preference', () => {
    itemSetSessions.setCursor('a', { hasSearched: true, pageIndex: 2 })
    expect(itemSetSessions.getCursor('a')).toMatchObject({
      hasSearched: true,
      pageIndex: 2,
      pageSize: 40,
      view: 'list',
    })
    itemSetSessions.setCursor('a', { pageSize: 100 })
    expect(itemSetSessions.getCursor('a')?.pageIndex).toBe(2)
    itemSetSessions.setCursor('b', {})
    expect(itemSetSessions.getCursor('b')?.pageSize).toBe(100)
  })

  it('evicts the least recently touched session past the cap', () => {
    for (let i = 0; i < MAX_SESSIONS; i++) itemSetSessions.setLinks(`c${i}`, { pageIndex: i })
    itemSetSessions.getLinks('c0') // touched: now the most recent
    itemSetSessions.setLinks('new', {})
    expect(itemSetSessions.getLinks('c0')).toBeDefined()
    expect(itemSetSessions.getLinks('c1')).toBeUndefined()
    expect(itemSetSessions.size).toBe(MAX_SESSIONS)
  })

  it('clear forgets everything', () => {
    itemSetSessions.setCursor('a', {})
    itemSetSessions.clear()
    expect(itemSetSessions.getCursor('a')).toBeUndefined()
  })

  it('clear also forgets the page sizes carried between Collections: a new catalog starts at the defaults', () => {
    itemSetSessions.setCursor('a', { pageSize: 100 })
    itemSetSessions.setLinks('b', { pageSize: 200 })
    itemSetSessions.clear()
    itemSetSessions.setCursor('c', {})
    expect(itemSetSessions.getCursor('c')?.pageSize).toBe(40)
    expect(itemSetSessions.preferredLinksPageSize).toBeUndefined()
  })

  it('reports the page a Collection last showed, or nothing before it was browsed', () => {
    const item = (id: string) => ({ href: id, id }) as unknown as StacNode
    const cursorNode = { href: 'c', items: { kind: 'cursor', endpoint: 'x' } } as unknown as StacNode
    expect(sessionPage(cursorNode)).toBeUndefined()
    itemSetSessions.setCursor('c', {
      items: [item('1'), item('2'), item('3')],
      pageIndex: 1,
      pageSize: 2,
      hasSearched: true,
    })
    expect(sessionPage(cursorNode)).toEqual({ items: [item('3')], pageIndex: 1 })
    const linksNode = { href: 'l', items: { kind: 'links', hrefs: ['a', 'b'] } } as unknown as StacNode
    expect(sessionPage(linksNode)).toBeUndefined()
    itemSetSessions.setLinks('l', { pageCache: { 0: [item('a')] }, renderedIndex: 0 })
    expect(sessionPage(linksNode)).toEqual({ items: [item('a')], pageIndex: 0 })
  })
})
