import { create } from 'zustand'

interface ItemSetStoreState {
  /** href of the Collection/Catalog the current `visibleHrefs` belong to —
   *  consumers must check this matches whatever they're resolving before
   *  trusting `visibleHrefs`, since a stale set from a just-abandoned
   *  selection would otherwise leak into a freshly-selected Collection for
   *  one render before its own Item Set catches up. */
  forHref: string | null
  visibleHrefs: string[]
  setVisible: (forHref: string, hrefs: string[]) => void
}

/** What Item Set (`ItemSetBrowser`, mounted in Detail Panel) currently has
 *  loaded and search-filtered — i.e. "which of this Collection's items are
 *  actually in view right now." Time/Space Lens read this instead of doing
 *  their own independent bulk fetch: selecting a Collection alone shows only
 *  its own stated extent; browsing/searching in Item Set is what populates
 *  individual marks/footprints. See docs/DESIGN.md §21. */
export const useItemSetStore = create<ItemSetStoreState>((set) => ({
  forHref: null,
  visibleHrefs: [],
  setVisible: (forHref, hrefs) => set({ forHref, visibleHrefs: hrefs }),
}))
