import type { StacNode } from './types'

/** Which world a node's coordinates belong to.
 *
 *  Almost every STAC dataset observes Earth, and its `bbox`/`geometry` are
 *  Earth longitude/latitude — so the app draws them on an Earth map. Not
 *  all: the Solar System extension (`ssys`) exists precisely for data about
 *  other bodies. `ssys:targets` names the body (or bodies) — "Titan",
 *  "Mars", "67P/Churyumov-Gerasimenko" — and `ssys:target_class` its kind
 *  (planet, satellite, comet, asteroid, …). Such coordinates are
 *  body-fixed lon/lat on *that* surface; drawn over OpenStreetMap tiles
 *  they would be a lie (Rosetta's comet extent `[-180, -90, 180, 90]`
 *  rendered as "the whole Earth").
 *
 *  The extension allows the fields on Catalogs, Collections and Items, and
 *  publishers put them where it is least repetitive: CNES's Rosetta
 *  Collection and its Items both carry them; the University of Nantes'
 *  Cassini VIMS *root Catalog* carries `["Titan"]` for everything under
 *  it. So resolution walks up the parent chain, nearest declaration wins.
 *  Only nodes already in the loader's cache are consulted — no fetching
 *  from a render — which in practice is the ancestors the tree has
 *  opened. */
export interface CelestialBody {
  /** As declared, e.g. `["67P/Churyumov-Gerasimenko"]`. */
  targets: string[]
  /** `ssys:target_class`, e.g. "comet", when declared. */
  targetClass?: string
  /** The node whose declaration applied — the node itself or an ancestor. */
  declaredOn: StacNode
}

interface NodeLookup {
  get(href: string): StacNode | undefined
}

export function isEarth(targets: readonly string[]): boolean {
  return targets.length > 0 && targets.every((t) => /^earth$/i.test(t.trim()))
}

/** The nearest `ssys:targets` declaration on `node` or its ancestors, or
 *  `undefined` when there is none or it names Earth (the default world,
 *  which needs no special handling). */
export function resolveBody(node: StacNode | undefined, lookup: NodeLookup): CelestialBody | undefined {
  const seen = new Set<string>()
  let current = node
  while (current && !seen.has(current.href)) {
    seen.add(current.href)
    if (current.ssysTargets && current.ssysTargets.length > 0) {
      if (isEarth(current.ssysTargets)) return undefined
      return { targets: current.ssysTargets, targetClass: current.ssysTargetClass, declaredOn: current }
    }
    current = current.parentHref ? lookup.get(current.parentHref) : undefined
  }
  return undefined
}

/** "67P/Churyumov-Gerasimenko (comet)", "Titan", "Mars, Phobos (planet)". */
export function describeBody(body: CelestialBody): string {
  const names = body.targets.join(', ')
  return body.targetClass ? `${names} (${body.targetClass})` : names
}

/** A stable key for React: a map's coordinate world is fixed at mount, so
 *  a parent re-keys the map when the body changes. */
export function bodyKey(body: CelestialBody | undefined): string {
  return body ? `body:${body.targets.join('|')}` : 'earth'
}
