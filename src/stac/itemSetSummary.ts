import type { StacNode } from './types'

/** What's actually common across a set of Items — declared extensions and
 *  observed property namespaces, via a real intersection ("what do all of
 *  them share"). This file used to also compute a combined temporal range
 *  and a spatial union bbox (the *right* aggregation for those two fields
 *  specifically — a literal intersection of timestamps or bboxes across a
 *  real Item Set is almost always empty and never what anyone wants), but
 *  both became dead computation once the Temporal/Spatial Inspector
 *  widgets started showing that same information visually instead
 *  (docs/DESIGN.md §39/§41) — removed rather than left computed for
 *  nothing. */
export interface ItemSetSummary {
  /** Present in every single member — empty when the set has zero common
   *  extensions, which is a real, honest possible outcome, not an error. */
  commonExtensions: string[]
  commonNamespaces: string[]
}

function intersect(sets: string[][]): string[] {
  if (sets.length === 0) return []
  let result = new Set(sets[0])
  for (const s of sets.slice(1)) {
    const next = new Set(s)
    result = new Set([...result].filter((x) => next.has(x)))
    if (result.size === 0) break
  }
  return [...result].sort()
}

export function summarizeItemSet(items: StacNode[]): ItemSetSummary {
  return {
    commonExtensions: intersect(items.map((i) => i.declaredExtensions)),
    commonNamespaces: intersect(items.map((i) => i.propertyNamespaces)),
  }
}
