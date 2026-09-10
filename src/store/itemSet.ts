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
  /** Whether the user has explicitly selected "all currently visible items"
   *  as their own selection — the Item Set's own selected/unselected state,
   *  distinct from merely having it open or loaded. Opening/browsing a
   *  Collection used to publish `visibleHrefs` straight to Time/Space Lens
   *  the moment its first page loaded, with no action of the user's own in
   *  between — reported directly: "选择了collection这个节点,他就不应该看到
   *  collection下面所有的item...它得单独做一个对象可以去选它" (selecting the
   *  Collection node shouldn't show every Item under it — [the Item Set]
   *  needs to be its own separate object you can actually select). Reset to
   *  `false` whenever `ItemSetBrowser` (re)mounts for any node — see its own
   *  mount effect, not this store — deliberately *not* keyed off whether
   *  `forHref` itself changed: browsing through an intermediate Collection
   *  with no direct items of its own never calls `setVisible` at all, which
   *  left a stale `true` surviving a round trip back to the same Item Set
   *  (confirmed directly via Playwright before this fix). Tying the reset
   *  to the browser component's own lifecycle instead — it fully unmounts/
   *  remounts every time `browsingHref` changes, regardless of whether the
   *  new target has items — closes that gap at the actual source. */
  aggregateSelected: boolean
  setAggregateSelected: (v: boolean) => void
}

/** What Item Set (`ItemSetBrowser`, mounted in Detail Panel) currently has
 *  loaded and search-filtered — i.e. "which of this Collection's items are
 *  actually in view right now." Time/Space Lens read this instead of doing
 *  their own independent bulk fetch: selecting a Collection alone shows only
 *  its own stated extent; browsing/searching in Item Set is what populates
 *  individual marks/footprints, and only once `aggregateSelected` is true —
 *  see docs/DESIGN.md §21 and its update in the same section for this
 *  explicit-selection requirement. */
export const useItemSetStore = create<ItemSetStoreState>((set) => ({
  forHref: null,
  visibleHrefs: [],
  aggregateSelected: false,
  setVisible: (forHref, hrefs) => set({ forHref, visibleHrefs: hrefs }),
  setAggregateSelected: (v) => set({ aggregateSelected: v }),
}))
