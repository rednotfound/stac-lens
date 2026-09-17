import type { ResolvedAsset } from './types'

// The Asset Object spec's own text on the `thumbnail` role: it should be
// "typically RGB/grayscale, low resolution, displayable in a web browser
// without scripts or extensions" — the spec's own way of marking exactly
// which assets are safe to render as a plain <img>. Verified directly
// against real Items (Capella, Earth Search): `overview`/`visual` assets
// often *look* like preview images by name but are frequently COG
// (image/tiff; profile=cloud-optimized), which no browser decodes natively
// — only `thumbnail` + an actual raster image type is a safe bet.
const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'])

export function isInlinePreviewAsset(asset: ResolvedAsset): boolean {
  return !!asset.roles?.includes('thumbnail') && !!asset.type && INLINE_IMAGE_TYPES.has(asset.type)
}

/** A short, human label for an asset's media type — "COG", "GeoTIFF",
 *  "JSON", the subtype, or "file" as a last resort. Not exhaustive; just
 *  enough to tell a copy-paste-only asset apart from another at a glance. */
export function describeAssetType(type: string | undefined): string {
  if (!type) return 'file'
  if (type.includes('cloud-optimized')) return 'COG'
  if (type.includes('geotiff') || type === 'image/tiff') return 'GeoTIFF'
  if (type === 'application/json' || type === 'application/geo+json') return 'JSON'
  if (type === 'application/x-parquet' || type.includes('parquet')) return 'Parquet'
  const slash = type.indexOf('/')
  return slash === -1
    ? type
    : type
        .slice(slash + 1)
        .split(';')[0]
        .toUpperCase()
}
