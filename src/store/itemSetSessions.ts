import type { NextLink, SearchFilter } from '../stac/apiSearch'
import type { QueryDraft } from '../stac/queryDraft'
import type { StacNode } from '../stac/types'

/** The Item Set's two presentations: the paged list, or the timeline over
 *  a map. */
export type ItemSetView = 'list' | 'time-space'

/** Everything an API Collection's Item Set knows that would be lost when
 *  its panel unmounts: the accumulated cursor buffer, the opaque `next`
 *  link (unrecoverable once dropped — a cursor can only be re-walked from
 *  page one), the applied query and its draft, the page position, the
 *  tab. */
export interface CursorSession {
  items: StacNode[]
  next?: NextLink
  exhausted: boolean
  matched?: number
  appliedQuery: SearchFilter
  hasSearched: boolean
  error?: string
  pageIndex: number
  pageSize: number
  view: ItemSetView
  draft: QueryDraft
  searchCollapsed: boolean
}

/** A static Collection's equivalent: the pages already fetched (one
 *  request per Item — re-fetching them is the expensive part), the page
 *  position, the tab. */
export interface LinksSession {
  pageCache: Record<number, StacNode[]>
  pageIndex: number
  renderedIndex: number
  pageSize: number
  view: ItemSetView
}

/** How many Collections' sessions are kept; the least recently touched
 *  goes first. Twenty is more than a browsing session revisits and keeps
 *  a 4,000-Item buffer from being held twenty times over. */
export const MAX_SESSIONS = 20

/** Per-Collection memory for the Item Set, keyed by href, so its panel can
 *  unmount — the Items panel closed, another Collection browsed, a view
 *  switched — and come back exactly where it was. A plain module, not a
 *  zustand store: the hooks that own this state read it once at mount and
 *  write it as they go; nothing renders from it directly. Cleared when a
 *  different catalog is opened. */
class ItemSetSessions {
  private cursor = new Map<string, CursorSession>()
  private links = new Map<string, LinksSession>()
  /** The last page size a user chose, carried to the next Collection — a
   *  UI preference, not per-Collection state. */
  preferredCursorPageSize?: number
  preferredLinksPageSize?: number

  getCursor(href: string): CursorSession | undefined {
    return this.touch(this.cursor, href)
  }
  setCursor(href: string, patch: Partial<CursorSession>): void {
    const prev = this.cursor.get(href)
    const next: CursorSession = {
      items: [],
      exhausted: false,
      appliedQuery: {},
      hasSearched: false,
      pageIndex: 0,
      pageSize: this.preferredCursorPageSize ?? 40,
      view: 'list',
      draft: { dateStart: '', dateEnd: '' },
      searchCollapsed: false,
      ...prev,
      ...patch,
    }
    if (patch.pageSize !== undefined) this.preferredCursorPageSize = patch.pageSize
    this.put(this.cursor, href, next)
  }
  getLinks(href: string): LinksSession | undefined {
    return this.touch(this.links, href)
  }
  setLinks(href: string, patch: Partial<LinksSession>): void {
    const prev = this.links.get(href)
    const next: LinksSession = {
      pageCache: {},
      pageIndex: 0,
      renderedIndex: 0,
      pageSize: this.preferredLinksPageSize ?? 40,
      view: 'list',
      ...prev,
      ...patch,
    }
    if (patch.pageSize !== undefined) this.preferredLinksPageSize = patch.pageSize
    this.put(this.links, href, next)
  }
  clear(): void {
    this.cursor.clear()
    this.links.clear()
  }
  get size(): number {
    return this.cursor.size + this.links.size
  }

  private touch<T>(map: Map<string, T>, href: string): T | undefined {
    const v = map.get(href)
    if (v !== undefined) {
      map.delete(href)
      map.set(href, v)
    }
    return v
  }
  private put<T>(map: Map<string, T>, href: string, value: T): void {
    map.delete(href)
    map.set(href, value)
    while (map.size > MAX_SESSIONS) {
      const oldest = map.keys().next().value
      if (oldest === undefined) break
      map.delete(oldest)
    }
  }
}

export const itemSetSessions = new ItemSetSessions()

/** The page a Collection's Item Set last showed, from its session — what
 *  a view draws for a Collection that is open in the outline but not the
 *  one the Items panel is on. `undefined` when there is no session (never
 *  browsed, or never searched for an API Collection). */
export function sessionPage(node: StacNode): { items: StacNode[]; pageIndex: number } | undefined {
  if (node.items.kind === 'cursor') {
    const s = itemSetSessions.getCursor(node.href)
    if (!s || !s.hasSearched) return undefined
    return { items: s.items.slice(s.pageIndex * s.pageSize, (s.pageIndex + 1) * s.pageSize), pageIndex: s.pageIndex }
  }
  const s = itemSetSessions.getLinks(node.href)
  if (!s) return undefined
  const items = s.pageCache[s.renderedIndex]
  return items ? { items, pageIndex: s.renderedIndex } : undefined
}
