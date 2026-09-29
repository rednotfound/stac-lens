import { useState } from 'react'
import { useStructure } from '../../hooks/useStructure'
import { Spinner } from '../Spinner'
import { canvasButtonStyle } from './canvasButton'

/** The two actions on the loaded structure itself — collapse back to the
 *  root's direct children, open every Catalog down to Collection level
 *  (within the tree's budget) — in the view switcher's row, because they
 *  act on the state every view shares (`StructureProvider`), not on one
 *  view's drawing. They used to sit inside the tree canvas; the tree
 *  keeps only "Reset layout", which is about its own dragged positions. */
export function StructureActions() {
  const { collapseAll, expandAllCatalogs } = useStructure()
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
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <button
        type="button"
        onClick={collapseAll}
        title="Collapse every expanded node back down to just the root's direct children"
        style={canvasButtonStyle}
      >
        Collapse to top level
      </button>
      <button
        type="button"
        onClick={() => void expandAll()}
        disabled={expanding}
        title="Expand every Catalog down to (but not into) Collection level, within a budget"
        style={{ ...canvasButtonStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        {expanding && <Spinner size={11} />}
        {expanding ? 'Expanding…' : 'Expand all catalogs'}
      </button>
    </span>
  )
}
