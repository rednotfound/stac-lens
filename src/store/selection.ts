import { create } from 'zustand'

// The one sync point between lenses: whichever node is currently selected.
// Structure Lens sets it on click; Time Lens (once built) will read and
// set it the same way, so neither lens needs to know about the other.
interface SelectionState {
  selectedHref: string | null
  select: (href: string | null) => void
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedHref: null,
  select: (href) => set({ selectedHref: href }),
}))
