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
import { RadialTreeView } from './components/views/RadialTreeView'
import { TypeIcon } from './components/TypeIcon'
import { useSelectionStore } from './store/selection'
import { useItemSetStore } from './store/itemSet'
import { useElementSize } from './hooks/useElementSize'
import { useDeepLinkBootstrap, usePopStateSync, useShareableUrlSync } from './hooks/useShareableUrl'
import { encodeSearchQuery } from './stac/searchQueryUrl'
import { Spinner } from './components/Spinner'
import { Logo } from './components/Logo'
import { GitHubMark, REPO_URL } from './components/ProjectLinks'
import { loader } from './stac/loaderInstance'
import type { StacNode } from './stac/types'

// Inspector's width is a plain pixel number, not a boolean — 0 means fully
// collapsed. Direct manipulation (drag the divider, the same "drag, not
// sliders/buttons" language the tree's own pan/zoom already uses) is the
// only control — there is no header show/hide button. This was an explicit
// request: a button is unnecessary when the dividing line itself can be
// dragged with the mouse, and dragging it to the edge should snap it away
// on its own.
const DEFAULT_INSPECTOR_WIDTH = 460
// Below this, a drag snaps straight to fully collapsed instead of leaving
// a barely-usable sliver.
const MIN_INSPECTOR_WIDTH = 220
const HANDLE_WIDTH = 8

function App() {
  const [rootHref, setRootHref] = useState<string | null>(null)
  const select = useSelectionStore((s) => s.select)
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  const browsingHref = useSelectionStore((s) => s.browsingHref)
  // Which Item Set box's search (if any) belongs on the URL right now —
  // scoped to `browsingHref` (the Collection whose Item Set box is open),
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
  const [inspectorWidth, setInspectorWidth] = useState(DEFAULT_INSPECTOR_WIDTH)
  // Phone layout: the Inspector is a bottom sheet over the canvas instead of
  // a second column. A new selection pops it from peek to half so the
  // detail appears without hiding the tree entirely.
  const narrow = useIsNarrow()
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
  // Remembers the last non-zero width so double-clicking the handle while
  // collapsed restores whatever size was actually in use, not always the
  // same default.
  const lastOpenWidthRef = useRef(DEFAULT_INSPECTOR_WIDTH)
  useEffect(() => {
    if (inspectorWidth > 0) lastOpenWidthRef.current = inspectorWidth
  }, [inspectorWidth])

  // Pointer Events with `setPointerCapture`, not mousedown/mousemove/mouseup
  // on `window` (the original approach) — a real, confirmed bug: dragging
  // the handle to collapse (or anywhere near a Leaflet map, e.g. Spatial's
  // inline map in DetailPanel) could end the drag with the browser button
  // released *without* a `mouseup` ever reaching `window` — either because
  // the cursor left the browser window entirely before release (a fast
  // drag to the edge, or resizing to fully collapsed is exactly a drag
  // toward the edge) or because Leaflet calls `stopPropagation` on the
  // pointer/mouse events it handles for its own map dragging, which stops
  // the event from ever bubbling up to `window`. Either way the stale
  // `onMove`/`onUp` pair from that drag stayed attached to `window`
  // forever, with `startX`/`startWidth` frozen from the drag that never
  // cleanly ended — so *any* later mouse movement anywhere on the page
  // kept re-firing that ghost handler, immediately recomputing `next` from
  // its stale closure and snapping the width straight back to 0 in a
  // fight against any new, legitimate resize attempt: the handle looked
  // permanently stuck at collapsed until a full page reload discarded the
  // listener. `setPointerCapture` on the handle itself fixes this at the
  // source — once captured, the browser keeps routing pointermove/pointerup
  // to this element regardless of what's under the cursor or whether the
  // pointer leaves the document, so `pointerup`/`pointercancel` are
  // guaranteed to fire and clean the listeners up every time.
  const beginResize = useCallback(
    (startEvent: React.PointerEvent<HTMLDivElement>) => {
      startEvent.preventDefault()
      const handle = startEvent.currentTarget
      const pointerId = startEvent.pointerId
      handle.setPointerCapture(pointerId)
      const startX = startEvent.clientX
      const startWidth = inspectorWidth

      function onMove(e: PointerEvent) {
        // Handle sits to the *left* of Inspector, so dragging left (cursor
        // x decreases) should grow it — the delta is inverted relative to
        // a plain "drag right to grow" control.
        const delta = startX - e.clientX
        const cap = containerWidth > 0 ? containerWidth * 0.5 : DEFAULT_INSPECTOR_WIDTH
        let next = Math.min(startWidth + delta, cap)
        if (next < MIN_INSPECTOR_WIDTH) next = 0
        setInspectorWidth(Math.max(next, 0))
      }
      function onUp(e: PointerEvent) {
        handle.releasePointerCapture(e.pointerId)
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
        handle.removeEventListener('pointercancel', onUp)
      }
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
      handle.addEventListener('pointercancel', onUp)
    },
    [inspectorWidth, containerWidth],
  )

  const toggleCollapse = useCallback(() => {
    setInspectorWidth((w) => (w > 0 ? 0 : lastOpenWidthRef.current || DEFAULT_INSPECTOR_WIDTH))
  }, [])

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
  useEffect(() => {
    if (!target) return
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
  }, [target, select, setPendingInitialQuery])
  useShareableUrlSync(rootHref, selectedHref, booting, queryStringForSelection)
  // The browser's own Back/Forward must work here. Without this hook they
  // did nothing at all (the address bar changed, but nothing on screen
  // did), which combined with `useShareableUrlSync` only ever having one
  // history entry per app session meant a single Back press left the app
  // outright, however much had been explored — a reported problem, not a
  // guess: pressing the browser's Back button went straight to the
  // browser's own default page. See both hooks' own docs for the full
  // mechanism.
  usePopStateSync(setRootHref, select, setPendingInitialQuery)

  function openCatalog(href: string) {
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
  const rootNode = rootHref
    ? (loader.get(rootHref) ?? (fetchedRoot?.href === rootHref ? fetchedRoot.node : undefined))
    : undefined
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
        // (rootError) — the header just quietly falls back to the href.
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
    // `overflow: 'hidden'` here is load-bearing, not decorative — this is
    // a fixed-viewport app (every scrollable area, Structure Lens's own
    // canvas and Inspector's own column, already manages its own internal
    // scrolling), so nothing here should ever need the *page* itself to
    // scroll. Without this, any descendant that's even a few pixels wider
    // than its own visual container — a real, reported case: the
    // Inspector-collapse chevron button is deliberately larger (22px) than
    // the divider handle it's centered on (`HANDLE_WIDTH`, 8px) for a
    // comfortable click target, so it overflows ~7px past the divider on
    // each side by design — bleeds all the way out to `body`/`html`
    // (neither clips by default), which then grow a real page-level
    // scrollbar in both directions to accommodate it. This was a reported
    // problem, not a guess: after clicking that button, scrollbars showed
    // up on the right and bottom in Chrome — confirmed in Firefox too,
    // since neither browser clips overflow that nothing in the ancestor
    // chain ever asked it to clip. This boundary is the right place to
    // guarantee that never happens, regardless of what a future
    // deliberately-larger-than-its-box affordance like this one does deep
    // inside either column.
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
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            title="Source on GitHub"
            style={{ marginLeft: 'auto', flexShrink: 0, color: 'var(--color-text-muted)', display: 'flex' }}
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
        <div ref={containerRef} style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              // The tree's own SVG doesn't clip content panned/zoomed past
              // its column's edge — normally invisible off-screen, but the
              // Item Set box (foreignObject, real HTML) can land close
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
              // the tree (with its Item Set boxes) is the entry; the others
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
                  {view === 'radial' && <RadialTreeView key={rootHref} />}
                </div>
              </div>
            )}
          </div>
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
          {hasSelection && !narrow && (
            <>
              {/* The divider resizes Inspector continuously while it's open
               * (drag past `MIN_INSPECTOR_WIDTH` snaps it fully away), but a
               * drag alone is not a reliable way back once collapsed — a
               * reported problem, not a guess: dragging alone didn't work,
               * even after the pointer-capture fix above made the *listener*
               * itself stop getting stuck, because a fully collapsed divider
               * is just a bare 8px sliver at the very edge of the window
               * with nothing to grab. Rather than keep
               * chasing that edge case, this is the standard resizable-panel
               * pattern instead — a small chevron button that's always
               * there and always a plain click, independent of drag
               * geometry entirely, layered on the same divider (double-click
               * still works too, this doesn't replace it). */}
              <div
                onPointerDown={beginResize}
                onDoubleClick={toggleCollapse}
                title={inspectorWidth > 0 ? 'Drag to resize' : 'Drag to show Inspector'}
                style={{
                  position: 'relative',
                  width: HANDLE_WIDTH,
                  flexShrink: 0,
                  cursor: 'col-resize',
                  background: 'var(--color-border)',
                  touchAction: 'none',
                }}
              >
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={toggleCollapse}
                  title={inspectorWidth > 0 ? 'Hide Inspector' : 'Show Inspector'}
                  aria-label={inspectorWidth > 0 ? 'Hide Inspector' : 'Show Inspector'}
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: 22,
                    height: 36,
                    borderRadius: 6,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-surface)',
                    color: 'var(--color-text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path
                      // Points the direction the panel actually moves on
                      // click — right (away) to hide, matching the same
                      // "drag left grows it" convention `beginResize`
                      // already uses, just inverted for collapsing.
                      d={inspectorWidth > 0 ? 'M8 4l6 6-6 6' : 'M12 4 6 10l6 6'}
                      stroke="currentColor"
                      strokeWidth={1.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
              {inspectorWidth > 0 && (
                <div ref={inspectorScrollRef} style={{ width: inspectorWidth, flexShrink: 0, overflow: 'auto' }}>
                  <DetailPanel />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </StructureProvider>
  )
}

export default App
