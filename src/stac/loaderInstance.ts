import { StacLoader } from './loader'

// Single shared cache for the whole app session. The loader is a pure
// href-keyed cache with no other state, so one instance is fine — this
// isn't a place selection/UI state lives.
export const loader = new StacLoader()
