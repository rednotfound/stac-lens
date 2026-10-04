/** One applied condition: what kind it is (muted), its value, and how to
 *  remove it. */
export interface ConditionChip {
  key: string
  /** The condition's kind ("Keywords", "Date"), shown muted before the
   *  value; omitted for a free-text query, shown in quotes. */
  kind?: string
  value: string
  onRemove: () => void
}

/** The applied conditions, always in view, each removable on its own —
 *  the overview Baymard's testing found people rely on to see that a
 *  filter took effect and to undo one without reopening the controls
 *  (DESIGN §128). Shared by the Children list's Filter and an API
 *  Collection's Search, so the two read as one pattern; what differs is
 *  when a change takes effect, which their own controls say. Renders
 *  nothing with no conditions. */
export function ConditionChips({
  chips,
  label,
  fallbackFocus,
}: {
  chips: ConditionChip[]
  label: string
  /** Where focus goes when the last chip is removed (the list's field, the
   *  search's Edit). Otherwise it moves to the next chip's remove button,
   *  never falling to the page. */
  fallbackFocus?: () => void
}) {
  if (chips.length === 0) return null
  function remove(c: ConditionChip, e: React.MouseEvent<HTMLButtonElement>) {
    const list = e.currentTarget.closest('ul')
    const buttons = list ? [...list.querySelectorAll('button')] : []
    const i = buttons.indexOf(e.currentTarget)
    c.onRemove()
    requestAnimationFrame(() => {
      const left = list?.isConnected ? [...list.querySelectorAll('button')] : []
      const target = left[Math.min(i, left.length - 1)]
      if (target) target.focus()
      else fallbackFocus?.()
    })
  }
  return (
    <ul
      aria-label={label}
      data-condition-chips
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 4 }}
    >
      {chips.map((c) => (
        <li
          key={c.key}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 2,
            maxWidth: '100%',
            padding: '1px 2px 1px 8px',
            borderRadius: 999,
            border: '1px solid var(--color-selection)',
            background: 'var(--color-selection-bg)',
            fontSize: 11,
            color: 'var(--color-text)',
          }}
        >
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.kind ? <span style={{ color: 'var(--color-text-muted)' }}>{c.kind}: </span> : null}
            {c.kind ? c.value : `“${c.value}”`}
          </span>
          <button
            type="button"
            onClick={(e) => remove(c, e)}
            aria-label={`Remove ${c.kind ? `${c.kind}: ${c.value}` : `“${c.value}”`}`}
            title="Remove"
            style={{
              flexShrink: 0,
              width: 18,
              height: 18,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              borderRadius: 999,
              background: 'none',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: 13,
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  )
}
