import type { AccessMethod } from '../assetAccess'
import { s3Bucket } from '../schemes'

// An `s3://bucket/key` URI is what AWS tools read; a browser cannot. When
// the bucket is public, the same object is served over HTTPS at AWS's
// documented virtual-hosted address, `https://{bucket}.s3.{region}.
// amazonaws.com/{key}` — the Storage extension's own `aws-s3` platform
// template. Earth Genome's Sentinel-2 mosaics, for one, publish only
// `s3://` hrefs to a public bucket that answers this way.
//
// It applies only when nothing says otherwise:
// - the href declares no credentials (`auth:refs` — Copernicus Data
//   Space's `s3://eodata` hrefs require its S3 keys);
// - the storage the catalog declares, if any, is AWS (`aws-s3`), not
//   another S3-compatible platform, and is not requester-pays (that needs
//   an AWS account; a browser cannot pay).
// An undeclared bucket is assumed to be on AWS (the `s3://` scheme is
// AWS's) and the access link says so — some catalogs keep `s3://` hrefs
// for buckets elsewhere, and from a browser the assumption cannot be
// checked (no CORS on most buckets).

/** Building the URL is all there is to do; the browser tab that opens it
 *  shows AWS's own answer. */
export const awsS3PublicUrl: AccessMethod = {
  id: 'aws-s3-public',
  label: 'its public AWS S3 HTTPS address',
  appliesTo(href, source) {
    if (!s3Bucket(href)) return false
    if (source.authRefs?.length) return false
    const storage = source.storage
    if (storage && (storage.type !== 'aws-s3' || storage.requesterPays)) return false
    return true
  },
  async access(href, source) {
    const bucket = s3Bucket(href)!
    const key = href.slice(`s3://${bucket}/`.length)
    const storage = source.storage
    const region = storage?.region ?? storage?.fields.region
    // A dotted bucket name breaks the TLS certificate of the virtual-hosted
    // address; AWS serves those path-style.
    const url = bucket.includes('.')
      ? `https://s3${region ? `.${region}` : ''}.amazonaws.com/${bucket}/${key}`
      : `https://${bucket}.s3${region ? `.${region}` : ''}.amazonaws.com/${key}`
    return {
      href: url,
      note: storage
        ? undefined
        : "The catalog doesn't declare where this bucket is stored; AWS is assumed, and the bucket must be public.",
    }
  },
}
