import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchChildrenPage, fetchCollectionsPage, fetchSearchPage, filterToParams, type NextLink } from '../apiSearch'

const SEARCH = 'https://api.example.org/v1/search'

type Call = { url: string; init?: RequestInit }
let calls: Call[]
let responses: Response[]

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/geo+json' } })
}

function feature(id: string, self?: string) {
  return {
    type: 'Feature',
    id,
    geometry: null,
    properties: { datetime: '2020-01-01T00:00:00Z' },
    links: self ? [{ rel: 'self', href: self }] : [],
    assets: {},
  }
}

beforeEach(() => {
  calls = []
  responses = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const next = responses.shift()
    if (!next) throw new Error(`unexpected fetch: ${url}`)
    return Promise.resolve(next)
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('filterToParams', () => {
  it("emits STAC's own parameter names and formats", () => {
    expect(
      filterToParams({
        bbox: [-75.5, 39.5, -73.5, 41.5],
        datetimeStart: '2020-01-01T00:00:00Z',
        datetimeEnd: '2020-01-31T23:59:59Z',
        sortDirection: 'desc',
      }),
    ).toEqual({
      bbox: '-75.5,39.5,-73.5,41.5',
      datetime: '2020-01-01T00:00:00Z/2020-01-31T23:59:59Z',
      sortby: '-properties.datetime',
    })
  })

  it("uses STAC's `..` for an open interval end and emits nothing for an empty filter", () => {
    expect(filterToParams({ datetimeStart: '2020-01-01T00:00:00Z' })).toEqual({ datetime: '2020-01-01T00:00:00Z/..' })
    expect(filterToParams({})).toEqual({})
    expect(filterToParams(undefined)).toEqual({})
  })
})

describe('fetchSearchPage — fresh request', () => {
  it('scopes a cross-collection /search with collections= and carries the filter', async () => {
    responses.push(json({ type: 'FeatureCollection', features: [], links: [] }))
    await fetchSearchPage(SEARCH, {
      limit: 250,
      collections: ['3dep-lidar-returns'],
      filter: { bbox: [-75.5, 39.5, -73.5, 41.5] },
    })
    const url = new URL(calls[0].url)
    expect(url.origin + url.pathname).toBe(SEARCH)
    expect(url.searchParams.get('limit')).toBe('250')
    expect(url.searchParams.get('collections')).toBe('3dep-lidar-returns')
    expect(url.searchParams.get('bbox')).toBe('-75.5,39.5,-73.5,41.5')
    expect(calls[0].init).toBeUndefined() // a plain GET, no preflight-triggering headers
  })

  it('reads the total from numberMatched or the deprecated context.matched, and absent means unknown', async () => {
    responses.push(json({ type: 'FeatureCollection', features: [], links: [], numberMatched: 3999 }))
    expect((await fetchSearchPage(SEARCH, { limit: 1 })).matched).toBe(3999)
    responses.push(json({ type: 'FeatureCollection', features: [], links: [], context: { matched: 42 } }))
    expect((await fetchSearchPage(SEARCH, { limit: 1 })).matched).toBe(42)
    responses.push(json({ type: 'FeatureCollection', features: [], links: [] }))
    expect((await fetchSearchPage(SEARCH, { limit: 1 })).matched).toBeUndefined()
  })

  it('gives an Item without a self link a stable synthetic href', async () => {
    responses.push(json({ type: 'FeatureCollection', features: [feature('abc')], links: [] }))
    const page = await fetchSearchPage(SEARCH, { limit: 1 })
    expect(page.items[0].href).toBe(`${SEARCH}#abc`)
  })

  it("surfaces the server's own words when a request is refused", async () => {
    // Planetary Computer answers any cross-collection search this way.
    responses.push(new Response('collection is required', { status: 422 }))
    await expect(fetchSearchPage(SEARCH, { limit: 1 })).rejects.toThrow(
      'Search request failed: 422 — collection is required',
    )
  })
})

describe('fetchSearchPage — following next links', () => {
  it('follows a GET next link verbatim, without re-appending the filter', async () => {
    const next: NextLink = { href: `${SEARCH}?token=next:abc&limit=250`, method: 'GET' }
    responses.push(json({ type: 'FeatureCollection', features: [], links: [] }))
    await fetchSearchPage(SEARCH, { limit: 250, next, filter: { bbox: [1, 2, 3, 4] } })
    expect(calls[0].url).toBe(next.href)
    expect(calls[0].init).toBeUndefined()
  })

  it('follows a POST next link with merge: the original request in POST shape, plus the link body', async () => {
    const next: NextLink = { href: SEARCH, method: 'POST', body: { token: 'abc123' }, merge: true }
    responses.push(json({ type: 'FeatureCollection', features: [], links: [] }))
    await fetchSearchPage(SEARCH, {
      limit: 250,
      next,
      collections: ['sentinel-2-pre-c1-l2a'],
      filter: { bbox: [11.2, 34.1, 26.3, 44.4], sortDirection: 'asc' },
    })
    expect(calls[0].init?.method).toBe('POST')
    const headers = calls[0].init?.headers as Record<string, string> | undefined
    expect(headers?.['content-type']).toBe('application/json')
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      limit: 250,
      collections: ['sentinel-2-pre-c1-l2a'],
      bbox: [11.2, 34.1, 26.3, 44.4],
      sortby: [{ field: 'properties.datetime', direction: 'asc' }],
      token: 'abc123',
    })
  })

  it('sends only the link body when merge is not requested', async () => {
    const next: NextLink = { href: SEARCH, method: 'POST', body: { token: 'x' } }
    responses.push(json({ type: 'FeatureCollection', features: [], links: [] }))
    await fetchSearchPage(SEARCH, { limit: 10, next, filter: { bbox: [1, 2, 3, 4] } })
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ token: 'x' })
  })

  it('reads the next link as an object — method, body, merge — not just its href', async () => {
    responses.push(
      json({
        type: 'FeatureCollection',
        features: [],
        links: [{ rel: 'next', href: './search', method: 'POST', body: { token: 't' }, merge: true }],
      }),
    )
    const page = await fetchSearchPage(SEARCH, { limit: 1 })
    expect(page.next).toEqual({
      href: 'https://api.example.org/v1/search',
      method: 'POST',
      headers: undefined,
      body: { token: 't' },
      merge: true,
    })
  })
})

describe('list endpoints', () => {
  it('/collections: reads the collections array, the next link, and a synthetic href for an entry without self', async () => {
    responses.push(
      json({
        collections: [{ type: 'Collection', id: 'naip', extent: {}, links: [] }],
        links: [{ rel: 'next', href: 'https://api.example.org/v1/collections?page=2' }],
      }),
    )
    const page = await fetchCollectionsPage('https://api.example.org/v1/collections', { limit: 100 })
    expect(page.items[0].href).toBe('https://api.example.org/v1/collections/naip')
    expect(page.next?.href).toBe('https://api.example.org/v1/collections?page=2')
    expect(page.next?.method).toBe('GET')
  })

  it('/children: reads the children array', async () => {
    responses.push(
      json({
        children: [{ type: 'Catalog', id: 'c1', links: [{ rel: 'self', href: 'https://api.example.org/v1/c1' }] }],
        links: [],
      }),
    )
    const page = await fetchChildrenPage('https://api.example.org/v1/children', { limit: 100 })
    expect(page.items.map((n) => n.href)).toEqual(['https://api.example.org/v1/c1'])
    expect(page.next).toBeUndefined()
  })
})
