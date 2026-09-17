import type { SpatialExtent } from './types'

const VALID_GEOMETRY_TYPES = new Set([
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
  'GeometryCollection',
])

function isValidGeoJsonGeometry(value: unknown): value is GeoJSON.Geometry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const type = (value as { type?: unknown }).type
  return typeof type === 'string' && VALID_GEOMETRY_TYPES.has(type)
}

interface SpatialSource {
  bbox?: unknown
  geometry?: unknown
}

/** Defensive: a real-world fixture (Adaptation Atlas hazard branch) stores
 *  `geometry` as a bare bbox array instead of a GeoJSON geometry object —
 *  a hard spec violation, not an alternate valid form. We detect this and
 *  fall back to bbox-only rather than crashing or silently "fixing" it. */
export function normalizeSpatial(source: SpatialSource | undefined): SpatialExtent | undefined {
  if (!source) return undefined

  const bbox = Array.isArray(source.bbox) ? (source.bbox as number[]) : undefined

  if (source.geometry == null) {
    return bbox ? { bbox } : undefined
  }

  if (isValidGeoJsonGeometry(source.geometry)) {
    return { bbox, geometry: source.geometry }
  }

  return { bbox, geometryInvalid: true }
}

/** A well-formed bbox: 4 or 6 finite numbers, latitudes within ±90,
 *  longitudes within ±180 (HEALTH-RULES I-04 / C-04). West > east is
 *  allowed — that is how an antimeridian-crossing box is written. */
export function isValidBbox(b: unknown): b is number[] {
  if (!Array.isArray(b) || (b.length !== 4 && b.length !== 6)) return false
  if (!b.every((n) => typeof n === 'number' && Number.isFinite(n))) return false
  const [w, s, e, n] = b.length === 6 ? [b[0], b[1], b[3], b[4]] : b
  return Math.abs(w) <= 180 && Math.abs(e) <= 180 && Math.abs(s) <= 90 && Math.abs(n) <= 90
}

/** Does `outer` contain `inner`? Both in [west, south, east, north] order;
 *  6-number (3D) bboxes are compared on their horizontal four. A box that
 *  crosses the antimeridian (west > east) is never treated as containing
 *  anything — the spec's own "first bbox is the overall extent" rule has
 *  no clean meaning across the seam, so it is reported as not-a-union
 *  rather than guessed at. */
export function bboxContains(outer: number[], inner: number[]): boolean {
  const [ow, os, oe, on] = outer.length === 6 ? [outer[0], outer[1], outer[3], outer[4]] : outer
  const [iw, is, ie, in_] = inner.length === 6 ? [inner[0], inner[1], inner[3], inner[4]] : inner
  if (ow > oe) return false
  return iw >= ow && ie <= oe && is >= os && in_ <= on
}

/** The spec's rule for a Collection's `extent.spatial.bbox` array: the
 *  first entry is the overall extent and every further entry lies inside
 *  it. True when that holds (or there is only one bbox). Planetary
 *  Computer's 3dep-lidar-* Collections violate it — CONUS+Alaska first,
 *  then a disjoint Guam box — which is what this exists to surface. */
export function firstBboxIsUnion(bboxes: number[][]): boolean {
  return bboxes.slice(1).every((b) => bboxContains(bboxes[0], b))
}

/** Every bbox a node declares, for drawing: the full array when the
 *  source gave several, else the single one, else nothing. */
export function declaredBboxes(spatial: SpatialExtent | undefined): number[][] | undefined {
  if (!spatial) return undefined
  if (spatial.bboxes && spatial.bboxes.length > 0) return spatial.bboxes
  return spatial.bbox ? [spatial.bbox] : undefined
}
