import { loader } from './loaderInstance'
import type { StacNode } from './types'

// Both major STAC API spec versions are checked — real deployments lag the
// latest release, and there's no cost to matching either. Sort is declared
// against either the Item Search or the OGC API - Features surface,
// depending on which the implementation builds on.
export const SORT_CONFORMANCE_URIS = [
  'https://api.stacspec.org/v1.0.0/item-search#sort',
  'https://api.stacspec.org/v1.1.0/item-search#sort',
  'https://api.stacspec.org/v1.0.0/ogcapi-features#sort',
  'https://api.stacspec.org/v1.1.0/ogcapi-features#sort',
]

export function supportsSort(conformsTo: string[] | undefined): boolean {
  return !!conformsTo?.some((uri) => SORT_CONFORMANCE_URIS.includes(uri))
}

/** Resolves the `conformsTo` array that actually governs a node's own
 *  search endpoint. Per spec, `conformsTo` is only ever declared on a STAC
 *  API's landing page/root — never repeated on a nested Collection reached
 *  by browsing — so a Collection deep in the tree can't read this off its
 *  own `declaredConformsTo`; it has to find its root via `declaredRootHref`
 *  and read the root's copy instead. Returns `undefined`, not `[]`, when
 *  genuinely unknown (no root link, an unresolvable root, or a root that
 *  itself never declared conformsTo) — callers must treat that as "don't
 *  know" and hide any conformance-gated UI, never guess either way. */
export async function resolveApiConformance(node: StacNode): Promise<string[] | undefined> {
  if (node.declaredConformsTo) return node.declaredConformsTo
  if (!node.declaredRootHref) return undefined
  const cached = loader.get(node.declaredRootHref)
  if (cached) return cached.declaredConformsTo
  try {
    return (await loader.load(node.declaredRootHref)).declaredConformsTo
  } catch {
    return undefined
  }
}
