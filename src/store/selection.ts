import { create } from 'zustand'
import { loader } from '../stac/loaderInstance'

// The one sync point between lenses: whichever node is currently selected.
// Structure Lens sets it on click; Time Lens (once built) will read and
// set it the same way, so neither lens needs to know about the other.
interface SelectionState {
  selectedHref: string | null
  /** The Catalog/Collection currently being *browsed* — distinct from
   *  `selectedHref`, which can drill down to one specific Item within it.
   *  Only changes when you select a Catalog/Collection directly; picking
   *  different Items (via Item Set, Time Lens, or Space Lens marks) leaves
   *  it pinned, rather than re-deriving it from each Item's own resolved
   *  `parentHref` every time.
   *
   *  This exists because an Item's canonical `rel:collection` can genuinely
   *  disagree with the Collection you actually found it through
   *  (docs/DESIGN.md, "An Item's parent is singular") —
   *  Capella cross-lists the same Item under both a product-type facet
   *  (e.g. "SLC") and a use-case facet (e.g. "Environmental"), and only one
   *  is the spec-authoritative `collection`. Without this pin, selecting
   *  such an Item from "SLC"'s Item Set would silently re-target Structure
   *  Tree/Time/Space Lens to "Environmental" instead — technically correct
   *  per STAC's single-parent philosophy, but disorienting in practice:
   *  the box you were just browsing vanishes, Time/Space Lens both show
   *  "0 items" (a Collection you hadn't browsed yet), and the tree jumps to
   *  a part of the hierarchy you weren't looking at — a reported problem,
   *  not a guess: the user lost their place. See docs/DESIGN.md, "Items
   *  removed from Structure Lens entirely". */
  browsingHref: string | null
  /** Counts every `select` call, including one that re-selects what is
   *  already selected. A selection is an *act*, and some things answer the
   *  act rather than the value: the Items panel reopens when a Collection
   *  is clicked again after being closed, which `browsingHref` alone can
   *  never say. */
  selectSeq: number
  /** `keepBrowsing`: select a Catalog/Collection without browsing it — a
   *  row of the Collections list, which must stay on screen while one
   *  Collection after another is looked at (DESIGN §128), as an Item
   *  picked from a search's results keeps its Collection browsed. */
  select: (href: string | null, opts?: { keepBrowsing?: boolean }) => void
  /** Browse a node without selecting anything: an opened catalog's root,
   *  so its contents (the Collections list of an API root's hundreds of
   *  Collections) are there from the start while the Inspector waits for a
   *  selection (DESIGN §128). Only when nothing is selected. */
  browse: (href: string) => void
}

export const useSelectionStore = create<SelectionState>((set) => ({
  browse: (href) => set((state) => (state.selectedHref ? state : { browsingHref: href })),
  selectedHref: null,
  browsingHref: null,
  selectSeq: 0,
  select: (href, opts) =>
    set((state) => {
      if (!href) return { selectedHref: null, browsingHref: null, selectSeq: state.selectSeq + 1 }
      const node = loader.get(href)
      const isItem = node?.type === 'Item'
      const keep = isItem || (opts?.keepBrowsing && state.browsingHref)
      return {
        selectedHref: href,
        browsingHref: keep ? (state.browsingHref ?? node?.parentHref ?? null) : href,
        selectSeq: state.selectSeq + 1,
      }
    }),
}))
