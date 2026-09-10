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
   *  disagree with the Collection you actually found it through (§15) —
   *  Capella cross-lists the same Item under both a product-type facet
   *  (e.g. "SLC") and a use-case facet (e.g. "Environmental"), and only one
   *  is the spec-authoritative `collection`. Before this existed, selecting
   *  such an Item from "SLC"'s Item Set silently re-targeted Structure
   *  Tree/Time/Space Lens to "Environmental" instead — technically correct
   *  per STAC's single-parent philosophy, but disorienting in practice:
   *  the box you were just browsing vanishes, Time/Space Lens both show
   *  "0 items" (a Collection you hadn't browsed yet), and the tree jumps to
   *  a part of the hierarchy you weren't looking at — reported directly as
   *  "我就lost掉了" (I got lost). See docs/DESIGN.md §21. */
  browsingHref: string | null
  select: (href: string | null) => void
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedHref: null,
  browsingHref: null,
  select: (href) =>
    set((state) => {
      if (!href) return { selectedHref: null, browsingHref: null }
      const node = loader.get(href)
      const isItem = node?.type === 'Item'
      return {
        selectedHref: href,
        browsingHref: isItem ? (state.browsingHref ?? node?.parentHref ?? null) : href,
      }
    }),
}))
