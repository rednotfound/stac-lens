import { createContext, useContext } from 'react'
import type { StructureTreeState } from './useStructureTree'

/** The shared structure state of the open catalog — provided once by
 *  `StructureProvider` (components/StructureProvider.tsx), read by every
 *  view. In its own file so the provider file exports only a component. */
export const StructureContext = createContext<StructureTreeState | null>(null)

export function useStructure(): StructureTreeState {
  const state = useContext(StructureContext)
  if (!state) throw new Error('useStructure must be used inside <StructureProvider> (the explorer)')
  return state
}
