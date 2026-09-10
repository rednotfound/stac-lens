import { useEffect, useState } from 'react'
import { loader } from '../stac/loaderInstance'

export interface DeepLinkTarget {
  rootHref: string
  selectedHref: string | null
}

interface BootstrapState {
  booting: boolean
  error: string | null
  target: DeepLinkTarget | null
}

/** Reads the hash fragment as the raw node href, verbatim — no key=value
 *  scheme, no `URLSearchParams`. `node.href` (from `resolveHref`/`new
 *  URL(...).toString()`) is already a fully valid, correctly-escaped
 *  absolute URL — `:` and `/` are legal, unescaped characters in a
 *  fragment per the URL spec, so writing it straight into `location.hash`
 *  round-trips byte-for-byte with no re-encoding on either end. Doing this
 *  through `URLSearchParams` instead (an earlier version did) applies
 *  `application/x-www-form-urlencoded` rules, which escape `:` and `/` too
 *  — technically correct, but turned every shared link into an unreadable
 *  `?node=https%3A%2F%2F...` wall of percent-encoding for no benefit here
 *  (there's only ever this one value; nothing else shares the URL). */
function readHashHref(): string {
  return window.location.hash.slice(1)
}

/** Resolves the hash-encoded node href (if present) into a catalog root to
 *  open plus an optional selection within it — read side of the
 *  deep-linking mechanism; `useShareableUrlSync` below is the write side.
 *  A node fetched this way is fetched in isolation, with nothing else
 *  loaded yet, so finding "which catalog does this belong to" needs its
 *  own step — see `StacLoader.resolveRoot`. Only ever reads the URL once,
 *  on mount; doesn't react to `popstate` (no back/forward support yet, see
 *  docs/DESIGN.md). */
export function useDeepLinkBootstrap(): BootstrapState {
  const [state, setState] = useState<BootstrapState>(() => {
    const hash = readHashHref()
    return { booting: !!hash, error: null, target: null }
  })

  useEffect(() => {
    const nodeHref = readHashHref()
    if (!nodeHref) return

    let cancelled = false
    void (async () => {
      try {
        const node = await loader.load(nodeHref)
        const rootHref = await loader.resolveRoot(node)
        if (cancelled) return
        setState({
          booting: false,
          error: null,
          target: { rootHref, selectedHref: node.href === rootHref ? null : node.href },
        })
      } catch (err) {
        if (cancelled) return
        setState({
          booting: false,
          error: err instanceof Error ? err.message : String(err),
          target: null,
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return state
}

/** Keeps the address bar in sync with whatever's currently open, so copying
 *  it at any point reproduces the same view — the write side. Uses
 *  `history.replaceState`, not `pushState`: updating on every selection
 *  would otherwise flood browser back/forward with one entry per click,
 *  which isn't what "back" should mean for this app (see docs/DESIGN.md).
 *
 *  `booting` must be true for as long as `useDeepLinkBootstrap` is still
 *  resolving a hash-encoded href — `rootHref` is still `null` at that point
 *  (the fetch hasn't set it yet), and syncing "nothing's open" would strip
 *  the very hash the bootstrap is mid-flight reading. Confirmed as a real,
 *  reproducible failure, not just a theoretical race: the bootstrap re-reads
 *  the hash on retry (React StrictMode's dev-only double-effect-invoke), so
 *  a hash stripped out from under it here made every deep link hang on
 *  "Opening shared link…" forever in dev. */
export function useShareableUrlSync(
  rootHref: string | null,
  selectedHref: string | null,
  booting: boolean,
): void {
  useEffect(() => {
    if (booting) return
    const current = rootHref ? (selectedHref ?? rootHref) : null
    if (readHashHref() === (current ?? '')) return

    const url = new URL(window.location.href)
    url.hash = current ?? ''
    window.history.replaceState(null, '', url)
  }, [rootHref, selectedHref, booting])
}
