import { describe, expect, it } from 'vitest'
import { KNOWN_CATALOGS } from '../knownCatalogs'
import { KINDS, PUBLISHERS, REGIONS, TOPICS } from '../catalogTags'

// Offline integrity of the known-catalog list (docs/CATALOGS.md). The live
// checks — reachability, CORS, shape — are the verifier's job; this pins
// what can be known from the file alone, so a malformed record fails CI
// rather than rendering as a broken card or an unfilterable entry.
describe('src/data/catalogs.json', () => {
  it('has unique https hrefs and non-empty text', () => {
    const hrefs = new Set<string>()
    for (const cat of KNOWN_CATALOGS) {
      expect(cat.href, cat.title).toMatch(/^https:\/\//)
      expect(hrefs.has(cat.href), `duplicate href ${cat.href}`).toBe(false)
      hrefs.add(cat.href)
      expect(cat.title.trim().length, cat.href).toBeGreaterThan(0)
      expect(cat.description.trim().length, cat.href).toBeGreaterThan(0)
    }
  })

  it('never embeds a key or token in an href', () => {
    for (const cat of KNOWN_CATALOGS) {
      expect(cat.href, cat.title).not.toMatch(/api[_-]?key|token|secret/i)
    }
  })

  it('uses only vocabulary values for every facet', () => {
    for (const cat of KNOWN_CATALOGS) {
      expect(Object.keys(KINDS), `${cat.title}: kind`).toContain(cat.kind)
      expect(cat.topics.length, `${cat.title}: at least one topic`).toBeGreaterThan(0)
      for (const t of cat.topics) expect(Object.keys(TOPICS), `${cat.title}: topic ${t}`).toContain(t)
      for (const r of cat.regions) expect(Object.keys(REGIONS), `${cat.title}: region ${r}`).toContain(r)
      expect(Object.keys(PUBLISHERS), `${cat.title}: publisher`).toContain(cat.publisher)
    }
  })

  it('dates are ISO days, and verifiedOn is never before addedOn', () => {
    const iso = /^\d{4}-\d{2}-\d{2}$/
    for (const cat of KNOWN_CATALOGS) {
      expect(cat.addedOn, cat.title).toMatch(iso)
      if (cat.verifiedOn) {
        expect(cat.verifiedOn, cat.title).toMatch(iso)
        expect(cat.verifiedOn >= cat.addedOn, `${cat.title}: verifiedOn before addedOn`).toBe(true)
      }
    }
  })
})
