import { Spinner } from './Spinner'

/** `EmptyState`'s loading counterpart — same padding/size, plus a spinner,
 *  so every "still fetching" message in the app reads as active rather
 *  than stalled. Not folded into `EmptyState` itself: that component also
 *  renders genuine empty/error messages with no spinner to show. */
export function LoadingState({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: 16,
        color: 'var(--color-text-muted)',
        fontSize: 13,
      }}
    >
      <Spinner size={14} />
      <span>{children}</span>
    </div>
  )
}
