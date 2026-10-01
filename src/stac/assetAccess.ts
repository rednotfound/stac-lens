import { planetaryComputerSigning } from './access/planetaryComputer'

// Discovery and access are separate concerns. A `StacAsset` (types.ts) is
// the resource as the publisher declared it; an `AssetAccess` is how this
// browser can reach that resource at this moment. For most catalogs the
// two hrefs are the same ("direct"); for some, the declared URL is not
// directly consumable — Planetary Computer's blob storage refuses
// unsigned requests — and an access method turns it into one that is.
//
//   STAC metadata → StacAsset → asset access → AssetAccess → consumer
//
// Access is lazy: nothing here runs while browsing, crawling or showing
// metadata — only when a consumer actually needs the bytes (open,
// preview). It never writes back into the StacAsset: the declared href
// stays what the catalog says, and the UI shows both.
//
// The standards-based way for a catalog to say "these assets need a
// signed URL, ask here" is the STAC Authentication extension
// (`auth:schemes` with `type: "signedUrl"`, referenced by `auth:refs`) —
// its own README uses Planetary Computer's /sign endpoint as the example.
// Planetary Computer's catalogs don't declare it, so it is a built-in
// method for now. When catalogs that declare `signedUrl` appear, the
// generic method belongs here, and Planetary Computer becomes data (a
// scheme for a source that doesn't declare its own) rather than code.
// See docs/DESIGN.md, "Asset access".

/** Where an asset was found — what an access method may use to decide
 *  whether it applies. The node's own href and its `rel: root` link. */
export interface AccessSource {
  nodeHref: string
  rootHref?: string
}

export function accessSourceOf(node: { href: string; declaredRootHref?: string }): AccessSource {
  return { nodeHref: node.href, rootHref: node.declaredRootHref }
}

/** How STAC Lens can reach an asset right now. `href` is what to open or
 *  fetch; `originalHref` is the asset's declared href, untouched. When
 *  access fails, `href` falls back to `originalHref` and `failure` says
 *  why — a failure never touches the metadata or the browsing around it. */
export interface AssetAccess {
  href: string
  originalHref: string
  /** `'direct'`, or the id of the access method that produced `href`. */
  method: string
  /** Human label of the method, e.g. "Planetary Computer signing". */
  methodLabel?: string
  expiresAt?: Date
  failure?: string
}

/** One way of turning a declared href into a consumable one. Everything
 *  provider-specific — detection included — lives inside the method. */
export interface AccessMethod {
  id: string
  label: string
  /** Synchronous and network-free: may this method handle this href from
   *  this source? Called while rendering, so it must stay cheap. */
  appliesTo(href: string, source: AccessSource): boolean
  access(href: string): Promise<{ href: string; expiresAt?: Date }>
}

/** Ordered; the first method that applies wins, and no match is direct.
 *  A plain list, not a registry — add a method by adding it here. */
const METHODS: readonly AccessMethod[] = [planetaryComputerSigning]

/** A cached access is reused until this long before it expires — the
 *  same one-minute margin Planetary Computer's own Python SDK uses. */
const EXPIRY_MARGIN_MS = 60_000

const cache = new Map<string, Promise<AssetAccess>>()

export function accessMethodFor(
  href: string,
  source: AccessSource,
  methods: readonly AccessMethod[] = METHODS,
): AccessMethod | undefined {
  return methods.find((m) => m.appliesTo(href, source))
}

export function directAccess(href: string): AssetAccess {
  return { href, originalHref: href, method: 'direct' }
}

/** Resolves how to reach `href`. Direct access resolves immediately and
 *  costs nothing; a method's result is cached per href until shortly
 *  before it expires, concurrent requests share one call, and failures
 *  are not cached (the next attempt tries again). */
export function accessAsset(
  href: string,
  source: AccessSource,
  methods: readonly AccessMethod[] = METHODS,
  now: () => number = Date.now,
): Promise<AssetAccess> {
  const method = accessMethodFor(href, source, methods)
  if (!method) return Promise.resolve(directAccess(href))

  const key = `${method.id} ${href}`
  // One entry per href; a stale one is replaced, not kept beside the new.
  // Two callers meeting the same stale entry at once may both refetch —
  // one extra signing call, the newer result wins.
  const cached = cache.get(key)
  if (cached) return cached.then((a) => (isFresh(a, now()) ? a : refetch()))
  return refetch()

  function refetch(): Promise<AssetAccess> {
    const pending: Promise<AssetAccess> = method!.access(href).then(
      (r) => ({
        href: r.href,
        originalHref: href,
        method: method!.id,
        methodLabel: method!.label,
        expiresAt: r.expiresAt,
      }),
      (err: unknown) => {
        // Only our own entry: a newer request may have replaced it.
        if (cache.get(key) === pending) cache.delete(key)
        return {
          ...directAccess(href),
          method: method!.id,
          methodLabel: method!.label,
          failure: err instanceof Error ? err.message : String(err),
        }
      },
    )
    cache.set(key, pending)
    return pending
  }
}

function isFresh(a: AssetAccess, now: number): boolean {
  return !a.expiresAt || a.expiresAt.getTime() - EXPIRY_MARGIN_MS > now
}

/** Tests only. */
export function clearAccessCache(): void {
  cache.clear()
}
