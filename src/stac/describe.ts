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

/** One degree of latitude — and, at the equator, of longitude — spans
 *  almost exactly 111.32 km on Earth's actual (slightly oblate) surface;
 *  longitude's own span shrinks by `cos(latitude)` moving away from the
 *  equator. Good enough for a UI summary ("≈45,231 km²" next to a drawn
 *  search box) — genuinely more informative than a bare "bbox set" label
 *  ("你有没有可能给一些更多的信息呢" — could you give some more information?),
 *  not a precision geodesy calculation (no ellipsoidal correction, no
 *  antimeridian handling — a box drawn by dragging on a map, via
 *  `BboxPickerModal`, never produces one by construction). */
const KM_PER_DEGREE = 111.32

/** Approximate ground area of a `[west, south, east, north]` bbox, in km². */
export function describeBboxArea(bbox: [number, number, number, number]): string {
  const [west, south, east, north] = bbox
  const midLatRad = ((south + north) / 2) * (Math.PI / 180)
  const widthKm = (east - west) * KM_PER_DEGREE * Math.cos(midLatRad)
  const heightKm = (north - south) * KM_PER_DEGREE
  const areaKm2 = Math.abs(widthKm * heightKm)
  return `≈${Math.round(areaKm2).toLocaleString()} km²`
}

function formatLon(lon: number): string {
  return `${Math.abs(lon).toFixed(1)}°${lon < 0 ? 'W' : 'E'}`
}
function formatLat(lat: number): string {
  return `${Math.abs(lat).toFixed(1)}°${lat < 0 ? 'S' : 'N'}`
}

/** "12.3°W–8.1°W, 4.2°N–9.6°N" — the bbox's own four edges, each labeled
 *  with its hemisphere rather than a bare signed number, so it reads
 *  correctly without the viewer having to remember STAC's own
 *  `[west, south, east, north]` ordering or sign convention. */
export function describeBboxCoords(bbox: [number, number, number, number]): string {
  const [west, south, east, north] = bbox
  return `${formatLon(west)}–${formatLon(east)}, ${formatLat(south)}–${formatLat(north)}`
}
