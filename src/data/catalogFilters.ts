import { FACETS, type FacetId } from './catalogTags'
import type { KnownCatalog } from './knownCatalogs'

/** Selected values per facet. Within a facet the selection is a union (any
 *  selected topic matches); across facets it is an intersection. An empty
 *  set means "no filter on this facet". */
export type FacetSelection = Record<FacetId, ReadonlySet<string>>

export const EMPTY_SELECTION: FacetSelection = {
  kind: new Set(),
  topics: new Set(),
  regions: new Set(),
  publisher: new Set(),
}

export function isSelectionEmpty(sel: FacetSelection): boolean {
  return Object.values(sel).every((s) => s.size === 0)
}

export function toggleFacetValue(sel: FacetSelection, facet: FacetId, value: string): FacetSelection {
  const next = new Set(sel[facet])
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return { ...sel, [facet]: next }
}

/** A catalog's values for one facet, always as an array so the two
 *  single-valued facets (`kind`, `publisher`) and the two list-valued ones
 *  read the same way. */
export function facetValues(cat: KnownCatalog, facet: FacetId): readonly string[] {
  switch (facet) {
    case 'kind':
      return [cat.kind]
    case 'publisher':
      return [cat.publisher]
    case 'topics':
      return cat.topics
    case 'regions':
      return cat.regions
  }
}

/** The labels of every facet value a catalog carries, joined — so a search
 *  for "elevation", "Europe" or "commercial" finds catalogs tagged that
 *  way even when the word is not in their title or description. People
 *  search for concepts, not only names. */
function tagText(cat: KnownCatalog): string {
  return FACETS.flatMap((f) => facetValues(cat, f.id).map((v) => f.values[v] ?? v)).join(' ')
}

export function matchesText(cat: KnownCatalog, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    cat.title.toLowerCase().includes(q) ||
    cat.description.toLowerCase().includes(q) ||
    cat.href.toLowerCase().includes(q) ||
    tagText(cat).toLowerCase().includes(q)
  )
}

function matchesFacet(cat: KnownCatalog, facet: FacetId, selected: ReadonlySet<string>): boolean {
  if (selected.size === 0) return true
  return facetValues(cat, facet).some((v) => selected.has(v))
}

export function matchesFacets(cat: KnownCatalog, sel: FacetSelection, except?: FacetId): boolean {
  return (Object.keys(sel) as FacetId[]).every((f) => f === except || matchesFacet(cat, f, sel[f]))
}

/** Counts shown on the chips of one facet: how many catalogs each value
 *  would leave if it were the *only* selection in this facet, given the
 *  text query and every other facet's current selection. Standard faceted
 *  search behavior — a facet's own selection never shrinks its own counts,
 *  so the user can see what else they could add. */
export function facetCounts(
  catalogs: readonly KnownCatalog[],
  query: string,
  sel: FacetSelection,
  facet: FacetId,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const cat of catalogs) {
    if (!matchesText(cat, query) || !matchesFacets(cat, sel, facet)) continue
    for (const v of facetValues(cat, facet)) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return counts
}

export function filterCatalogs(catalogs: readonly KnownCatalog[], query: string, sel: FacetSelection): KnownCatalog[] {
  return catalogs.filter((cat) => matchesText(cat, query) && matchesFacets(cat, sel))
}
