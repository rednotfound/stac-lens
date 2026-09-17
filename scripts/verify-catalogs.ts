// Re-verifies every entry of the landing page's known-catalog list
// (src/data/catalogs.json) against the live server, the way a browser
// would see it. Prints a report; never adds or removes an entry — whether a
// failing catalog leaves the list is a decision a person records in
// docs/CATALOGS.md, not something a script does at 6am.
//
//   npm run verify:catalogs                     # report to stdout
//   npm run verify:catalogs -- --only <substr>  # entries whose href contains <substr>
//   npm run verify:catalogs -- --report out.md  # also write a Markdown report
//   npm run verify:catalogs -- --stamp          # set verifiedOn=today on entries that pass
//
// Exit code is 1 if any entry fails, so the scheduled workflow turns red.
//
// Per entry, in order:
//   0. tags         — every topic/region/publisher/kind value is in the
//                     vocabularies of src/data/catalogTags.ts (offline)
//   1. reachable    — GET the root with an Origin header, 2xx within the timeout
//   2. cors         — Access-Control-Allow-Origin present (`*` or the origin);
//                     without it no browser-side app can open the catalog
//   3. stac         — body parses as JSON and carries `stac_version`
//   4. kind         — the declared `kind` matches the app's own runtime
//                     detection (`detectSourceKind`): api = advertises a
//                     GET `rel:search`, static = does not
//   5. shape        — static: a breadth-first walk over child links (depth ≤ 3,
//                     ≤ 16 documents) reaches Items (`rel:item`/`rel:items`)
//                     or at least a Collection — the two things the app can
//                     render meaningfully (a Collection shows its extent and
//                     collection-level assets even with no Items; fiboa and
//                     TriMet are like that). Nothing but nested Catalogs, or
//                     untyped documents, within the budget is a warning.
//                     api: the root has `rel:child` links, or `/collections`
//                     answers with a `collections` array — the same order
//                     the app uses.

import { readFileSync, writeFileSync } from 'node:fs'
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net'
import { detectSourceKind, type RawStacObject } from '../src/stac/graph'
import { KINDS, PUBLISHERS, REGIONS, TOPICS } from '../src/data/catalogTags'

interface Entry {
  title: string
  description: string
  href: string
  kind: 'static' | 'api'
  topics: string[]
  regions: string[]
  publisher: string
  addedOn: string
  verifiedOn?: string
}

type Level = 'ok' | 'warn' | 'fail'
interface Result {
  entry: Entry
  level: Level
  notes: string[]
}

const DATA_PATH = new URL('../src/data/catalogs.json', import.meta.url)
const ORIGIN = 'https://staclens.com'
const TIMEOUT_MS = 20_000
const CONCURRENCY = 6
const MAX_DEPTH = 3
const MAX_FETCHES = 16
// Per node, so a root with 130 children (Google Earth Engine) does not spend
// the whole budget on siblings before the walk reaches anything deeper.
const MAX_CHILDREN_PER_NODE = 4

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : (args[i + 1] ?? '')
}
const only = flag('--only')
const reportPath = flag('--report')
const stamp = args.includes('--stamp')

// Node's fetch tries each address family for only 250 ms before moving on
// (Happy Eyeballs); a host that needs ~300 ms to complete a TCP handshake
// reports ETIMEDOUT even though curl and every browser open it in under a
// second. Two entries (vims.univ-nantes.fr, esa.pages.eox.at) hit exactly
// this. Give each attempt the time a browser would.
setDefaultAutoSelectFamilyAttemptTimeout(2000)

const entries: Entry[] = JSON.parse(readFileSync(DATA_PATH, 'utf8'))
const selected = only ? entries.filter((e) => e.href.includes(only)) : entries

interface Fetched {
  status: number
  cors: boolean
  body?: RawStacObject & { stac_version?: string; conformsTo?: string[]; collections?: unknown[] }
  error?: string
}

async function fetchStac(url: string): Promise<Fetched> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers: { Origin: ORIGIN, Accept: 'application/json' }, signal: ctrl.signal })
    const acao = res.headers.get('access-control-allow-origin')
    const cors = acao === '*' || acao === ORIGIN
    let body: Fetched['body']
    try {
      body = (await res.json()) as Fetched['body']
    } catch {
      return { status: res.status, cors, error: 'body is not JSON' }
    }
    return { status: res.status, cors, body }
  } catch (e) {
    return { status: 0, cors: false, error: e instanceof Error && e.name === 'AbortError' ? 'timeout' : String(e) }
  } finally {
    clearTimeout(timer)
  }
}

function resolveHref(href: string, base: string): string {
  return new URL(href, base).href
}

function links(body: RawStacObject | undefined, rel: string) {
  return (body?.links ?? []).filter((l) => l.rel === rel && l.href)
}

/** Static catalogs: breadth-first over `child`/`collection` links, at most
 *  MAX_DEPTH deep and MAX_FETCHES documents in total. Breadth-first because
 *  a catalog's *first* child is often an empty or unusual collection while
 *  its siblings are full, and capped per node so a wide root cannot
 *  exhaust the budget on one level. Returns `{ ok: true }` as soon as Items are
 *  found, or — after the walk — if any Collection was reached. */
async function findShape(root: RawStacObject, rootHref: string): Promise<{ ok: boolean; note: string }> {
  let frontier: { node: RawStacObject; href: string; depth: number }[] = [{ node: root, href: rootHref, depth: 0 }]
  let fetched = 0
  let collectionDepth: number | undefined
  while (frontier.length > 0) {
    const nextFrontier: typeof frontier = []
    for (const { node, href, depth } of frontier) {
      if (links(node, 'item').length > 0) return { ok: true, note: `rel:item at depth ${depth}` }
      if (links(node, 'items').length > 0) return { ok: true, note: `rel:items at depth ${depth}` }
      if (node.type === 'Collection' && collectionDepth === undefined) collectionDepth = depth
      if (depth >= MAX_DEPTH) continue
      for (const child of [...links(node, 'child'), ...links(node, 'collection')].slice(0, MAX_CHILDREN_PER_NODE)) {
        if (fetched >= MAX_FETCHES) break
        fetched++
        const childHref = resolveHref(child.href!, href)
        const doc = await fetchStac(childHref)
        if (doc.body) nextFrontier.push({ node: doc.body, href: childHref, depth: depth + 1 })
      }
    }
    frontier = nextFrontier
  }
  if (collectionDepth !== undefined) {
    return { ok: true, note: `Collections from depth ${collectionDepth}, no Items within ${fetched} documents` }
  }
  return { ok: false, note: `no Collection or Item within depth ${MAX_DEPTH} (${fetched} documents read)` }
}

/** APIs, mirroring the app: a root with `rel:child` links is walked like a
 *  static tree (NASA CMR STAC's root lists providers this way); only a
 *  root without them relies on the `/collections` listing. */
async function checkApiRoot(root: RawStacObject, rootHref: string): Promise<{ ok: boolean; note: string }> {
  const children = links(root, 'child')
  if (children.length > 0) return { ok: true, note: `${children.length} rel:child links` }
  const data = links(root, 'data')[0]
  const url = data
    ? resolveHref(data.href!, rootHref)
    : new URL('collections', rootHref.endsWith('/') ? rootHref : rootHref + '/').href
  const doc = await fetchStac(url)
  if (!doc.body) return { ok: false, note: `/collections unreadable (${doc.error ?? doc.status})` }
  const n = Array.isArray(doc.body.collections) ? doc.body.collections.length : undefined
  return n === undefined
    ? { ok: false, note: '/collections has no `collections` array' }
    : { ok: true, note: `/collections lists ${n}` }
}

async function verify(entry: Entry): Promise<Result> {
  const notes: string[] = []
  let level: Level = 'ok'
  const bump = (l: Level) => {
    if (l === 'fail' || (l === 'warn' && level === 'ok')) level = l
  }

  // 0. tags — offline; a value outside the vocabularies in catalogTags.ts
  //    makes the record unfilterable, so it is a failure, not a warning.
  const badTags = [
    ...(entry.topics ?? []).filter((t) => !(t in TOPICS)).map((t) => `topic ${t}`),
    ...(entry.regions ?? []).filter((r) => !(r in REGIONS)).map((r) => `region ${r}`),
    ...(entry.publisher in PUBLISHERS ? [] : [`publisher ${entry.publisher}`]),
    ...(entry.kind in KINDS ? [] : [`kind ${entry.kind}`]),
    ...((entry.topics ?? []).length === 0 ? ['no topic'] : []),
  ]
  if (badTags.length > 0) {
    bump('fail')
    notes.push(`unknown tags: ${badTags.join(', ')}`)
  }

  const root = await fetchStac(entry.href)
  if (!root.body || root.status < 200 || root.status >= 300) {
    return { entry, level: 'fail', notes: [`unreachable: ${root.error ?? `HTTP ${root.status}`}`] }
  }
  if (!root.cors) {
    bump('fail')
    notes.push('no CORS header — a browser cannot open it')
  }
  if (!root.body.stac_version) {
    bump('fail')
    notes.push('no stac_version — not a STAC document')
  }

  const detected = detectSourceKind(root.body, entry.href).kind === 'api-search' ? 'api' : 'static'
  if (detected !== entry.kind) {
    bump('warn')
    notes.push(`declared ${entry.kind}, server looks ${detected}`)
  }

  if (detected === 'api') {
    const c = await checkApiRoot(root.body, entry.href)
    if (!c.ok) bump('fail')
    notes.push(c.note)
  } else {
    const shape = await findShape(root.body, entry.href)
    if (!shape.ok) bump('warn')
    notes.push(shape.note)
  }
  return { entry, level, notes }
}

async function runAll(): Promise<Result[]> {
  const results: Result[] = new Array(selected.length)
  let next = 0
  async function worker() {
    while (next < selected.length) {
      const i = next++
      results[i] = await verify(selected[i])
      const r = results[i]
      console.log(`${r.level.padEnd(4)} ${r.entry.title}  —  ${r.notes.join('; ')}`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return results
}

const started = Date.now()
const results = await runAll()
const count = (l: Level) => results.filter((r) => r.level === l).length
const today = new Date().toISOString().slice(0, 10)
const summary = `${results.length} entries — ${count('ok')} ok, ${count('warn')} warn, ${count('fail')} fail (${Math.round((Date.now() - started) / 1000)}s, ${today})`
console.log(`\n${summary}`)

if (reportPath) {
  const rows = results
    .filter((r) => r.level !== 'ok')
    .map((r) => `| ${r.level} | ${r.entry.title} | \`${r.entry.href}\` | ${r.notes.join('; ')} |`)
  const md = [
    `## Known-catalog verification — ${today}`,
    '',
    summary,
    '',
    ...(rows.length
      ? ['| level | catalog | href | notes |', '|---|---|---|---|', ...rows]
      : ['Every entry passed every check.']),
    '',
    'What each check means, and what to do with a failure: docs/CATALOGS.md.',
    '',
  ].join('\n')
  writeFileSync(reportPath, md)
  console.log(`report written to ${reportPath}`)
}

if (stamp) {
  const passed = new Set(results.filter((r) => r.level === 'ok').map((r) => r.entry.href))
  for (const e of entries) if (passed.has(e.href)) e.verifiedOn = today
  writeFileSync(DATA_PATH, JSON.stringify(entries, null, 2) + '\n')
  console.log(`stamped verifiedOn=${today} on ${passed.size} entries`)
}

process.exit(count('fail') > 0 ? 1 : 0)
