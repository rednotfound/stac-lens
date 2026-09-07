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
