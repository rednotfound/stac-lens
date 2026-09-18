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
// desktop's view switcher (icicle, radial, outline over the same graph), a deep
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
const handleRoute = async (route) => {
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
// selection rendered as an icicle, a radial tree and an outline. The tree
// is restored at the end so the checks below find their boxes.
await page.getByRole('tab', { name: 'Icicle' }).click()
await page.waitForSelector('g[data-href]')
const icicleCells = await page.locator('g[data-href]').count()
check('icicle: one cell per loaded node (root + 5 Collections)', icicleCells === 6, `cells: ${icicleCells}`)
// Landsat, not 3DEP: the next section deep-links a query into 3DEP, and
// a query arriving for the Collection that is already selected is not
// applied (a known edge of the hash sync; docs/DESIGN.md, "Views beyond
// the tree").
await page.locator('g[data-href$="/collections/landsat-c2-l2"]').click()
await page.waitForFunction(() => document.body.innerText.includes('Landsat Collection 2 Level-2'), null, {
  timeout: 5000,
})
check(
  'icicle: clicking a cell selects it — Inspector follows, cell outlined',
  (await page.locator('g[data-href$="landsat-c2-l2"] rect[stroke-width="2"]').count()) === 1,
)
await page.getByRole('tab', { name: 'Radial' }).click()
await page.waitForSelector('g[data-href] circle')
check(
  'radial: the same nodes, with the selection ring on the selected one',
  (await page.locator('g[data-href]').count()) === 6 &&
    (await page.locator('g[data-href$="landsat-c2-l2"] circle').count()) === 2,
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
