import { useState } from 'react'
import { Logo } from './Logo'
import { LandingFooter } from './ProjectLinks'
import { KNOWN_CATALOGS } from '../data/knownCatalogs'

/** Entry point, not the explorer itself — pick or paste a catalog first,
 *  then move into the coordinated Structure/Time/Space/Detail view. A
 *  STAC Browser gets its first impression right by starting here instead
 *  of dropping straight into a tree; free-text URL input is the actual
 *  "browse any STAC catalog" capability, not just a convenience — it's
 *  also how this list of known catalogs can grow without fabricating
 *  URLs nobody's verified. One search box does both jobs (filter the known
 *  list, or open a pasted URL directly) rather than two overlapping ones —
 *  see docs/DESIGN.md, "Growing the known-catalog list to match STAC Browser's breadth". */
export function LandingPage({
  onOpen,
  error,
}: {
  onOpen: (href: string) => void
  /** Set when a `?node=` deep link failed to resolve (bad/stale URL, CORS,
   *  not valid STAC JSON) — surfaced here rather than a silent fallback,
   *  since arriving via a shared link with no explanation when it fails
   *  would look like the link (or the app) is just broken. */
  error?: string | null
}) {
  // One box, two jobs — paste a URL to open it directly, or type anything
  // else to filter the known-catalog grid below live. Having a separate
  // "paste a URL" field and "filter the list" field side by side was two
  // search bars doing overlapping things; a single input can tell which job
  // it's doing from the text itself; no mode switch for the user to think
  // about.
  const [query, setQuery] = useState('')
  const trimmed = query.trim()
  const looksLikeUrl = /^https?:\/\//i.test(trimmed)

  // A hundred-odd known catalogs is too many to scan by eye in a 340px scroll box —
  // filter client-side by title/description/href rather than adding
  // pagination or grouping, which would be overkill for this list's scale.
  const filteredCatalogs = KNOWN_CATALOGS.filter((cat) => {
    if (!trimmed) return true
    const q = trimmed.toLowerCase()
    return (
      cat.title.toLowerCase().includes(q) ||
      cat.description.toLowerCase().includes(q) ||
      cat.href.toLowerCase().includes(q)
    )
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (looksLikeUrl) onOpen(trimmed)
  }

  return (
    // Top-anchored, not vertically centered — with 69 known catalogs this is
    // a real page with a real list on it, not a small centered dialog. The
    // hero/URL-input stays a narrow, single-decision column; the catalog
    // list below breaks out to the full page width so a wide screen actually
    // shows more at once instead of squeezing 69 cards through a 560px-wide,
    // 340px-tall porthole (the previous layout — genuinely bad once the list
    // grew past ~8 entries; see docs/DESIGN.md).
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 28,
        padding: '48px 24px',
        background: 'var(--color-bg)',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <h1
          style={{
            fontSize: 32,
            margin: 0,
            color: 'var(--color-text)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
          }}
        >
          <Logo size={44} />
          STAC Lens
        </h1>
        <p style={{ color: 'var(--color-text-muted)', marginTop: 8, maxWidth: 480, lineHeight: 1.5 }}>
          See the shape of your STAC data. Structure, time, and space as one coordinated view — not another STAC
          Browser.
        </p>
      </div>

      {error && (
        <div
          style={{
            width: '100%',
            maxWidth: 560,
            padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-node-warning)',
            background: 'var(--color-surface)',
            color: 'var(--color-node-warning)',
            fontSize: 13,
          }}
        >
          Couldn't open the linked catalog: {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 560 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search known catalogs, or paste a STAC catalog.json URL…"
          style={{
            flex: 1,
            padding: '10px 12px',
            fontSize: 14,
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            color: 'var(--color-text)',
          }}
        />
        <button
          type="submit"
          disabled={!looksLikeUrl}
          title={looksLikeUrl ? undefined : 'Type or paste a full https:// URL to open it directly'}
          style={{
            padding: '10px 18px',
            fontSize: 14,
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            background: 'var(--color-selection)',
            color: '#fff',
            cursor: looksLikeUrl ? 'pointer' : 'not-allowed',
            opacity: looksLikeUrl ? 1 : 0.5,
          }}
        >
          Explore
        </button>
      </form>

      <div style={{ width: '100%', maxWidth: 1400, marginTop: 8 }}>
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            textTransform: 'uppercase',
            letterSpacing: 0.4,
            marginBottom: 14,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
          }}
        >
          <span>
            Known catalogs ({filteredCatalogs.length} of {KNOWN_CATALOGS.length})
          </span>
          <span style={{ textTransform: 'none', letterSpacing: 0 }}>
            via{' '}
            <a
              href="https://stacindex.org"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--color-text-muted)' }}
            >
              STAC Index
            </a>
          </span>
        </div>
        {filteredCatalogs.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '8px 2px' }}>
            No known catalog matches "{trimmed}". {looksLikeUrl && 'Press Explore to open it directly.'}
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 10,
            }}
          >
            {filteredCatalogs.map((cat) => (
              <button
                key={cat.href}
                onClick={() => onOpen(cat.href)}
                style={{
                  // Explicit, not left to CSS Grid's own default stretch
                  // behavior — a `<button>` is a form control, and some
                  // browsers size those to their own content rather than
                  // stretching to fill a grid cell the way a plain `<div>`
                  // would, silently reintroducing per-card widths flush
                  // against the buggy visual this fixes. `display: flex` +
                  // the href's own `marginTop: auto` below is what actually
                  // fixes the reported raggedness, though — a differently-
                  // long description (1 line vs. 3) would leave the short
                  // URL line sitting at a different height card to card in
                  // the same row, which reads as uneven, "like it's all
                  // centered", even though nothing is horizontally
                  // centered — pinning the URL to
                  // each card's own bottom edge instead gives every card in
                  // a row the same true bottom line, regardless of how
                  // long its own description happens to be.
                  width: '100%',
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ fontWeight: 600, color: 'var(--color-text)', fontSize: 14 }}>{cat.title}</div>
                  {/* Same tag, same convention, as every other API-backed
                   * node in the app (Structure Lens's own tree, Item Set) —
                   * only the special case (a live query endpoint) gets a
                   * badge; the default (static) case stays plain, matching
                   * STAC Browser's own convention this was originally
                   * copied from. This was an explicit request: STAC Browser
                   * lets you tell static vs. API apart, and this app should
                   * do at least as well. */}
                  {cat.kind === 'api' && (
                    <span
                      style={{
                        display: 'inline-block',
                        flexShrink: 0,
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 7px',
                        borderRadius: 999,
                        background: 'var(--color-badge-api-bg)',
                        color: 'var(--color-badge-api-text)',
                      }}
                    >
                      API
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{cat.description}</div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--color-text-faint)',
                    // The actual fix for the reported unevenness — pushes
                    // this line to the bottom of the card's own flex
                    // column regardless of how many lines the description
                    // above it wrapped to, so every card in a row ends on
                    // the same true baseline instead of wherever its own
                    // description happened to stop.
                    marginTop: 'auto',
                    paddingTop: 8,
                    fontFamily: 'var(--font-mono)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {cat.href}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      <LandingFooter />
    </div>
  )
}
