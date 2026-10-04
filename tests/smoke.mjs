// Offline browser smoke test. Drives the built (or dev) app in headless
// Chromium with every Planetary Computer request answered from recorded
// fixtures in tests/fixtures/pc, so it runs in CI without a live server
// and fails only when the app changes. Run with the app served at
// BASE_URL (default http://localhost:5173):
//
//   node tests/smoke.mjs
//
// It covers the paths a contributor is most likely to break: the landing
// page, opening an API root whose children come from /collections, the
// desktop's view switcher (icicle and outline over the same graph), the
// Items panel that follows the browsed Collection across views, a deep
// link into a Collection with an applied search, a rejected search shown
// as an error, the Inspector's Spatial map fitting a Collection's bbox, the
// phone layout (390px: Filters button, outline, bottom-sheet Inspector), and
// the static pages generated from docs/ (/about/, robots.txt, llms.txt).

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173'
const PC = 'https://planetarycomputer.microsoft.com/api/stac/v1'
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'pc')
const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8')

const failures = []
function check(name, condition, detail = '') {
  if (condition) console.log(`ok   ${name}`)
  else {
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
    failures.push(name)
  }
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

// Everything Planetary Computer is served from fixtures; anything else
// external (map tiles, other catalogs) is refused so the run is offline.
// Planetary Computer's signer, mocked: it answers with the href plus a
// fixture SAS query, and records what it was asked to sign.
const SIGN = 'https://planetarycomputer.microsoft.com/api/sas/v1/sign'
const signRequests = []
// Every /search request PC receives, for the default-search checks.
const searchRequests = []
const OFF_PAGE_ID = 'not-on-the-search-page'
// A made-up static Item for the asset-location checks: a credentialed
// s3:// href with an HTTPS alternate, an undeclared s3:// href, an https
// href with an empty path segment, and a plain https href.
const FIXTURE_ROOT = 'https://fixtures.stac-lens.test/catalog.json'
const FIXTURE_ITEM = 'https://fixtures.stac-lens.test/item.json'
// An Item whose structural links were written on the publisher's laptop
// (CoCliCo's real Items do this, health rule L-07): resolved, the host answers 400.
const LOCAL_PATH_ITEM = 'https://fixtures.stac-lens.test/local/items/a.json'
const localPathItem = {
  type: 'Feature',
  stac_version: '1.0.0',
  id: 'local-path-item',
  geometry: { type: 'Point', coordinates: [4.3, 52.1] },
  bbox: [4.3, 52.1, 4.3, 52.1],
  properties: { datetime: '2023-02-09T00:00:00Z' },
  links: [
    { rel: 'root', href: '/Users/someone/dev/stac/catalog.json' },
    { rel: 'parent', href: '/Users/someone/dev/stac/local/collection.json' },
    { rel: 'collection', href: '/Users/someone/dev/stac/local/collection.json' },
  ],
  assets: {},
}
// A static Collection of 50 Items, for an Items page carried in a shared link
// (a static href list is fixed, so page 2 holds exactly Items 21–40).
const PAGED_ROOT = 'https://fixtures.stac-lens.test/paged/catalog.json'
const PAGED_COLLECTION = 'https://fixtures.stac-lens.test/paged/collection/collection.json'
const pagedRoot = {
  type: 'Catalog',
  stac_version: '1.0.0',
  id: 'paged-root',
  title: 'Paged root',
  description: 'One Collection.',
  links: [
    { rel: 'root', href: './catalog.json' },
    { rel: 'child', href: './collection/collection.json' },
  ],
}
const pagedItemId = (n) => `paged-${String(n).padStart(2, '0')}`
const pagedCollection = {
  type: 'Collection',
  stac_version: '1.0.0',
  id: 'paged',
  title: 'Paged fixture',
  description: 'Fifty Items.',
  license: 'CC0-1.0',
  extent: { spatial: { bbox: [[0, 0, 1, 1]] }, temporal: { interval: [['2024-01-01T00:00:00Z', null]] } },
  links: [
    { rel: 'root', href: '../catalog.json' },
    { rel: 'parent', href: '../catalog.json' },
    ...Array.from({ length: 50 }, (_, i) => ({ rel: 'item', href: `./items/${pagedItemId(i + 1)}.json` })),
  ],
}
// The same fifty Items in a Collection that is its own root (no root or
// parent link): a link to it with a page must still select and page it.
const SOLO_COLLECTION = 'https://fixtures.stac-lens.test/solo/collection.json'
const soloCollection = {
  ...pagedCollection,
  id: 'solo',
  title: 'Solo fixture',
  links: Array.from({ length: 50 }, (_, i) => ({ rel: 'item', href: `./items/${pagedItemId(i + 1)}.json` })),
}
const pagedItem = (id) => ({
  type: 'Feature',
  stac_version: '1.0.0',
  id,
  geometry: { type: 'Point', coordinates: [0.5, 0.5] },
  bbox: [0.5, 0.5, 0.5, 0.5],
  properties: { datetime: '2024-01-01T00:00:00Z' },
  links: [
    { rel: 'collection', href: '../collection.json' },
    { rel: 'parent', href: '../collection.json' },
  ],
  assets: {},
})
// A static catalog with twelve child Collections: enough for the
// Collections list to open by itself (DESIGN §128, ten or more).
const MANY_ROOT = 'https://fixtures.stac-lens.test/many/catalog.json'
const manyChild = (i) => ({
  type: 'Collection',
  stac_version: '1.0.0',
  id: `many-${i}`,
  title: `Many ${i}${i % 3 === 0 ? ' radar' : ''}`,
  description: 'A fixture Collection.',
  license: i % 2 ? 'CC-BY-4.0' : 'proprietary',
  keywords: i % 3 === 0 ? ['SAR', 'fixture'] : ['optical', 'fixture'],
  extent: { spatial: { bbox: [[0, 0, 1, 1]] }, temporal: { interval: [['2024-01-01T00:00:00Z', null]] } },
  links: [],
})
const manyRoot = {
  type: 'Catalog',
  stac_version: '1.0.0',
  id: 'many',
  title: 'Many fixture',
  description: 'Twelve Collections.',
  links: Array.from({ length: 12 }, (_, i) => ({ rel: 'child', href: `./c${i + 1}.json` })),
}
// A Catalog of twelve, one level down, reached by a deep link that selects
// it: its Children list must open by itself (review H3 — the count was
// wiped by the per-catalog clear in the same commit).
const NEST_ROOT = 'https://fixtures.stac-lens.test/nest/catalog.json'
const NEST_MANY = 'https://fixtures.stac-lens.test/nest/many/catalog.json'
const nestRoot = {
  type: 'Catalog',
  stac_version: '1.0.0',
  id: 'nest',
  title: 'Nest root',
  description: 'One Catalog.',
  links: [
    { rel: 'root', href: './catalog.json' },
    { rel: 'child', href: './many/catalog.json' },
  ],
}
const nestMany = {
  ...manyRoot,
  id: 'nest-many',
  title: 'Nest many',
  links: [
    { rel: 'root', href: '../catalog.json' },
    { rel: 'parent', href: '../catalog.json' },
    ...Array.from({ length: 12 }, (_, i) => ({ rel: 'child', href: `../../many/c${i + 1}.json` })),
  ],
}
// An API root whose child links go on over a rel:next page and that
// declares Collection Search free text (NASA CMR's ALL, in miniature): the
// list says it is partial and can send its text to rel:data.
const SRV_ROOT = 'https://fixtures.stac-lens.test/srv/'
const srvRoot = {
  type: 'Catalog',
  stac_version: '1.0.0',
  id: 'srv',
  title: 'Server-search root',
  description: 'Three of many.',
  conformsTo: ['https://api.stacspec.org/v1.0.0/core', 'https://api.stacspec.org/v1.0.0/collection-search#free-text'],
  links: [
    { rel: 'root', href: './' },
    { rel: 'self', href: './' },
    { rel: 'data', href: './collections' },
    { rel: 'next', href: './?cursor=2' },
    ...[1, 2, 3].map((i) => ({ rel: 'child', href: `../many/c${i}.json` })),
  ],
}
const srvRequests = []
const fixtureRoot = {
  type: 'Catalog',
  stac_version: '1.1.0',
  id: 'fixtures',
  description: 'Asset-location fixtures',
  links: [
    { rel: 'self', href: FIXTURE_ROOT },
    { rel: 'root', href: FIXTURE_ROOT },
    { rel: 'item', href: FIXTURE_ITEM },
  ],
}
const fixtureItem = {
  type: 'Feature',
  stac_version: '1.1.0',
  id: 'fixture-item',
  geometry: null,
  properties: {
    datetime: '2026-01-01T00:00:00Z',
    description:
      'A **bold** [link](https://example.org/docs) and <b>raw</b> `code`.\n\n## A heading\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[evil](javascript:alert(1))',
    'auth:schemes': {
      s3: { type: 's3' },
      oidc: { type: 'openIdConnect', openIdConnectUrl: 'https://identity.example/.well-known/openid-configuration' },
    },
  },
  links: [
    { rel: 'self', href: FIXTURE_ITEM },
    { rel: 'root', href: FIXTURE_ROOT },
    { rel: 'parent', href: FIXTURE_ROOT },
  ],
  assets: {
    keyed: {
      title: 'Keyed band',
      href: 's3://private-bucket/a/b.tif',
      'auth:refs': ['s3'],
      alternate: {
        https: { href: 'https://download.example/b.tif', 'auth:refs': ['oidc'], 'alternate:name': 'HTTPS' },
      },
    },
    open: { title: 'Open band', href: 's3://open-bucket/c/d.tif' },
    doubled: { title: 'Doubled path', href: 'https://files.example//e/f.tif' },
    plain: { title: 'Plain file', href: 'https://files.example/g.tif' },
  },
}
const handleRoute = async (route) => {
  const url = route.request().url()
  if (url.startsWith(BASE_URL)) return route.continue()
  if (url === FIXTURE_ITEM) {
    return route.fulfill({ status: 200, contentType: 'application/geo+json', body: JSON.stringify(fixtureItem) })
  }
  if (url === SOLO_COLLECTION) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(soloCollection) })
  }
  if (url.startsWith('https://fixtures.stac-lens.test/solo/items/')) {
    const id = url.split('/').pop().replace('.json', '')
    return route.fulfill({ status: 200, contentType: 'application/geo+json', body: JSON.stringify(pagedItem(id)) })
  }
  if (url === NEST_ROOT) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(nestRoot) })
  }
  if (url === NEST_MANY) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(nestMany) })
  }
  if (url === SRV_ROOT) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(srvRoot) })
  }
  if (url.startsWith(`${SRV_ROOT}collections`)) {
    srvRequests.push(url)
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        collections: [7, 8].map((i) => ({
          ...manyChild(i),
          links: [{ rel: 'self', href: `https://fixtures.stac-lens.test/many/c${i}.json` }],
        })),
        numberMatched: 2,
        links: [],
      }),
    })
  }
  if (url === MANY_ROOT) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manyRoot) })
  }
  if (url.startsWith('https://fixtures.stac-lens.test/many/c')) {
    const i = Number(url.match(/c(\d+)\.json$/)?.[1])
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manyChild(i)) })
  }
  if (url === PAGED_ROOT) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pagedRoot) })
  }
  if (url === PAGED_COLLECTION) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pagedCollection) })
  }
  if (url.startsWith('https://fixtures.stac-lens.test/paged/collection/items/')) {
    const id = url.split('/').pop().replace('.json', '')
    return route.fulfill({ status: 200, contentType: 'application/geo+json', body: JSON.stringify(pagedItem(id)) })
  }
  if (url === LOCAL_PATH_ITEM) {
    return route.fulfill({ status: 200, contentType: 'application/geo+json', body: JSON.stringify(localPathItem) })
  }
  if (url.startsWith('https://fixtures.stac-lens.test/Users/')) {
    return route.fulfill({ status: 400, contentType: 'text/plain', body: 'invalid resource name' })
  }
  if (url === FIXTURE_ROOT) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixtureRoot) })
  }
  if (url.startsWith(SIGN)) {
    const href = new URL(url).searchParams.get('href')
    signRequests.push(href)
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ href: `${href}?st=a&se=b&sp=rl&sig=fixture`, 'msft:expiry': '2099-01-01T00:00:00Z' }),
    })
  }
  if (url.startsWith(PC)) {
    const path = url.slice(PC.length)
    const reply = (name, contentType = 'application/json', status = 200) =>
      route.fulfill({ status, contentType, body: fixture(name) })
    if (path === '/' || path === '') return reply('root.json')
    if (path.startsWith('/collections?')) return reply('collections.json')
    if (path === '/collections/3dep-lidar-returns') return reply('collection-3dep.json')
    // One Item by its own URL: the feature from the search fixture — or,
    // for OFF_PAGE_ID, a copy of one under another id, so it is an Item of
    // the Collection that the (fixture) search page does not hold.
    if (path.startsWith('/collections/3dep-lidar-returns/items/')) {
      const id = decodeURIComponent(path.split('/').pop())
      const features = JSON.parse(fixture('search-3dep-nj.json')).features
      const feature =
        id === OFF_PAGE_ID
          ? {
              ...features[0],
              id,
              links: features[0].links.map((l) => (l.rel === 'self' ? { ...l, href: `${PC}${path}` } : l)),
            }
          : features.find((f) => f.id === id)
      if (feature)
        return route.fulfill({ status: 200, contentType: 'application/geo+json', body: JSON.stringify(feature) })
    }
    if (path.startsWith('/search?')) {
      searchRequests.push(url)
      const q = new URL(url).searchParams
      if (!q.get('collections')) return reply('search-422.txt', 'text/plain', 422)
      if (q.get('datetime')?.startsWith('1900')) {
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: '{"error":"datetime is out of range"}',
        })
      }
      return reply('search-3dep-nj.json', 'application/geo+json')
    }
    return route.fulfill({ status: 404, body: 'no fixture for ' + path })
  }
  // A signed blob (the mocked signer's output) answers with a 1×1 PNG, so a
  // signed preview really loads.
  if (url.includes('.blob.core.windows.net/') && url.includes('sig=fixture')) {
    return route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      ),
    })
  }
  return route.abort()
}
await page.route('**/*', handleRoute)

const text = () => page.evaluate(() => document.body.innerText)
const titleBars = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-items-panel] > div:first-child')].map((h) => h.innerText.replace(/\n/g, ' ')),
  )
const treeLabels = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('svg text')].map((t) => t.textContent.trim()).filter((t) => t && t !== 'API'),
  )

// 1. Landing page
await page.goto(`${BASE_URL}/`)
await page.waitForSelector('footer')
check('landing page lists the known catalogs', /^\d+ catalogs$/m.test(await text()) && /^TOPIC$/m.test(await text()))
check(
  'landing footer names the version and license',
  /STAC Lens v\d+\.\d+\.\d+[\s·]+Apache-2\.0 license/.test(await text()),
)
{
  // A catalog a re-check found failing, kept in the list on purpose, says
  // so on its card and, opened, gives its recorded reason instead of the
  // generic ones (DESIGN §129). Generic over whichever entry has an issue.
  const issueCard = page.locator('[role="button"]', { has: page.locator('[data-card-issue]') }).first()
  if ((await issueCard.count()) === 0) {
    console.log('skip   known-issue card — no entry records an issue today')
  } else {
    const issueText = (
      (await issueCard
        .locator('[data-card-issue]')
        .textContent()
        .catch(() => '')) ?? ''
    ).trim()
    await issueCard.click({ timeout: 5000 }).catch(() => {})
    await page
      .locator('[data-root-load-error]')
      .waitFor({ timeout: 15000 })
      .catch(() => {})
    const pageIssue = (
      (await page
        .locator('[data-known-issue]')
        .textContent()
        .catch(() => '')) ?? ''
    ).trim()
    check(
      'a known failing catalog says so on its card, and its failure page gives the recorded reason',
      /Not reachable since \d{4}-\d{2}-\d{2}/.test(issueText) &&
        /^Probably the known issue \(since \d{4}-\d{2}-\d{2}\)/.test(pageIssue),
      `${issueText} | ${pageIssue}`,
    )
  }
}

// 2. API root: children discovered through /collections
await page.goto(`${BASE_URL}/#${PC}/`)
await page.waitForFunction(() => document.querySelectorAll('svg text').length > 3, null, { timeout: 15000 })
const labels = await treeLabels()
check('API root opens with its Collections as children', labels.length === 6, `labels: ${labels.join(' | ')}`)
{
  // The wheel zooms the canvas even with the pointer resting on a node's
  // label (the label's own click and drag must not swallow it).
  const scale = () =>
    page.evaluate(() => Number(/scale\(([^)]+)\)/.exec(document.querySelector('svg > g').getAttribute('transform'))[1]))
  const box = await page.locator('svg text[data-block-pan]').nth(1).boundingBox()
  const before = await scale()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -300)
  await page.waitForTimeout(300)
  const after = await scale()
  check('tree: the wheel zooms with the pointer on a node', after > before, `${before} → ${after}`)
  await page.mouse.wheel(0, 300)
  await page.waitForTimeout(300)
}
check('header shows the catalog title', (await text()).includes('Microsoft Planetary Computer STAC API'))

// 2b. The desktop's view switcher: the same loaded graph and the same
// selection rendered as an icicle and an outline. (Landsat here so the
// next section's deep link into 3DEP is a fresh Collection.) The tree
// is restored at the end so the checks below find their boxes.
await page.getByRole('tab', { name: 'Icicle' }).click()
await page.waitForSelector('g[data-href]')
const icicleCells = await page.locator('g[data-href]').count()
check('icicle: one cell per loaded node (root + 5 Collections)', icicleCells === 6, `cells: ${icicleCells}`)
await page.locator('g[data-href$="/collections/landsat-c2-l2"]').click()
await page.waitForFunction(() => document.body.innerText.includes('Landsat Collection 2 Level-2'), null, {
  timeout: 5000,
})
check(
  'icicle: clicking a cell selects it — Inspector follows, cell outlined',
  (await page.locator('g[data-href$="landsat-c2-l2"] rect[stroke-width="2"]').count()) === 1,
)
// The Items panel opens for it with its default search already run (no
// conditions — one request, the recorded page of 5 Items served for any
// collections= search), and that page is the row under the Collection.
await page.waitForSelector('[data-items-panel]', { timeout: 10000 })
await page.waitForSelector('g[data-item-href]', { timeout: 10000 })
{
  const landsat = searchRequests.filter((u) => /collections=landsat-c2-l2/.test(u))
  check(
    'a Collection opens with its default, unconditioned search already run — once',
    landsat.length === 1 &&
      !/datetime|bbox|sortby/.test(landsat[0]) &&
      /no conditions, the server's order/.test(await page.locator('[data-items-panel]').textContent()),
    JSON.stringify(landsat),
  )
}
check(
  'icicle: the Items panel opens for the browsed Collection and its page is the row under it',
  (await page.locator('g[data-item-href]').count()) === 5,
  `items: ${await page.locator('g[data-item-href]').count()}`,
)
await page.getByRole('tab', { name: 'Outline' }).click()
await page.waitForSelector('[role="treeitem"]')
check(
  'outline on the desktop: rows for the loaded nodes, selection kept',
  (await page.locator('[role="treeitem"]').count()) >= 6 &&
    (await page.locator('[role="treeitem"][aria-selected="true"]').count()) === 1,
)
await page.getByRole('tab', { name: 'Tree' }).click()
await page.waitForFunction(() => document.querySelectorAll('svg text').length > 3, null, { timeout: 5000 })

// 3. Deep link into a Collection with an applied bbox search
await page.goto(`${BASE_URL}/#${PC}/collections/3dep-lidar-returns?bbox=-75.5%2C39.5%2C-73.5%2C41.5`)
await page.waitForFunction(() => /page \d+ of \d+/.test(document.body.innerText), null, { timeout: 15000 })
check(
  'the Items panel opens for the Collection, with Search above Results and the linked area as a chip',
  (await page.locator('[data-items-panel]').count()) === 1 &&
    /USGS 3DEP Lidar Returns.*API/s.test((await titleBars()).join(',')) &&
    (await page.locator('[data-items-panel] button[aria-expanded="true"]', { hasText: /^Hide$/ }).count()) === 1 &&
    ((await page.locator('[data-condition-chips]').textContent()) ?? '').includes('Area:'),
  (await titleBars()).join(','),
)
check(
  'restored search renders the fixture page',
  /page 1 of 1 — 5 items total/.test(await text()),
  (await text()).match(/page \d+ of[^\n]*/)?.[0],
)
check('Area condition shows the restored bbox as a real value', /≈[\d,]+ km²/.test(await text()))
check(
  'URL round-trips the search',
  (await page.evaluate(() => decodeURIComponent(location.hash))).endsWith('?bbox=-75.5,39.5,-73.5,41.5'),
)
check(
  "tree: the panel's page appears as Item leaves under the Collection; Landsat's page last seen stays, dimmed",
  (await page.locator('[data-item-leaf][opacity="1"]').count()) === 5 &&
    (await page.locator('[data-item-leaf][opacity="0.55"]').count()) === 5,
  `current: ${await page.locator('[data-item-leaf][opacity="1"]').count()}, remembered: ${await page.locator('[data-item-leaf][opacity="0.55"]').count()}`,
)
check('Inspector flags the two-bbox extent as the spec does', (await text()).includes('exactly two spatial bboxes'))
check(
  'the Inspector map draws both declared bboxes',
  (await page.locator('.leaflet-overlay-pane path').count()) >= 2,
  `overlay paths: ${await page.locator('.leaflet-overlay-pane path').count()}`,
)
check('Inspector marks the deprecated license value', (await text()).includes('deprecated value since STAC 1.1'))

// 3b. The Items panel is the same panel in every view: switching to
// the icicle and back leaves it where it was, with its page; it is docked
// beside the views and its splitter resizes it.
await page.getByRole('tab', { name: 'Icicle' }).click()
await page.waitForSelector('g[data-href]')
check(
  'Items panel persists across a view switch with its page',
  (await page.locator('[data-items-panel]').count()) === 1 && /page 1 of 1 — 5 items total/.test(await text()),
)
check(
  "icicle: the browsed Collection's row is the panel's page; Landsat keeps its last page, dimmed",
  (await page.locator('g[data-items-row="current"] g[data-item-href]').count()) === 5 &&
    (await page.locator('g[data-items-row="remembered"] g[data-item-href]').count()) === 5,
  `current: ${await page.locator('g[data-items-row="current"] g[data-item-href]').count()}, remembered: ${await page.locator('g[data-items-row="remembered"] g[data-item-href]').count()}`,
)
await page.getByRole('tab', { name: 'Tree' }).click()
await page.waitForFunction(() => document.querySelectorAll('svg text').length > 3, null, { timeout: 5000 })
{
  // The Items panel is docked: a column between the views and the
  // Inspector, overlapping neither; its divider resizes it, taking the
  // width from the canvas.
  const box = (sel) =>
    page
      .locator(sel)
      .first()
      .evaluate((el) => el.getBoundingClientRect().toJSON())
  const canvas = await page
    .locator('svg')
    .filter({ has: page.locator(':scope > g[transform]') })
    .first()
    .evaluate((el) => el.getBoundingClientRect().toJSON())
  const panel = await box('[data-items-panel]')
  const inspectorLeft = await page.evaluate(
    () => document.querySelector('[data-inspector-pane]').getBoundingClientRect().left,
  )
  check(
    'the Items panel is docked between the views and the Inspector, overlapping neither',
    canvas.right <= panel.left && panel.right <= inspectorLeft,
    `canvas ${canvas.left}–${canvas.right}, panel ${panel.left}–${panel.right}, inspector from ${inspectorLeft}`,
  )
  const d = await page.getByRole('separator', { name: 'Resize the Items panel' }).boundingBox()
  await page.mouse.move(d.x + d.width / 2, d.y + 200)
  await page.mouse.down()
  await page.mouse.move(d.x + d.width / 2 - 60, d.y + 200, { steps: 6 })
  await page.mouse.up()
  const after = await box('[data-items-panel]')
  check(
    'dragging its divider widens the panel, its right edge where it was',
    Math.abs(after.width - panel.width - 60) < 1.5 && Math.abs(after.right - panel.right) < 1.5,
    `width ${panel.width} → ${after.width}, right ${panel.right} → ${after.right}`,
  )
}
// Hide and show from the header toggle (the one place panes are shown and
// hidden): same page, no refetch (the session). The pane is named by its
// role — "Items", the Collection only its context.
const itemsToggle = page.getByRole('button', { name: 'Items', exact: true })
check(
  'the Items panel is titled "Items", with its Collection as context',
  /^Items\s*in USGS 3DEP Lidar Returns/.test(
    (await page.locator('[data-items-panel] .stac-lens-pane-header').textContent()).trim(),
  ),
  await page.locator('[data-items-panel] .stac-lens-pane-header').textContent(),
)
await itemsToggle.click()
check(
  "the header's Items toggle hides the panel and shows as unpressed",
  (await page.locator('[data-items-panel]').count()) === 0 &&
    (await itemsToggle.getAttribute('aria-pressed')) === 'false',
)
await itemsToggle.click()
await page.waitForSelector('[data-items-panel]')
check('reopening restores the search and its page from the session', /page 1 of 1 — 5 items total/.test(await text()))
// Closing and clicking the *same* Collection again also reopens it — a
// selection is an act, not only a value (a reported confusion).
await itemsToggle.click()
await page.locator('svg text', { hasText: 'USGS 3DEP Lidar Returns' }).first().click()
await page.waitForSelector('[data-items-panel]', { timeout: 5000 })
check(
  'clicking the already-selected Collection reopens the closed panel',
  (await page.locator('[data-items-panel]').count()) === 1,
)

{
  // The Inspector is the same kind of pane: hidden and shown again from
  // its header toggle, at the width it had; its splitter takes the
  // keyboard (WAI-ARIA window splitter).
  const inspector = page.locator('[data-inspector-pane]')
  const width = await inspector.evaluate((e) => Math.round(e.getBoundingClientRect().width))
  await page.getByRole('button', { name: 'Inspector', exact: true }).click()
  const hidden = (await inspector.count()) === 0
  await page.getByRole('button', { name: 'Inspector', exact: true }).click()
  const back = await inspector.evaluate((e) => Math.round(e.getBoundingClientRect().width))
  const splitter = page.getByRole('separator', { name: 'Resize the Inspector' })
  await splitter.focus()
  await page.keyboard.press('ArrowLeft')
  const keyed = await inspector.evaluate((e) => Math.round(e.getBoundingClientRect().width))
  await page.keyboard.press('ArrowRight')
  check(
    'the Inspector hides and returns from its toggle at its width, and resizes by keyboard',
    hidden &&
      back === width &&
      keyed === width + 16 &&
      (await splitter.getAttribute('aria-valuenow')) === String(width),
    `width ${width}, back ${back}, keyed ${keyed}`,
  )
  // Enter on a splitter hides its pane and hands keyboard focus to the
  // toggle that brings it back; dragging a splitter well past the minimum
  // hides the pane too; widths survive a reload, a hidden pane does not —
  // every newly opened catalog starts with what should be open, open.
  await splitter.focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(100)
  const focusedToggle = await page.evaluate(() => document.activeElement?.getAttribute('data-pane-toggle'))
  check(
    "Enter on a splitter hides its pane and moves focus to that pane's toggle",
    (await inspector.count()) === 0 && focusedToggle === 'inspector',
    `focus on ${focusedToggle}`,
  )
  await page.getByRole('button', { name: 'Inspector', exact: true }).click()
  const isp = await page.getByRole('separator', { name: 'Resize the Inspector' }).boundingBox()
  await page.mouse.move(isp.x + 4, isp.y + 200)
  await page.mouse.down()
  await page.mouse.move(isp.x + 500, isp.y + 200, { steps: 8 })
  await page.mouse.up()
  check('dragging a splitter well past the minimum hides its pane', (await inspector.count()) === 0)
  const itemsWidth = await page
    .locator('[data-items-panel]')
    .evaluate((e) => Math.round(e.getBoundingClientRect().width))
  await page.reload()
  await page.waitForSelector('[data-items-panel]', { timeout: 15000 })
  await page.waitForSelector('[data-inspector-pane]', { timeout: 10000 }).catch(() => {})
  check(
    'after a reload the Inspector is back (a hidden pane belongs to that visit) and the Items panel keeps its width',
    (await page.locator('[data-inspector-pane]').count()) === 1 &&
      (await page.locator('[data-items-panel]').evaluate((e) => Math.round(e.getBoundingClientRect().width))) ===
        itemsWidth,
  )
}

// 3c. Asset access. Browsing never signs anything; selecting an Item
// signs only what is about to be shown (its thumbnail lives in storage
// that refuses unsigned requests), the declared hrefs stay what STAC says,
// and an access link is obtained only when asked for.
check('browsing a catalog signs nothing', signRequests.length === 0, `${signRequests.length} sign request(s)`)
await page.locator('[data-items-panel]').getByText('NJ_South_Jersey_FEMA_2018-returns-5m-2-3').first().click()
await page.waitForSelector('[data-asset-access]', { timeout: 10000 })
await page.waitForFunction(
  () => {
    const img = document.querySelector('img[alt="preview"]')
    return !!img && /sig=fixture/.test(img.src) && img.complete && img.naturalWidth > 0
  },
  null,
  { timeout: 10000 },
)
{
  const nj = JSON.parse(fixture('search-3dep-nj.json')).features.find(
    (f) => f.id === 'NJ_South_Jersey_FEMA_2018-returns-5m-2-3',
  )
  const declared = nj.assets.data.href
  check(
    'an Item: blob assets need access, the rest stay direct, only the preview was signed',
    (await page.locator('[data-asset-access="needed"]').count()) === 2 &&
      signRequests.length === 1 &&
      signRequests[0] === nj.assets.thumbnail.href,
    `needed: ${await page.locator('[data-asset-access="needed"]').count()}, signed: ${JSON.stringify(signRequests)}`,
  )
  const dataTitle = nj.assets.data.title
  const dataRow = page.locator('[role="listitem"]').filter({ hasText: dataTitle })
  check(
    'the asset list: one row per asset, all shown, and Copy means the STAC href',
    (await page.locator('[role="listitem"]').count()) === Object.keys(nj.assets).length &&
      (await dataRow
        .getByRole('button', { name: `Copy STAC href of ${dataTitle}`, exact: true })
        .getAttribute('title')) === `Copy the STAC href — ${declared}`,
  )
  await dataRow.locator('button[aria-expanded]').click()
  await dataRow.getByRole('button', { name: 'Get access link' }).click()
  await page.waitForSelector('[data-asset-access="ready"]', { timeout: 10000 })
  check(
    'an access link is shown beside the declared one, with its method and expiry',
    (await page.locator('[data-access-href]').first().textContent()) === `${declared}?st=a&se=b&sp=rl&sig=fixture` &&
      /Planetary Computer signing · valid until/.test(await page.locator('[data-asset-access="ready"]').textContent()),
  )
}

{
  // Dragging one Item leaf moves its Collection's whole group of leaves —
  // (after the signing checks above: hovering a leaf shows its signed
  // preview, by design) —
  // the page's place in the tree — and the Collection itself stays put.
  const rel = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-item-leaf][opacity="1"]')].map((g) => {
        const r = g.getBoundingClientRect()
        return [Math.round(r.x), Math.round(r.y)]
      }),
    )
  const before = await rel()
  const leaf = await page.locator('[data-item-leaf][opacity="1"]').nth(1).boundingBox()
  await page.mouse.move(leaf.x + 6, leaf.y + leaf.height / 2)
  await page.mouse.down()
  await page.mouse.move(leaf.x + 86, leaf.y + leaf.height / 2 + 40, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  const after = await rel()
  const moved = after.map((p, k) => [p[0] - before[k][0], p[1] - before[k][1]])
  check(
    'tree: dragging an Item leaf moves its whole group of leaves together',
    moved.length === 5 && moved.every((m) => Math.abs(m[0] - 80) < 2 && Math.abs(m[1] - 40) < 2),
    JSON.stringify(moved),
  )
  await page.getByRole('button', { name: 'Reset layout' }).click()
}

// 3d. An Item opened by its own URL — a reload, a shared link — that the
// Collection's default search page does not hold: the tree still draws the
// selected Item under its Collection, marked off the page.
{
  const fresh = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  await fresh.route('**/*', handleRoute)
  const id = OFF_PAGE_ID
  await fresh.goto(`${BASE_URL}/#${PC}/collections/3dep-lidar-returns/items/${id}`)
  await fresh.waitForSelector('[data-item-leaf][data-off-page]', { timeout: 15000 }).catch(() => {})
  const leaf = fresh.locator('[data-item-leaf][data-off-page]')
  check(
    'an Item opened by its URL is drawn in the tree under its Collection, marked off the page',
    (await leaf.count()) === 1 &&
      (await leaf.getAttribute('data-item-leaf')).endsWith(`/items/${id}`) &&
      /not on the Items panel's page/.test(await leaf.textContent()),
  )
  await fresh.getByRole('tab', { name: 'Outline' }).click()
  await fresh.waitForSelector('[role="treeitem"][data-off-page]', { timeout: 5000 }).catch(() => {})
  const outlineRow = fresh.locator('[role="treeitem"][data-off-page]')
  await fresh.getByRole('tab', { name: 'Icicle' }).click()
  await fresh.waitForSelector('g[data-item-href][data-off-page]', { timeout: 5000 }).catch(() => {})
  check(
    '…and in the outline and the icicle too',
    (await fresh.locator('g[data-item-href][data-off-page]').count()) === 1 &&
      (await fresh.locator('g[data-item-href][data-off-page]').getAttribute('data-item-href')).endsWith(`/items/${id}`),
    `icicle cells: ${await fresh.locator('g[data-item-href][data-off-page]').count()}`,
  )
  await fresh.getByRole('tab', { name: 'Outline' }).click()
  await fresh.waitForSelector('[role="treeitem"][data-off-page]', { timeout: 5000 }).catch(() => {})
  check(
    'the outline opens the Collection the selection is in and shows the Item as its first row',
    (await outlineRow.count()) === 1 && (await outlineRow.textContent()).includes(id),
  )
  await fresh.close()
}

// 3e. Where an asset lives and what it needs, as the catalog declares it.
{
  const fx = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  await fx.route('**/*', handleRoute)
  await fx.goto(`${BASE_URL}/#${FIXTURE_ITEM}`)
  await fx.waitForSelector('[role="listitem"]', { timeout: 15000 })
  await fx.waitForSelector('.stac-lens-md', { timeout: 10000 })
  const md = fx.locator('.stac-lens-md')
  const mdText = await md.textContent()
  check(
    'a Markdown description renders as structure, with safe links and no raw HTML',
    (await md.locator('a[href="https://example.org/docs"][target="_blank"]').count()) === 1 &&
      (await md.locator('strong').count()) === 1 &&
      (await md.locator('code').count()) === 1 &&
      (await md.locator('h4').count()) === 1 &&
      (await md.locator('table td').count()) === 2 &&
      (await md.locator('a[href^="javascript"]').count()) === 0 &&
      !/\*\*|<b>|##|\]\(/.test(mdText) &&
      /evil/.test(mdText),
    mdText,
  )
  const notes = (await fx.locator('[role="list"]').locator('xpath=preceding-sibling::div').allTextContents()).join(
    ' | ',
  )
  check(
    'asset notes: declared credentials, an S3 address to open through, an empty path segment',
    /1 of 4 needs S3 credentials/.test(notes) &&
      /1 of 4 opens through its public AWS S3 HTTPS address/.test(notes) &&
      /1 of 4 has an empty segment/.test(notes),
    notes,
  )
  const keyed = fx.locator('[role="listitem"]').filter({ hasText: 'Keyed band' })
  check(
    "an s3:// href that needs credentials can't be opened from here, and says why",
    (await keyed.locator('button[disabled][aria-label="Open Keyed band"]').count()) === 1,
  )
  await keyed.locator('button[aria-expanded]').click()
  const keyedText = await keyed.textContent()
  check(
    'the opened row names the credentials and lists the alternate with what it needs',
    /RequiresS3 credentials/.test(keyedText) &&
      (await keyed.locator('[data-alternate="https"]').count()) === 1 &&
      /needs sign-in \(OpenID Connect\) · identity\.example/.test(keyedText),
  )
  const open = fx.locator('[role="listitem"]').filter({ hasText: 'Open band' })
  await open.locator('button[aria-expanded]').click()
  await open.getByRole('button', { name: 'Get access link' }).click()
  await open.locator('[data-access-href]').waitFor({ timeout: 5000 })
  check(
    'an undeclared s3:// href gets its AWS HTTPS address, with the assumption said',
    (await open.locator('[data-access-href]').textContent()) === 'https://open-bucket.s3.amazonaws.com/c/d.tif' &&
      /AWS is assumed/.test(await open.textContent()),
  )
  await fx.close()
}

// 3f. A deep link whose root and parent links point to the publisher's
// own file system: the node still opens, and the page says why it is alone.
{
  const lp = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const lpErrors = []
  lp.on('pageerror', (e) => lpErrors.push(e.message))
  await lp.route('**/*', handleRoute)
  await lp.goto(`${BASE_URL}/#${LOCAL_PATH_ITEM}`)
  await lp.waitForSelector('[data-unreachable-catalog]', { timeout: 15000 }).catch(() => {})
  const notice =
    (await lp
      .locator('[data-unreachable-catalog]')
      .textContent()
      .catch(() => '')) ?? ''
  check(
    'deep link with unreachable root: the node opens on its own with a notice naming the link',
    /opened on its own/.test(notice) &&
      notice.includes('/Users/someone/dev/stac/catalog.json') &&
      /L-07/.test(notice) &&
      (await lp.getByText('Failed to load this catalog').count()) === 0,
    notice,
  )
  await lp.waitForSelector('[data-local-path-links]', { timeout: 5000 }).catch(() => {})
  const lpList =
    (await lp
      .locator('[data-local-path-links]')
      .textContent()
      .catch(() => '')) ?? ''
  const lpInspector = (await lp.locator('[data-inspector-pane]').textContent()) ?? ''
  check(
    'the Inspector shows the Item, its own time, and lists the local-path links (L-07)',
    lpInspector.includes('local-path-item') &&
      /3 links/.test(lpList) &&
      (await lp.locator('[data-inspector-pane]').getByText('Loading…').count()) === 0 &&
      lpErrors.length === 0,
    `${lpList} | errors ${lpErrors.join('; ')}`,
  )
  await lp.getByRole('button', { name: 'Dismiss' }).click()
  check('the notice can be dismissed', (await lp.locator('[data-unreachable-catalog]').count()) === 0)
  // Reaching the same link through history (popstate), not a fresh load,
  // must explain it too; leaving for the landing page clears it.
  await lp.evaluate(() => (location.hash = ''))
  await lp.waitForSelector('[data-unreachable-catalog]', { state: 'detached', timeout: 5000 }).catch(() => {})
  await lp.evaluate((h) => (location.hash = h), LOCAL_PATH_ITEM)
  await lp.waitForSelector('[data-unreachable-catalog]', { timeout: 10000 }).catch(() => {})
  check(
    'the notice also appears when the link is reached through history, not only on first load',
    (await lp.locator('[data-unreachable-catalog]').count()) === 1,
  )
  await lp.close()
}

// 3g. Any opened catalog can be starred from the header and found again
// under the landing page's Favorites — the inline fixture root is not in
// the known list, which is the case that used to have no star at all.
{
  const fv = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await fv.route('**/*', handleRoute)
  await fv.goto(`${BASE_URL}/#${FIXTURE_ROOT}`)
  const star = fv.locator('[data-favorite-star]')
  await star.waitFor({ timeout: 15000 }).catch(() => {})
  await fv
    .waitForFunction(
      () => document.querySelector('[data-favorite-star]')?.getAttribute('aria-disabled') !== 'true',
      null,
      { timeout: 10000 },
    )
    .catch(() => {})
  const enabled = (await star.count()) === 1 && (await star.getAttribute('aria-disabled')) !== 'true'
  if (enabled) await star.click({ timeout: 5000 }).catch(() => {})
  const pressed = enabled ? await star.getAttribute('aria-pressed') : 'star never became available'
  await fv.getByTitle('Back to catalogs').click()
  await fv
    .getByRole('button', { name: /^Favorites/ })
    .first()
    .click()
  const favCard = fv.locator(`[role="button"][title="${FIXTURE_ROOT}"]`)
  await favCard.waitFor({ timeout: 5000 }).catch(() => {})
  const favCardStar = favCard.locator('.stac-lens-card-star')
  check(
    'a catalog not in the list is starred from the header and listed under Favorites, star on',
    pressed === 'true' && (await favCard.count()) === 1 && (await favCardStar.getAttribute('aria-pressed')) === 'true',
    `pressed ${pressed}, cards ${await favCard.count()}`,
  )
  if ((await favCardStar.count()) === 1) await favCardStar.click({ timeout: 5000 }).catch(() => {})
  check('unstarring it on the card removes it from Favorites', (await favCard.count()) === 0)
  await fv.close()
}

// 3h. A shared link carries the view and the Items page; the Share panel
// says so in words, copies the link, and closes on Escape.
{
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const sh = await ctx.newPage()
  await sh.route('**/*', handleRoute)
  await sh.goto(`${BASE_URL}/#${PAGED_COLLECTION}?view=outline&page=2&page-size=20`)
  const shPanel = sh.locator('[data-items-panel]')
  await shPanel
    .getByText('page 2 of 3')
    .waitFor({ timeout: 15000 })
    .catch(() => {})
  await shPanel
    .getByText(pagedItemId(21), { exact: true })
    .waitFor({ timeout: 10000 })
    .catch(() => {})
  const shText = (await shPanel.innerText().catch(() => '')) ?? ''
  check(
    'a link with page=2&page-size=20 opens a static Collection on exactly Items 21–40',
    /page 2 of 3/.test(shText) &&
      shText.includes(pagedItemId(21)) &&
      shText.includes(pagedItemId(40)) &&
      !shText.includes(pagedItemId(20)) &&
      !shText.includes(pagedItemId(41)),
    shText.match(/page \d+ of[^\n]*/)?.[0],
  )
  // At its minimum width the Items panel never scrolls sideways: the pager
  // wraps, and the page size lives in the footer.
  await sh.getByRole('separator', { name: /Resize the Items panel/ }).focus()
  await sh.keyboard.press('Home')
  await sh.waitForTimeout(200)
  const sideways = await sh.evaluate(() => {
    const body = document.querySelector('[data-items-panel] > div:last-child')
    return body ? body.scrollWidth - body.clientWidth : -1
  })
  check(
    'the Items panel at its minimum width has no horizontal scroll; the page size is in the footer',
    sideways === 0 && (await sh.locator('[data-results-footer] select[aria-label="Items per page"]').count()) === 1,
    `overflow ${sideways}px`,
  )
  const outlineTab = sh.locator('button[aria-selected="true"]', { hasText: /^Outline$/ })
  check(
    'a link with view=outline opens the Outline view, and the hash keeps view and page',
    (await outlineTab.count()) === 1 &&
      (await sh.evaluate(() => location.hash)).endsWith('?view=outline&page=2&page-size=20'),
    await sh.evaluate(() => location.hash),
  )
  await sh.locator('[data-share-button]').click()
  const sharePanel = sh.locator('[data-share-panel]')
  await sharePanel.waitFor({ timeout: 5000 }).catch(() => {})
  const facts = (await sharePanel.innerText().catch(() => '')) ?? ''
  check(
    'the Share panel lists what the link opens: catalog, selection, view, Items page (no API caveat for a static list)',
    /Paged root/.test(facts) &&
      /Paged fixture · Collection/.test(facts) &&
      /Outline/.test(facts) &&
      /page 2, 20 per page/.test(facts) &&
      !/runs again/.test(facts),
    facts.replace(/\n+/g, ' | '),
  )
  await sh.locator('[data-share-copy]').click()
  await sh.waitForTimeout(200)
  const clip = await sh.evaluate(() => navigator.clipboard.readText()).catch(() => '')
  check(
    'Copy link puts the same link on the clipboard and says Copied',
    clip === (await sh.evaluate(() => location.href)) &&
      (await sh.locator('[data-share-copy]').innerText()) === 'Copied',
    clip,
  )
  await sh.keyboard.press('Escape')
  check(
    'Escape closes the Share panel and returns focus to its button',
    (await sharePanel.count()) === 0 &&
      (await sh.evaluate(() => document.activeElement?.hasAttribute('data-share-button'))),
  )
  // A root that is itself a Collection: the link selects it so its page opens.
  await sh.goto(`${BASE_URL}/#${SOLO_COLLECTION}?page=2&page-size=20`)
  await sh.reload()
  await shPanel
    .getByText('page 2 of 3')
    .waitFor({ timeout: 15000 })
    .catch(() => {})
  await shPanel
    .getByText(pagedItemId(21), { exact: true })
    .waitFor({ timeout: 10000 })
    .catch(() => {})
  const soloText = (await shPanel.innerText().catch(() => '')) ?? ''
  check(
    'a link paging a root Collection’s own Items selects it and opens that page',
    /page 2 of 3/.test(soloText) && soloText.includes(pagedItemId(21)),
    soloText.match(/page \d+ of[^\n]*/)?.[0] ?? 'no Items panel',
  )
  await ctx.close()
}

// 3i. Many children: the Collections list is there when the catalog opens,
// before anything is selected, and a license facet narrows it.
{
  const mp = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await mp.route('**/*', handleRoute)
  await mp.goto(`${BASE_URL}/#${MANY_ROOT}`)
  const list = mp.locator('[data-collections-list]')
  await list.waitFor({ timeout: 15000 }).catch(() => {})
  const count = await mp
    .locator('[data-collections-count]')
    .innerText()
    .catch(() => 'no list')
  check(
    'a catalog with 12 Collections opens with its Collections list, nothing selected yet',
    count === '12' && (await mp.locator('[data-inspector-pane]').count()) === 0,
    count,
  )
  await list.locator('[data-facet-button="licenses"]').click()
  await list
    .locator('[data-facet="licenses"] label', { hasText: /^CC-BY-4.0/ })
    .locator('input')
    .check()
  await mp.keyboard.press('Escape')
  await mp.waitForTimeout(200)
  check(
    'a license facet ("any of") narrows the list, and the tree dims the rest',
    (await mp.locator('[data-collections-count]').innerText()) === '6 of 12' &&
      (await mp.locator('g[data-dimmed]').count()) === 6,
    await mp.locator('[data-collections-count]').innerText(),
  )
  // Pane and view choices belong to one visit: hide both panes and pick
  // the Outline, go back to the catalog list, open the same catalog again —
  // it starts fresh.
  await list.locator('[data-collection-row] button').first().click()
  await mp
    .locator('[data-inspector-pane]')
    .waitFor({ timeout: 5000 })
    .catch(() => {})
  await mp.locator('button[aria-selected]', { hasText: /^Outline$/ }).click()
  await mp.locator('[data-pane-toggle="inspector"]').click()
  await mp.locator('[data-pane-toggle="items"]').click()
  const hiddenBoth =
    (await mp.locator('[data-inspector-pane]').count()) === 0 &&
    (await mp.locator('[data-contents-pane]').count()) === 0
  await mp.getByTitle('Back to catalogs').click()
  await mp.getByPlaceholder(/paste a STAC URL/).fill(MANY_ROOT)
  await mp.getByRole('button', { name: 'Open', exact: true }).click()
  await list.waitFor({ timeout: 10000 }).catch(() => {})
  const freshView = await mp.locator('button[aria-selected="true"]', { hasText: /^Tree$/ }).count()
  await list.locator('[data-collection-row] button').first().click()
  await mp
    .locator('[data-inspector-pane]')
    .waitFor({ timeout: 5000 })
    .catch(() => {})
  check(
    'reopening a catalog starts fresh: the tree, its Collections list open, the Inspector shown on selecting',
    hiddenBoth && freshView === 1 && (await mp.locator('[data-inspector-pane]').count()) === 1,
    `hidden ${hiddenBoth}, tree ${freshView}, inspector ${await mp.locator('[data-inspector-pane]').count()}`,
  )
  await mp.close()
}

// 3j. A deep link selecting a Catalog of twelve opens its Children list.
{
  const np = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await np.route('**/*', handleRoute)
  await np.goto(`${BASE_URL}/#${NEST_MANY}`)
  await np
    .locator('[data-collections-count]')
    .waitFor({ timeout: 15000 })
    .catch(() => {})
  check(
    'a deep link selecting a Catalog with 12 children opens its Children list by itself',
    (await np
      .locator('[data-collections-count]')
      .innerText()
      .catch(() => 'no list')) === '12' && (await np.locator('[data-inspector-pane]').count()) === 1,
    await np
      .locator('[data-collections-count]')
      .innerText()
      .catch(() => 'no list'),
  )
  await np.close()
}

// 3k. A partial list (child links that go on over rel:next) can send its
// text to the API's Collection Search, and says what came back.
{
  const sp = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await sp.route('**/*', handleRoute)
  await sp.goto(`${BASE_URL}/#${SRV_ROOT}`)
  await sp
    .waitForFunction(() => document.querySelectorAll('svg text').length > 2, null, { timeout: 15000 })
    .catch(() => {})
  await sp.locator('[data-pane-toggle="items"]').click()
  const spCount = sp.locator('[data-collections-count]')
  await spCount.waitFor({ timeout: 10000 }).catch(() => {})
  const partial = await spCount.innerText().catch(() => '')
  await sp.locator('[data-collections-list] input[type="search"]').first().fill('radar')
  await sp.getByRole('button', { name: 'Search the server' }).click()
  await sp
    .waitForFunction(
      () => /server’s search/.test(document.querySelector('[data-collections-count]')?.textContent ?? ''),
      null,
      { timeout: 10000 },
    )
    .catch(() => {})
  const after = await spCount.innerText().catch(() => '')
  check(
    'a partial list says so, and "Search the server" sends q to rel:data and counts what came back',
    /the first 3 listed — the listing goes on/.test(partial) &&
      srvRequests.some((u) => new URL(u).searchParams.get('q') === 'radar') &&
      /2 of 2 returned by the server’s search for “radar” \(2 matched\)/.test(after),
    `${partial} → ${after}`,
  )
  await sp.close()
}

// 4. An API root's Collections list, and a search the server rejects -> shown as an error, not as an empty result
await page.goto(`${BASE_URL}/#${PC}/`)
await page.waitForFunction(() => document.querySelectorAll('svg text').length > 3, null, { timeout: 15000 })
{
  // A flat API root (only Collections under it) has nothing to collapse
  // and no Catalog to open: both commands say so instead of doing nothing.
  check(
    'a flat API root offers neither Collapse nor Expand (both disabled)',
    (await page.getByRole('button', { name: 'Collapse to top level' }).isDisabled()) &&
      (await page.getByRole('button', { name: 'Expand all catalogs' }).isDisabled()),
  )
  const before = (await treeLabels()).length
  await page.locator('svg text', { hasText: 'Planetary Computer' }).first().click()
  await page.waitForTimeout(300)
  // Selecting the open root by its name keeps the tree open (the circle
  // toggles; the label only selects and opens).
  check(
    "clicking the open root's label selects it without collapsing the tree",
    (await treeLabels()).length === before,
    `${before} → ${(await treeLabels()).length}`,
  )
  // A root with few children leaves them to the tree: the contents pane
  // stays closed, and its header toggle opens the list. Pane and toggle are
  // "Children" whatever the children are (Catalogs, Collections or both),
  // never borrowing a Collection's name or icon (DESIGN §128).
  const paneToggle = page.locator('[data-pane-toggle="items"]')
  check(
    'an API root with few Collections keeps its pane closed; the toggle is named Children',
    (await page.locator('[data-contents-pane]').count()) === 0 && (await paneToggle.innerText()).trim() === 'Children',
    await paneToggle.innerText(),
  )
  await paneToggle.click()
  const collList = page.locator('[data-collections-list]')
  await collList.waitFor({ timeout: 5000 }).catch(() => {})
  const count = () => page.locator('[data-collections-count]').innerText()
  const listed = await count()
  await collList.locator('input[type="search"]').first().fill('imagery')
  await page.waitForTimeout(200)
  const filtered = await count()
  const dimmedTree = await page.locator('g[data-dimmed]').count()
  check(
    'the Collections list filters by text over title and keywords, and the tree dims the rest',
    /^\d+$/.test(listed) &&
      filtered === `3 of ${listed}` &&
      dimmedTree === Number(listed) - 3 &&
      (await collList.locator('[data-collection-row]').count()) === 3,
    `${listed} → ${filtered}, dimmed ${dimmedTree}`,
  )
  // The facets are a row of buttons, each opening its values; Escape closes
  // and returns focus. Keywords are "all of": Imagery and Reflectance leave
  // Landsat and Sentinel-2.
  await collList.locator('[data-facet-button="keywords"]').click()
  await collList
    .locator('[data-facet="keywords"] label', { hasText: /^Reflectance/ })
    .locator('input')
    .check()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  const chipTexts = await collList.locator('[data-condition-chips] li').allInnerTexts()
  check(
    'a keyword from the filter bar narrows the list ("all of"), shows as a removable chip, and Escape closes its panel',
    (await count()) === `2 of ${listed}` &&
      chipTexts.some((t) => t.includes('Keywords: Reflectance')) &&
      chipTexts.some((t) => t.includes('imagery')) &&
      (await collList.locator('[data-facet="keywords"]').count()) === 0 &&
      (await page.evaluate(() => document.activeElement?.getAttribute('data-facet-button'))) === 'keywords',
    `${await count()} | ${chipTexts.join(' / ')}`,
  )
  const row = collList.locator('[data-collection-row]').first()
  const rowTitle = (await row.innerText()).split('\n')[0]
  const rowBox = await row.boundingBox()
  await page.mouse.move(rowBox.x + 40, rowBox.y + rowBox.height / 2)
  await page
    .locator('[data-node-tooltip]')
    .waitFor({ timeout: 3000 })
    .catch(() => {})
  check(
    'hovering a Collections list row shows the same hover card as the views',
    (
      (await page
        .locator('[data-node-tooltip]')
        .textContent()
        .catch(() => '')) ?? ''
    ).includes(rowTitle),
    rowTitle,
  )
  await row.locator('button').first().click()
  await page.waitForTimeout(300)
  check(
    'choosing a row shows that Collection in the Inspector and keeps the list',
    (await page.locator('[data-inspector-pane]').innerText()).includes(rowTitle) && (await collList.count()) === 1,
    rowTitle,
  )
  await row.getByRole('button', { name: /Items →/ }).click()
  await page
    .locator('[data-collections-back]')
    .waitFor({ timeout: 5000 })
    .catch(() => {})
  check(
    '"Items →" browses its Items, with the way back to the list ("‹ Children of …")',
    (await page.locator('[data-contents-pane="items"]').count()) === 1 &&
      /^‹ Children of /.test(((await page.locator('[data-collections-back]').textContent()) ?? '').trim()),
  )
  await page.locator('[data-collections-back]').click()
  await collList.waitFor({ timeout: 5000 }).catch(() => {})
  check(
    'back on the list, its text and facets are as they were',
    (await count()) === `2 of ${listed}` &&
      (await collList.locator('input[type="search"]').first().inputValue()) === 'imagery',
    await count(),
  )
  await paneToggle.click()
  check(
    'hiding the Children list un-dims the views (the filter is out of sight), showing it again dims them',
    (await page.locator('g[data-dimmed]').count()) === 0,
    `${await page.locator('g[data-dimmed]').count()} still dimmed`,
  )
  await paneToggle.click()
  await collList.waitFor({ timeout: 5000 }).catch(() => {})
  await page.locator('[data-collections-list] button', { hasText: 'Clear all' }).click()
  // An API root has no Items of its own: no second tab, no search across
  // every Collection (DESIGN §128 — Planetary Computer refuses one).
  check(
    'an API root’s pane is its Collections list only — no cross-Collection Item search',
    (await page.locator('[data-contents-pane] [role="tablist"]').count()) === 0 &&
      (await page.locator('[data-contents-pane="collections"]').count()) === 1,
  )
  // Items are searched inside a Collection.
  await collList
    .locator('[data-collection-row]', { hasText: '3DEP' })
    .getByRole('button', { name: /Items →/ })
    .click()
}
await page.waitForSelector('[data-items-panel]')
const dates = page.locator('input[type="date"]')
await dates.nth(0).fill('1900-01-01')
await dates.nth(1).fill('1900-01-31')
await page.getByRole('button', { name: 'Search', exact: true }).first().click()
await page.waitForFunction(() => /Search request failed|no items match/.test(document.body.innerText), null, {
  timeout: 15000,
})
// The mocked response carries a statusText the real server omits, so match
// the status and the body, not the exact spacing between them.
check(
  'a rejected search shows the server\'s words, not "no items"',
  /Search request failed: 400[^\n]*datetime is out of range/.test(await text()),
  (await text()).match(/Search request failed[^\n]*|no items match[^\n]*/)?.[0],
)
{
  // Removing an applied condition's chip searches again without it.
  const before = searchRequests.length
  await page.locator('[data-items-panel] [data-condition-chips] button[aria-label^="Remove Date"]').click()
  await page.waitForTimeout(500)
  const last = searchRequests[searchRequests.length - 1] ?? ''
  check(
    'removing the Date chip searches again without a datetime',
    searchRequests.length > before && !new URL(last).searchParams.get('datetime'),
    last,
  )
}
check(
  'no search was ever sent without collections= (an API root is not searched across every Collection)',
  searchRequests.length > 0 && searchRequests.every((u) => new URL(u).searchParams.get('collections')),
  searchRequests.filter((u) => !new URL(u).searchParams.get('collections')).join(' '),
)

// 5. Phone layout (390px, touch): the landing hides its sidebar behind a
// Filters button; the explorer shows the outline instead of the canvas,
// with the Inspector as a bottom sheet and a Collection's Items inline.
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
phone.on('pageerror', (e) => pageErrors.push('phone: ' + e.message))
await phone.route('**/*', handleRoute)
await phone.goto(`${BASE_URL}/`)
await phone.waitForSelector('[role="button"][title^="http"]')
const phoneStarColor = await phone
  .locator('.stac-lens-card-star[aria-pressed="false"]')
  .first()
  .evaluate((el) => getComputedStyle(el).color)
check(
  'phone landing: an unstarred card shows its star (no hover to reveal it on touch)',
  !/rgba\(0, 0, 0, 0\)|transparent/.test(phoneStarColor),
  phoneStarColor,
)
check(
  'phone landing: sidebar behind a Filters button, no horizontal overflow',
  (await phone.locator('aside').count()) === 0 &&
    (await phone.getByRole('button', { name: /^Filters/ }).count()) === 1 &&
    (await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)),
)
await phone.goto(`${BASE_URL}/#${PC}/collections/3dep-lidar-returns?bbox=-75.5,39.3,-73.9,41.4`)
await phone.waitForSelector('[role="tree"]', { timeout: 15000 })
await phone.waitForSelector('[role="dialog"][aria-label="Inspector"]', { timeout: 15000 })
await phone.waitForFunction(() => document.querySelectorAll('[role="group"] [role="treeitem"]').length > 0, null, {
  timeout: 15000,
})
const phoneText = await phone.evaluate(() => document.body.innerText)
{
  // The phone opening an API root: it is browsed, but there is no docked
  // column and nothing is searched.
  const pp = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await pp.route('**/*', handleRoute)
  const before = searchRequests.length
  await pp.goto(`${BASE_URL}/#${PC}/`)
  await pp.waitForSelector('[role="treeitem"]', { timeout: 15000 }).catch(() => {})
  await pp.waitForTimeout(500)
  check(
    'phone, API root: the outline lists its Collections, no docked column, no search request',
    (await pp.locator('[role="treeitem"]').count()) > 1 &&
      (await pp.locator('[data-contents-pane]').count()) === 0 &&
      searchRequests.length === before,
    `rows ${await pp.locator('[role="treeitem"]').count()}, searches ${searchRequests.length - before}`,
  )
  await pp.close()
}
check(
  'phone explorer: outline + bottom-sheet Inspector, no canvas, compact banner',
  (await phone.locator('[data-structure-canvas]').count()) === 0 &&
    (await phone.locator('[role="tree"]').count()) >= 1 &&
    /Compact view/.test(phoneText),
  `canvas ${await phone.locator('[data-structure-canvas]').count()}, outline ${await phone.locator('[role="tree"]').count()}, banner ${/Compact view/.test(phoneText)}`,
)
check(
  'phone explorer: no docked panes — no splitters, no pane toggles',
  (await phone.locator('[role="separator"]').count()) === 0 &&
    (await phone.locator('[data-pane-toggle]').count()) === 0,
)
{
  const shareButton = phone.locator('[data-share-button]')
  await shareButton.tap()
  const box = await phone.locator('[data-share-panel]').boundingBox()
  check(
    'phone explorer: Share is an icon button whose panel fits inside the screen',
    (await shareButton.getAttribute('aria-label')) === 'Share' &&
      (await shareButton.innerText()).trim() === '' &&
      !!box &&
      box.x >= 0 &&
      box.x + box.width <= 390,
    JSON.stringify(box),
  )
  await phone.keyboard.press('Escape')
}
check(
  "phone explorer: a Collection's Items listed inline from the recorded search page",
  (await phone.locator('[role="group"] [role="treeitem"]').count()) === 5 &&
    /All 5 items the API returned/.test(phoneText),
  phoneText.match(/All \d+ items[^\n]*|First \d+[^\n]*/)?.[0],
)
await phone.close()

check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))

// 8. The static pages and crawler files generated at build time from
// docs/*.md (scripts/pages) — real URLs a search engine or a crawler that
// runs no JavaScript can read, and the home page's own no-JS shell.
const about = await page.goto(`${BASE_URL}/about/`)
check(
  'static pages: /about/ is a real page with a title, a Markdown alternate and JSON-LD',
  about?.status() === 200 &&
    (await page.locator('h1').innerText()) === 'About STAC Lens' &&
    (await page.locator('link[rel="alternate"][type="text/markdown"]').count()) === 1 &&
    (await page.locator('script[type="application/ld+json"]').count()) === 1,
  `status ${about?.status()}`,
)
const rules = await page.goto(`${BASE_URL}/health-rules/#C-04`)
check(
  'static pages: /health-rules/ has citable rule anchors',
  rules?.status() === 200 && (await page.locator('td#C-04').count()) === 1,
)
const crawlerFiles = {}
for (const path of ['/robots.txt', '/llms.txt', '/catalogs.md', '/og-image.png']) {
  const r = await page.request.get(`${BASE_URL}${path}`)
  crawlerFiles[path] = r.status()
}
check(
  'static pages: robots.txt, llms.txt, a Markdown copy and the Open Graph image are served',
  Object.values(crawlerFiles).every((s) => s === 200),
  JSON.stringify(crawlerFiles),
)
const noJs = await browser.newContext({ javaScriptEnabled: false })
const noJsPage = await noJs.newPage()
await noJsPage.goto(`${BASE_URL}/`)
const noJsText = await noJsPage.locator('#root').innerText()
check(
  'home without JavaScript: the shell describes the app and links the static pages',
  /SpatioTemporal Asset Catalog/.test(noJsText) &&
    (await noJsPage.locator('#root a[href$="/about/"]').count()) === 1 &&
    (await noJsPage.locator('#root a[href$="/health-rules/"]').count()) === 1,
)
await noJs.close()

await browser.close()
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
