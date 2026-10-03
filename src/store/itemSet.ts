import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { SearchFilter } from '../stac/apiSearch'
/** The Items panel's width before the user has dragged its divider. */
export const DEFAULT_ITEMS_PANEL_WIDTH = 400

interface ItemSetStoreState {
  /** href of the Collection/Catalog the current `visibleHrefs` belong to —
   *  consumers must check this matches whatever they're resolving before
   *  trusting `visibleHrefs`, since a stale set from a just-abandoned
   *  selection would otherwise leak into a freshly-selected Collection for
   *  one render before its own Item Set catches up. */
  forHref: string | null
  visibleHrefs: string[]
  /** 0-based page the panel is on, published with `visibleHrefs`, for
   *  views that name the page ("+30 more on this page · page 2"). */
  pageIndex: number
  setVisible: (forHref: string, hrefs: string[], pageIndex?: number) => void
  /** Whether the currently-visible items are also being shown on Time/Space
   *  Lens — a plain feature toggle, *not* a "selection" of Item Set as its
   *  own object (deliberately no `aggregateSelected` field and no synthetic
   *  selectable href for Item Set). The reason: STAC's own architecture
   *  only has three real objects — Item, Catalog, Collection — so each gets
   *  its own dedicated Inspector, and at that point "Item Set" is not
   *  needed as a concept of its own.
   *
   *  There is currently no UI anywhere that sets this to `true`. A toggle
   *  button in the Collection Inspector would be redundant with the
   *  always-on Temporal/Spatial widgets it would feed, and the Inspector
   *  has no "Provided by this app" section for it to live in
   *  (docs/DESIGN.md, "Retiring 'Provided by this app' as its own
   *  section"); the button is meant to land somewhere else instead.
   *
   *  Reset to `false` whenever the tree-embedded browse panel (rendered
   *  inline in Structure Lens — `LinksItemSetBrowser` for a static
   *  catalog, `CursorItemSetPanels` for an API-backed Collection) (re)mounts
   *  for any node — see `useResetShowOnLenses` in `ItemSetBrowser.tsx`, not
   *  this store — deliberately *not* keyed
   *  off whether `forHref` itself changed: browsing through an intermediate
   *  Collection with no direct items of its own never calls `setVisible` at
   *  all, which left a stale `true` surviving a round trip back to the same
   *  Item Set (confirmed directly via Playwright before this fix). Tying
   *  the reset to the browser component's own lifecycle instead — it fully
   *  unmounts/remounts every time `browsingHref` changes, regardless of
   *  whether the new target has items — closes that gap at the actual
   *  source. */
  showOnLenses: boolean
  setShowOnLenses: (v: boolean) => void
  /** The API search currently applied to `forHref`'s Item Set box, if it's
   *  a cursor-mode (API-backed) Collection — `undefined` for a static
   *  catalog, or a cursor-mode Collection with no filter applied. Read by
   *  `App.tsx` to encode into the shareable-URL query string
   *  (`useShareableUrlSync`). Kept in this same store, not a separate one,
   *  since it's just one more fact about the same "currently open Item Set
   *  box" concept `visibleHrefs` already owns. */
  appliedQuery: SearchFilter | undefined
  setAppliedQuery: (forHref: string, query: SearchFilter | undefined) => void
  /** A query restored off a deep-linked/back-forward-navigated shareable
   *  URL, waiting to be picked up once the matching `CursorItemSetPanels`
   *  mounts — see `consumePendingInitialQuery`. Cleared the moment it's
   *  read, since it's meant as a one-shot "apply this on your very first
   *  render," not an ongoing synced value (that's `appliedQuery`'s job). */
  pendingInitialQuery: { forHref: string; query: SearchFilter } | null
  setPendingInitialQuery: (forHref: string, query: SearchFilter) => void
  /** Reads and clears `pendingInitialQuery` in one step, only if it's for
   *  the given `forHref` — `CursorItemSetPanels` calls this exactly once,
   *  from a `useState` initializer, so a stale pending query destined for a
   *  since-abandoned Collection is never silently picked up by a different
   *  one later. */
  consumePendingInitialQuery: (forHref: string) => SearchFilter | undefined
  /** Whether the Items panel — the docked column that shows the browsed
   *  Collection's Item Set beside every view — is showing. Opened again
   *  on every act of selecting a node with Items to list (`App`); hidden
   *  from its header toggle until then. Not persisted. */
  panelOpen: boolean
  setPanelOpen: (open: boolean) => void
  /** The panel's width in pixels, as the user last left it by dragging
   *  its divider. Persisted per browser. */
  panelWidth: number
  setPanelWidth: (width: number) => void
}

/** What the tree-embedded browse panel (rendered inline in Structure Lens
 *  at a Collection's own position — `LinksItemSetBrowser` or
 *  `CursorItemSetPanels`, depending on `node.items.kind`) currently has
 *  loaded and search-filtered — i.e. "which items are actually in view
 *  right now." Time/Space Lens read this instead of doing their own independent
 *  bulk fetch, and only once `showOnLenses` is on; the Collection
 *  Inspector's own Declared-extensions/Property-namespaces fields also
 *  read it (via `visibleHrefs`) to annotate what's common across the
 *  browsed set, regardless of `showOnLenses`. */
export const useItemSetStore = create<ItemSetStoreState>()(
  persist(
    (set, get) => ({
      forHref: null,
      visibleHrefs: [],
      pageIndex: 0,
      showOnLenses: false,
      appliedQuery: undefined,
      pendingInitialQuery: null,
      panelOpen: true,
      panelWidth: DEFAULT_ITEMS_PANEL_WIDTH,
      setPanelOpen: (open) => set({ panelOpen: open }),
      setPanelWidth: (width) => set({ panelWidth: width }),
      setVisible: (forHref, hrefs, pageIndex = 0) =>
        set((state) => ({
          forHref,
          visibleHrefs: hrefs,
          pageIndex,
          // Switching to a *different* box (a new `forHref`) must not let a
          // stale `appliedQuery` from the abandoned one survive — otherwise
          // switching from a just-searched API Collection to a plain static
          // Collection would leak the old query into the new one's shareable
          // URL, since the `forHref === browsingHref` freshness check would
          // wrongly pass. `CursorItemSetPanels`'s own `setAppliedQuery` call
          // re-asserts the real value right after, in the same commit (see
          // its `usePublishAppliedQuery`), so there's no observable gap.
          appliedQuery: forHref === state.forHref ? state.appliedQuery : undefined,
        })),
      setShowOnLenses: (v) => set({ showOnLenses: v }),
      setAppliedQuery: (forHref, query) =>
        set((state) => (forHref === state.forHref ? { appliedQuery: query } : state)),
      setPendingInitialQuery: (forHref, query) => set({ pendingInitialQuery: { forHref, query } }),
      consumePendingInitialQuery: (forHref) => {
        const pending = get().pendingInitialQuery
        if (!pending || pending.forHref !== forHref) return undefined
        set({ pendingInitialQuery: null })
        return pending.query
      },
    }),
    {
      name: 'stac-lens.items-panel',
      version: 1,
      // Only the panel's width is remembered; everything else here is
      // live state for one session. A throwing `localStorage` (blocked site
      // data) makes `createJSONStorage` return no storage, and the store
      // simply runs in memory.
      storage: createJSONStorage(() => {
        if (typeof localStorage === 'undefined') throw new Error('localStorage unavailable')
        return localStorage
      }),
      partialize: (state) => ({ panelWidth: state.panelWidth }),
      // A stored width that is not a positive number (hand-edited, an older
      // shape) falls back to the default instead of making the panel NaN.
      merge: (persisted, current) => {
        const w = (persisted as { panelWidth?: unknown } | undefined)?.panelWidth
        return { ...current, panelWidth: typeof w === 'number' && w > 0 ? w : DEFAULT_ITEMS_PANEL_WIDTH }
      },
    },
  ),
)
