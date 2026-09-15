import { useEffect, useRef, useState } from 'react'
import { loader } from '../stac/loaderInstance'
import { joinHashFragment, splitHashFragment, decodeSearchQuery } from '../stac/searchQueryUrl'
import type { SearchFilter } from '../stac/apiSearch'
import type { StacNode } from '../stac/types'

export interface DeepLinkTarget {
  rootHref: string
  selectedHref: string | null
  /** An API search query carried in the hash's own `?...` suffix, if any —
   *  see `splitHashFragment`/`joinHashFragment`. Scoped to whichever
   *  Collection actually owns the browsed Item Set box (`forHref`): the
   *  named node itself when it's a Collection/Catalog, or its parent when
   *  it's an Item — the same rule `store/selection.ts`'s `browsingHref`
   *  already uses, so a query restored this way lands on the same box a
   *  freshly-applied one would. */
  appliedQuery?: { forHref: string; query: SearchFilter }
}

function queryOwnerHref(node: StacNode): string {
  return node.type === 'Item' ? (node.parentHref ?? node.href) : node.href
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

/** Fetches the node a hash names and finds the catalog root it belongs to
 *  — the one piece of async resolution both the initial-load bootstrap
 *  and back/forward navigation (`usePopStateSync`, below) need identically,
 *  so it exists exactly once rather than copied into both. Also decodes an
 *  applied-search suffix when the hash carries one (`splitHashFragment`). */
async function resolveHashTarget(hash: string): Promise<DeepLinkTarget> {
  const { href, queryString } = splitHashFragment(hash)
  const node = await loader.load(href)
  const rootHref = await loader.resolveRoot(node)
  const appliedQuery = queryString
    ? { forHref: queryOwnerHref(node), query: decodeSearchQuery(queryString) }
    : undefined
  return { rootHref, selectedHref: node.href === rootHref ? null : node.href, appliedQuery }
}

/** Resolves the hash-encoded node href (if present) into a catalog root to
 *  open plus an optional selection within it — read side of the
 *  deep-linking mechanism; `useShareableUrlSync` below is the write side.
 *  A node fetched this way is fetched in isolation, with nothing else
 *  loaded yet, so finding "which catalog does this belong to" needs its
 *  own step — see `StacLoader.resolveRoot`. Only ever reads the URL once,
 *  on mount — subsequent browser back/forward navigation is
 *  `usePopStateSync`'s job instead, not this hook's. */
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
        const target = await resolveHashTarget(nodeHref)
        if (cancelled) return
        setState({ booting: false, error: null, target })
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

/** Reacts to the browser's own Back/Forward buttons — not handled at all
 *  before this (this project's own "not yet built" note said exactly that:
 *  `popstate` does nothing useful). `useDeepLinkBootstrap` only ever reads
 *  the hash once, on the very first mount, so navigating back used to
 *  change the address bar without the app ever noticing. Paired with
 *  `useShareableUrlSync`'s own push-vs-replace change below, this is what
 *  makes pressing Back, once, from inside an open catalog return to this
 *  app's own landing page instead of leaving the app outright on the very
 *  first press: "浏览器的返回按钮按下之后就回到了浏览器的默认页...这个真的没有
 *  办法么" (pressing the browser's back button goes straight to the
 *  browser's own default page — is there really no way around this?). A
 *  hash that can no longer resolve (a dead link, now that we've navigated
 *  back to it) degrades to the landing page rather than a silent failure
 *  — the same safe fallback an invalid hash already gets on a fresh load. */
export function usePopStateSync(
  setRootHref: (href: string | null) => void,
  select: (href: string | null) => void,
  setPendingQuery: (forHref: string, query: SearchFilter) => void,
): void {
  useEffect(() => {
    function handlePopState() {
      const hash = readHashHref()
      if (!hash) {
        setRootHref(null)
        select(null)
        return
      }
      void (async () => {
        try {
          const target = await resolveHashTarget(hash)
          if (target.appliedQuery) setPendingQuery(target.appliedQuery.forHref, target.appliedQuery.query)
          setRootHref(target.rootHref)
          select(target.selectedHref)
        } catch {
          setRootHref(null)
          select(null)
        }
      })()
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [setRootHref, select, setPendingQuery])
}

/** Keeps the address bar in sync with whatever's currently open, so copying
 *  it at any point reproduces the same view — the write side.
 *
 *  Pushes a real history entry only at a *logical page* boundary — the
 *  landing page and an open catalog, or one catalog and a different one —
 *  and replaces the current entry for everything else (selecting a
 *  different node within the same catalog). Plain `replaceState` for
 *  everything was the original design, on purpose, specifically to avoid
 *  flooding back/forward with one entry per click — still correct for
 *  *within* a catalog, since nobody wants to page back through fifty
 *  individual Item selections. But it also meant there was only ever one
 *  history entry for the entire app session, so the browser's Back button
 *  left the app outright on the very first press regardless of how much
 *  had been explored — reported directly, and confirmed as the actual
 *  cause here (not assumed): "这个太容易让人误操作了" (this makes it far too
 *  easy to trigger by accident). Pushing only at the root-catalog boundary
 *  keeps both properties: exploring one catalog stays a single entry, and
 *  Back still means something a user would actually want ("the catalog/
 *  page I was on before this one"). */
export function useShareableUrlSync(
  rootHref: string | null,
  selectedHref: string | null,
  booting: boolean,
  /** The query-string suffix (no leading `?`) for whatever `appliedQuery`
   *  currently belongs to the Collection actually named by `selectedHref ??
   *  rootHref` — `''` when there's nothing to append (a static catalog, an
   *  API Collection with no filter applied, or a stale/mismatched
   *  `forHref`). Computed by the caller (`App.tsx`) from `store/itemSet.ts`
   *  — this hook only threads it into the hash, it owns no query state
   *  itself. */
  queryStringForSelection: string,
): void {
  // `undefined` means "hasn't synced yet" — distinct from `null` (synced,
  // and landed on the landing page) so the very first sync after mount
  // (settling into whatever a deep link/fresh load already resolved to)
  // never counts as a root *change* to push, only ones a user actually
  // triggers afterward.
  const prevRootHrefRef = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (booting) return
    const current = rootHref ? joinHashFragment(selectedHref ?? rootHref, queryStringForSelection) : null
    if (readHashHref() === (current ?? '')) {
      prevRootHrefRef.current = rootHref
      return
    }

    const url = new URL(window.location.href)
    url.hash = current ?? ''

    const isRootChange = prevRootHrefRef.current !== undefined && prevRootHrefRef.current !== rootHref
    if (isRootChange) {
      window.history.pushState(null, '', url)
    } else {
      window.history.replaceState(null, '', url)
    }
    prevRootHrefRef.current = rootHref
  }, [rootHref, selectedHref, booting, queryStringForSelection])
}
