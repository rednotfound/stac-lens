import { ECOSYSTEM_LINKS, LICENSE_URL, REPO_URL, SITE_PAGES } from '../data/projectLinks'

export { REPO_URL, LICENSE_URL }

/** The GitHub mark — path from Simple Icons (CC0), inlined so the header
 *  needs no icon library and no external image request. */
export function GitHubMark({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

const linkStyle: React.CSSProperties = {
  color: 'inherit',
  textDecoration: 'none',
  borderBottom: '1px solid var(--color-border)',
}

/** The landing page's page foot: version, license, source — the three
 *  facts a visitor to a deployed instance needs to place what they're
 *  looking at, and the only place they live in full (the catalog view's
 *  header keeps just the GitHub mark). Same footer-links convention STAC
 *  Browser uses; no logo repetition, no marketing line. */
export function LandingFooter() {
  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'center',
  }
  return (
    <footer
      style={{
        marginTop: 'auto',
        // Symmetric breathing room: the last row sat flush against the
        // bottom of the page (reported).
        padding: '32px 24px 36px',
        boxSizing: 'border-box',
        width: '100%',
        fontSize: 12,
        color: 'var(--color-text-muted)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
      }}
    >
      {/* Row 1: this project. */}
      <div style={rowStyle}>
        <span>STAC Lens v{__APP_VERSION__}</span>
        <span aria-hidden="true">·</span>
        <a href={LICENSE_URL} target="_blank" rel="noreferrer" style={linkStyle}>
          Apache-2.0 license
        </a>
        <span aria-hidden="true">·</span>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          style={{ ...linkStyle, display: 'inline-flex', alignItems: 'center', gap: 5 }}
        >
          <GitHubMark size={13} />
          Source on GitHub
        </a>
      </div>
      {/* Row 2: the site's own pages — real URLs generated at build time
       * from docs/*.md (scripts/build-pages.ts), so they are also what a
       * search engine or a crawler that runs no JavaScript can read. Plain
       * anchors, same tab: they are part of this site. */}
      <nav aria-label="About this site" style={rowStyle}>
        {SITE_PAGES.map((p, i) => (
          <span key={p.path} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {i > 0 && <span aria-hidden="true">·</span>}
            <a href={`${import.meta.env.BASE_URL}${p.path}`} title={p.title} style={linkStyle}>
              {p.label}
            </a>
          </span>
        ))}
      </nav>
      {/* Row 3: the ecosystem it belongs to — fainter, one step below the
       * project's own line, so the two read as "about this" then "about
       * STAC" rather than one undifferentiated link pile. */}
      <nav aria-label="STAC ecosystem" style={{ ...rowStyle, color: 'var(--color-text-faint)', fontSize: 11.5 }}>
        <span style={{ fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', fontSize: 10 }}>
          STAC ecosystem
        </span>
        {ECOSYSTEM_LINKS.map((l, i) => (
          <span key={l.href} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {i > 0 && <span aria-hidden="true">·</span>}
            <a href={l.href} target="_blank" rel="noreferrer" title={l.title} style={linkStyle}>
              {l.label}
            </a>
          </span>
        ))}
      </nav>
    </footer>
  )
}
