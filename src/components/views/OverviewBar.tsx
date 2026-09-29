import type { TreeDatum } from '../../hooks/useStructureTree'
import { structureStats } from './structureStats'

/** The line above an overview view saying what it is drawing — only what
 *  is loaded — and what is still closed. The counts come from the loaded
 *  datum tree, so they update as an expansion lands; the actions that
 *  change them (collapse, expand all catalogs) live in the view switcher's
 *  row, shared by every view. */
export function OverviewBar({ root, isExpanded }: { root: TreeDatum; isExpanded: (href: string) => boolean }) {
  const stats = structureStats(root, isExpanded)
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

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
    </div>
  )
}
