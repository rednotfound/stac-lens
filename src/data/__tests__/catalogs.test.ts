import { describe, expect, it } from 'vitest'
import { knownIssueFor, KNOWN_CATALOGS } from '../knownCatalogs'
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

  it('a recorded issue has an ISO since-date no earlier than addedOn, and a note in words', () => {
    const iso = /^\d{4}-\d{2}-\d{2}$/
    for (const cat of KNOWN_CATALOGS) {
      if (!cat.issue) continue
      expect(cat.issue.since, cat.title).toMatch(iso)
      expect(cat.issue.since >= cat.addedOn, `${cat.title}: issue before addedOn`).toBe(true)
      expect(cat.issue.note.trim().length, `${cat.title}: issue note`).toBeGreaterThan(10)
    }
  })

  it('knownIssueFor finds an entry by href, a trailing slash ignored', () => {
    // A fixed list, so the test does not depend on some entry failing today.
    const issue = { since: '2026-10-04', note: 'The URL answers 404.' }
    const list = [
      { ...KNOWN_CATALOGS[0], href: 'https://a.example/stac/', issue },
      { ...KNOWN_CATALOGS[0], href: 'https://b.example/catalog.json', issue: undefined },
    ]
    expect(knownIssueFor('https://a.example/stac/', list)).toEqual(issue)
    expect(knownIssueFor('https://a.example/stac', list)).toEqual(issue)
    expect(knownIssueFor('https://b.example/catalog.json', list)).toBeUndefined()
    expect(knownIssueFor('https://nowhere.example/catalog.json', list)).toBeUndefined()
    expect(knownIssueFor(undefined, list)).toBeUndefined()
  })

  it('no entry is verified after its recorded issue began (a passing entry drops its issue)', () => {
    for (const cat of KNOWN_CATALOGS) {
      if (!cat.issue || !cat.verifiedOn) continue
      expect(
        cat.verifiedOn <= cat.issue.since,
        `${cat.title}: verified ${cat.verifiedOn}, issue since ${cat.issue.since}`,
      ).toBe(true)
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
