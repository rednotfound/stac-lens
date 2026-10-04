import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApiConformance } from '../../hooks/useApiConformance'
import { useStructure } from '../../hooks/useStructure'
import { COLLECTIONS_SAFETY_CAP } from '../../hooks/useStructureTree'
import { fetchCollectionsPage, type NextLink } from '../../stac/apiSearch'
import {
  COLLECTION_FACETS,
  collectionFacetCounts,
  EMPTY_COLLECTION_FILTER,
  filterCollections,
  isFilterActive,
  toggleFacetSelection,
  type CollectionFacetId,
  type CollectionFilter,
} from '../../stac/collectionFacets'
import { supportsCollectionFreeText } from '../../stac/conformance'
import { loader } from '../../stac/loaderInstance'
import type { StacNode } from '../../stac/types'
import { filterFor, useCollectionListStore, type ServerResults } from '../../store/collectionList'
import { useSelectionStore } from '../../store/selection'
import { formControlStyle } from '../ItemSetBrowser'
import { Spinner } from '../Spinner'
import { ConditionChips, type ConditionChip } from '../ConditionChips'
import { useDismiss } from '../useDismiss'
import { NodeTooltip } from '../tree/NodeTooltip'
import { hasDirectItems, hoverInfoFor, nodeColor, type HoverInfo, type TooltipState } from '../tree/treeGeometry'
import { TypeIcon } from '../TypeIcon'
import { containerChildren } from './containerChildren'

/** From how many values a facet offers its own find field. */
const FACET_FIND_FROM = 12

/** The Collections list (DESIGN §128): the browsed node's child Catalogs
 *  and Collections, as the shared structure loaded them, with a text
 *  filter and facets read from what each Collection declares. Choosing a
 *  row selects that Collection — the Inspector shows it, the views reveal
 *  it — and leaves this list where it is; "Items →" browses it. The views
 *  light the matching children and dim the rest (`useCollectionHighlight`);
 *  the tree itself is never re-shaped. Counts are only what is loaded or
 *  declared. When the list is incomplete and the API declares Collection
 *  Search free text, the text can be sent to the server instead. */
export function CollectionsList({ container }: { container: StacNode }) {
  const href = container.href
  const { root, isExpanded, isLoading, open } = useStructure()
  const kids = containerChildren(root, href, isExpanded, isLoading, COLLECTIONS_SAFETY_CAP)
  const filter = useCollectionListStore((s) => filterFor(s.filters, href))
  const setFilter = useCollectionListStore((s) => s.setFilter)
  const server = useCollectionListStore((s) => s.serverResults[href])
  const setServerResults = useCollectionListStore((s) => s.setServerResults)
  const setOrigin = useCollectionListStore((s) => s.setOrigin)
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  const select = useSelectionStore((s) => s.select)
  const conformsTo = useApiConformance(container)
  const textRef = useRef<HTMLInputElement>(null)
  // The same hover card as every view and the Items list (`hoverInfoFor`):
  // full title, description, preview — the row itself shows two lines.
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  // Listing a node means opening it in the structure: the list is the
  // structure's own children, never a second fetch of them. Once per node,
  // and only ever opening — a node the person collapses in a view while
  // its list is shown stays collapsed.
  const openedFor = useRef<string | null>(null)
  useEffect(() => {
    // Open (or already open — the root opens with the structure): from now
    // on, a collapse is the person's, and is left alone.
    if (kids.status === 'ready' || kids.status === 'loading') openedFor.current = href
    if (kids.status !== 'not-open' || openedFor.current === href) return
    openedFor.current = href
    open(href)
  }, [kids.status, href, open])

  const update = (f: CollectionFilter) => setFilter(href, f)
  const setText = (text: string) => {
    update({ ...filter, text })
    // Server results answer one query; editing the text leaves them.
    if (server && server.q !== text.trim()) setServerResults(href, undefined)
  }

  const canAskServer =
    !kids.complete && kids.status === 'ready' && !!container.dataHref && supportsCollectionFreeText(conformsTo)
  const [serverState, setServerState] = useState<{ loading: boolean; error?: string }>({ loading: false })
  // The text as it is now, for a server answer that comes back after it
  // changed: that answer is to a question no longer asked, and is dropped.
  const textNow = useRef(filter.text)
  useEffect(() => {
    textNow.current = filter.text
  })
  async function askServer() {
    const q = filter.text.trim()
    if (!q || !container.dataHref) return
    setServerState({ loading: true })
    try {
      const hrefs: string[] = []
      let next: NextLink | undefined
      let matched: number | undefined
      do {
        const page = await fetchCollectionsPage(container.dataHref, { limit: 1000, next, q })
        for (const n of page.items) loader.cachePreFetched(n)
        hrefs.push(...page.items.map((n) => n.href))
        matched ??= page.matched
        next = page.next
      } while (next && hrefs.length < COLLECTIONS_SAFETY_CAP)
      if (textNow.current.trim() === q) setServerResults(href, { q, hrefs, matched, more: !!next })
      setServerState({ loading: false })
    } catch (err) {
      setServerState({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  // The pool the facets and the list work over: the loaded children, or the
  // server's answer to the text (which then is not applied locally again).
  const pool = useMemo(
    () => (server ? server.hrefs.map((h) => loader.get(h)).filter((n): n is StacNode => !!n) : kids.children),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- children are rebuilt on every structure render; their count and ends say when they changed
    [server, kids.children.length, kids.children[0]?.href, kids.children[kids.children.length - 1]?.href],
  )
  const localFilter = useMemo(() => (server ? { ...filter, text: '' } : filter), [server, filter])
  const shown = useMemo(() => filterCollections(pool, localFilter), [pool, localFilter])
  const active = isFilterActive(filter) || !!server
  // The applied conditions, each removable: the text (or the server's
  // search it was sent as), then every selected value under its field.
  const spellings = useMemo(() => {
    const m = new Map<string, string>()
    for (const facet of COLLECTION_FACETS) {
      for (const c of collectionFacetCounts(pool, EMPTY_COLLECTION_FILTER, facet.id))
        m.set(`${facet.id}:${c.key}`, c.label)
    }
    return m
  }, [pool])
  // Facet counts and which fields exist, computed when the pool or the
  // filter changes — not on every hover-card move, which re-renders the list.
  const facetCounts = useMemo(
    () =>
      Object.fromEntries(
        COLLECTION_FACETS.map((f) => [f.id, collectionFacetCounts(pool, localFilter, f.id)]),
      ) as Record<CollectionFacetId, ReturnType<typeof collectionFacetCounts>>,
    [pool, localFilter],
  )
  const declaredFacets = useMemo(
    () =>
      new Set(
        COLLECTION_FACETS.filter((f) => [...spellings.keys()].some((k) => k.startsWith(`${f.id}:`))).map((f) => f.id),
      ),
    [spellings],
  )
  const chips: ConditionChip[] = []
  if (server) {
    chips.push({
      key: 'server',
      kind: 'Server search',
      value: server.q,
      onRemove: () => {
        setServerResults(href, undefined)
        update({ ...filter, text: '' })
      },
    })
  } else if (filter.text.trim()) {
    chips.push({ key: 'text', value: filter.text.trim(), onRemove: () => setText('') })
  }
  for (const facet of COLLECTION_FACETS) {
    for (const key of filter.selected[facet.id]) {
      chips.push({
        key: `${facet.id}:${key}`,
        kind: facet.label,
        value: spellings.get(`${facet.id}:${key}`) ?? key,
        onRemove: () => update(toggleFacetSelection(filter, facet.id, key)),
      })
    }
  }

  if (kids.status === 'absent' || (kids.status === 'not-open' && openedFor.current === href)) {
    return (
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
        {kids.status === 'absent'
          ? `${container.title ?? container.id} is not drawn in the structure yet — its children are listed once it is.`
          : `${container.title ?? container.id} is closed in the structure — open it there to list its children.`}
      </div>
    )
  }
  if (kids.status !== 'ready') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-muted)' }}>
        <Spinner size={12} /> Loading the children of {container.title ?? container.id}…
      </div>
    )
  }

  return (
    <div data-collections-list style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (canAskServer) void askServer()
        }}
        style={{ display: 'flex', gap: 6 }}
      >
        <input
          ref={textRef}
          type="search"
          value={filter.text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Filter by title, id, description, keywords"
          aria-label="Filter the children"
          style={{ ...formControlStyle, flex: 1, minWidth: 0 }}
        />
        {canAskServer && (
          <button
            type="submit"
            disabled={!filter.text.trim() || serverState.loading}
            title="This list is not complete: send the text to the API's Collection Search instead"
            className="stac-lens-view-command"
          >
            {serverState.loading ? <Spinner size={11} /> : null}
            Search the server
          </button>
        )}
      </form>
      {serverState.error && (
        <div role="alert" style={{ color: 'var(--color-node-warning)', fontSize: 11.5 }}>
          ⚠ {serverState.error}
        </div>
      )}

      <FilterBar
        counts={facetCounts}
        declared={declaredFacets}
        selected={localFilter.selected}
        onToggle={(facet, key) => update(toggleFacetSelection(filter, facet, key))}
      />

      <ConditionChips chips={chips} label="Applied filters" fallbackFocus={() => textRef.current?.focus()} />

      <CountLine
        shown={shown.length}
        pool={pool.length}
        kids={kids}
        server={server}
        active={active}
        onClear={() => {
          update(EMPTY_COLLECTION_FILTER)
          setServerResults(href, undefined)
        }}
      />

      <ul role="list" aria-label="Children" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {shown.map((child) => (
          <CollectionRow
            key={child.href}
            node={child}
            selected={selectedHref === child.href}
            onSelect={() => select(child.href, { keepBrowsing: true })}
            onHover={(info, x, y) => setTooltip(info ? { ...info, x, y } : null)}
            onBrowse={() => {
              setOrigin(href)
              select(child.href)
            }}
          />
        ))}
      </ul>
      {shown.length === 0 && (
        <div style={{ color: 'var(--color-text-muted)' }}>
          No {server ? 'result of the server’s search' : 'loaded child'} matches these conditions.
        </div>
      )}
      {tooltip && createPortal(<NodeTooltip tooltip={tooltip} />, document.body)}
    </div>
  )
}

function CountLine({
  shown,
  pool,
  kids,
  server,
  active,
  onClear,
}: {
  shown: number
  pool: number
  kids: ReturnType<typeof containerChildren>
  server?: ServerResults
  active: boolean
  onClear: () => void
}) {
  let text: string
  if (server) {
    const returned = server.more ? `the first ${pool}` : `${pool}`
    const total = server.matched != null ? ` (${server.matched} matched)` : server.more ? ' — it has more' : ''
    text = `${shown} of ${returned} returned by the server’s search for “${server.q}”${total}`
  } else if (kids.complete) {
    text = active ? `${shown} of ${pool}` : `${pool}`
  } else if (kids.declaredTotal != null) {
    text = `${active ? `${shown} of ` : ''}the ${pool} loaded — ${kids.declaredTotal} declared`
  } else {
    text = `${active ? `${shown} of ` : ''}the first ${pool} listed — the listing goes on`
  }
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, color: 'var(--color-text-muted)', fontSize: 11.5 }}>
      <span data-collections-count style={{ flex: 1 }}>
        {text}
      </span>
      {active && (
        <button type="button" onClick={onClear} className="stac-lens-view-command" style={{ height: 22 }}>
          Clear all
        </button>
      )}
    </div>
  )
}

/** The facets as a row of buttons, one per declared field, each opening its
 *  values in a small panel — the filter bar of GitHub's and Airbnb's lists,
 *  which keeps the conditions to two lines in a narrow pane and gives the
 *  list its height (DESIGN §128; the stacked groups took half the pane).
 *  A field no child declares is a disabled button that says so. */
function FilterBar({
  counts,
  declared,
  selected,
  onToggle,
}: {
  counts: Record<CollectionFacetId, ReturnType<typeof collectionFacetCounts>>
  declared: ReadonlySet<CollectionFacetId>
  selected: CollectionFilter['selected']
  onToggle: (facet: CollectionFacetId, key: string) => void
}) {
  return (
    <div role="group" aria-label="Filter by" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {COLLECTION_FACETS.map((facet) => (
        <FacetButton
          key={facet.id}
          facet={facet}
          counts={counts[facet.id]}
          declared={declared.has(facet.id)}
          selected={selected[facet.id]}
          onToggle={(key) => onToggle(facet.id, key)}
        />
      ))}
    </div>
  )
}

const FACET_PANEL_WIDTH = 260

function FacetButton({
  facet,
  counts,
  declared,
  selected,
  onToggle,
}: {
  facet: (typeof COLLECTION_FACETS)[number]
  counts: ReturnType<typeof collectionFacetCounts>
  /** Whether any listed child declares this field at all — not whether the
   *  current text leaves one: a field the text narrows to nothing still
   *  exists, and says so in its panel. */
  declared: boolean
  selected: readonly string[]
  onToggle: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [find, setFind] = useState('')
  const [anchor, setAnchor] = useState({ top: 0, left: 0, maxHeight: 300 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const findRef = useRef<HTMLInputElement>(null)
  const panelId = useId()
  const close = (returnFocus: boolean) => {
    setOpen(false)
    setFind('')
    if (returnFocus) buttonRef.current?.focus()
  }
  useDismiss(open, { button: buttonRef, panel: panelRef }, close)
  useEffect(() => {
    if (!open) return
    ;(findRef.current ?? panelRef.current?.querySelector('input'))?.focus()
    // Placed once under its button: if the pane scrolls or the window
    // resizes, it would float away from it — close it instead.
    const onMove = (e: Event) => {
      if (e.target instanceof Node && panelRef.current?.contains(e.target)) return
      close(false)
    }
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `close` only sets state and moves focus
  }, [open])

  const none = !declared && selected.length === 0
  const q = find.trim().toLowerCase()
  // Selected values first, and kept in view whatever is typed in the find field.
  const ordered = [
    ...counts.filter((c) => selected.includes(c.key)),
    ...counts.filter((c) => !selected.includes(c.key)),
  ]
  const visible = q ? ordered.filter((c) => selected.includes(c.key) || c.label.toLowerCase().includes(q)) : ordered

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-facet-button={facet.id}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-disabled={none || undefined}
        title={none ? `No child here declares ${facet.source}` : `Filter by ${facet.label} (${facet.source})`}
        aria-description={none ? `No child here declares ${facet.source}` : undefined}
        onClick={() => {
          // Unavailable, but focusable, so a keyboard user can reach the
          // reason (a disabled button cannot be focused at all).
          if (none) return
          if (open) return close(false)
          const r = buttonRef.current!.getBoundingClientRect()
          const width = Math.min(FACET_PANEL_WIDTH, window.innerWidth - 16)
          setAnchor({
            top: r.bottom + 4,
            left: Math.min(Math.max(8, r.left), window.innerWidth - width - 8),
            maxHeight: Math.max(160, window.innerHeight - r.bottom - 16),
          })
          setOpen(true)
        }}
        className="stac-lens-filter-button"
        data-active={selected.length > 0 || undefined}
      >
        {facet.label}
        {selected.length > 0 && <span className="stac-lens-filter-count">{selected.length}</span>}
        <span aria-hidden style={{ fontSize: 9 }}>
          ▾
        </span>
      </button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={`Filter by ${facet.label}`}
          data-facet={facet.id}
          style={{
            position: 'fixed',
            top: anchor.top,
            left: anchor.left,
            zIndex: 60,
            width: `min(${FACET_PANEL_WIDTH}px, calc(100vw - 16px))`,
            maxHeight: anchor.maxHeight,
            overflow: 'auto',
            boxSizing: 'border-box',
            padding: 8,
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.16)',
            fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
            <span style={{ fontWeight: 600 }}>{facet.label}</span>
            <span
              style={{ color: 'var(--color-text-faint)', fontSize: 10.5 }}
              title={`Read from each Collection’s ${facet.source}`}
            >
              {facet.combine === 'all' ? 'a child must have all the selected' : 'any of the selected'}
            </span>
          </div>
          {counts.length > FACET_FIND_FROM && (
            <input
              ref={findRef}
              type="search"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder={`Find among ${counts.length}`}
              aria-label={`Find a value in ${facet.label}`}
              style={{ ...formControlStyle, width: '100%', boxSizing: 'border-box', marginBottom: 4, fontSize: 11 }}
            />
          )}
          {visible.map((c) => {
            const on = selected.includes(c.key)
            return (
              <label
                key={c.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '2px 0',
                  cursor: 'pointer',
                  fontSize: 11.5,
                }}
              >
                <input type="checkbox" checked={on} onChange={() => onToggle(c.key)} style={{ margin: 0 }} />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflowWrap: 'anywhere',
                    color: on ? 'var(--color-selection)' : undefined,
                  }}
                >
                  {c.label}
                </span>
                <span style={{ color: 'var(--color-text-faint)', fontVariantNumeric: 'tabular-nums' }}>{c.count}</span>
              </label>
            )
          })}
          {visible.length === 0 && <div style={{ color: 'var(--color-text-faint)' }}>Nothing matches “{find}”.</div>}
        </div>
      )}
    </>
  )
}

function CollectionRow({
  node,
  selected,
  onSelect,
  onBrowse,
  onHover,
}: {
  node: StacNode
  selected: boolean
  onSelect: () => void
  onBrowse: () => void
  onHover: (info: HoverInfo | null, clientX: number, clientY: number) => void
}) {
  const hasItems = hasDirectItems(node)
  const opens = hasItems || node.childHrefs.length > 0 || !!node.childrenEndpoint || !!node.collectionsEndpoint
  return (
    <li
      data-collection-row={node.href}
      aria-current={selected || undefined}
      onMouseMove={(e) => onHover(hoverInfoFor(node), e.clientX, e.clientY)}
      onMouseLeave={() => onHover(null, 0, 0)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        borderBottom: '1px solid var(--color-border)',
        background: selected ? 'var(--color-selection-bg)' : undefined,
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        title={`Show ${node.title ?? node.id} in the Inspector — this list stays`}
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 6,
          padding: '5px 4px',
          border: 'none',
          background: 'none',
          font: 'inherit',
          textAlign: 'left',
          color: 'var(--color-text)',
          cursor: 'pointer',
        }}
      >
        <span style={{ paddingTop: 1, flexShrink: 0 }}>
          <TypeIcon type={node.type} size={13} color={nodeColor(node)} />
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: selected ? 600 : 500, overflowWrap: 'anywhere' }}>
            {node.title ?? node.id}
          </span>
          {node.title && node.title !== node.id && (
            <span
              style={{
                display: 'block',
                fontSize: 10.5,
                color: 'var(--color-text-faint)',
                fontFamily: 'var(--font-mono)',
                overflowWrap: 'anywhere',
              }}
            >
              {node.id}
            </span>
          )}
        </span>
      </button>
      {opens && (
        <button
          type="button"
          onClick={onBrowse}
          className="stac-lens-view-command"
          title={
            hasItems ? `Browse the Items of ${node.title ?? node.id}` : `Browse what ${node.title ?? node.id} contains`
          }
          style={{ flexShrink: 0, fontSize: 11 }}
        >
          {hasItems ? 'Items' : 'Open'} →
        </button>
      )}
    </li>
  )
}
