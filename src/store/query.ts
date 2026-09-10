import { create } from 'zustand'

export interface QueryBbox {
  west: number
  south: number
  east: number
  north: number
}

interface QueryState {
  /** Drawn on Space Lens / dragged on Time Lens — live as you draw, not
   *  applied to an actual request until `triggerSearch` bumps
   *  `searchNonce`. Deliberately manual, not live-as-you-drag: a query
   *  against a real API (Earth Search's Sentinel-2 collection alone
   *  reports 51M+ Items) firing on every mouse-move while drawing would be
   *  wasteful and, for a rate-limited or metered API, actually costly. */
  bbox: QueryBbox | null
  datetimeStart: string | null
  datetimeEnd: string | null
  searchNonce: number
  /** Which draw tool is currently "armed" — `'bbox'` while Space Lens
   *  should be listening for a drag-to-draw gesture, `'datetime'` while
   *  Time Lens should be listening for a drag-to-select gesture, `null`
   *  otherwise. The single source of truth for that on/off state, not a
   *  local `useState` inside each Lens — Item Set's own query section can
   *  now arm the same tool Space/Time Lens's own "Draw area"/"Select
   *  range" buttons do, so there's exactly one place either entry point
   *  needs to agree on. Asked for directly: "为什么不能将search bar...放入
   *  item set里面...一定要分两块？" (why can't the search bar live inside
   *  Item Set — does it have to be two separate places?) — the actual
   *  drag gesture still has to happen on a real map/timeline (§27), but
   *  where you *start* it no longer has to. */
  drawRequest: 'bbox' | 'datetime' | null
  setBbox: (bbox: QueryBbox | null) => void
  setDatetimeRange: (start: string | null, end: string | null) => void
  clearDraft: () => void
  triggerSearch: () => void
  requestDraw: (tool: 'bbox' | 'datetime') => void
  clearDrawRequest: () => void
}

export const useQueryStore = create<QueryState>((set) => ({
  bbox: null,
  datetimeStart: null,
  datetimeEnd: null,
  searchNonce: 0,
  drawRequest: null,
  setBbox: (bbox) => set({ bbox }),
  setDatetimeRange: (datetimeStart, datetimeEnd) => set({ datetimeStart, datetimeEnd }),
  clearDraft: () => set({ bbox: null, datetimeStart: null, datetimeEnd: null }),
  triggerSearch: () => set((s) => ({ searchNonce: s.searchNonce + 1 })),
  requestDraw: (tool) => set((s) => ({ drawRequest: s.drawRequest === tool ? null : tool })),
  clearDrawRequest: () => set({ drawRequest: null }),
}))
