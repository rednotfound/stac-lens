import type { StacAsset } from './types'

// The Asset Object spec's own text on the `thumbnail` role: it should be
// "typically RGB/grayscale, low resolution, displayable in a web browser
// without scripts or extensions" — the spec's own way of marking exactly
// which assets are safe to render as a plain <img>. Verified directly
// against real Items (Capella, Earth Search): `overview`/`visual` assets
// often *look* like preview images by name but are frequently COG
// (image/tiff; profile=cloud-optimized), which no browser decodes natively
// — only `thumbnail` + an actual raster image type is a safe bet.
const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'])

/** Renderable as a plain `<img>`: a `thumbnail` — or, failing that, an
 *  `overview` — asset whose media type is a browser image. `overview`
 *  assets are usually COGs, which is why the type check, not the role,
 *  decides; a PNG overview is as good as a thumbnail. */
export function isInlinePreviewAsset(asset: StacAsset): boolean {
  const roles = asset.roles ?? []
  return (
    (roles.includes('thumbnail') || roles.includes('overview')) && !!asset.type && INLINE_IMAGE_TYPES.has(asset.type)
  )
}

export function isInlineImageType(type: string | undefined): boolean {
  return !!type && INLINE_IMAGE_TYPES.has(type)
}

/** The one image the hover card and the Inspector show for a node, if
 *  any: a `thumbnail` asset first, then an `overview` that is a browser
 *  image, then a `rel: preview` link with an image type (the link-level
 *  convention STAC Browser also honors). Nothing else — an asset that
 *  merely *looks* like a picture by name is not loaded on speculation. */
export function previewImageHref(node: { assets: StacAsset[]; previewHref?: string }): string | undefined {
  const thumb = node.assets.find((a) => a.roles?.includes('thumbnail') && isInlineImageType(a.type))
  if (thumb) return thumb.href
  const overview = node.assets.find((a) => a.roles?.includes('overview') && isInlineImageType(a.type))
  if (overview) return overview.href
  return node.previewHref
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

/** HEALTH-RULES A-06: the href's path has an empty segment (`//` after the
 *  host). Object stores treat `a//b` and `a/b` as different keys, so such
 *  a link usually fails — the Africa Agriculture Adaptation Atlas'
 *  `…amazonaws.com//vulnerability/…` answers 403, the same path with one
 *  slash answers. Only the path is read, not the query or fragment. */
export function hasEmptyPathSegment(href: string): boolean {
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+([^?#]*)/i.exec(href)
  return !!m && m[1].includes('//')
}

/** A browser can open it itself (`http:`/`https:`); `s3://`, `gs://`,
 *  `abfs://` and the like are for other tools. */
export function browserCanOpen(href: string): boolean {
  return /^https?:\/\//i.test(href)
}

/** HEALTH-RULES L-07: an href written as a local file-system path — a
 *  `file:` URL, a drive letter (`C:\…`), a UNC path, or an absolute path
 *  under a home or temp directory (`/Users/…`, `/home/…`, `/tmp/…`). Such a
 *  link only ever worked on the publisher's own machine: CoCliCo's Items
 *  carry `/Users/calkoen/dev/stac-phd/…` as their root, parent, collection
 *  and self. Takes the href *as written*: once resolved against a web host
 *  it is an ordinary URL, and a web URL whose path happens to start with
 *  `/media/` or `/home/` is a real link, not a publisher error. */
export function looksLikeLocalPath(href: string): boolean {
  if (/^file:/i.test(href) || /^[A-Za-z]:[\\/]/.test(href) || /^\\\\/.test(href) || /^~\//.test(href)) return true
  return /^\/(Users|home|mnt|media|tmp|private\/var|var\/folders)\//.test(href)
}
