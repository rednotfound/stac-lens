// Offline browser smoke test. Drives the built (or dev) app in headless
// Chromium with every Planetary Computer request answered from recorded
// fixtures in tests/fixtures/pc, so it runs in CI without a live server
// and fails only when the app changes. Run with the app served at
// BASE_URL (default http://localhost:5173):
//
//   node tests/smoke.mjs
//
// It covers the paths a contributor is most likely to break: the landing
// page, opening an API root whose children come from /collections, a deep
// link into a Collection with an applied search, a rejected search shown
// as an error, and the Inspector's Spatial map fitting a Collection's bbox.

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
await page.route('**/*', async (route) => {
  const url = route.request().url()
  if (url.startsWith(BASE_URL)) return route.continue()
  if (url.startsWith(PC)) {
    const path = url.slice(PC.length)
    const reply = (name, contentType = 'application/json', status = 200) =>
      route.fulfill({ status, contentType, body: fixture(name) })
    if (path === '/' || path === '') return reply('root.json')
    if (path.startsWith('/collections?')) return reply('collections.json')
    if (path === '/collections/3dep-lidar-returns') return reply('collection-3dep.json')
    if (path.startsWith('/search?')) {
      const q = new URL(url).searchParams
      if (!q.get('collections')) return reply('search-422.txt', 'text/plain', 422)
      return reply('search-3dep-nj.json', 'application/geo+json')
    }
    return route.fulfill({ status: 404, body: 'no fixture for ' + path })
  }
  return route.abort()
})

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
check('landing page lists the known catalogs', /KNOWN CATALOGS \(\d+ OF \d+\)/.test(await text()))
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

// 3. Deep link into a Collection with an applied bbox search
await page.goto(`${BASE_URL}/#${PC}/collections/3dep-lidar-returns?bbox=-75.5%2C39.5%2C-73.5%2C41.5`)
await page.waitForFunction(() => /page \d+ of \d+/.test(document.body.innerText), null, { timeout: 15000 })
check(
  'Search and Results boxes open for the Collection',
  (await titleBars()).join(',') === 'Search API,Results API',
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
check('Inspector flags the two-bbox extent as the spec does', (await text()).includes('exactly two spatial bboxes'))
check('Inspector marks the deprecated license value', (await text()).includes('deprecated value since STAC 1.1'))

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

check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))

await browser.close()
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
