import type { AuthScheme, StacNode, StorageScheme } from './types'

// Authentication and Storage extension schemes are declared once — on the
// Collection, the root Catalog, or the Item itself — and referred to by key
// from assets (`auth:refs`, `storage:refs`). Copernicus Data Space declares
// `auth:schemes` on each Collection and refers to them from every Item's
// assets. So a key resolves up the parent chain, nearest declaration wins;
// only nodes already in the loader's cache are consulted (no fetching from
// a render), as in `body.ts`.

interface NodeLookup {
  get(href: string): StacNode | undefined
}

function findScheme<T>(
  node: StacNode | undefined,
  key: string,
  pick: (n: StacNode) => Record<string, T> | undefined,
  lookup: NodeLookup,
): T | undefined {
  const seen = new Set<string>()
  let current = node
  while (current && !seen.has(current.href)) {
    seen.add(current.href)
    const found = pick(current)?.[key]
    if (found) return found
    current = current.parentHref ? lookup.get(current.parentHref) : undefined
  }
  return undefined
}

export function resolveAuthScheme(node: StacNode | undefined, key: string, lookup: NodeLookup): AuthScheme | undefined {
  return findScheme(node, key, (n) => n.authSchemes, lookup)
}

/** Every storage scheme visible from `node` (its own and its ancestors'),
 *  nearest first per key. */
function allStorageSchemes(node: StacNode | undefined, lookup: NodeLookup): Record<string, StorageScheme> {
  const out: Record<string, StorageScheme> = {}
  const seen = new Set<string>()
  let current = node
  while (current && !seen.has(current.href)) {
    seen.add(current.href)
    for (const [k, v] of Object.entries(current.storageSchemes ?? {})) if (!(k in out)) out[k] = v
    current = current.parentHref ? lookup.get(current.parentHref) : undefined
  }
  return out
}

/** The storage scheme an href lives in: the first of its `storage:refs`
 *  that resolves; without refs, for an `s3://` URI, a declared scheme
 *  naming the same bucket. Undefined when the catalog does not say. */
export function resolveStorageScheme(
  node: StacNode | undefined,
  href: string,
  storageRefs: readonly string[] | undefined,
  lookup: NodeLookup,
): StorageScheme | undefined {
  const all = allStorageSchemes(node, lookup)
  for (const ref of storageRefs ?? []) if (all[ref]) return all[ref]
  const bucket = s3Bucket(href)
  if (!bucket) return undefined
  return Object.values(all).find((s) => s.fields.bucket === bucket)
}

/** `s3://bucket/key` → "bucket"; anything else → undefined. */
export function s3Bucket(href: string): string | undefined {
  const m = /^s3:\/\/([^/]+)\//.exec(href)
  return m?.[1]
}

const AUTH_TYPE_LABEL: Record<string, string> = {
  openIdConnect: 'sign-in (OpenID Connect)',
  oauth2: 'sign-in (OAuth 2.0)',
  http: 'HTTP authentication',
  apiKey: 'an API key',
  s3: 'S3 credentials',
  signedUrl: 'a signed URL',
}

/** "sign-in (OpenID Connect) · identity.dataspace.copernicus.eu". */
export function describeAuthScheme(s: AuthScheme): string {
  const label = AUTH_TYPE_LABEL[s.type] ?? s.type
  const detail = s.type === 'http' && s.scheme ? s.scheme : s.openIdConnectUrl ? hostOf(s.openIdConnectUrl) : undefined
  return detail ? `${label} · ${detail}` : label
}

const STORAGE_TYPE_LABEL: Record<string, string> = {
  'aws-s3': 'AWS S3',
  'custom-s3': 'S3-compatible storage',
  'ms-azure': 'Azure Blob Storage',
}

/** "AWS S3 · us-west-2 · requester pays", "S3-compatible storage ·
 *  eodata.dataspace.copernicus.eu". */
export function describeStorageScheme(s: StorageScheme): string {
  const parts = [s.title ?? STORAGE_TYPE_LABEL[s.type] ?? s.type]
  if (s.region) parts.push(s.region)
  else if (s.platform && !s.platform.includes('{')) parts.push(hostOf(s.platform))
  if (s.requesterPays) parts.push('requester pays')
  return parts.join(' · ')
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
