import type { TemporalShape } from './types'

/** Plain-text rendering of a temporal shape, for the bare-bones tree UI
 *  before a real Time Lens exists. Open bounds render as "…" rather than
 *  a date, to keep "unbounded" visually distinct from "unknown". */
export function describeTemporal(t: TemporalShape): string {
  if (t.kind === 'instant') return t.at
  const start = t.start ?? '…'
  const end = t.end ?? '…'
  return `${start} → ${end}`
}
