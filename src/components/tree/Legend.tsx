import { useState } from 'react'
import { TypeIcon, type StacObjectKind } from '../TypeIcon'

const LEGEND_OPEN_STORAGE_KEY = 'stac-lens.legend-open'

function readStoredLegendOpen(): boolean {
  try {
    const stored = localStorage.getItem(LEGEND_OPEN_STORAGE_KEY)
    return stored === null ? true : stored === 'true'
  } catch {
    return true
  }
}

/** The tree's key, bottom-left. Starts open the first time — its whole
 *  purpose is to orient someone immediately — and remembers being closed
 *  across reloads in `localStorage`, because reopening it unasked on every
 *  visit was annoying once the vocabulary was learned. Bottom-left because
 *  the tree fans out from the left toward the right and an open Item Set
 *  box paints above everything; top-left holds the collapse/expand
 *  buttons. */
export function Legend() {
  const [open, setOpenState] = useState(readStoredLegendOpen)

  function setOpen(next: boolean) {
    setOpenState(next)
    try {
      localStorage.setItem(LEGEND_OPEN_STORAGE_KEY, String(next))
    } catch {
      // Storage unavailable (private browsing, blocked site data) — the
      // toggle still works for this session, it just won't persist.
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Show legend"
        style={{
          position: 'absolute',
          bottom: 10,
          left: 10,
          zIndex: 5,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 999,
          padding: '4px 8px',
          cursor: 'pointer',
        }}
      >
        <Dot color="var(--color-node-catalog)" />
        <Dot color="var(--color-node-collection)" />
      </button>
    )
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 10,
        left: 10,
        zIndex: 5,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '8px 12px',
        fontSize: 11,
        color: 'var(--color-text-muted)',
        lineHeight: 1.7,
      }}
    >
      <button
        onClick={() => setOpen(false)}
        title="Hide legend"
        style={{
          position: 'absolute',
          top: 4,
          right: 6,
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          color: 'var(--color-text-muted)',
          fontSize: 12,
        }}
      >
        ✕
      </button>
      <LegendRow icon="Catalog" color="var(--color-node-catalog)" label="Catalog" />
      <LegendRow icon="Collection" color="var(--color-node-collection)" label="Collection" />
      {/* Items and Assets are never tree nodes, but this is the one place
       * all four type icons are taught together — the same glyphs the
       * Inspector uses for its title and its asset rows. No dot swatch for
       * these two: a dot would imply a tree-node color that doesn't exist. */}
      <LegendRow icon="Item" color="var(--color-node-item)" label="Item (Detail Panel only)" showDot={false} />
      <LegendRow icon="Asset" color="var(--color-node-asset)" label="Asset (Detail Panel only)" showDot={false} />
      <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--color-border)' }}>
        <div>● filled — has something to open (children or items)</div>
        <div>○ hollow — already open, or genuinely empty</div>
        <div>┄ dashed ring — your selected Item is inside</div>
        <div>"N items" label — browse via Detail Panel, not the tree</div>
        <div>blue "API" tag — items are live-queried, not a static list</div>
        <div>drag a label (or the Item Set panel) to rearrange freely</div>
      </div>
    </div>
  )
}

function Dot({ color }: { color: string }) {
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
}

function LegendRow({
  icon,
  color,
  label,
  showDot = true,
}: {
  icon: StacObjectKind
  color: string
  label: string
  showDot?: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {showDot && (
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: color,
            display: 'inline-block',
          }}
        />
      )}
      <TypeIcon type={icon} size={12} color={color} />
      {label}
    </div>
  )
}
