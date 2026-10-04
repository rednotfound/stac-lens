import { useCallback, useEffect, useRef, useState } from 'react'
import { StructureTree } from './components/StructureTree'
import { DetailPanel } from './components/DetailPanel'
import { LandingPage } from './components/LandingPage'
import { useLandingPrefsStore } from './store/landingPrefs'
import { useIsNarrow } from './hooks/useMediaQuery'
import { useDocumentTitle } from './hooks/useDocumentTitle'
import { BottomSheet, type SheetSnap } from './components/BottomSheet'
import { OutlineView } from './components/OutlineView'
import { CompactBanner } from './components/CompactBanner'
import { StructureProvider } from './components/StructureProvider'
import { TabButton } from './components/TabButton'
import { EXPLORER_VIEWS, type ExplorerView } from './components/views/explorerViews'
import { IcicleView } from './components/views/IcicleView'
import { ItemsPanel } from './components/ItemsPanel'
import { InspectorIcon, ItemSetIcon, PaneHeader, PaneSplitter, PaneToggle, SPLITTER_WIDTH } from './components/panes'
import { StructureActions } from './components/views/StructureActions'
import { itemSetSessions } from './store/itemSetSessions'
import { hasDirectItems } from './components/tree/treeGeometry'
import { TypeIcon } from './components/TypeIcon'
import { useSelectionStore } from './store/selection'
import { DEFAULT_ITEMS_PANEL_WIDTH, useItemSetStore } from './store/itemSet'
import { useElementSize } from './hooks/useElementSize'
import {
  useDeepLinkBootstrap,
  usePopStateSync,
  useShareableUrlSync,
  type DeepLinkTarget,
} from './hooks/useShareableUrl'
import { encodeSearchQuery } from './stac/searchQueryUrl'
import { Spinner } from './components/Spinner'
import { Logo } from './components/Logo'
import { GitHubMark, REPO_URL } from './components/ProjectLinks'
import { FavoriteStar } from './components/FavoriteStar'
import { loader } from './stac/loaderInstance'
import { loadMarkdown } from './stac/markdownLoader'
import type { StacNode } from './stac/types'

// The two docked panes — the Items panel and the Inspector — follow one
// rule set (docs/DESIGN.md §122): a default and a minimum width each; a
// PaneSplitter to resize (double-click: the default); shown and hidden
// from the header's toggles (or hidden by dragging a splitter past the
// minimum, or Enter on it); widths remembered per browser. The views keep
// MIN_CANVAS_WIDTH while the window is wide enough for it and both panes'
// minimums (~960 px with both open); below that the panes keep their
// minimums and the canvas narrows.
const DEFAULT_INSPECTOR_WIDTH = 460
const MIN_INSPECTOR_WIDTH = 280
const MIN_ITEMS_PANEL_WIDTH = 300
const MIN_CANVAS_WIDTH = 360
const INSPECTOR_PREFS_KEY = 'stac-lens.inspector'

/** The Inspector's remembered width and whether the user hid it. A
 *  throwing or empty `localStorage` falls back to the defaults. */
function readInspectorPrefs(): { width: number; hidden: boolean } {
  try {
    const raw = JSON.parse(localStorage.getItem(INSPECTOR_PREFS_KEY) ?? 'null') as {
      width?: unknown
      hidden?: unknown
    } | null
    return {
      width: typeof raw?.width === 'number' && raw.width > 0 ? raw.width : DEFAULT_INSPECTOR_WIDTH,
      hidden: raw?.hidden === true,
    }
  } catch {
    return { width: DEFAULT_INSPECTOR_WIDTH, hidden: false }
  }
}

function App() {
  const [rootHref, setRootHref] = useState<string | null>(null)
  const select = useSelectionStore((s) => s.select)
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  const browsingHref = useSelectionStore((s) => s.browsingHref)
  // Which Item Set's search (if any) belongs on the URL right now —
  // scoped to `browsingHref` (the Collection the Items panel shows),
  // not `selectedHref` (which can drill into an Item inside it): see
  // `store/itemSet.ts`. `itemSetForHref === browsingHref` guards against a
  // one-render-stale value from a just-abandoned box before its own
  // `setVisible`/`setAppliedQuery` catch up.
  const itemSetForHref = useItemSetStore((s) => s.forHref)
  const itemSetAppliedQuery = useItemSetStore((s) => s.appliedQuery)
  const setPendingInitialQuery = useItemSetStore((s) => s.setPendingInitialQuery)
  const queryStringForSelection =
    itemSetForHref && itemSetForHref === browsingHref ? encodeSearchQuery(itemSetAppliedQuery ?? {}) : ''
  // Time/Space are not their own toggleable panels stacked below Detail's
  // facts, nor a pair of Inspector tabs — they live directly in the Human
  // tab's own field flow (DetailPanel.tsx: an inline timeline right where
  // "Temporal" is, an inline map right where "Spatial" is), so there is
  // only ever one panel to show/hide here. This was an explicit request:
  // the human-readable page should be one long scroll, with each property
  // rendered by whatever viewer fits it. The interactive bbox/datetime
  // query tool that used to live alongside Time/Space Lens was dropped
  // entirely in the same pass, not folded in here either — see
  // DetailPanel.tsx/ItemSetBrowser.tsx.
  const [containerRef, { width: containerWidth }] = useElementSize<HTMLDivElement>()
  const [inspectorPrefs, setInspectorPrefs] = useState(readInspectorPrefs)
  useEffect(() => {
    try {
      localStorage.setItem(INSPECTOR_PREFS_KEY, JSON.stringify(inspectorPrefs))
    } catch {
      // per-viewer convenience only
    }
  }, [inspectorPrefs])
  // Phone layout: the Inspector is a bottom sheet over the canvas instead of
  // a second column. A new selection pops it from peek to half so the
  // detail appears without hiding the tree entirely.
  const narrow = useIsNarrow()
  // The Items panel: the browsed Collection's Item Set, docked as a column
  // between the views and the Inspector. It appears whenever browsing is
  // on a node with Items to list and gives the canvas its width back
  // otherwise; hidden from its toggle, it stays hidden only until the next
  // act of selecting.
  const browsingNode = browsingHref ? loader.get(browsingHref) : undefined
  const itemsNode = browsingNode && hasDirectItems(browsingNode) ? browsingNode : undefined
  const panelOpen = useItemSetStore((s) => s.panelOpen)
  const setPanelOpen = useItemSetStore((s) => s.setPanelOpen)
  const itemsHref = itemsNode?.href
  // Keyed on the *act* of selecting (`selectSeq`), not only on which
  // Collection: clicking the same Collection again after closing the
  // panel must reopen it — with the href alone nothing changed and the
  // panel stayed shut, which read as broken.
  const selectSeq = useSelectionStore((s) => s.selectSeq)
  // Opened only when there are Items to list: a static node's item links,
  // or a Collection, whose default search runs on open. An API root's
  // Items are a search across every Collection that waits for conditions
  // — nothing to show yet — so browsing it closes the panel; its toggle
  // still opens it for that search (reported: an empty panel stayed open).
  const itemsToShow = !!itemsNode && !(itemsNode.items.kind === 'cursor' && itemsNode.type !== 'Collection')
  // Forced closed only when browsing moves to such a node — not on every
  // select: picking a result of an API root's search (opened from the
  // toggle) keeps browsing on the root, and must not close the panel it
  // was picked from.
  const lastBrowsedRef = useRef<string | null | undefined>(null)
  useEffect(() => {
    if (itemsToShow) setPanelOpen(true)
    else if (lastBrowsedRef.current !== itemsHref) setPanelOpen(false)
    lastBrowsedRef.current = itemsHref
  }, [itemsHref, itemsToShow, selectSeq, setPanelOpen])
  const panelWidth = useItemSetStore((s) => s.panelWidth)
  const setPanelWidth = useItemSetStore((s) => s.setPanelWidth)
  // Which view of the open catalog the desktop shows. Remembered with the
  // catalog it was chosen for, so opening another catalog starts at the
  // tree again without an effect to reset it.
  const [viewChoice, setViewChoice] = useState<{ view: ExplorerView; forRoot: string | null }>({
    view: 'tree',
    forRoot: null,
  })
  // Derived in render, not synced in an effect: a snap is remembered
  // together with the selection it was made for, and a "peek" made for a
  // previous selection reads as "half" once a new node is selected.
  const [sheet, setSheet] = useState<{ snap: SheetSnap; href: string | null }>({ snap: 'half', href: null })
  // Pane widths, clamped in render so the views keep MIN_CANVAS_WIDTH:
  // each pane gets what is left after the canvas, the splitters and the
  // other pane (at its minimum, if it is shown).
  const itemsShown = !narrow && !!itemsNode && panelOpen
  const inspectorShown = !narrow && !!selectedHref && !inspectorPrefs.hidden
  const room =
    containerWidth - MIN_CANVAS_WIDTH - (itemsShown ? SPLITTER_WIDTH : 0) - (inspectorShown ? SPLITTER_WIDTH : 0)
  const inspectorMax = Math.max(MIN_INSPECTOR_WIDTH, room - (itemsShown ? MIN_ITEMS_PANEL_WIDTH : 0))
  const inspectorWidth = Math.min(Math.max(inspectorPrefs.width, MIN_INSPECTOR_WIDTH), inspectorMax)
  const itemsMax = Math.max(MIN_ITEMS_PANEL_WIDTH, room - (inspectorShown ? inspectorWidth : 0))
  const itemsPanelWidth = Math.min(Math.max(panelWidth, MIN_ITEMS_PANEL_WIDTH), itemsMax)
  const setInspectorHidden = (hidden: boolean) => setInspectorPrefs((p) => ({ ...p, hidden }))

  // Selecting a new node reuses this same scrolled-down container for
  // completely different content — without this, a selection made while
  // scrolled into, say, an Item's asset list left the next Item's Inspector
  // rendered mid-scroll instead of from the top, which reads as the old
  // content silently mutating in place rather than a new object being
  // shown. This was a reported problem, not a guess: after selecting a new
  // object, the image flash-changed while staying in the same scroll
  // position.
  const inspectorScrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    inspectorScrollRef.current?.scrollTo({ top: 0 })
  }, [selectedHref])

  // A `?node=<href>` URL opens straight into that node — same idea as STAC
  // Browser's shareable links (see docs/DESIGN.md), adapted to how this app
  // already works: every node's href is already absolute, and the loader
  // can fetch one in isolation, so the URL only needs to name the leaf —
  // its catalog root and ancestor chain are found live, the same way
  // Structure Lens already reveals a selection that arrived from Time/Space
  // Lens (the parentHref chain: docs/DESIGN.md, "UX uplift pass" and "An
  // Item's parent is singular").
  const { booting, error: bootError, target } = useDeepLinkBootstrap()
  // The linked node's catalog could not be reached (DESIGN §124): say so
  // above the views. Set by whichever navigation resolved a hash (first
  // load or Back/Forward), cleared by any other open, shown only while the
  // catalog it was resolved for is the one open.
  const [notice, setNotice] = useState<{ rootHref: string; info: NonNullable<DeepLinkTarget['unreachable']> }>()
  const showUnreachable = useCallback(
    (t: DeepLinkTarget | null) => setNotice(t?.unreachable && { rootHref: t.rootHref, info: t.unreachable }),
    [],
  )
  useEffect(() => {
    if (!target) return
    // eslint-disable-next-line react/set-state-in-effect
    showUnreachable(target)
    // Register the restored query *before* selecting — `select` can
    // synchronously trigger `CursorItemSetPanels`'s mount (an already-open
    // Structure Tree box for `target.rootHref`), whose one-shot
    // `consumePendingInitialQuery(node.href)` call needs to find it there
    // already.
    if (target.appliedQuery) setPendingInitialQuery(target.appliedQuery.forHref, target.appliedQuery.query)
    // Synchronizing with an external system — the URL, resolved
    // asynchronously by `useDeepLinkBootstrap` — is the one job effects are
    // for; `rootHref` can't be derived, since the user changes it too.
    // eslint-disable-next-line react/set-state-in-effect
    setRootHref(target.rootHref)
    if (target.selectedHref) select(target.selectedHref)
  }, [target, select, setPendingInitialQuery, showUnreachable])
  const unreachable = notice && notice.rootHref === rootHref ? notice.info : undefined
  useShareableUrlSync(rootHref, selectedHref, booting, queryStringForSelection)
  // The browser's own Back/Forward must work here. Without this hook they
  // did nothing at all (the address bar changed, but nothing on screen
  // did), which combined with `useShareableUrlSync` only ever having one
  // history entry per app session meant a single Back press left the app
  // outright, however much had been explored — a reported problem, not a
  // guess: pressing the browser's Back button went straight to the
  // browser's own default page. See both hooks' own docs for the full
  // mechanism.
  usePopStateSync(setRootHref, select, setPendingInitialQuery, showUnreachable)

  function openCatalog(href: string) {
    setNotice(undefined)
    select(null) // a selection from a previous catalog can't mean anything here
    setRootHref(href)
  }

  // The header shows the catalog's name, not only the raw href — the href
  // is real, but not what a person actually orients by; per direct
  // feedback, a header that only shows the data's link isn't very useful.
  // Same cache-then-fetch shape `useSelectedItems` already uses:
  // Structure Lens's own root-expand effect fetches this exact node, so
  // this rarely does its own network request in practice — it's here so
  // the header has *something* to show the moment the href itself resolves,
  // not only once Structure Lens gets around to it.
  // Read from the loader's cache during render; state only holds a node
  // this effect had to fetch itself, keyed by href so a previous catalog's
  // root is never shown under a new one.
  const [fetchedRoot, setFetchedRoot] = useState<{ href: string; node: StacNode } | undefined>(undefined)
  const [failedRoot, setFailedRoot] = useState<string>()
  const rootNode = rootHref
    ? (loader.get(rootHref) ?? (fetchedRoot?.href === rootHref ? fetchedRoot.node : undefined))
    : undefined
  // A different catalog: its Collections' Item Set sessions are not this
  // one's.
  useEffect(() => {
    itemSetSessions.clear()
  }, [rootHref])
  // Descriptions are Markdown; fetch the parser as soon as a catalog is
  // open, not with the landing page.
  useEffect(() => {
    if (rootHref) void loadMarkdown()
  }, [rootHref])
  // The tab title follows what is on screen: the selected object, else the
  // catalog, else the landing page's own title. Before any early return
  // below — hooks must run in the same order every render.
  const selectedNode = selectedHref ? loader.get(selectedHref) : undefined
  const subject = selectedNode ?? rootNode
  useDocumentTitle(
    rootHref
      ? `${subject?.title ?? subject?.id ?? rootHref} · STAC Lens`
      : 'STAC Lens — see the shape of any STAC catalog',
  )
  useEffect(() => {
    if (!rootHref || loader.get(rootHref)) return
    let cancelled = false
    loader
      .load(rootHref)
      .then((node) => {
        if (!cancelled) setFetchedRoot({ href: rootHref, node })
      })
      .catch(() => {
        // Structure Lens's own root fetch already surfaces this failure
        // (rootError) — the header just quietly falls back to the href,
        // and the favorite star says why it is unavailable.
        if (!cancelled) setFailedRoot(rootHref)
      })
    return () => {
      cancelled = true
    }
  }, [rootHref])

  // Remember every root that was actually opened, under the name it
  // resolved to, for the landing page's "Recently opened" list. Waits for
  // the root node so a mistyped or unreachable URL never lands in history.
  const recordOpen = useLandingPrefsStore((s) => s.recordOpen)
  useEffect(() => {
    if (!rootHref || !rootNode) return
    recordOpen(rootHref, rootNode.title ?? rootNode.id)
  }, [rootHref, rootNode, recordOpen])

  if (booting) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          color: 'var(--color-text-muted)',
          fontSize: 13,
          background: 'var(--color-bg)',
        }}
      >
        <Spinner size={22} />
        Opening shared link…
      </div>
    )
  }

  if (!rootHref) {
    return <LandingPage onOpen={openCatalog} error={bootError} />
  }

  const hasSelection = !!selectedHref
  const view: ExplorerView = viewChoice.forRoot === rootHref ? viewChoice.view : 'tree'
  const sheetSnap: SheetSnap = sheet.snap === 'peek' && sheet.href !== selectedHref ? 'half' : sheet.snap

  return (
    // `overflow: 'hidden'` here is load-bearing: this is a fixed-viewport
    // app — the canvas and each pane manage their own scrolling — so the
    // page itself must never scroll. Any descendant a few pixels wider than
    // its box would otherwise bleed out to `body`/`html` (neither clips by
    // default) and grow page-level scrollbars; it happened once with a
    // control larger than the divider it sat on.
    <StructureProvider key={rootHref} rootHref={rootHref}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <header
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: 'var(--color-surface)',
          }}
        >
          {/* No separate "← Catalogs" button — the title itself is the
           * back-to-landing-page control, the same convention countless real
           * websites already use (their own logo/site name in the header is
           * always a link home). This was an explicit request: a back button
           * is unnecessary when clicking the "STAC Lens" title itself returns
           * to the initial page. No border/background of its own, so it
           * doesn't read as a second, competing button next to the title it
           * *is*. */}
          <button
            onClick={() => {
              select(null)
              setRootHref(null)
            }}
            title="Back to catalogs"
            style={{
              fontSize: 14,
              fontWeight: 700,
              flexShrink: 0,
              padding: 0,
              border: 'none',
              background: 'none',
              color: 'var(--color-text)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Logo size={20} />
            STAC Lens
          </button>
          <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--color-border)', flexShrink: 0 }} />
          {/* Stars the open catalog, next to its name — where every product
           * puts it (GitHub's Star by the repo name, STAC Browser's by the
           * title). DESIGN §125. */}
          <FavoriteStar
            href={rootHref}
            title={rootNode && (rootNode.title ?? rootNode.id ?? rootHref)}
            failed={failedRoot === rootHref}
          />
          {/* The catalog's own name, not its URL, is what actually orients
           * someone here — per direct feedback, the href alone isn't very
           * useful on its own. Falls back to the raw href until
           * the root node itself resolves (rarely more than an instant —
           * Structure Lens's own root-expand effect fetches the same node),
           * and again if a catalog genuinely has no `title`/`id` to show
           * (never actually seen, but STAC requires neither on a bare
           * Catalog). The href stays visible underneath, once there's a
           * real title to distinguish it from — demoted, not removed. */}
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, justifyContent: 'center' }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--color-text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {rootNode?.title ?? rootNode?.id ?? rootHref}
            </span>
            {rootNode && !narrow && (
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--color-text-faint)',
                  fontFamily: 'var(--font-mono)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {rootHref}
              </span>
            )}
          </div>
          {/* Source link, kept to the bare mark — the landing page's footer
           * carries version/license/source in full; here it only needs to be
           * findable, at the header's far edge, away from the catalog title. */}
          {/* The panes' show/hide switches, fixed at the header's trailing
           * end so they never move as panes open and close — the one place
           * a hidden pane always comes back from. */}
          {!narrow && (
            <span
              role="group"
              aria-label="Panes"
              className="stac-lens-pane-switch"
              style={{ marginLeft: 'auto', flexShrink: 0 }}
            >
              <PaneToggle
                id="items"
                label="Items"
                pressed={itemsShown}
                disabled={!itemsNode}
                title={
                  itemsNode
                    ? `${itemsShown ? 'Hide' : 'Show'} the Items panel (${itemsToShow ? (itemsNode.title ?? itemsNode.id) : 'a search across every Collection'})`
                    : 'Items panel — select a Collection that has Items'
                }
                icon={<ItemSetIcon color="currentColor" />}
                onToggle={() => setPanelOpen(!panelOpen)}
              />
              <PaneToggle
                id="inspector"
                label="Inspector"
                pressed={inspectorShown}
                disabled={!selectedHref}
                title={
                  selectedHref ? `${inspectorShown ? 'Hide' : 'Show'} the Inspector` : 'Inspector — select something'
                }
                icon={<InspectorIcon />}
                onToggle={() => setInspectorHidden(!inspectorPrefs.hidden)}
              />
            </span>
          )}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            title="Source on GitHub"
            style={{
              marginLeft: narrow ? 'auto' : 8,
              flexShrink: 0,
              color: 'var(--color-text-muted)',
              display: 'flex',
            }}
          >
            <GitHubMark size={18} />
          </a>
        </header>
        {/* Show only what's needed right now: nothing selected means Structure
         * is the whole story so far, full width — the Inspector column only
         * earns its space once there's something for it to actually show.
         * No header button any more to turn it back off — the divider itself
         * (below) is dragged to 0 or double-clicked instead, so there is
         * exactly one thing to interact with, not a button *and* a divider
         * that both claim to control the same width.
         *
         * Time/Space used to live in this column as their own stacked
         * sections below Detail's facts, each independently toggleable, then
         * briefly as Inspector's own tabs — now folded a level deeper still,
         * directly into Inspector's Human tab (DetailPanel.tsx), so there is
         * exactly one thing to resize/collapse here regardless of what's
         * rendering inside Inspector. */}
        {unreachable && (
          <div
            role="status"
            data-unreachable-catalog
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '6px 12px 6px 16px',
              borderBottom: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-node-warning)',
              fontSize: 12,
              lineHeight: 1.45,
            }}
          >
            <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
              ⚠{' '}
              {unreachable.openedOnItsOwn
                ? 'The catalog this node belongs to could not be reached'
                : unreachable.rel === 'root' && unreachable.walkComplete
                  ? 'This node’s root link is broken'
                  : 'This node’s root catalog could not be reached'}
              : its <code>{unreachable.rel}</code> link points to <code>{unreachable.href}</code> (
              {/* The loader's message repeats the href; only the server's answer is new here. */}
              {unreachable.error.replace(`Failed to fetch ${unreachable.href}: `, '')}).{' '}
              {unreachable.openedOnItsOwn
                ? 'It is opened on its own.'
                : unreachable.walkComplete
                  ? 'It is opened from the catalog its parent links lead to.'
                  : 'It is opened from the highest ancestor its links did reach.'}{' '}
              {unreachable.localPath && (
                <span style={{ color: 'var(--color-text-muted)' }}>
                  The link is a local file path from the publisher’s machine — a publisher error (health rule L-07).
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => setNotice(undefined)}
              aria-label="Dismiss"
              title="Dismiss"
              style={{
                border: 'none',
                background: 'none',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                fontSize: 14,
                lineHeight: 1,
                padding: 2,
              }}
            >
              ×
            </button>
          </div>
        )}
        <div ref={containerRef} style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              // The tree's own SVG doesn't clip content panned/zoomed past
              // its column's edge — normally invisible off-screen, but the
              // Item Set box (then a foreignObject, real HTML) could land close
              // enough to this boundary that part of it renders *inside*
              // the Inspector column's own screen area, where that column's
              // later-painted, opaque content (Detail Panel's div) silently
              // covers it — confirmed directly: a button there was
              // unclickable because `elementFromPoint` at its own center
              // resolved to Detail Panel's div, not the button, even though
              // both were "in the left column" by a few pixels' margin.
              // Clipping here is also just correct pan/zoom behavior on its
              // own terms — content panned outside a viewport should
              // disappear, not surface somewhere else.
              overflow: 'hidden',
            }}
          >
            {narrow ? (
              // The phone does not get the canvas: a free-form tree is a
              // desktop instrument. It gets the same graph as an outline, and
              // a banner saying where the full view lives.
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <CompactBanner />
                {/* Bottom padding equal to the sheet's current height, so every
                 * outline row can be scrolled above the sheet — otherwise the
                 * rows under a half-open sheet are unreachable. */}
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflow: 'auto',
                    paddingBottom: !hasSelection
                      ? 0
                      : sheetSnap === 'peek'
                        ? 64
                        : sheetSnap === 'half'
                          ? '50vh'
                          : '90vh',
                  }}
                >
                  <OutlineView key={rootHref} />
                </div>
              </div>
            ) : (
              // The desktop gets a view switcher over the same loaded graph:
              // the tree is the entry; the others
              // are lighter readings of the same structure and selection.
              // One view at a time — the Baobab pattern, not side-by-side
              // panels that would each be too small. The tree remounts on
              // return, so its pan position and dragged offsets reset; the
              // expansion and the selection do not (StructureProvider).
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div
                  role="tablist"
                  aria-label="Views"
                  style={{
                    display: 'flex',
                    paddingLeft: 8,
                    borderBottom: '1px solid var(--color-border)',
                    background: 'var(--color-surface)',
                    flexShrink: 0,
                  }}
                >
                  {EXPLORER_VIEWS.map((v) => (
                    <TabButton
                      key={v.id}
                      label={v.label}
                      title={v.title}
                      active={view === v.id}
                      onClick={() => setViewChoice({ view: v.id, forRoot: rootHref })}
                    />
                  ))}
                  <span
                    style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 8 }}
                  >
                    <StructureActions />
                  </span>
                </div>
                <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                  {view === 'tree' && <StructureTree key={rootHref} />}
                  {view === 'outline' && (
                    <div style={{ height: '100%', overflow: 'auto' }}>
                      <div style={{ maxWidth: 920, padding: '8px 16px 32px' }}>
                        <OutlineView key={rootHref} />
                      </div>
                    </div>
                  )}
                  {view === 'icicle' && <IcicleView key={rootHref} />}
                </div>
              </div>
            )}
          </div>
          {itemsShown && itemsNode && (
            <>
              <PaneSplitter
                width={itemsPanelWidth}
                min={MIN_ITEMS_PANEL_WIDTH}
                max={itemsMax}
                defaultWidth={DEFAULT_ITEMS_PANEL_WIDTH}
                label="Resize the Items panel"
                returnFocusTo="items"
                controls="stac-lens-items-pane"
                onResize={setPanelWidth}
                onHide={() => setPanelOpen(false)}
              />
              <div style={{ width: itemsPanelWidth, flexShrink: 0, minWidth: 0 }}>
                <ItemsPanel node={itemsNode} />
              </div>
            </>
          )}
          {hasSelection && narrow && (
            <BottomSheet
              snap={sheetSnap}
              onSnapChange={(snap) => setSheet({ snap, href: selectedHref })}
              scrollKey={selectedHref}
              peek={
                selectedNode ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <TypeIcon type={selectedNode.type} size={12} />
                    {selectedNode.title ?? selectedNode.id}
                  </span>
                ) : (
                  'Inspector'
                )
              }
            >
              <DetailPanel />
            </BottomSheet>
          )}
          {inspectorShown && (
            <>
              <PaneSplitter
                width={inspectorWidth}
                min={MIN_INSPECTOR_WIDTH}
                max={inspectorMax}
                defaultWidth={DEFAULT_INSPECTOR_WIDTH}
                label="Resize the Inspector"
                returnFocusTo="inspector"
                controls="stac-lens-inspector-pane"
                onResize={(width) => setInspectorPrefs((p) => ({ ...p, width }))}
                onHide={() => setInspectorHidden(true)}
              />
              <section
                id="stac-lens-inspector-pane"
                aria-label="Inspector"
                data-inspector-pane
                style={{ width: inspectorWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', minWidth: 0 }}
              >
                <PaneHeader icon={<InspectorIcon />} title="Inspector" />
                <div ref={inspectorScrollRef} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                  <DetailPanel />
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </StructureProvider>
  )
}

export default App
