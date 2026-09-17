import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

/** Per-browser memory for the landing page: catalogs the user starred, and
 *  the roots they opened most recently. Local only — STAC Lens has no
 *  backend and no accounts, so this lives in `localStorage`, the same
 *  choice STAC Browser makes for its favorites. Nothing here is required
 *  for the app to work: with storage unavailable (private window, blocked
 *  site data) the store simply runs in memory for the session.
 *
 *  Favorites are limited to entries of the known-catalog list by decision
 *  (the star lives on the landing card); the title is stored alongside the
 *  href so a favorite still has a name if the list entry is ever removed. */

export interface FavoriteRef {
  href: string
  title: string
}

export interface RecentRef {
  href: string
  title: string
  /** Epoch milliseconds of the most recent open. */
  openedAt: number
}

export const MAX_RECENT = 10

interface LandingPrefsState {
  favorites: FavoriteRef[]
  recent: RecentRef[]
  isFavorite: (href: string) => boolean
  toggleFavorite: (ref: FavoriteRef) => void
  recordOpen: (href: string, title: string) => void
  clearRecent: () => void
}

/** `localStorage` can throw on access (not just on write) when a browser
 *  blocks site data, and is absent outside a browser. `createJSONStorage`
 *  treats a getter that throws as "no storage", and persist then runs the
 *  store in memory with a console warning — the behavior wanted here — so
 *  the getter throws rather than returning nothing. */
function requireLocalStorage(): StateStorage {
  if (typeof localStorage === 'undefined') throw new Error('localStorage unavailable')
  return localStorage
}

export const useLandingPrefsStore = create<LandingPrefsState>()(
  persist(
    (set, get) => ({
      favorites: [],
      recent: [],
      isFavorite: (href) => get().favorites.some((f) => f.href === href),
      toggleFavorite: (ref) =>
        set((state) => ({
          favorites: state.favorites.some((f) => f.href === ref.href)
            ? state.favorites.filter((f) => f.href !== ref.href)
            : [...state.favorites, ref],
        })),
      recordOpen: (href, title) =>
        set((state) => ({
          recent: [{ href, title, openedAt: Date.now() }, ...state.recent.filter((r) => r.href !== href)].slice(
            0,
            MAX_RECENT,
          ),
        })),
      clearRecent: () => set({ recent: [] }),
    }),
    {
      name: 'stac-lens.landing-prefs',
      version: 1,
      storage: createJSONStorage(requireLocalStorage),
      partialize: (state) => ({ favorites: state.favorites, recent: state.recent }),
    },
  ),
)
