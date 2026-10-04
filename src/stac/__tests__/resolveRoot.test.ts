import { afterEach, describe, expect, it, vi } from 'vitest'
import { looksLikeLocalPath } from '../assets'
import { buildNode } from '../graph'
import { StacLoader } from '../loader'

// Shaped on CoCliCo (2026-10-04): its Collection links to the root with
// `../catalog.json`, but each Item carries the publisher's laptop paths —
// `/Users/calkoen/dev/stac-phd/release/v1/…` — for root, parent,
// collection and self. Resolved against the blob host those become URLs
// Azure refuses (400).
const HOST = 'https://blob.test'
const ROOT = `${HOST}/stac/v1/catalog.json`
const COLLECTION = `${HOST}/stac/v1/coastal-zone/collection.json`
const ITEM = `${HOST}/stac/v1/coastal-zone/items/zone.json`
const LOCAL = '/Users/someone/dev/stac/release/v1'

function item(links: { rel: string; href: string }[]) {
  return buildNode(ITEM, {
    type: 'Feature',
    stac_version: '1.0.0',
    id: 'zone',
    geometry: null,
    properties: { datetime: '2024-01-01T00:00:00Z' },
    links,
    assets: {},
  } as never)
}

/** A fetch that serves the given documents and answers anything else 400. */
function serve(docs: Record<string, unknown>) {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url)
    return url in docs
      ? new Response(JSON.stringify(docs[url]), { status: 200 })
      : new Response('The specifed resource name contains invalid characters.', {
          status: 400,
          statusText: 'Bad Request',
        })
  })
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('looksLikeLocalPath', () => {
  it('knows local file-system paths as written, and leaves real URLs alone', () => {
    expect(looksLikeLocalPath('/Users/someone/dev/catalog.json')).toBe(true)
    expect(looksLikeLocalPath('/home/me/stac/catalog.json')).toBe(true)
    expect(looksLikeLocalPath('C:\\data\\catalog.json')).toBe(true)
    expect(looksLikeLocalPath('file:///tmp/catalog.json')).toBe(true)
    expect(looksLikeLocalPath('../catalog.json')).toBe(false)
    expect(looksLikeLocalPath('https://blob.test/stac/v1/catalog.json')).toBe(false)
    expect(looksLikeLocalPath('/stac/v1/catalog.json')).toBe(false)
    // A web URL whose path merely starts with such a folder is a real link.
    expect(looksLikeLocalPath('https://data.example.org/media/stac/collection.json')).toBe(false)
    expect(looksLikeLocalPath('https://blob.test/Users/someone/dev/catalog.json')).toBe(false)
  })

  it('records the raw local-path links on the node (L-07)', () => {
    const n = item([
      { rel: 'root', href: `${LOCAL}/catalog.json` },
      { rel: 'parent', href: '../collection.json' },
    ])
    expect(n.localPathLinks).toEqual([{ rel: 'root', href: `${LOCAL}/catalog.json` }])
  })
})

describe('resolveRoot', () => {
  it('takes a root link only once it has loaded', async () => {
    serve({ [ROOT]: { type: 'Catalog', id: 'root', links: [] } })
    const n = item([{ rel: 'root', href: '../../catalog.json' }])
    expect(await new StacLoader().resolveRoot(n)).toEqual({ rootHref: ROOT })
  })

  it('falls back to the parent chain when the root link does not load', async () => {
    serve({
      [COLLECTION]: { type: 'Collection', id: 'cz', extent: {}, links: [{ rel: 'parent', href: '../catalog.json' }] },
      [ROOT]: { type: 'Catalog', id: 'root', links: [] },
    })
    const n = item([
      { rel: 'root', href: `${LOCAL}/catalog.json` },
      { rel: 'parent', href: '../collection.json' },
    ])
    const r = await new StacLoader().resolveRoot(n)
    expect(r.rootHref).toBe(ROOT)
    // Only the root link was broken: the parent walk still reached the top.
    expect(r.unreachable).toMatchObject({
      rel: 'root',
      href: `${HOST}${LOCAL}/catalog.json`,
      localPath: true,
      walkComplete: true,
    })
  })

  it('opens the node on its own when none of its links load (CoCliCo)', async () => {
    serve({})
    const n = item([
      { rel: 'root', href: `${LOCAL}/catalog.json` },
      { rel: 'parent', href: `${LOCAL}/coastal-zone/collection.json` },
    ])
    const r = await new StacLoader().resolveRoot(n)
    expect(r.rootHref).toBe(ITEM)
    expect(r.unreachable?.rel).toBe('root')
    expect(r.unreachable?.error).toMatch(/400/)
    expect(r.unreachable?.walkComplete).toBe(false)
  })
})
