import { useRef, useState } from 'react'
import { Logo } from './Logo'
import { LandingFooter } from './ProjectLinks'
import { KNOWN_CATALOGS, type KnownCatalog } from '../data/knownCatalogs'
import { FACETS, type FacetDef, type FacetId } from '../data/catalogTags'
import {
  EMPTY_SELECTION,
  facetCounts,
  facetValues,
  filterCatalogs,
  isSelectionEmpty,
  toggleFacetValue,
  type FacetSelection,
} from '../data/catalogFilters'
import { useLandingPrefsStore } from '../store/landingPrefs'
import { useStickySidebar } from '../hooks/useStickySidebar'
import { useIsNarrow } from '../hooks/useMediaQuery'

/** Entry point, not the explorer itself. Two things happen here, in this
 *  order of importance:
 *
 *  1. **The field.** One large field, two jobs: type a name, a topic or a
 *     place and the list below filters live; paste a URL and Open takes
 *     you into that catalog. Most visitors come to look at data rather
 *     than to bring their own, and a prominent field gets keywords typed
 *     into it whatever its placeholder says — so it has to answer them. A
 *     version with a URL-only hero and a small list filter in the toolbar
 *     was tried and reverted for that reason.
 *  2. **Browse the known catalogs**: a faceted catalog browser — sidebar
 *     of collapsible facet groups with counts, main area of cards, each
 *     card carrying its own clickable tags, and the list's own name
 *     filter in its toolbar. The pattern Hugging Face's dataset hub, NASA
 *     Earthdata and CKAN portals share; Baymard's testing calls sidebar
 *     filtering proven, and calls a wall of horizontal filter chips (our
 *     first attempt) the failure mode. Cards rather than rows by the
 *     owner's choice: the sidebar carries the structure, so the main area
 *     can afford to look full.
 *
 *  Favorites and recently opened roots are per-browser
 *  (`store/landingPrefs.ts`); the facet vocabulary is ours
 *  (`data/catalogTags.ts`), since neither STAC nor STAC Index has one.
 *  See docs/DESIGN.md, "Finding something in a hundred catalogs". */
export function LandingPage({
  onOpen,
  error,
}: {
  onOpen: (href: string) => void
  /** Set when a `?node=` deep link failed to resolve (bad/stale URL, CORS,
   *  not valid STAC JSON) — surfaced here rather than a silent fallback,
   *  since arriving via a shared link with no explanation when it fails
   *  would look like the link (or the app) is just broken. */
  error?: string | null
}) {
  // One field, two jobs. Most visitors come to look at data, not to bring
  // their own; a prominent field invites typing a name or a topic, and it
  // must answer that. So typing filters the list below live, and pasting
  // a URL arms the Open button — the text tells which is meant. (A version
  // with the URL field alone and a small list filter in the toolbar was
  // tried and reverted: the big field still got the keywords.) A URL never
  // filters the list — that would show zero results and read as broken.
  const [input, setInput] = useState('')
  const [selection, setSelection] = useState<FacetSelection>(EMPTY_SELECTION)
  const [view, setView] = useState<View>('all')
  const [sort, setSort] = useState<SortKey>('name')
  const url = input.trim()
  const looksLikeUrl = /^https?:\/\/\S+$/i.test(url)
  const query = looksLikeUrl ? '' : url

  const sidebarWrapperRef = useRef<HTMLElement>(null)
  const sidebarSpacerRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)
  // Phone layout: no sidebar column — the same facet groups live behind a
  // Filters button in the toolbar (a full-screen panel), the applied chips
  // stay visible in the toolbar, and cards run in one column.
  const narrow = useIsNarrow()
  const [filtersOpen, setFiltersOpen] = useState(false)
  useStickySidebar(sidebarWrapperRef, sidebarSpacerRef, sidebarRef, { enabled: !narrow })

  const favorites = useLandingPrefsStore((s) => s.favorites)
  const recent = useLandingPrefsStore((s) => s.recent)
  const clearRecent = useLandingPrefsStore((s) => s.clearRecent)

  const byHref = new Map(KNOWN_CATALOGS.map((c) => [c.href, c]))
  // The population the facets and the cards work over. Favorites and
  // recents that are no longer (or never were) list entries still appear,
  // as thin cards built from the stored title; they carry no tags, so
  // facet filters skip them.
  const population: Row[] =
    view === 'favorites'
      ? favorites.map((f) => byHref.get(f.href) ?? { href: f.href, title: f.title })
      : view === 'recent'
        ? recent.map((r) => byHref.get(r.href) ?? { href: r.href, title: r.title })
        : [...KNOWN_CATALOGS]
  const known = population.filter(isKnown)
  const filtered = filterCatalogs(known, query, selection)
  const thin = isSelectionEmpty(selection) ? population.filter((r) => !isKnown(r) && matchesThin(r, query)) : []
  const rows: Row[] = view === 'recent' ? [...filtered, ...thin] : [...sortRows(filtered, sort), ...thin]

  const toggle = (facet: FacetId, value: string) => setSelection((sel) => toggleFacetValue(sel, facet, value))

  const sidebarProps: SidebarContentProps = {
    view,
    setView,
    favoritesCount: favorites.length,
    recentCount: recent.length,
    known,
    query,
    selection,
    toggle,
  }

  function handleOpen(e: React.FormEvent) {
    e.preventDefault()
    if (looksLikeUrl) onOpen(url)
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        background: 'var(--color-bg)',
      }}
    >
      {/* Hero: the product's one real entrance. Large, centered, one job. */}
      <div
        style={{
          width: '100%',
          maxWidth: 760,
          boxSizing: 'border-box',
          padding: narrow ? '32px 16px 20px' : '56px 24px 40px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 18,
          textAlign: 'center',
        }}
      >
        <h1
          style={{
            fontSize: narrow ? 26 : 32,
            margin: 0,
            color: 'var(--color-text)',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <Logo size={44} />
          STAC Lens
        </h1>
        <p style={{ color: 'var(--color-text-muted)', margin: 0, maxWidth: 520, lineHeight: 1.5 }}>
          See the shape of your STAC data — structure, time, and space as one coordinated view.
        </p>
        <form onSubmit={handleOpen} style={{ display: 'flex', gap: 8, width: '100%', marginTop: 6 }}>
          <input
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              // A search from the hero is a search of everything.
              if (view !== 'all' && e.target.value.trim()) setView('all')
            }}
            placeholder="Search catalogs by name, topic or place — or paste a STAC URL to open it"
            aria-label="Search catalogs or paste a STAC URL"
            spellCheck={false}
            style={{
              flex: 1,
              padding: '13px 16px',
              fontSize: 16,
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-text)',
              boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
            }}
          />
          <button
            type="submit"
            disabled={!looksLikeUrl}
            title={
              looksLikeUrl ? undefined : 'Paste a full https:// URL to open it; plain text searches the list below'
            }
            style={{
              padding: '13px 22px',
              fontSize: 16,
              fontWeight: 600,
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: 'var(--color-brand)',
              color: 'var(--color-on-brand)',
              cursor: looksLikeUrl ? 'pointer' : 'not-allowed',
              opacity: looksLikeUrl ? 1 : 0.5,
            }}
          >
            Open
          </button>
        </form>
        {/* Live answer to whatever is in the field, so the effect of typing
         * is known even when the list is below the fold. Empty when the
         * field is empty: an idle explanation here read as filler. */}
        <div style={{ fontSize: 13, color: 'var(--color-text-faint)', minHeight: 18 }} aria-live="polite">
          {looksLikeUrl
            ? 'Press Open or Enter to explore this catalog.'
            : query
              ? `${rows.length} of ${population.length} catalogs match — listed below.`
              : ''}
        </div>
        {error && (
          <div
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-node-warning)',
              background: 'var(--color-surface)',
              color: 'var(--color-node-warning)',
              fontSize: 13,
              textAlign: 'left',
            }}
          >
            Couldn't open the linked catalog: {error}
          </div>
        )}
      </div>

      {/* Browser: sidebar + cards. */}
      <div
        style={{
          width: '100%',
          maxWidth: 1400,
          boxSizing: 'border-box',
          padding: narrow ? '0 16px 24px' : '0 24px 32px',
          display: 'flex',
          gap: 32,
          alignItems: 'flex-start',
          flex: 1,
        }}
      >
        {/* One scroll context. The sidebar follows the page and pins its
         * bottom edge while scrolling down and its top edge while scrolling
         * up (`useStickySidebar`) — never a second scrollbar, which is the
         * "inline scroll area" pattern usability testing warns against, and
         * never an unreachable bottom, which plain `position: sticky` has
         * once the sidebar is taller than the viewport (reported). The
         * wrapper is stretched to the row's full height and is the sticky
         * element's containing block; the empty spacer is how the hook
         * freezes the sidebar's position on a direction change. */}
        {!narrow && (
          <aside ref={sidebarWrapperRef} style={{ width: 220, flexShrink: 0, alignSelf: 'stretch' }}>
            <div ref={sidebarSpacerRef} aria-hidden style={{ height: 0 }} />
            <div ref={sidebarRef}>
              <SidebarContent {...sidebarProps} />
            </div>
          </aside>
        )}

        <main style={{ flex: 1, minWidth: 0 }}>
          <Toolbar
            count={rows.length}
            total={population.length}
            view={view}
            selection={selection}
            onRemove={toggle}
            onClear={() => setSelection(EMPTY_SELECTION)}
            sort={sort}
            onSort={setSort}
            onClearRecent={view === 'recent' && recent.length > 0 ? clearRecent : undefined}
            onOpenFilters={narrow ? () => setFiltersOpen(true) : undefined}
          />
          {narrow && filtersOpen && (
            <FiltersSheet
              onClose={() => setFiltersOpen(false)}
              resultCount={rows.length}
              total={population.length}
              appliedCount={FACETS.reduce((n, f) => n + selection[f.id].size, 0)}
              onClearAll={() => setSelection(EMPTY_SELECTION)}
            >
              <SidebarContent {...sidebarProps} />
            </FiltersSheet>
          )}
          {rows.length === 0 ? (
            <EmptyCards view={view} query={query} filtering={!isSelectionEmpty(selection)} />
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fill, minmax(${narrow ? 240 : 300}px, 1fr))`,
                gap: 12,
              }}
            >
              {rows.map((row) => (
                <CatalogCard
                  key={row.href}
                  row={row}
                  selection={selection}
                  onToggle={toggle}
                  onOpen={onOpen}
                  openedAt={view === 'recent' ? recent.find((r) => r.href === row.href)?.openedAt : undefined}
                />
              ))}
            </div>
          )}
        </main>
      </div>
      <LandingFooter />
    </div>
  )
}

type View = 'all' | 'favorites' | 'recent'
type SortKey = 'name' | 'added' | 'verified'
/** A list entry, or a favorite/recent root that is not in the list. */
type Row = KnownCatalog | { href: string; title: string }

function isKnown(row: Row): row is KnownCatalog {
  return 'kind' in row
}

function matchesThin(row: { href: string; title: string }, query: string): boolean {
  const q = query.toLowerCase()
  return !q || row.title.toLowerCase().includes(q) || row.href.toLowerCase().includes(q)
}

function sortRows(rows: KnownCatalog[], sort: SortKey): KnownCatalog[] {
  const copy = [...rows]
  switch (sort) {
    case 'name':
      return copy.sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }))
    case 'added':
      return copy.sort((a, b) => b.addedOn.localeCompare(a.addedOn) || a.title.localeCompare(b.title))
    case 'verified':
      return copy.sort(
        (a, b) => (b.verifiedOn ?? '').localeCompare(a.verifiedOn ?? '') || a.title.localeCompare(b.title),
      )
  }
}

const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name',
  added: 'Recently added',
  verified: 'Recently verified',
}

const groupTitleStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
}

/** A sidebar section with a disclosure header. Open/closed is plain
 *  component state — remembering it across visits was not asked for. */
function SidebarGroup({
  title,
  defaultOpen,
  aside,
  children,
}: {
  title: string
  defaultOpen?: boolean
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <div style={{ marginBottom: 14 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          padding: '6px 0',
          border: 'none',
          borderBottom: '1px solid var(--color-border)',
          background: 'none',
          cursor: 'pointer',
          ...groupTitleStyle,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Chevron open={open} />
          {title}
        </span>
        {aside}
      </button>
      {open && <div style={{ paddingTop: 6 }}>{children}</div>}
    </div>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }}
      aria-hidden
    >
      <path d="M3.5 2 L6.5 5 L3.5 8" />
    </svg>
  )
}

function ViewItem({
  label,
  count,
  active,
  onClick,
  icon,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
  icon?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 6px',
        margin: '1px 0',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        background: active ? 'var(--color-selection-bg)' : 'none',
        color: active ? 'var(--color-selection)' : 'var(--color-text)',
        fontSize: 13,
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      {icon && (
        <span style={{ display: 'flex', color: active ? 'var(--color-selection)' : 'var(--color-text-faint)' }}>
          {icon}
        </span>
      )}
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ fontSize: 11, color: active ? 'var(--color-selection)' : 'var(--color-text-faint)' }}>
        {count}
      </span>
    </button>
  )
}

// Six, not eight: with Topic and Region open the whole sidebar then fits a
// laptop viewport (~650 px of page), so it pins at the top like a plain
// sticky element and its header is never scrolled off.
const FACET_PREVIEW = 6

/** One facet as a checkbox list, values ordered by count, with a "show
 *  all" once a group is longer than the preview. Counts are what each value
 *  would leave given the query and the other facets' selections
 *  (`facetCounts`); a value that would leave nothing is dimmed, not
 *  hidden, so the vocabulary itself stays readable. */
function FacetGroup({
  facet,
  counts,
  selected,
  onToggle,
  defaultOpen,
}: {
  facet: FacetDef
  counts: Map<string, number>
  selected: ReadonlySet<string>
  onToggle: (value: string) => void
  defaultOpen: boolean
}) {
  const [showAll, setShowAll] = useState(false)
  const entries = Object.entries(facet.values).sort(([a], [b]) => {
    const d = (counts.get(b) ?? 0) - (counts.get(a) ?? 0)
    return d !== 0 ? d : facet.values[a].localeCompare(facet.values[b])
  })
  const hiddenSelected = entries.slice(FACET_PREVIEW).some(([v]) => selected.has(v))
  const shown = showAll || hiddenSelected || entries.length <= FACET_PREVIEW ? entries : entries.slice(0, FACET_PREVIEW)
  return (
    <SidebarGroup
      title={facet.label}
      defaultOpen={defaultOpen}
      aside={selected.size > 0 ? <span style={{ color: 'var(--color-selection)' }}>{selected.size}</span> : undefined}
    >
      {shown.map(([value, label]) => {
        const count = counts.get(value) ?? 0
        const on = selected.has(value)
        const dim = count === 0 && !on
        return (
          <label
            key={value}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '3px 6px',
              fontSize: 13,
              color: dim ? 'var(--color-text-faint)' : 'var(--color-text)',
              cursor: dim ? 'default' : 'pointer',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <input
              type="checkbox"
              checked={on}
              disabled={dim}
              onChange={() => onToggle(value)}
              style={{ margin: 0, accentColor: 'var(--color-selection)' }}
            />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
            <span style={{ fontSize: 11, color: on ? 'var(--color-selection)' : 'var(--color-text-faint)' }}>
              {count}
            </span>
          </label>
        )
      })}
      {entries.length > FACET_PREVIEW && !hiddenSelected && (
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          style={{ ...linkButtonStyle, padding: '4px 6px', fontSize: 12 }}
        >
          {showAll ? 'Show fewer' : `Show all ${entries.length}`}
        </button>
      )}
    </SidebarGroup>
  )
}

const linkButtonStyle: React.CSSProperties = {
  border: 'none',
  background: 'none',
  padding: 0,
  font: 'inherit',
  color: 'var(--color-text-muted)',
  textDecoration: 'underline',
  textUnderlineOffset: 2,
  cursor: 'pointer',
}

/** Result count, the applied filters as removable chips, and sort. The applied chips are the one place all active
 *  facet values are visible at once, whatever is collapsed in the
 *  sidebar. */
function Toolbar({
  count,
  total,
  view,
  selection,
  onRemove,
  onClear,
  sort,
  onSort,
  onClearRecent,
  onOpenFilters,
}: {
  count: number
  total: number
  view: View
  selection: FacetSelection
  onRemove: (facet: FacetId, value: string) => void
  onClear: () => void
  sort: SortKey
  onSort: (s: SortKey) => void
  onClearRecent?: () => void
  /** Phone layout: the sidebar is behind this button. */
  onOpenFilters?: () => void
}) {
  const applied = FACETS.flatMap((f) =>
    [...selection[f.id]].map((v) => ({ facet: f.id, value: v, label: f.values[v] })),
  )
  const shown = count === total ? `${count}` : `${count} of ${total}`
  const label =
    view === 'recent'
      ? `${shown} recently opened`
      : `${shown} ${view === 'favorites' ? 'favorite' : 'catalog'}${count === 1 ? '' : 's'}`
  const controlStyle: React.CSSProperties = {
    fontSize: 12,
    padding: '5px 8px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-border)',
    background: 'var(--color-surface)',
    color: 'var(--color-text)',
  }
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        padding: '4px 0 14px',
        fontSize: 13,
        color: 'var(--color-text-muted)',
      }}
    >
      <span style={{ color: 'var(--color-text)' }}>{label}</span>
      {applied.map((a) => (
        <button
          key={`${a.facet}:${a.value}`}
          type="button"
          onClick={() => onRemove(a.facet, a.value)}
          title="Remove this filter"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '2px 8px',
            borderRadius: 999,
            border: '1px solid var(--color-selection)',
            background: 'var(--color-selection-bg)',
            color: 'var(--color-selection)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {a.label}
          <span aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>
            ×
          </span>
        </button>
      ))}
      {applied.length > 1 && (
        <button type="button" onClick={onClear} style={{ ...linkButtonStyle, fontSize: 12 }}>
          Clear all
        </button>
      )}
      <span style={{ flex: 1 }} />
      {onClearRecent && (
        <button type="button" onClick={onClearRecent} style={{ ...linkButtonStyle, fontSize: 12 }}>
          Clear history
        </button>
      )}
      {onOpenFilters && (
        <button
          type="button"
          onClick={onOpenFilters}
          style={{
            ...controlStyle,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: applied.length > 0 ? 'var(--color-selection)' : 'var(--color-text)',
            borderColor: applied.length > 0 ? 'var(--color-selection)' : 'var(--color-border)',
          }}
        >
          Filters{applied.length > 0 ? ` (${applied.length})` : ''}
        </button>
      )}
      {view !== 'recent' && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          Sort
          <select value={sort} onChange={(e) => onSort(e.target.value as SortKey)} style={controlStyle}>
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}

function EmptyCards({ view, query, filtering }: { view: View; query: string; filtering: boolean }) {
  let text: string
  if (view === 'favorites' && !query && !filtering) text = 'No favorites yet — star a catalog to keep it here.'
  else if (view === 'recent' && !query && !filtering) text = 'Catalogs you open will appear here.'
  else text = `Nothing matches${query ? ` "${query}"` : ''}${filtering ? ' with these filters' : ''}.`
  return <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '24px 2px' }}>{text}</div>
}

function relativeTime(epochMs: number): string {
  const s = Math.max(0, Math.round((Date.now() - epochMs) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

/** One catalog card: star, title with the API badge, a two-line
 *  description, and — pinned to the bottom — the card's own tags, each a
 *  button that applies that value as a filter, plus the host name (the
 *  full URL is the card's tooltip). The card is a `<div role="button">`,
 *  not a `<button>`: the star and the tags are real buttons, and a button
 *  may not contain another. Their clicks are excluded from "open" by DOM
 *  containment, never `stopPropagation()`. */
function CatalogCard({
  row,
  selection,
  onToggle,
  onOpen,
  openedAt,
}: {
  row: Row
  selection: FacetSelection
  onToggle: (facet: FacetId, value: string) => void
  onOpen: (href: string) => void
  openedAt?: number
}) {
  const known = isKnown(row)
  const favorite = useLandingPrefsStore((s) => s.favorites.some((f) => f.href === row.href))
  const toggleFavorite = useLandingPrefsStore((s) => s.toggleFavorite)
  const [hover, setHover] = useState(false)

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as Element).closest('[data-card-control]')) return
    onOpen(row.href)
  }
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen(row.href)
    }
  }
  const host = (() => {
    try {
      return new URL(row.href).host
    } catch {
      return row.href
    }
  })()
  const tags = known
    ? FACETS.filter((f) => f.id !== 'kind').flatMap((f) => facetValues(row, f.id).map((v) => ({ facet: f, value: v })))
    : []

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={row.href}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minHeight: 128,
        padding: '12px 14px',
        boxSizing: 'border-box',
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${hover ? 'var(--color-selection)' : 'var(--color-border)'}`,
        background: 'var(--color-surface)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 24 }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-text)', lineHeight: 1.3 }}>{row.title}</span>
        {known && row.kind === 'api' && (
          // Same tag, same convention, as every other API-backed node in
          // the app: only the special case gets a badge; static stays plain.
          <span
            style={{
              flexShrink: 0,
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: 999,
              background: 'var(--color-badge-api-bg)',
              color: 'var(--color-badge-api-text)',
            }}
          >
            API
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: 12.5,
          lineHeight: 1.45,
          color: 'var(--color-text-muted)',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {known ? row.description : 'Not in the known-catalog list — opened by URL.'}
      </div>
      {/* Tags first, host last, in one wrapping flow: giving the host its
       * own right-aligned column squeezed the tags into three lines. */}
      <div
        style={{
          marginTop: 'auto',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          columnGap: 0,
          rowGap: 2,
          paddingTop: 4,
          fontSize: 11.5,
          minWidth: 0,
        }}
      >
        {tags.map(({ facet, value }) => {
          const on = selection[facet.id].has(value)
          return (
            <span key={`${facet.id}:${value}`} style={{ display: 'inline-flex', alignItems: 'baseline' }}>
              <button
                type="button"
                data-card-control
                onClick={() => onToggle(facet.id, value)}
                title={`${on ? 'Remove' : 'Add'} filter: ${facet.label} = ${facet.values[value]}`}
                style={{
                  border: 'none',
                  background: 'none',
                  padding: 0,
                  font: 'inherit',
                  color: on ? 'var(--color-selection)' : 'var(--color-text-faint)',
                  textDecoration: on ? 'underline' : 'none',
                  textUnderlineOffset: 2,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {facet.values[value]}
              </button>
              <span aria-hidden style={{ color: 'var(--color-border)', margin: '0 5px' }}>
                ·
              </span>
            </span>
          )
        })}
        <span
          style={{
            fontSize: 10.5,
            color: 'var(--color-text-faint)',
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'nowrap',
            // A long S3 host (spatio-temporal-asset-catalog.s3.ap-south-1…)
            // wraps onto its own line and must truncate there, not overflow.
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {openedAt !== undefined ? relativeTime(openedAt) : host}
        </span>
      </div>
      {/* Favorites are limited to list entries by decision — a recent root
       * that is not in the list has no star. */}
      {known && (
        <button
          type="button"
          data-card-control
          aria-pressed={favorite}
          aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
          title={favorite ? 'Remove from favorites' : 'Add to favorites'}
          onClick={() => toggleFavorite({ href: row.href, title: row.title })}
          style={{
            position: 'absolute',
            top: 9,
            right: 9,
            width: 24,
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            color: favorite ? 'var(--color-selection)' : hover ? 'var(--color-text-faint)' : 'transparent',
          }}
        >
          <StarIcon filled={favorite} size={14} />
        </button>
      )}
    </div>
  )
}

function StarIcon({ filled, size = 14 }: { filled: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z" />
    </svg>
  )
}

interface SidebarContentProps {
  view: View
  setView: (v: View) => void
  favoritesCount: number
  recentCount: number
  known: KnownCatalog[]
  query: string
  selection: FacetSelection
  toggle: (facet: FacetId, value: string) => void
}

/** The facet sidebar's contents — the "Yours" view switch, one group per
 *  facet, and the provenance footnote. Rendered in the desktop sidebar and,
 *  on phones, inside the full-screen Filters panel. */
function SidebarContent({
  view,
  setView,
  favoritesCount,
  recentCount,
  known,
  query,
  selection,
  toggle,
}: SidebarContentProps) {
  return (
    <>
      <SidebarGroup title="Yours" defaultOpen>
        <ViewItem
          label="All catalogs"
          count={KNOWN_CATALOGS.length}
          active={view === 'all'}
          onClick={() => setView('all')}
        />
        <ViewItem
          label="Favorites"
          count={favoritesCount}
          active={view === 'favorites'}
          onClick={() => setView('favorites')}
          icon={<StarIcon filled size={11} />}
        />
        <ViewItem
          label="Recently opened"
          count={recentCount}
          active={view === 'recent'}
          onClick={() => setView('recent')}
        />
      </SidebarGroup>
      {FACETS.map((facet) => (
        <FacetGroup
          key={facet.id}
          facet={facet}
          counts={facetCounts(known, query, selection, facet.id)}
          selected={selection[facet.id]}
          onToggle={(v) => toggle(facet.id, v)}
          defaultOpen={facet.id === 'topics' || facet.id === 'regions'}
        />
      ))}
      <div style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 12, lineHeight: 1.5 }}>
        Catalogs via{' '}
        <a href="https://stacindex.org" target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
          STAC Index
        </a>
        ; tags are{' '}
        <a
          href="https://github.com/rednotfound/stac-lens/blob/main/docs/CATALOGS.md"
          target="_blank"
          rel="noreferrer"
          style={{ color: 'inherit' }}
        >
          ours
        </a>
        .
      </div>
    </>
  )
}

/** Phone layout: the sidebar as a full-screen panel over the page. Opened
 *  from the toolbar's Filters button; the toolbar keeps the applied chips
 *  visible, so filters are never out of sight even when this is closed —
 *  the discoverability cost of hidden controls, per NN/g, is paid only by
 *  the *unapplied* ones. Filters apply as they are checked, so the panel
 *  has no "apply" step: a plain × closes it (a first version's "Show 103"
 *  button read as an action nobody had asked for), and a line under the
 *  title says live how many catalogs match. */
function FiltersSheet({
  onClose,
  resultCount,
  total,
  appliedCount,
  onClearAll,
  children,
}: {
  onClose: () => void
  resultCount: number
  total: number
  appliedCount: number
  onClearAll: () => void
  children: React.ReactNode
}) {
  return (
    <div
      role="dialog"
      aria-label="Filters"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg)',
      }}
    >
      <div
        style={{
          padding: '10px 16px 10px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: 16, color: 'var(--color-text)' }}>Filters</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            title="Close"
            style={{
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              background: 'none',
              color: 'var(--color-text)',
              fontSize: 22,
              lineHeight: 1,
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>
        <div
          style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 13, color: 'var(--color-text-muted)' }}
        >
          <span aria-live="polite">
            {resultCount === total ? `All ${total} catalogs` : `${resultCount} of ${total} catalogs match`}
          </span>
          {appliedCount > 0 && (
            <button type="button" onClick={onClearAll} style={{ ...linkButtonStyle, fontSize: 13 }}>
              Clear all
            </button>
          )}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 16px 24px' }}>{children}</div>
    </div>
  )
}
