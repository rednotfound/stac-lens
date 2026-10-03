import { describe, expect, it } from 'vitest'
import { awsS3PublicUrl } from '../access/awsS3'
import { planetaryComputerSigning } from '../access/planetaryComputer'
import { accessSourceFor } from '../assetAccess'
import { browserCanOpen, hasEmptyPathSegment } from '../assets'
import { buildNode } from '../graph'
import {
  describeAuthScheme,
  describeStorageScheme,
  resolveAuthScheme,
  resolveStorageScheme,
  s3Bucket,
} from '../schemes'
import type { StacNode } from '../types'

// Shapes taken from real catalogs: Copernicus Data Space declares
// auth:schemes and storage:schemes on the Collection and refers to them
// from Item assets, which also carry an `alternate` https location.
const collection = buildNode('https://stac.example/collections/s2', {
  type: 'Collection',
  id: 's2',
  stac_version: '1.1.0',
  description: 'd',
  license: 'other',
  extent: { spatial: { bbox: [[-180, -90, 180, 90]] }, temporal: { interval: [[null, null]] } },
  links: [],
  'auth:schemes': {
    s3: { type: 's3' },
    oidc: {
      type: 'openIdConnect',
      openIdConnectUrl: 'https://identity.example/realms/x/.well-known/openid-configuration',
    },
  },
  'storage:schemes': {
    eo: { type: 'custom-s3', platform: 'https://eodata.example', title: 'Example S3' },
    pub: {
      type: 'aws-s3',
      platform: 'https://{bucket}.s3.{region}.amazonaws.com',
      bucket: 'open-data',
      region: 'us-west-2',
    },
    rp: {
      type: 'aws-s3',
      platform: 'https://{bucket}.s3.{region}.amazonaws.com',
      bucket: 'paid',
      region: 'eu-central-1',
      requester_pays: true,
    },
  },
} as never)

const item = buildNode('https://stac.example/collections/s2/items/a', {
  type: 'Feature',
  stac_version: '1.1.0',
  id: 'a',
  geometry: null,
  properties: { datetime: '2026-01-01T00:00:00Z' },
  links: [
    { rel: 'collection', href: '../../s2' },
    { rel: 'parent', href: '../../s2' },
  ],
  assets: {
    B04: {
      href: 's3://eodata/S2/B04.jp2',
      type: 'image/jp2',
      'auth:refs': ['s3'],
      'storage:refs': ['eo'],
      'alternate:name': 'S3',
      alternate: {
        https: { href: 'https://download.example/B04.jp2', 'auth:refs': ['oidc'], 'alternate:name': 'HTTPS' },
        bad: { title: 'no href' },
      },
    },
    open: { href: 's3://open-data/x/y.tif' },
    paid: { href: 's3://paid/x/y.tif' },
    undeclared: { href: 's3://somewhere/x/y.tif' },
  },
} as never)

const lookup = { get: (h: string): StacNode | undefined => (h === collection.href ? collection : undefined) }
const asset = (key: string) => item.assets.find((a) => a.key === key)!

describe('parsing', () => {
  it('reads auth:refs, storage:refs, alternate:name and alternates, resolving hrefs, skipping one without href', () => {
    const b04 = asset('B04')
    expect(b04.authRefs).toEqual(['s3'])
    expect(b04.storageRefs).toEqual(['eo'])
    expect(b04.alternateName).toBe('S3')
    expect(b04.alternates).toEqual([
      {
        key: 'https',
        href: 'https://download.example/B04.jp2',
        name: 'HTTPS',
        description: undefined,
        authRefs: ['oidc'],
        storageRefs: undefined,
      },
    ])
  })

  it('reads auth:schemes and storage:schemes where they are declared', () => {
    expect(collection.authSchemes?.oidc.type).toBe('openIdConnect')
    expect(collection.storageSchemes?.rp.requesterPays).toBe(true)
    expect(collection.storageSchemes?.pub.fields.bucket).toBe('open-data')
    expect(item.authSchemes).toBeUndefined()
  })
})

describe('resolving schemes up the parent chain', () => {
  it("finds an Item asset's auth scheme on its Collection", () => {
    expect(item.parentHref).toBe(collection.href)
    expect(resolveAuthScheme(item, 'oidc', lookup)?.type).toBe('openIdConnect')
    expect(resolveAuthScheme(item, 'nope', lookup)).toBeUndefined()
  })

  it('finds a storage scheme by storage:refs, else by the s3 bucket', () => {
    expect(resolveStorageScheme(item, 's3://eodata/S2/B04.jp2', ['eo'], lookup)?.type).toBe('custom-s3')
    expect(resolveStorageScheme(item, 's3://open-data/x/y.tif', undefined, lookup)?.region).toBe('us-west-2')
    expect(resolveStorageScheme(item, 's3://somewhere/x/y.tif', undefined, lookup)).toBeUndefined()
  })

  it('describes schemes in words', () => {
    expect(describeAuthScheme(collection.authSchemes!.oidc)).toBe('sign-in (OpenID Connect) · identity.example')
    expect(describeAuthScheme(collection.authSchemes!.s3)).toBe('S3 credentials')
    expect(describeStorageScheme(collection.storageSchemes!.rp)).toBe('AWS S3 · eu-central-1 · requester pays')
    expect(describeStorageScheme(collection.storageSchemes!.eo)).toBe('Example S3 · eodata.example')
  })
})

describe('the public AWS S3 access method', () => {
  const src = (key: string) => accessSourceFor(item, asset(key), lookup)

  it('applies to an s3:// href on declared public AWS storage, or undeclared storage', () => {
    expect(awsS3PublicUrl.appliesTo(asset('open').href, src('open'))).toBe(true)
    expect(awsS3PublicUrl.appliesTo(asset('undeclared').href, src('undeclared'))).toBe(true)
  })

  it('never applies when credentials are declared, the storage is not AWS, or it is requester-pays', () => {
    expect(awsS3PublicUrl.appliesTo(asset('B04').href, src('B04'))).toBe(false)
    expect(awsS3PublicUrl.appliesTo(asset('paid').href, src('paid'))).toBe(false)
    const customNoAuth = { nodeHref: item.href, storage: collection.storageSchemes!.eo }
    expect(awsS3PublicUrl.appliesTo('s3://eodata/S2/B04.jp2', customNoAuth)).toBe(false)
    expect(awsS3PublicUrl.appliesTo('https://x.example/a.tif', { nodeHref: item.href })).toBe(false)
  })

  it('builds the regional virtual-hosted address when the region is declared, and says when it assumed AWS', async () => {
    expect(await awsS3PublicUrl.access(asset('open').href, src('open'))).toEqual({
      href: 'https://open-data.s3.us-west-2.amazonaws.com/x/y.tif',
      note: undefined,
    })
    const undeclared = await awsS3PublicUrl.access(asset('undeclared').href, src('undeclared'))
    expect(undeclared.href).toBe('https://somewhere.s3.amazonaws.com/x/y.tif')
    expect(undeclared.note).toMatch(/AWS is assumed/)
  })

  it('uses the path-style address for a dotted bucket name', async () => {
    const r = await awsS3PublicUrl.access('s3://my.bucket/k.tif', { nodeHref: 'x' })
    expect(r.href).toBe('https://s3.amazonaws.com/my.bucket/k.tif')
  })

  it('Planetary Computer signing also stands down when credentials are declared', () => {
    const pc = {
      nodeHref: 'https://planetarycomputer.microsoft.com/api/stac/v1/collections/x/items/y',
      authRefs: ['oidc'],
    }
    expect(planetaryComputerSigning.appliesTo('https://acct.blob.core.windows.net/c/a.tif', pc)).toBe(false)
  })
})

describe('href checks', () => {
  it('finds an empty path segment (A-06) in the path only', () => {
    expect(hasEmptyPathSegment('https://digital-atlas.s3.amazonaws.com//vulnerability/x.tif')).toBe(true)
    expect(hasEmptyPathSegment('https://host/a//b')).toBe(true)
    expect(hasEmptyPathSegment('https://host/a/b?next=https://x/y')).toBe(false)
    expect(hasEmptyPathSegment('https://host/a/b')).toBe(false)
    expect(hasEmptyPathSegment('s3://bucket//key')).toBe(true)
  })

  it('knows what a browser can open', () => {
    expect(browserCanOpen('https://a/b')).toBe(true)
    expect(browserCanOpen('s3://a/b')).toBe(false)
    expect(browserCanOpen('abfs://items/x.parquet')).toBe(false)
    expect(s3Bucket('s3://b/k')).toBe('b')
  })
})
