import { useState } from 'react'
import type { TreeDatum } from '../../hooks/useStructureTree'
import { Spinner } from '../Spinner'
import { canvasButtonStyle } from './canvasButton'
import { structureStats } from './structureStats'

/** The line above an overview view saying what it is drawing — only what
 *  is loaded — and offering to open the rest. "Load all catalogs" is the
 *  tree's own `expandAllCatalogs` (Catalogs only, never a Collection's
 *  Items, within its budget); nothing is fetched until it is clicked, the
 *  same rule as the tree. The counts come from the loaded datum tree, so
 *  they update as the expansion lands, and the text stays honest when the
 *  budget runs out: whatever is still closed is still counted. */
export function OverviewBar({
  root,
  isExpanded,
  expandAllCatalogs,
  children,
}: {
  root: TreeDatum
  isExpanded: (href: string) => boolean
  expandAllCatalogs: () => Promise<void>
  /** Extra controls a view wants on the same line (e.g. Collapse). */
  children?: React.ReactNode
}) {
  const [loading, setLoading] = useState(false)
  const stats = structureStats(root, isExpanded)
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

  async function loadAll() {
    setLoading(true)
    try {
      await expandAllCatalogs()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
        padding: '8px 12px',
        fontSize: 12,
        color: 'var(--color-text-muted)',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
      }}
    >
      <span>
        {plural(stats.collections, 'Collection')} in {plural(stats.catalogs, 'Catalog')} loaded
        {stats.moreLeaves > 0 && <> · {stats.moreLeaves} children not loaded</>}
        {stats.unopenedCatalogs > 0 && <> · {plural(stats.unopenedCatalogs, 'catalog')} not opened yet</>}
      </span>
      {stats.unopenedCatalogs > 0 && (
        <button
          type="button"
          onClick={() => void loadAll()}
          disabled={loading}
          title="Expand every Catalog down to (but not into) Collection level, within the same budget as the tree"
          style={{ ...canvasButtonStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          {loading && <Spinner size={11} />}
          {loading ? 'Loading…' : 'Load all catalogs'}
        </button>
      )}
      {children}
    </div>
  )
}
