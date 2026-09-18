/** The pill button every canvas-level control uses — the tree's "Collapse
 *  to top level" / "Expand all catalogs" / "Reset layout" and the overview
 *  views' "Load all catalogs". One style so the controls read as one
 *  family wherever they float. */
export const canvasButtonStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 999,
  padding: '4px 10px',
  fontSize: 12,
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
}
