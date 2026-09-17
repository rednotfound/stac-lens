import catalogs from './catalogs.json'

/** One entry of the landing page's known-catalog list. The list itself is
 *  data (`catalogs.json`), not code: how an entry gets in, how it is
 *  re-verified, and how it leaves are all written down in
 *  docs/CATALOGS.md, and `npm run verify:catalogs` checks every entry
 *  against the live server and stamps `verifiedOn`. */
export interface KnownCatalog {
  title: string
  description: string
  href: string
  /** Mirrors the app's own runtime detection (`detectSourceKind`): `api`
   *  when the root advertises Item Search, `static` otherwise. The verifier
   *  flags an entry whose declared kind disagrees with what the server
   *  actually says. */
  kind: 'static' | 'api'
  /** First commit that listed this href (ISO date). A catalog that was
   *  removed and later restored keeps its original date; the gap is in
   *  the log in docs/CATALOGS.md. */
  addedOn: string
  /** Last date `verify:catalogs --stamp` found the entry passing every
   *  check. Absent until the first stamped run after the entry was added. */
  verifiedOn?: string
}

export const KNOWN_CATALOGS: readonly KnownCatalog[] = catalogs as KnownCatalog[]
