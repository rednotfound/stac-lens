import { describe, expect, it } from 'vitest'
import { decodeSearchQuery, encodeSearchQuery, joinHashFragment, splitHashFragment } from '../searchQueryUrl'

describe('encode / decode', () => {
  it('round-trips a full filter using the real request parameter names', () => {
    const filter = {
      bbox: [-75.5, 39.5, -73.5, 41.5] as [number, number, number, number],
      datetimeStart: '2020-01-01T00:00:00Z',
      datetimeEnd: '2020-01-31T23:59:59Z',
      sortDirection: 'desc' as const,
    }
    const encoded = encodeSearchQuery(filter)
    expect(encoded).toContain('bbox=')
    expect(encoded).toContain('datetime=')
    expect(encoded).toContain('sortby=-properties.datetime')
    expect(decodeSearchQuery(encoded)).toEqual(filter)
  })

  it('encodes an empty filter as the empty string so the hash keeps its bare shape', () => {
    expect(encodeSearchQuery({})).toBe('')
  })

  it('degrades field by field instead of throwing on a hand-edited query', () => {
    expect(decodeSearchQuery('bbox=1,2,3&datetime=..%2F2021-01-01T00:00:00Z&sortby=nonsense&junk=1')).toEqual({
      datetimeEnd: '2021-01-01T00:00:00Z',
    })
    expect(decodeSearchQuery('')).toEqual({})
    expect(decodeSearchQuery('bbox=a,b,c,d')).toEqual({})
  })
})

describe('hash fragment', () => {
  it('splits on the last literal ? so an href with its own query string survives', () => {
    const href = 'https://api.example.org/v1/collections/x?f=json'
    expect(splitHashFragment(`${href}?bbox=1%2C2%2C3%2C4`)).toEqual({ href, queryString: 'bbox=1%2C2%2C3%2C4' })
    expect(splitHashFragment(href)).toEqual({ href: 'https://api.example.org/v1/collections/x', queryString: 'f=json' })
    expect(splitHashFragment('https://example.org/catalog.json')).toEqual({ href: 'https://example.org/catalog.json' })
  })

  it('joins without a trailing ? when there is no query', () => {
    expect(joinHashFragment('https://example.org/c.json', '')).toBe('https://example.org/c.json')
    expect(joinHashFragment('https://example.org/c.json', 'bbox=1')).toBe('https://example.org/c.json?bbox=1')
  })
})
