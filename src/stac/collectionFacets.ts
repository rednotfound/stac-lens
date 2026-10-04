import type { StacNode } from './types'

/** Finding the right Collection among many (DESIGN §128): a text filter and
 *  four facets, every value read from what each Collection itself declares —
 *  nothing grouped or named by this app. Pure, so the list, the counts and
 *  the views' highlighting all come from the same functions. */

export type CollectionFacetId = 'keywords' | 'providers' | 'platforms' | 'licenses'

export const COLLECTION_FACETS: {
  id: CollectionFacetId
  label: string
  /** How several selected values combine. Keywords narrow (a Collection
   *  must carry all of them — free tags pile up, as in STAC Browser); the
   *  others widen (a Collection has one license, so "any of" is the only
   *  useful reading). */
  combine: 'all' | 'any'
  source: string
}[] = [
  { id: 'keywords', label: 'Keywords', combine: 'all', source: 'keywords' },
  { id: 'providers', label: 'Providers', combine: 'any', source: 'providers[].name' },
  { id: 'platforms', label: 'Platform / constellation', combine: 'any', source: 'summaries.platform, constellation' },
  { id: 'licenses', label: 'License', combine: 'any', source: 'license' },
]

export interface CollectionFilter {
  text: string
  selected: Record<CollectionFacetId, readonly string[]>
}

export const EMPTY_COLLECTION_FILTER: CollectionFilter = {
  text: '',
  selected: { keywords: [], providers: [], platforms: [], licenses: [] },
}

export function isFilterActive(f: CollectionFilter): boolean {
  return !!f.text.trim() || Object.values(f.selected).some((v) => v.length > 0)
}

/** Facet values are compared case-insensitively ("Sentinel" and
 *  "sentinel" are one keyword in practice); the key is the lower-cased,
 *  trimmed value. */
export function facetKey(value: string): string {
  return value.trim().toLowerCase()
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  return []
}

/** A Collection's raw values for one facet, as declared. */
export function rawFacetValues(node: StacNode, facet: CollectionFacetId): string[] {
  switch (facet) {
    case 'keywords':
      return node.keywords ?? []
    case 'providers':
      return (node.providers ?? []).map((p) => p.name).filter(Boolean)
    case 'platforms': {
      const s = node.schemaHints?.summaries
      return [...strings(s?.platform), ...strings(s?.constellation)]
    }
    case 'licenses':
      return node.license ? [node.license] : []
  }
}

function facetKeys(node: StacNode, facet: CollectionFacetId): Set<string> {
  return new Set(rawFacetValues(node, facet).map(facetKey).filter(Boolean))
}

/** Free text over what a person would recognize a Collection by: title, id,
 *  description and keywords — the fields STAC API Collection Search's `q`
 *  is recommended to match. Every word must appear somewhere. */
export function matchesCollectionText(node: StacNode, text: string): boolean {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const hay = [node.title ?? '', node.id, node.description ?? '', ...(node.keywords ?? [])].join(' \n ').toLowerCase()
  return words.every((w) => hay.includes(w))
}

function matchesFacet(node: StacNode, facet: CollectionFacetId, selected: readonly string[]): boolean {
  if (selected.length === 0) return true
  const keys = facetKeys(node, facet)
  const combine = COLLECTION_FACETS.find((f) => f.id === facet)!.combine
  return combine === 'all' ? selected.every((v) => keys.has(v)) : selected.some((v) => keys.has(v))
}

export function matchesCollection(node: StacNode, f: CollectionFilter, exceptFacet?: CollectionFacetId): boolean {
  if (!matchesCollectionText(node, f.text)) return false
  return COLLECTION_FACETS.every(
    (facet) => facet.id === exceptFacet || matchesFacet(node, facet.id, f.selected[facet.id]),
  )
}

export function filterCollections(nodes: readonly StacNode[], f: CollectionFilter): StacNode[] {
  return nodes.filter((n) => matchesCollection(n, f))
}

export interface FacetCount {
  key: string
  /** The spelling most Collections use for this value. */
  label: string
  count: number
}

/** One facet's values with counts: how many Collections declare each value,
 *  among those the text and the *other* facets leave — standard faceted
 *  search, so a facet's own selection never hides what else it offers. For
 *  "all of" keywords the facet's own selection does apply: each further
 *  keyword can only narrow, and a count that ignored it would promise
 *  Collections the list cannot show. Most common first, then by name. */
export function collectionFacetCounts(
  nodes: readonly StacNode[],
  f: CollectionFilter,
  facet: CollectionFacetId,
): FacetCount[] {
  const combine = COLLECTION_FACETS.find((x) => x.id === facet)!.combine
  const counts = new Map<string, number>()
  const spellings = new Map<string, Map<string, number>>()
  for (const node of nodes) {
    if (!matchesCollection(node, f, combine === 'any' ? facet : undefined)) continue
    const seen = new Set<string>()
    for (const raw of rawFacetValues(node, facet)) {
      const key = facetKey(raw)
      if (!key || seen.has(key)) continue
      seen.add(key)
      counts.set(key, (counts.get(key) ?? 0) + 1)
      const s = spellings.get(key) ?? new Map<string, number>()
      s.set(raw.trim(), (s.get(raw.trim()) ?? 0) + 1)
      spellings.set(key, s)
    }
  }
  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      count,
      label: [...spellings.get(key)!.entries()].sort((a, b) => b[1] - a[1])[0][0],
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export function toggleFacetSelection(f: CollectionFilter, facet: CollectionFacetId, key: string): CollectionFilter {
  const cur = f.selected[facet]
  const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]
  return { ...f, selected: { ...f.selected, [facet]: next } }
}
