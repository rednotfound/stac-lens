import type { TemporalShape } from './types'

export interface TemporalProperties {
  datetime?: string | null
  start_datetime?: string | null
  end_datetime?: string | null
}

/** Normalizes an Item's temporal properties per the STAC spec:
 *  `datetime` set -> instant. `datetime: null` + start/end -> interval,
 *  each bound independently nullable (open-ended / "ongoing" extents). */
export function normalizeItemTemporal(
  props: TemporalProperties | undefined,
): TemporalShape | undefined {
  if (!props) return undefined

  if (props.datetime != null) {
    return { kind: 'instant', at: props.datetime }
  }

  if (props.start_datetime !== undefined || props.end_datetime !== undefined) {
    return {
      kind: 'interval',
      start: props.start_datetime ?? null,
      end: props.end_datetime ?? null,
    }
  }

  return undefined
}

/** Normalizes a Collection's `extent.temporal.interval` (spec: array of
 *  [start, end] pairs, almost always length 1). Takes the first pair. */
export function normalizeCollectionTemporalExtent(extent: unknown): TemporalShape | undefined {
  if (!extent || typeof extent !== 'object') return undefined
  const temporal = (extent as { temporal?: { interval?: unknown } }).temporal
  const interval = temporal?.interval
  if (!Array.isArray(interval) || !Array.isArray(interval[0])) return undefined

  const [start, end] = interval[0] as [string | null, string | null]
  return { kind: 'interval', start: start ?? null, end: end ?? null }
}

/** For UI: does this shape have any bound extending indefinitely? */
export function isOpenEnded(shape: TemporalShape): boolean {
  return shape.kind === 'interval' && (shape.start === null || shape.end === null)
}

/** [start, end] as Date objects for positioning on a time axis. An instant
 *  is a zero-width bound at that instant; a null interval bound is a
 *  genuinely open end, not "unknown" — callers clamp it to whatever domain
 *  they're rendering rather than guessing a date. */
export function temporalBounds(shape: TemporalShape): [Date | null, Date | null] {
  if (shape.kind === 'instant') {
    const at = new Date(shape.at)
    return [at, at]
  }
  return [shape.start ? new Date(shape.start) : null, shape.end ? new Date(shape.end) : null]
}
