import type { SearchFilter } from '../stac/apiSearch'
import { describeDraft, isEmptyQuery, queryToDraft } from '../stac/queryDraft'
import type { StacNode } from '../stac/types'
import type { ShareFact } from './SharePanel'
import { EXPLORER_VIEWS, type ExplorerView } from './views/explorerViews'

/** The Share panel's "This link opens" lines, from the same state the hash
 *  is written from, so the words and the link cannot disagree. Says only
 *  what the link carries: no line for a default (the tree, page 1, no
 *  search). */
export function describeShare({
  rootTitle,
  selected,
  view,
  browsed,
  query,
  page,
  narrow,
}: {
  rootTitle: string
  selected: StacNode | null
  view: ExplorerView
  browsed: StacNode | null
  query: SearchFilter | undefined
  page: { page: number; pageSize: number } | undefined
  narrow: boolean
}): ShareFact[] {
  const facts: ShareFact[] = [{ label: 'Catalog', value: rootTitle }]
  if (selected) facts.push({ label: 'Selected', value: `${selected.title ?? selected.id} · ${selected.type}` })
  if (!narrow && view !== 'tree') {
    facts.push({ label: 'View', value: EXPLORER_VIEWS.find((v) => v.id === view)?.label ?? view })
  }
  const browsedName = browsed ? (browsed.title ?? browsed.id) : undefined
  if (query && !isEmptyQuery(query)) {
    facts.push({
      label: 'Search',
      value: describeDraft(queryToDraft(query), true),
      note: browsedName ? `in ${browsedName}` : undefined,
    })
  }
  if (page && browsed) {
    facts.push({
      label: 'Items',
      value: `page ${page.page}, ${page.pageSize} per page${browsedName ? ` — ${browsedName}` : ''}`,
      note:
        browsed.items.kind === 'cursor'
          ? 'The search runs again when the link opens; the API may have other Items on that page by then.'
          : undefined,
    })
  }
  return facts
}
