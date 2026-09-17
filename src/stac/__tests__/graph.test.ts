import { describe, expect, it } from 'vitest'
import { buildNode, detectSourceKind, resolveHref, type RawStacObject } from '../graph'

const CAT = 'https://example.org/stac/catalog.json'
const COL = 'https://example.org/stac/a/collection.json'
const ROOT = 'https://api.example.org/v1/'

describe('resolveHref', () => {
  it('resolves relative hrefs against the document URL (self-contained catalogs)', () => {
    expect(resolveHref(CAT, './a/collection.json')).toBe(COL)
    expect(resolveHref(CAT, 'a/collection.json')).toBe(COL)
    expect(resolveHref(CAT, '../other.json')).toBe('https://example.org/other.json')
  })

  it('keeps absolute hrefs as they are (published catalogs)', () => {
    expect(resolveHref(CAT, 'https://elsewhere.org/x.json')).toBe('https://elsewhere.org/x.json')
  })
})

describe('buildNode — links', () => {
  it('resolves and dedupes child links', () => {
    const node = buildNode(CAT, {
      type: 'Catalog',
      links: [
        { rel: 'child', href: './a/collection.json' },
        { rel: 'child', href: 'a/collection.json' },
        { rel: 'child', href: './b/catalog.json' },
      ],
    })
    expect(node.childHrefs).toEqual([COL, 'https://example.org/stac/b/catalog.json'])
  })

  it('keeps rel:collection and rel:parent as separate facts and prefers collection as the parent', () => {
    const node = buildNode('https://example.org/stac/items/i.json', {
      type: 'Feature',
      links: [
        { rel: 'collection', href: '../thematic/collection.json' },
        { rel: 'parent', href: '../a/collection.json' },
      ],
      assets: {},
    })
    expect(node.declaredCollectionHref).toBe('https://example.org/stac/thematic/collection.json')
    expect(node.declaredParentHref).toBe(COL)
    expect(node.parentHref).toBe('https://example.org/stac/thematic/collection.json')
  })

  it('records the /collections listing endpoint only for a node with no child links', () => {
    const withData = buildNode(ROOT, { type: 'Catalog', links: [{ rel: 'data', href: './collections' }] })
    expect(withData.collectionsEndpoint).toBe('https://api.example.org/v1/collections')

    const withChildren = buildNode(ROOT, {
      type: 'Catalog',
      links: [
        { rel: 'data', href: './collections' },
        { rel: 'child', href: './collections/x' },
      ],
    })
    expect(withChildren.collectionsEndpoint).toBeUndefined()
  })

  it('records a Children-extension endpoint whenever advertised', () => {
    const node = buildNode(ROOT, {
      type: 'Catalog',
      links: [
        { rel: 'children', href: './children' },
        { rel: 'child', href: './collections/x' },
      ],
    })
    expect(node.childrenEndpoint).toBe('https://api.example.org/v1/children')
  })
})

describe('buildNode — how Items are reached', () => {
  it('a static rel:item list is a finite enumeration', () => {
    const node = buildNode(COL, {
      type: 'Collection',
      extent: {},
      links: [
        { rel: 'item', href: './i1.json' },
        { rel: 'item', href: './i2.json' },
      ],
    })
    expect(node.items).toEqual({
      kind: 'links',
      hrefs: ['https://example.org/stac/a/i1.json', 'https://example.org/stac/a/i2.json'],
    })
  })

  it('a rel:items link is a cursor (never assumed finite)', () => {
    const node = buildNode(ROOT + 'collections/x', {
      type: 'Collection',
      extent: {},
      links: [{ rel: 'items', href: './x/items' }],
    })
    expect(node.items).toEqual({ kind: 'cursor', endpoint: 'https://api.example.org/v1/collections/x/items' })
  })

  it('an API root with only a search link searches through it', () => {
    const node = buildNode(ROOT, { type: 'Catalog', conformsTo: [], links: [{ rel: 'search', href: './search' }] })
    expect(node.items).toEqual({ kind: 'cursor', endpoint: 'https://api.example.org/v1/search' })
  })

  it('nothing at all is an empty, finite list — not an unknown', () => {
    expect(buildNode(CAT, { type: 'Catalog', links: [] }).items).toEqual({ kind: 'links', hrefs: [] })
  })
})

describe('detectSourceKind', () => {
  it('prefers the GET search link when GET and POST are advertised separately', () => {
    const kind = detectSourceKind(
      {
        conformsTo: ['https://api.stacspec.org/v1.0.0/item-search'],
        links: [
          { rel: 'search', href: './search-post', method: 'POST' },
          { rel: 'search', href: './search', method: 'GET' },
        ],
      },
      ROOT,
    )
    expect(kind).toEqual({ kind: 'api-search', searchHref: 'https://api.example.org/v1/search' })
  })

  it('treats a link without method as GET', () => {
    const kind = detectSourceKind({ links: [{ rel: 'search', href: './search' }] }, ROOT)
    expect(kind).toEqual({ kind: 'api-search', searchHref: 'https://api.example.org/v1/search' })
  })

  it('a document with neither conformsTo nor a search link is static', () => {
    expect(detectSourceKind({ links: [{ rel: 'child', href: './a' }] }, CAT)).toEqual({ kind: 'static-links' })
  })
})

describe('buildNode — Collection spatial extent', () => {
  function collection(bbox: number[][]): RawStacObject {
    return { type: 'Collection', extent: { spatial: { bbox } }, links: [] }
  }

  it('takes the first bbox as the overall extent', () => {
    const node = buildNode(COL, collection([[-10, 40, 10, 50]]))
    expect(node.spatial?.bbox).toEqual([-10, 40, 10, 50])
    expect(node.spatial?.bboxCount).toBeUndefined()
  })

  it('records exactly two bboxes — the shape STAC 1.1 reports as invalid', () => {
    // Planetary Computer's 3dep-lidar-returns declares two disjoint boxes (CONUS+Alaska, then Guam).
    const node = buildNode(
      COL,
      collection([
        [-166.85, 17.66, -64.56, 71.39],
        [144.6, 13.22, 146.08, 18.18],
      ]),
    )
    expect(node.spatial?.bbox).toEqual([-166.85, 17.66, -64.56, 71.39])
    expect(node.spatial?.bboxCount).toBe(2)
    expect(node.spatial?.bboxes).toHaveLength(2)
    // The first does not contain the second — the spec's overall-extent rule is broken.
    expect(node.spatial?.firstBboxIsUnion).toBe(false)
  })

  it('keeps every bbox for drawing and knows when the first is the overall extent', () => {
    const node = buildNode(
      COL,
      collection([
        [-180, -90, 180, 90],
        [0, 0, 1, 1],
        [2, 2, 3, 3],
      ]),
    )
    expect(node.spatial?.bboxCount).toBe(3)
    expect(node.spatial?.bboxes).toEqual([
      [-180, -90, 180, 90],
      [0, 0, 1, 1],
      [2, 2, 3, 3],
    ])
    expect(node.spatial?.firstBboxIsUnion).toBe(true)
  })

  it('drops a malformed sub-bbox but keeps the valid ones', () => {
    const node = buildNode(
      COL,
      collection([
        [-10, 40, 10, 50],
        [1, 2],
        [0, 41, 1, 42],
      ]),
    )
    expect(node.spatial?.bboxCount).toBe(3)
    expect(node.spatial?.bboxes).toEqual([
      [-10, 40, 10, 50],
      [0, 41, 1, 42],
    ])
  })

  it('has no spatial extent when the array is malformed', () => {
    expect(
      buildNode(COL, { type: 'Collection', extent: { spatial: { bbox: 'nope' } }, links: [] }).spatial,
    ).toBeUndefined()
  })
})

describe('buildNode — Item geometry', () => {
  it('flags a geometry that is not GeoJSON and keeps the bbox', () => {
    const node = buildNode('https://example.org/i.json', {
      type: 'Feature',
      bbox: [1, 2, 3, 4],
      geometry: [1, 2, 3, 4], // a bare bbox array where a geometry object belongs — seen in the wild
      links: [],
      assets: {},
    })
    expect(node.spatial).toEqual({ bbox: [1, 2, 3, 4], geometryInvalid: true })
  })

  it('accepts a valid geometry', () => {
    const geometry = { type: 'Point', coordinates: [1, 2] }
    const node = buildNode('https://example.org/i.json', {
      type: 'Feature',
      bbox: [1, 2, 1, 2],
      geometry,
      links: [],
      assets: {},
    })
    expect(node.spatial?.geometry).toEqual(geometry)
    expect(node.spatial?.geometryInvalid).toBeUndefined()
  })
})

describe('buildNode — assets', () => {
  const itemWith = (asset: Record<string, unknown>): RawStacObject => ({
    type: 'Feature',
    links: [],
    assets: { a: { href: './a.tif', ...asset } },
  })

  it('resolves asset hrefs against the Item', () => {
    const node = buildNode('https://example.org/items/i.json', itemWith({}))
    expect(node.assets[0].href).toBe('https://example.org/items/a.tif')
  })

  it('reads the data type from STAC 1.1 bands, then asset-level data_type, then 1.0 raster:bands', () => {
    expect(buildNode(CAT, itemWith({ bands: [{ data_type: 'uint8' }] })).assets[0].dataType).toBe('uint8')
    expect(buildNode(CAT, itemWith({ data_type: 'int16' })).assets[0].dataType).toBe('int16')
    expect(buildNode(CAT, itemWith({ 'raster:bands': [{ data_type: 'float32' }] })).assets[0].dataType).toBe('float32')
    expect(
      buildNode(CAT, itemWith({ bands: [{ data_type: 'uint8' }], 'raster:bands': [{ data_type: 'float32' }] }))
        .assets[0].dataType,
    ).toBe('uint8')
    expect(buildNode(CAT, itemWith({})).assets[0].dataType).toBeUndefined()
  })
})

describe('buildNode — Collection-only source fields', () => {
  it('passes license, keywords and providers through for a Collection and not for an Item', () => {
    const col = buildNode(COL, {
      type: 'Collection',
      extent: {},
      links: [],
      license: 'proprietary',
      keywords: ['lidar'],
      providers: [{ name: 'USGS', roles: ['producer'] }],
    })
    expect(col.license).toBe('proprietary')
    expect(col.keywords).toEqual(['lidar'])
    expect(col.providers).toEqual([{ name: 'USGS', roles: ['producer'], description: undefined, url: undefined }])

    const item = buildNode(CAT, { type: 'Feature', links: [], assets: {}, license: 'MIT' })
    expect(item.license).toBeUndefined()
  })
})

describe('buildNode — Solar System extension', () => {
  it("reads ssys fields from a Collection top level and from an Item's properties", () => {
    const coll = buildNode(COL, {
      type: 'Collection',
      links: [],
      'ssys:targets': ['67P/Churyumov-Gerasimenko'],
      'ssys:target_class': 'comet',
    } as unknown as RawStacObject)
    expect(coll.ssysTargets).toEqual(['67P/Churyumov-Gerasimenko'])
    expect(coll.ssysTargetClass).toBe('comet')
    const item = buildNode('https://x/item.json', {
      type: 'Feature',
      properties: { datetime: '2014-08-03T11:29:13Z', 'ssys:targets': ['Titan'] },
      links: [],
    } as unknown as RawStacObject)
    expect(item.ssysTargets).toEqual(['Titan'])
    expect(item.ssysTargetClass).toBeUndefined()
  })

  it('ignores malformed ssys values', () => {
    const coll = buildNode(COL, { type: 'Collection', links: [], 'ssys:targets': 'Mars' } as unknown as RawStacObject)
    expect(coll.ssysTargets).toBeUndefined()
  })
})
