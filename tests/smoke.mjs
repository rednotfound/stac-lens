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
// Items window that follows the browsed Collection across views, a deep
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
// A made-up static Item for the asset-location checks: a credentialed
// s3:// href with an HTTPS alternate, an undeclared s3:// href, an https
// href with an empty path segment, and a plain https href.
const FIXTURE_ROOT = 'https://fixtures.stac-lens.test/catalog.json'
const FIXTURE_ITEM = 'https://fixtures.stac-lens.test/item.json'
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
    // One Item by its own URL: the feature from the search fixture.
    if (path.startsWith('/collections/3dep-lidar-returns/items/')) {
      const id = decodeURIComponent(path.split('/').pop())
      const feature = JSON.parse(fixture('search-3dep-nj.json')).features.find((f) => f.id === id)
      if (feature)
        return route.fulfill({ status: 200, contentType: 'application/geo+json', body: JSON.stringify(feature) })
    }
    if (path.startsWith('/search?')) {
      const q = new URL(url).searchParams
      if (!q.get('collections')) return reply('search-422.txt', 'text/plain', 422)
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
    [...document.querySelectorAll('[title="Drag to move this panel"]')].map((h) => h.innerText.replace(/\n/g, ' ')),
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

// 2. API root: children discovered through /collections
await page.goto(`${BASE_URL}/#${PC}/`)
await page.waitForFunction(() => document.querySelectorAll('svg text').length > 3, null, { timeout: 15000 })
const labels = await treeLabels()
check('API root opens with its Collections as children', labels.length === 6, `labels: ${labels.join(' | ')}`)
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
// The Items window opens for it (search-first: idle until Search); after
// a search its page — the recorded search page, 5 Items, served for any
// collections= search — is also the row under the Collection's cell.
await page.waitForSelector('[data-items-window]', { timeout: 10000 })
await page.locator('[data-items-window]').getByRole('button', { name: 'Search', exact: true }).click()
await page.waitForSelector('g[data-item-href]', { timeout: 10000 })
check(
  'icicle: the Items window opens for the browsed Collection and its page is the row under it',
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
  'the Items window opens for the Collection, with Search above Results',
  (await page.locator('[data-items-window]').count()) === 1 &&
    /USGS 3DEP Lidar Returns.*API/s.test((await titleBars()).join(',')) &&
    (await page.getByRole('button', { name: 'Hide the search conditions' }).count()) === 1,
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
  "tree: the window's page appears as Item leaves under the Collection; Landsat's page last seen stays, dimmed",
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

// 3b. The Items window is the same window in every view: switching to
// the icicle and back leaves it where it was, with its page; the title
// bar still drags it (screen pixels now, not tree coordinates).
await page.getByRole('tab', { name: 'Icicle' }).click()
await page.waitForSelector('g[data-href]')
check(
  'Items window persists across a view switch with its page',
  (await page.locator('[data-items-window]').count()) === 1 && /page 1 of 1 — 5 items total/.test(await text()),
)
check(
  "icicle: the browsed Collection's row is the window's page; Landsat keeps its last page, dimmed",
  (await page.locator('g[data-items-row="current"] g[data-item-href]').count()) === 5 &&
    (await page.locator('g[data-items-row="remembered"] g[data-item-href]').count()) === 5,
  `current: ${await page.locator('g[data-items-row="current"] g[data-item-href]').count()}, remembered: ${await page.locator('g[data-items-row="remembered"] g[data-item-href]').count()}`,
)
await page.getByRole('tab', { name: 'Tree' }).click()
await page.waitForFunction(() => document.querySelectorAll('svg text').length > 3, null, { timeout: 5000 })
{
  const win = page.locator('[data-items-window]')
  const bar = win.locator('[title="Drag to move this panel"]')
  const before = await win.evaluate((el) => el.getBoundingClientRect().left)
  const b = await bar.boundingBox()
  await page.mouse.move(b.x + 40, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x - 40, b.y + b.height / 2, { steps: 6 })
  await page.mouse.up()
  const after = await win.evaluate((el) => el.getBoundingClientRect().left)
  check('Items window drags by its title bar', Math.abs(after - before + 80) < 0.5, `moved ${after - before}px`)
  // Resizes from any edge: the left edge moves x and grows the width,
  // keeping the right edge where it was.
  const edge = page.locator('[data-resize="w"]')
  const e = await edge.boundingBox()
  const rectBefore = await win.evaluate((el) => el.getBoundingClientRect().toJSON())
  await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2)
  await page.mouse.down()
  await page.mouse.move(e.x + e.width / 2 - 60, e.y + e.height / 2, { steps: 6 })
  await page.mouse.up()
  const rectAfter = await win.evaluate((el) => el.getBoundingClientRect().toJSON())
  check(
    'Items window resizes from its left edge with the right edge pinned',
    Math.abs(rectAfter.width - rectBefore.width - 60) < 0.5 && Math.abs(rectAfter.right - rectBefore.right) < 0.5,
    `width ${rectBefore.width} → ${rectAfter.width}, right ${rectBefore.right} → ${rectAfter.right}`,
  )
}
// Close, reopen from the tab row: same page, no refetch (the session).
await page.getByRole('button', { name: 'Close the Items window' }).click()
check(
  'closing the window leaves an Items button in the tab row',
  (await page.locator('[data-items-window]').count()) === 0 &&
    (await page.getByRole('button', { name: /^Items ▸/ }).count()) === 1,
)
await page.getByRole('button', { name: /^Items ▸/ }).click()
await page.waitForSelector('[data-items-window]')
check('reopening restores the search and its page from the session', /page 1 of 1 — 5 items total/.test(await text()))
// Closing and clicking the *same* Collection again also reopens it — a
// selection is an act, not only a value (a reported confusion).
await page.getByRole('button', { name: 'Close the Items window' }).click()
await page.locator('svg text', { hasText: 'USGS 3DEP Lidar Returns' }).first().click()
await page.waitForSelector('[data-items-window]', { timeout: 5000 })
check(
  'clicking the already-selected Collection reopens the closed window',
  (await page.locator('[data-items-window]').count()) === 1,
)

// 3c. Asset access. Browsing never signs anything; selecting an Item
// signs only what is about to be shown (its thumbnail lives in storage
// that refuses unsigned requests), the declared hrefs stay what STAC says,
// and an access link is obtained only when asked for.
check('browsing a catalog signs nothing', signRequests.length === 0, `${signRequests.length} sign request(s)`)
await page.locator('[data-items-window]').getByText('NJ_South_Jersey_FEMA_2018-returns-5m-2-3').first().click()
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

// 3d. An Item opened by its own URL — a reload, a shared link. The API
// Collection's window starts unsearched, so its page is empty; the tree
// still draws the selected Item under its Collection, marked off the page.
{
  const fresh = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  await fresh.route('**/*', handleRoute)
  const id = 'NJ_South_Jersey_FEMA_2018-returns-5m-2-3'
  await fresh.goto(`${BASE_URL}/#${PC}/collections/3dep-lidar-returns/items/${id}`)
  await fresh.waitForSelector('[data-item-leaf][data-off-page]', { timeout: 15000 }).catch(() => {})
  const leaf = fresh.locator('[data-item-leaf][data-off-page]')
  check(
    'an Item opened by its URL is drawn in the tree under its Collection, marked off the page',
    (await leaf.count()) === 1 &&
      (await leaf.getAttribute('data-item-leaf')).endsWith(`/items/${id}`) &&
      /not on the Items window's page/.test(await leaf.textContent()),
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

// 4. Root-level search rejected by the server -> shown as an error, not as an empty result
await page.goto(`${BASE_URL}/#${PC}/`)
await page.waitForFunction(() => document.querySelectorAll('svg text').length > 3, null, { timeout: 15000 })
await page.locator('svg text', { hasText: 'Planetary Computer' }).first().click()
await page.waitForSelector('[title="Drag to move this panel"]')
const dates = page.locator('input[type="date"]')
await dates.nth(0).fill('2020-01-01')
await dates.nth(1).fill('2020-01-31')
await page.getByRole('button', { name: 'Search', exact: true }).first().click()
await page.waitForFunction(() => /Search request failed|no items match/.test(document.body.innerText), null, {
  timeout: 15000,
})
// The mocked response carries a statusText the real server omits, so match
// the status and the body, not the exact spacing between them.
check(
  'a rejected search shows the server\'s words, not "no items"',
  /Search request failed: 422[^\n]*collection is required/.test(await text()),
  (await text()).match(/Search request failed[^\n]*|no items match[^\n]*/)?.[0],
)

// 5. Phone layout (390px, touch): the landing hides its sidebar behind a
// Filters button; the explorer shows the outline instead of the canvas,
// with the Inspector as a bottom sheet and a Collection's Items inline.
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
phone.on('pageerror', (e) => pageErrors.push('phone: ' + e.message))
await phone.route('**/*', handleRoute)
await phone.goto(`${BASE_URL}/`)
await phone.waitForSelector('[role="button"][title^="http"]')
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
check(
  'phone explorer: outline + bottom-sheet Inspector, no canvas, compact banner',
  !/Collapse to top level/.test(phoneText) && /Compact view/.test(phoneText),
)
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
