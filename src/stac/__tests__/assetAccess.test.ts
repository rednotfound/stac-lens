import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { planetaryComputerSigning } from '../access/planetaryComputer'
import { accessAsset, accessMethodFor, clearAccessCache, type AccessMethod, type AccessSource } from '../assetAccess'

const PC_ROOT = 'https://planetarycomputer.microsoft.com/api/stac/v1/'
const PC_ITEM = `${PC_ROOT}collections/landsat-c2-l2/items/LC09`
const BLOB = 'https://landsateuwest.blob.core.windows.net/landsat-c2/level-2/B4.TIF'
const pcSource: AccessSource = { nodeHref: PC_ITEM, rootHref: PC_ROOT }

beforeEach(() => clearAccessCache())
afterEach(() => vi.unstubAllGlobals())

describe('planetaryComputerSigning.appliesTo', () => {
  const applies = (href: string, source = pcSource) => planetaryComputerSigning.appliesTo(href, source)

  it('applies to a blob asset found in Planetary Computer', () => {
    expect(applies(BLOB)).toBe(true)
    // No rel:root — the node's own href identifies the source.
    expect(applies(BLOB, { nodeHref: PC_ITEM })).toBe(true)
  })

  it('never applies to another publisher, even on Azure blob storage', () => {
    expect(applies(BLOB, { nodeHref: 'https://example.org/catalog/item.json' })).toBe(false)
    expect(applies(BLOB, { nodeHref: 'https://planetarycomputer.microsoft.com.evil.example/api/stac/v1/x' })).toBe(
      false,
    )
  })

  it('follows the SDK: public thumbnails, non-blob and already-signed hrefs are left alone', () => {
    expect(applies('https://ai4edatasetspublicassets.blob.core.windows.net/assets/thumb.png')).toBe(false)
    expect(applies('https://planetarycomputer.microsoft.com/api/data/v1/item/preview.png?collection=x')).toBe(false)
    expect(applies(`${BLOB}?st=2026-01-01&se=2026-01-02&sp=rl&sig=abc`)).toBe(false)
    expect(applies('abfs://items/landsat-c2-l2.parquet')).toBe(false)
    expect(applies('not a url')).toBe(false)
  })
})

describe('accessAsset', () => {
  function stubSigner(responses: Array<{ status: number; body: unknown }>) {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url)
      const r = responses[Math.min(calls.length - 1, responses.length - 1)]
      return new Response(JSON.stringify(r.body), { status: r.status })
    })
    return calls
  }

  it('is direct, immediate and network-free when no method applies', async () => {
    const calls = stubSigner([])
    const a = await accessAsset('https://example.org/data.tif', { nodeHref: 'https://example.org/item.json' })
    expect(a).toEqual({
      href: 'https://example.org/data.tif',
      originalHref: 'https://example.org/data.tif',
      method: 'direct',
    })
    expect(calls).toHaveLength(0)
    expect(accessMethodFor('https://example.org/data.tif', pcSource)).toBeUndefined()
  })

  it('signs through /sign, keeps the original href, and reports the expiry', async () => {
    const calls = stubSigner([
      { status: 200, body: { href: `${BLOB}?se=x&sig=y`, 'msft:expiry': '2026-10-01T13:52:07Z' } },
    ])
    const a = await accessAsset(BLOB, pcSource)
    expect(calls[0]).toBe(`https://planetarycomputer.microsoft.com/api/sas/v1/sign?href=${encodeURIComponent(BLOB)}`)
    expect(a.href).toBe(`${BLOB}?se=x&sig=y`)
    expect(a.originalHref).toBe(BLOB)
    expect(a.method).toBe('planetary-computer')
    expect(a.expiresAt?.toISOString()).toBe('2026-10-01T13:52:07.000Z')
    expect(a.failure).toBeUndefined()
  })

  it('reuses a cached access until a minute before expiry, then resolves again', async () => {
    let t = Date.parse('2026-10-01T13:00:00Z')
    const now = () => t
    const calls: string[] = []
    const method: AccessMethod = {
      id: 'm',
      label: 'm',
      appliesTo: () => true,
      access: async (href) => {
        calls.push(href)
        return { href: `${href}?n=${calls.length}`, expiresAt: new Date(t + 45 * 60_000) }
      },
    }
    const src = { nodeHref: 'x' }
    await Promise.all([accessAsset('h', src, [method], now), accessAsset('h', src, [method], now)])
    expect(calls).toHaveLength(1) // concurrent requests share one call
    t += 40 * 60_000
    expect((await accessAsset('h', src, [method], now)).href).toBe('h?n=1')
    t += 4.5 * 60_000 // 30 s before expiry: inside the margin
    expect((await accessAsset('h', src, [method], now)).href).toBe('h?n=2')
  })

  it('degrades to the original href on failure and does not cache the failure', async () => {
    const calls = stubSigner([
      { status: 404, body: { detail: 'The given location does not exist or cannot be read' } },
      { status: 200, body: { href: `${BLOB}?sig=y`, 'msft:expiry': null } },
    ])
    const failed = await accessAsset(BLOB, pcSource)
    expect(failed.href).toBe(BLOB)
    expect(failed.failure).toBe(
      'Planetary Computer signing returned 404: The given location does not exist or cannot be read',
    )
    const retried = await accessAsset(BLOB, pcSource)
    expect(calls).toHaveLength(2)
    expect(retried.href).toBe(`${BLOB}?sig=y`)
    expect(retried.expiresAt).toBeUndefined()
  })

  it('a failure that lands late never removes a newer cached access', async () => {
    let t = 0
    const now = () => t
    let call = 0
    let failFirst!: (e: Error) => void
    const method: AccessMethod = {
      id: 'm',
      label: 'm',
      appliesTo: () => true,
      access: () => {
        call += 1
        if (call === 1) return new Promise((_, reject) => (failFirst = reject))
        return Promise.resolve({ href: 'h?fresh', expiresAt: new Date(10 * 60_000) })
      },
    }
    const src = { nodeHref: 'x' }
    const first = accessAsset('h', src, [method], now)
    // The first call is still pending; its failure is simulated after a
    // second, successful call has been made and cached.
    clearAccessCache()
    const second = await accessAsset('h', src, [method], now)
    failFirst(new Error('late failure'))
    expect((await first).failure).toBe('late failure')
    expect(second.href).toBe('h?fresh')
    expect((await accessAsset('h', src, [method], now)).href).toBe('h?fresh')
    expect(call).toBe(2)
  })
})
