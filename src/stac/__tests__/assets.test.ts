import { describe, expect, it } from 'vitest'
import { isInlinePreviewAsset, previewImageHref } from '../assets'
import type { ResolvedAsset } from '../types'

const asset = (key: string, type: string | undefined, roles: string[]): ResolvedAsset => ({
  key,
  href: `https://x/${key}`,
  type,
  roles,
})

describe('preview images', () => {
  it('accepts a thumbnail or overview only when the type is a browser image', () => {
    expect(isInlinePreviewAsset(asset('t', 'image/png', ['thumbnail']))).toBe(true)
    expect(isInlinePreviewAsset(asset('o', 'image/jpeg', ['overview']))).toBe(true)
    expect(
      isInlinePreviewAsset(asset('cog', 'image/tiff; application=geotiff; profile=cloud-optimized', ['overview'])),
    ).toBe(false)
    expect(isInlinePreviewAsset(asset('v', 'image/png', ['visual']))).toBe(false)
    expect(isInlinePreviewAsset(asset('n', undefined, ['thumbnail']))).toBe(false)
  })

  it('prefers a thumbnail, then an image overview, then a preview link', () => {
    const thumb = asset('t', 'image/png', ['thumbnail'])
    const overview = asset('o', 'image/webp', ['overview'])
    expect(previewImageHref({ assets: [overview, thumb], previewHref: 'https://x/link.png' })).toBe(thumb.href)
    expect(previewImageHref({ assets: [overview], previewHref: 'https://x/link.png' })).toBe(overview.href)
    expect(
      previewImageHref({ assets: [asset('d', 'application/x-parquet', ['data'])], previewHref: 'https://x/link.png' }),
    ).toBe('https://x/link.png')
    expect(previewImageHref({ assets: [] })).toBeUndefined()
  })
})
