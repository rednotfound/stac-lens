import { useState } from 'react'

const KNOWN_CATALOGS = [
  {
    title: 'Africa Agriculture Adaptation Atlas',
    description:
      'Climate hazard rasters, scenarios, and real metadata inconsistencies — the primary stress-test fixture for this project.',
    href: 'https://digital-atlas.s3.amazonaws.com/stac/public_stac/catalog.json',
  },
  {
    title: 'STAC spec example catalog',
    description:
      "The spec's own minimal example tree — the floor case: bare-minimum valid STAC, empty collections, no extensions.",
    href: 'https://raw.githubusercontent.com/radiantearth/stac-spec/master/examples/catalog.json',
  },
  // The rest are static catalogs sourced from STAC Index (stacindex.org) —
  // the same public directory STAC Browser itself defers to rather than
  // maintaining its own list — each individually checked here for CORS and
  // valid STAC content before being added, not copied in blind.
  {
    title: 'Capella Space Open Data',
    description: 'SAR (synthetic aperture radar) satellite imagery.',
    href: 'https://capella-open-data.s3.us-west-2.amazonaws.com/stac/catalog.json',
  },
  {
    title: 'Maxar Open Data Catalog',
    description: 'High-resolution optical imagery released for disaster-response events.',
    href: 'https://maxar-opendata.s3.amazonaws.com/events/catalog.json',
  },
  {
    title: 'NZ Imagery',
    description: 'Aerial imagery of New Zealand — a genuinely large tree (800+ links) for scale-testing.',
    href: 'https://nz-imagery.s3.ap-southeast-2.amazonaws.com/catalog.json',
  },
  {
    title: 'Overture Maps Releases',
    description: 'Vector map data from the Overture Maps Foundation.',
    href: 'https://stac.overturemaps.org/catalog.json',
  },
  {
    title: 'fiboa Field Boundaries',
    description: 'Vector agricultural field-boundary datasets.',
    href: 'https://fiboa.org/stac/catalog.json',
  },
  {
    title: 'Polar Geospatial Center DEMs',
    description: 'High-resolution digital elevation models of the polar regions.',
    href: 'https://pgc-opendata-dems.s3.us-west-2.amazonaws.com/pgc-data-stac.json',
  },
]

/** Entry point, not the explorer itself — pick or paste a catalog first,
 *  then move into the coordinated Structure/Time/Space/Detail view. A
 *  STAC Browser gets its first impression right by starting here instead
 *  of dropping straight into a tree; free-text URL input is the actual
 *  "browse any STAC catalog" capability, not just a convenience — it's
 *  also how this list of known catalogs can grow without fabricating
 *  URLs nobody's verified. */
export function LandingPage({ onOpen }: { onOpen: (href: string) => void }) {
  const [url, setUrl] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = url.trim()
    if (trimmed) onOpen(trimmed)
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 32,
        padding: 24,
        background: 'var(--color-bg)',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 32, margin: 0, color: 'var(--color-text)' }}>STAC Lens</h1>
        <p style={{ color: 'var(--color-text-muted)', marginTop: 8, maxWidth: 480, lineHeight: 1.5 }}>
          See the shape of your STAC data. Structure, time, and space as one coordinated view —
          not another STAC Browser.
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 560 }}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a STAC catalog.json URL…"
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
          disabled={!url.trim()}
          style={{
            padding: '10px 18px',
            fontSize: 14,
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            background: 'var(--color-selection)',
            color: '#fff',
            cursor: url.trim() ? 'pointer' : 'not-allowed',
            opacity: url.trim() ? 1 : 0.5,
          }}
        >
          Explore
        </button>
      </form>

      <div style={{ width: '100%', maxWidth: 560 }}>
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            textTransform: 'uppercase',
            letterSpacing: 0.4,
            marginBottom: 8,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
          }}
        >
          <span>Or pick a known catalog</span>
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
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            maxHeight: 340,
            overflow: 'auto',
            paddingRight: 4,
          }}
        >
          {KNOWN_CATALOGS.map((cat) => (
            <button
              key={cat.href}
              onClick={() => onOpen(cat.href)}
              style={{
                textAlign: 'left',
                padding: '12px 14px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 600, color: 'var(--color-text)', fontSize: 14 }}>{cat.title}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                {cat.description}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--color-text-faint)',
                  marginTop: 4,
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
      </div>
    </div>
  )
}
