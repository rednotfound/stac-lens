import { describe, expect, it } from 'vitest'
import { bboxContains, declaredBboxes, firstBboxIsUnion, isValidBbox, normalizeSpatial } from '../spatial'
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

describe("bbox containment (the spec's overall-extent rule)", () => {
  it('contains when every edge is inside, including equal edges', () => {
    expect(bboxContains([-10, 40, 10, 50], [0, 41, 1, 42])).toBe(true)
    expect(bboxContains([-10, 40, 10, 50], [-10, 40, 10, 50])).toBe(true)
    expect(bboxContains([-10, 40, 10, 50], [9, 41, 11, 42])).toBe(false)
  })

  it('compares 3D bboxes on their horizontal four', () => {
    expect(bboxContains([-10, 40, 0, 10, 50, 100], [0, 41, 5, 1, 42, 50])).toBe(true)
  })

  it('never treats an antimeridian-crossing box as a union', () => {
    // goes-cmi style: a box written west > east.
    expect(bboxContains([141.7, -81.3, -180, 81.3], [150, 0, 160, 10])).toBe(false)
  })

  it('firstBboxIsUnion follows from containment', () => {
    expect(
      firstBboxIsUnion([
        [-180, -90, 180, 90],
        [0, 0, 1, 1],
      ]),
    ).toBe(true)
    expect(
      firstBboxIsUnion([
        [-166.85, 17.66, -64.56, 71.39],
        [144.6, 13.22, 146.08, 18.18],
      ]),
    ).toBe(false)
    expect(firstBboxIsUnion([[0, 0, 1, 1]])).toBe(true)
  })

  it('declaredBboxes prefers the full array, falls back to the single bbox', () => {
    expect(declaredBboxes(undefined)).toBeUndefined()
    expect(declaredBboxes({ bbox: [0, 0, 1, 1] })).toEqual([[0, 0, 1, 1]])
    expect(
      declaredBboxes({
        bbox: [0, 0, 1, 1],
        bboxes: [
          [0, 0, 1, 1],
          [2, 2, 3, 3],
        ],
      }),
    ).toEqual([
      [0, 0, 1, 1],
      [2, 2, 3, 3],
    ])
  })
})

describe('isValidBbox', () => {
  it('accepts 4 or 6 finite numbers within range, including west > east', () => {
    expect(isValidBbox([-10, 40, 10, 50])).toBe(true)
    expect(isValidBbox([-10, 40, 0, 10, 50, 100])).toBe(true)
    expect(isValidBbox([141.7, -81.3, -180, 81.3])).toBe(true)
  })
  it('rejects the wrong arity, non-numbers, and out-of-range coordinates', () => {
    expect(isValidBbox([1, 2])).toBe(false)
    expect(isValidBbox([-10, 40, '10', 50])).toBe(false)
    expect(isValidBbox([-190, 40, 10, 50])).toBe(false)
    expect(isValidBbox([-10, 95, 10, 50])).toBe(false)
    expect(isValidBbox('nope')).toBe(false)
  })
})
