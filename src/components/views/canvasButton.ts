/** The pill button every canvas-level control uses — the shared
 *  "Collapse to top level" / "Expand all catalogs" in the view switcher's
 *  row, the tree's "Reset layout", the "Items ▸" reopen button. One style
 *  so the controls read as one family wherever they sit. */
export const canvasButtonStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 999,
  padding: '4px 10px',
  fontSize: 12,
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
}
