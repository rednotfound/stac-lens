/** The project's own URLs and the STAC ecosystem it sits in — one data
 *  file read by the React footer (`components/ProjectLinks.tsx`) and by
 *  the static-page generator (`scripts/pages/render.ts`), so the two
 *  footers can never disagree. No React here: the generator runs in Node. */

export const SITE_NAME = 'STAC Lens'
export const TAGLINE = 'See the shape of your STAC data — structure, time, and space as one coordinated view.'
export const REPO_URL = 'https://github.com/rednotfound/stac-lens'
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`
export const ISSUES_URL = `${REPO_URL}/issues`

/** The site's own documentation pages, generated at build time from
 *  `docs/*.md` (see `scripts/build-pages.ts`). Paths are relative to the
 *  deployment base so a sub-path build keeps working. */
export const SITE_PAGES: { label: string; path: string; title: string }[] = [
  { label: 'About', path: 'about/', title: 'What STAC Lens is, what it shows, and what it deliberately is not' },
  { label: 'Health rules', path: 'health-rules/', title: 'Every check the app performs, with the rule it comes from' },
  { label: 'Catalogs', path: 'catalogs/', title: 'The public STAC catalogs and APIs on the landing page, with tags' },
  { label: 'Deploy', path: 'deploy/', title: 'Hosting your own instance: any static host, Docker, sub-paths' },
]

/** The STAC ecosystem this app sits in — the spec and its API, the two
 *  registries the Inspector's extension facts and the API capability gating
 *  are read against, the reference browser this one is explicitly "not
 *  another" of, the directory the landing list comes from, and the
 *  tooling most people arrive from. Every URL checked live before being
 *  listed. */
export const ECOSYSTEM_LINKS: { label: string; href: string; title: string }[] = [
  { label: 'STAC', href: 'https://stacspec.org/', title: 'SpatioTemporal Asset Catalog — the specification’s home' },
  {
    label: 'Spec',
    href: 'https://github.com/radiantearth/stac-spec',
    title: 'STAC core specification (Catalog, Collection, Item)',
  },
  { label: 'API spec', href: 'https://github.com/radiantearth/stac-api-spec', title: 'STAC API specification' },
  { label: 'Extensions', href: 'https://stac-extensions.github.io/', title: 'STAC extensions registry' },
  { label: 'API extensions', href: 'https://stac-api-extensions.github.io/', title: 'STAC API extensions registry' },
  { label: 'STAC Browser', href: 'https://radiantearth.github.io/stac-browser/', title: 'The reference STAC browser' },
  {
    label: 'STAC Index',
    href: 'https://stacindex.org/',
    title: 'Public directory of STAC catalogs and APIs — the source of the landing list',
  },
  {
    label: 'stac-utils',
    href: 'https://github.com/stac-utils',
    title: 'PySTAC, stac-fastapi, stac-validator and friends',
  },
  { label: 'Tutorials', href: 'https://stacspec.org/en/tutorials/', title: 'STAC tutorials' },
  { label: 'OGC', href: 'https://www.ogc.org/standards/stac/', title: 'STAC as an OGC Community Standard' },
]
