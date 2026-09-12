/** The one tab-button visual language this app uses — originally
 *  Inspector's own Human/JSON switcher, now shared with Item Set's
 *  List/Temporal/Spatial switcher too rather than inventing a second tab
 *  style: asked about directly, "如果是tab切换的话，我不知道是不是应该使用我们
 *  系统中已经有的tab组件" (if it's a tab switch, shouldn't it reuse the tab
 *  component the system already has?). A caller wraps one or more of these
 *  in its own `<div style={{ display: 'flex', borderBottom: '1px solid
 *  var(--color-border)' }}>` — the bar itself isn't part of this component
 *  since its own margin/spacing needs already differ slightly between the
 *  two call sites. */
export function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        background: 'none',
        border: 'none',
        borderBottom: active ? '2px solid var(--color-selection)' : '2px solid transparent',
        color: active ? 'var(--color-selection)' : 'var(--color-text-muted)',
        cursor: 'pointer',
        marginBottom: -1,
      }}
    >
      {label}
    </button>
  )
}
