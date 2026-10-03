import { useState } from 'react'
import { useStructure } from '../../hooks/useStructure'
import { Spinner } from '../Spinner'
import { structureStats } from './structureStats'

/** The two actions on the loaded structure itself — collapse back to the
 *  root's direct children, open every Catalog down to Collection level
 *  (within the tree's budget) — in the view switcher's row, because they
 *  act on the state every view shares (`StructureProvider`), not on one
 *  view's drawing. They used to sit inside the tree canvas; the tree
 *  keeps only "Reset layout", which is about its own dragged positions. */
export function StructureActions() {
  const { root, isExpanded, collapseAll, expandAllCatalogs } = useStructure()
  // Each action is offered only when it would change something — a flat
  // API root (Planetary Computer: 138 Collections, no Catalogs) has neither
  // anything to collapse nor any Catalog to open, and buttons that did
  // nothing read as broken (reported).
  const stats = root ? structureStats(root, isExpanded) : undefined
  const canCollapse = (stats?.expandedBelowTop ?? 0) > 0
  const canExpand = (stats?.unopenedCatalogs ?? 0) > 0
  const [expanding, setExpanding] = useState(false)
  async function expandAll() {
    setExpanding(true)
    try {
      await expandAllCatalogs()
    } finally {
      setExpanding(false)
    }
  }
  return (
    <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
      <button
        type="button"
        onClick={collapseAll}
        disabled={!canCollapse}
        title={
          canCollapse
            ? "Collapse every expanded node back down to just the root's direct children"
            : 'Nothing to collapse — only the top level is open'
        }
        className="stac-lens-view-command"
      >
        <CollapseAllIcon />
        Collapse to top level
      </button>
      <button
        type="button"
        onClick={() => void expandAll()}
        disabled={expanding || !canExpand}
        title={
          canExpand
            ? 'Expand every Catalog down to (but not into) Collection level, within a budget'
            : 'No closed Catalogs to open — every Catalog loaded so far is open'
        }
        className="stac-lens-view-command"
      >
        {expanding ? <Spinner size={11} /> : <ExpandAllIcon />}
        {expanding ? 'Expanding…' : 'Expand all catalogs'}
      </button>
    </span>
  )
}

const glyph = {
  width: 13,
  height: 13,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.3,
  strokeLinecap: 'round' as const,
  'aria-hidden': true,
}
/** ⊟ — fold everything back. */
function CollapseAllIcon() {
  return (
    <svg {...glyph}>
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="M5 8h6" />
    </svg>
  )
}
/** ⊞ — open what is closed. */
function ExpandAllIcon() {
  return (
    <svg {...glyph}>
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="M5 8h6M8 5v6" />
    </svg>
  )
}
