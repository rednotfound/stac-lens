import catalogs from './catalogs.json'
import type { KindId, PublisherId, RegionId, TopicId } from './catalogTags'

/** One entry of the landing page's known-catalog list. The list itself is
 *  data (`catalogs.json`), not code: how an entry gets in, how it is
 *  re-verified, how it is tagged, and how it leaves are all written down
 *  in docs/CATALOGS.md. `npm run verify:catalogs` checks every entry
 *  against the live server and against the tag vocabularies, and stamps
 *  `verifiedOn`. */
export interface KnownCatalog {
  title: string
  description: string
  href: string
  /** Mirrors the app's own runtime detection (`detectSourceKind`): `api`
   *  when the root advertises Item Search, `static` otherwise. The verifier
   *  flags an entry whose declared kind disagrees with what the server
   *  actually says. */
  kind: KindId
  /** Editorial facets from `catalogTags.ts` — what the data is about,
   *  where it covers, who is behind it. One or more topics, zero or more
   *  regions (empty = coverage not established), exactly one publisher. */
  topics: TopicId[]
  regions: RegionId[]
  publisher: PublisherId
  /** First commit that listed this href (ISO date). A catalog that was
   *  removed and later restored keeps its original date; the gap is in
   *  the log in docs/CATALOGS.md. */
  addedOn: string
  /** Last date `verify:catalogs --stamp` found the entry passing every
   *  check. Absent until the first stamped run after the entry was added. */
  verifiedOn?: string
}

export const KNOWN_CATALOGS: readonly KnownCatalog[] = catalogs as KnownCatalog[]
