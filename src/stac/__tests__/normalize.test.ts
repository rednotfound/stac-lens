import { describe, expect, it } from 'vitest'
import { normalizeSpatial } from '../spatial'
import { isOpenEnded, normalizeCollectionTemporalExtent, normalizeItemTemporal, temporalBounds } from '../temporal'

describe('normalizeItemTemporal', () => {
  it('a datetime is an instant', () => {
    expect(normalizeItemTemporal({ datetime: '2020-01-01T00:00:00Z' })).toEqual({
      kind: 'instant',
      at: '2020-01-01T00:00:00Z',
    })
  })

  it("datetime: null with start/end is an interval — STAC's own pattern", () => {
    expect(
      normalizeItemTemporal({
        datetime: null,
        start_datetime: '2020-01-01T00:00:00Z',
        end_datetime: '2020-12-31T00:00:00Z',
      }),
    ).toEqual({ kind: 'interval', start: '2020-01-01T00:00:00Z', end: '2020-12-31T00:00:00Z' })
  })

  it('an interval may be open on either side', () => {
    const ongoing = normalizeItemTemporal({
      datetime: null,
      start_datetime: '2020-01-01T00:00:00Z',
      end_datetime: null,
    })
    expect(ongoing).toEqual({ kind: 'interval', start: '2020-01-01T00:00:00Z', end: null })
    expect(isOpenEnded(ongoing!)).toBe(true)
    expect(temporalBounds(ongoing!)[1]).toBeNull()
  })

  it('nothing temporal at all is undefined, not a fake instant', () => {
    expect(normalizeItemTemporal({ datetime: null })).toBeUndefined()
    expect(normalizeItemTemporal(undefined)).toBeUndefined()
  })
})

describe('normalizeCollectionTemporalExtent', () => {
  it('takes the first interval and keeps null bounds open', () => {
    expect(normalizeCollectionTemporalExtent({ temporal: { interval: [['2012-01-01T00:00:00Z', null]] } })).toEqual({
      kind: 'interval',
      start: '2012-01-01T00:00:00Z',
      end: null,
    })
  })

  it('is undefined for a malformed extent', () => {
    expect(normalizeCollectionTemporalExtent({ temporal: { interval: 'soon' } })).toBeUndefined()
    expect(normalizeCollectionTemporalExtent(undefined)).toBeUndefined()
  })
})

describe('normalizeSpatial', () => {
  it('keeps a valid geometry alongside the bbox', () => {
    const geometry = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    }
    expect(normalizeSpatial({ bbox: [0, 0, 1, 1], geometry })).toEqual({ bbox: [0, 0, 1, 1], geometry })
  })

  it('flags a geometry that is present but not GeoJSON and falls back to the bbox', () => {
    expect(normalizeSpatial({ bbox: [0, 0, 1, 1], geometry: [0, 0, 1, 1] })).toEqual({
      bbox: [0, 0, 1, 1],
      geometryInvalid: true,
    })
    expect(normalizeSpatial({ bbox: [0, 0, 1, 1], geometry: { type: 'Blob' } })).toEqual({
      bbox: [0, 0, 1, 1],
      geometryInvalid: true,
    })
  })

  it('a null geometry is simply absent', () => {
    expect(normalizeSpatial({ bbox: [0, 0, 1, 1], geometry: null })).toEqual({ bbox: [0, 0, 1, 1] })
    expect(normalizeSpatial({ geometry: null })).toBeUndefined()
  })
})
