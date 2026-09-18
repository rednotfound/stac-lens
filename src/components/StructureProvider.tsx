import { StructureContext } from '../hooks/useStructure'
import { useStructureTree } from '../hooks/useStructureTree'

/** One `useStructureTree` instance for the open catalog, shared by every
 *  structure view — the tree, the outline, the icicle, the radial tree.
 *  The hook's state (which nodes are expanded, which are loading) used to
 *  live inside whichever component called it, which was fine while only
 *  one view existed per layout; with a view switcher, expansion has to
 *  survive the switch, so it lives here, above the views, and each view is
 *  a rendering of the same state. Keyed on `rootHref` by the caller so a
 *  new catalog starts clean. */
export function StructureProvider({ rootHref, children }: { rootHref: string; children: React.ReactNode }) {
  const state = useStructureTree(rootHref)
  return <StructureContext.Provider value={state}>{children}</StructureContext.Provider>
}
