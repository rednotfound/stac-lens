import { knownIssueFor } from '../../data/knownCatalogs'
import { Spinner } from '../Spinner'

/** The two states every structure view shares before it has a tree to
 *  draw: the root failed to load, or is still loading. Same words in each
 *  view, so switching views during a load does not change the message. */
export function StructureFallback({ rootHref, rootError }: { rootHref: string; rootError: string | undefined }) {
  if (rootError) return <RootLoadError rootHref={rootHref} error={rootError} />
  return (
    <div style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--color-text-muted)' }}>
      <Spinner size={18} /> Loading catalog…
    </div>
  )
}

/** The root did not load: what the browser said, then why — the reason a
 *  re-check recorded for a known catalog (DESIGN §129), or the usual
 *  suspects for any other URL. One component for every view (the tree, the
 *  outline and the icicle each had their own copy, worded differently). */
export function RootLoadError({ rootHref, error }: { rootHref: string; error: string }) {
  const issue = knownIssueFor(rootHref)
  return (
    <div data-root-load-error style={{ padding: 24, maxWidth: 480 }}>
      <div style={{ color: 'var(--color-node-warning)', fontWeight: 600, marginBottom: 8 }}>
        Failed to load this catalog
      </div>
      <div style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 8 }}>{error}</div>
      {issue ? (
        <div data-known-issue style={{ color: 'var(--color-text-muted)', fontSize: 12.5, lineHeight: 1.5 }}>
          <strong style={{ color: 'var(--color-node-warning)', fontWeight: 600 }}>
            Probably the known issue (since {issue.since}):
          </strong>{' '}
          {issue.note} It stays in the catalog list in case it comes back.
        </div>
      ) : (
        <div style={{ color: 'var(--color-text-faint)', fontSize: 12 }}>
          This can happen if the URL doesn't point to valid STAC JSON, the server doesn't allow cross-origin browser
          requests (CORS), or the catalog is temporarily unreachable.
        </div>
      )}
    </div>
  )
}
