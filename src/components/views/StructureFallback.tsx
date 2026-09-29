import { Spinner } from '../Spinner'

/** The two states every structure view shares before it has a tree to
 *  draw: the root failed to load, or is still loading. Same words in each
 *  view, so switching views during a load does not change the message. */
export function StructureFallback({ rootError }: { rootError: string | undefined }) {
  if (rootError) {
    return (
      <div style={{ padding: 20 }}>
        <div style={{ color: 'var(--color-node-warning)', fontWeight: 600, marginBottom: 8 }}>
          Failed to load this catalog
        </div>
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{rootError}</div>
      </div>
    )
  }
  return (
    <div style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--color-text-muted)' }}>
      <Spinner size={18} /> Loading catalog…
    </div>
  )
}
