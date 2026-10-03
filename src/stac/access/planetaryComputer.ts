import type { AccessMethod, AccessSource } from '../assetAccess'

// Planetary Computer keeps its data in Azure Blob Storage that refuses
// unsigned requests ("409 Public access is not permitted on this storage
// account", measured 2026-10-01 on a Landsat C2 L2 asset). Its public
// Data Authentication API signs an href with a short-lived SAS token —
// no account, no key, CORS open to every origin — so a browser can do it
// directly. Docs: https://planetarycomputer.microsoft.com/docs/concepts/sas/
//
// Everything Planetary Computer-specific lives in this file. The rules
// below follow Microsoft's own Python SDK (planetary_computer/sas.py,
// `sign_url`), so this signs exactly what the official client signs.

const STAC_ROOT = 'https://planetarycomputer.microsoft.com/api/stac/v1/'
const SIGN_ENDPOINT = 'https://planetarycomputer.microsoft.com/api/sas/v1/sign'
const BLOB_STORAGE_DOMAIN = '.blob.core.windows.net'
/** Public thumbnails; the signer rejects them (they need no signing). */
const PUBLIC_ACCOUNT = 'ai4edatasetspublicassets.blob.core.windows.net'
const TIMEOUT_MS = 15_000

/** The asset was found in Planetary Computer's own STAC API — by the
 *  node's `rel: root` link (every Planetary Computer Item and Collection
 *  carries one), else by the node's own href. The asset URL alone is not
 *  enough: any publisher can host on Azure, and their URLs must never be
 *  sent to Microsoft's signer. */
function fromPlanetaryComputer(source: AccessSource): boolean {
  const where = source.rootHref ?? source.nodeHref
  return (where.endsWith('/') ? where : `${where}/`).startsWith(STAC_ROOT)
}

/** The SDK's eligibility rules: an Azure blob URL, not the public
 *  thumbnail account, and not already signed. */
function needsSigning(href: string): boolean {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || !url.hostname.endsWith(BLOB_STORAGE_DOMAIN)) return false
  if (url.hostname === PUBLIC_ACCOUNT) return false
  const p = url.searchParams
  return !(p.has('st') || p.has('se') || p.has('sp'))
}

export const planetaryComputerSigning: AccessMethod = {
  id: 'planetary-computer',
  label: 'Planetary Computer signing',
  appliesTo: (href, source) => !source.authRefs?.length && fromPlanetaryComputer(source) && needsSigning(href),
  async access(href) {
    // `/sign` (one call per href) rather than the SDK's `/token/{account}/
    // {container}` (one call per container): access is per click today,
    // and the response is a finished URL plus its expiry. If a viewer
    // ever needs many assets at once, switch to `/token` here — callers
    // don't change.
    const res = await fetch(`${SIGN_ENDPOINT}?href=${encodeURIComponent(href)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((err: unknown) => {
      // The service is usually sub-second but has its slow moments.
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new Error(`Planetary Computer signing did not answer within ${TIMEOUT_MS / 1000} seconds`)
      }
      throw err
    })
    const body: unknown = await res.json().catch(() => undefined)
    if (!res.ok) {
      const detail = (body as { detail?: unknown } | undefined)?.detail
      throw new Error(
        `Planetary Computer signing returned ${res.status}${typeof detail === 'string' ? `: ${detail}` : ''}`,
      )
    }
    const signed = body as { href?: unknown; 'msft:expiry'?: unknown } | undefined
    if (typeof signed?.href !== 'string') throw new Error('Planetary Computer signing returned no href')
    const expiry = signed['msft:expiry']
    return { href: signed.href, expiresAt: typeof expiry === 'string' ? new Date(expiry) : undefined }
  },
}
