import { useCallback, useEffect, useRef, useState } from 'react'
import { StructureTree } from './components/StructureTree'
import { DetailPanel } from './components/DetailPanel'
import { LandingPage } from './components/LandingPage'
import { useSelectionStore } from './store/selection'
import { useElementSize } from './hooks/useElementSize'
import { useDeepLinkBootstrap, usePopStateSync, useShareableUrlSync } from './hooks/useShareableUrl'
import { Spinner } from './components/Spinner'

// Inspector's width is a plain pixel number, not a boolean — 0 means fully
// collapsed. Direct-manipulation (drag the divider, same "drag not
// sliders/buttons" language the tree's own pan/zoom already uses) replaced
// a header show/hide button entirely: "我觉得完全没有必要...我希望我能够用我
// 的鼠标去拖拽那个分界线...拖到边缘的地方,它就自己就吸附消失" (I don't think we
// need [the button] at all — I want to drag the dividing line itself with
// my mouse, and dragging it to the edge should snap it away on its own).
const DEFAULT_INSPECTOR_WIDTH = 460
// Below this, a drag snaps straight to fully collapsed instead of leaving
// a barely-usable sliver.
const MIN_INSPECTOR_WIDTH = 220
const HANDLE_WIDTH = 8

function App() {
  const [rootHref, setRootHref] = useState<string | null>(null)
  const select = useSelectionStore((s) => s.select)
  const selectedHref = useSelectionStore((s) => s.selectedHref)
  // Time/Space used to be their own always-visible panels stacked below
  // Detail's facts, each with its own on/off toggle here, then briefly a
  // pair of Inspector tabs — now folded directly into the Human tab's own
  // field flow instead (DetailPanel.tsx: an inline timeline right where
  // "Temporal" is, an inline map right where "Spatial" is), so there is
  // only ever one panel to show/hide here: "为什么我们不能把这个...human
  // readable的那一个页面做成一个很长的东西,然后不同的属性...用不同的viewer...去把
  // 那个数据给渲染出来" (why can't the human-readable page just be one long
  // scroll, with each property rendered by whatever viewer fits it). The
  // interactive bbox/datetime query tool that used to live alongside
  // Time/Space Lens was dropped entirely in the same pass, not folded in
  // here either — see DetailPanel.tsx/ItemSetBrowser.tsx.
  const [containerRef, { width: containerWidth }] = useElementSize<HTMLDivElement>()
  const [inspectorWidth, setInspectorWidth] = useState(DEFAULT_INSPECTOR_WIDTH)
  // Remembers the last non-zero width so double-clicking the handle while
  // collapsed restores whatever size was actually in use, not always the
  // same default.
  const lastOpenWidthRef = useRef(DEFAULT_INSPECTOR_WIDTH)
  useEffect(() => {
    if (inspectorWidth > 0) lastOpenWidthRef.current = inspectorWidth
  }, [inspectorWidth])

  // Manual mousedown/mousemove/mouseup, not d3-drag — this is a single
  // linear pixel value on a plain HTML divider, not an SVG element bound
  // to d3 selections the way the tree's own draggable nodes are; d3-drag
  // would add a dependency here for no real benefit over a few native
  // listeners. Attached to `window`, not the handle itself, so the drag
  // keeps tracking correctly even if the cursor briefly leaves the thin
  // handle strip mid-drag — a real, common case for a fast mouse movement.
  const beginResize = useCallback(
    (startEvent: React.MouseEvent) => {
      startEvent.preventDefault()
      const startX = startEvent.clientX
      const startWidth = inspectorWidth

      function onMove(e: MouseEvent) {
        // Handle sits to the *left* of Inspector, so dragging left (cursor
        // x decreases) should grow it — the delta is inverted relative to
        // a plain "drag right to grow" control.
        const delta = startX - e.clientX
        const cap = containerWidth > 0 ? containerWidth * 0.5 : DEFAULT_INSPECTOR_WIDTH
        let next = Math.min(startWidth + delta, cap)
        if (next < MIN_INSPECTOR_WIDTH) next = 0
        setInspectorWidth(Math.max(next, 0))
      }
      function onUp() {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
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
  // shown: "选择了一个新的对象之后...看到图片在闪变并且留在原位置" (after
  // selecting a new object... you see the image flash-change while staying
  // in the same scroll position).
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
  // Lens (§10/§15's parentHref chain).
  const { booting, error: bootError, target } = useDeepLinkBootstrap()
  useEffect(() => {
    if (!target) return
    setRootHref(target.rootHref)
    if (target.selectedHref) select(target.selectedHref)
  }, [target, select])
  useShareableUrlSync(rootHref, selectedHref, booting)
  // The browser's own Back/Forward — previously did nothing at all (the
  // address bar changed, but nothing on screen did), which combined with
  // `useShareableUrlSync` only ever having one history entry per app
  // session meant a single Back press left the app outright, however much
  // had been explored: "浏览器的返回按钮按下之后就回到了浏览器的默认页...这个
  // 真的没有办法么" (pressing the browser's back button goes straight to
  // the browser's own default page — is there really no way around
  // this?). See both hooks' own docs for the full mechanism.
  usePopStateSync(setRootHref, select)

  function openCatalog(href: string) {
    select(null) // a selection from a previous catalog can't mean anything here
    setRootHref(href)
  }

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
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
        {/* Replaced a separate "← Catalogs" button — the title itself is
         * the back-to-landing-page control now, the same convention
         * countless real websites already use (their own logo/site name
         * in the header is always a link home): "我觉得我们似乎不需要返回
         * 按钮,因为我觉得按下网站标题STAC Lens就可以回到初始页" (I don't think
         * we need a back button — clicking the "STAC Lens" title itself
         * should return to the initial page). No border/background of its
         * own, so it doesn't read as a second, competing button next to
         * the title it *is*. */}
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
          }}
        >
          STAC Lens
        </button>
        <span
          style={{
            fontSize: 12,
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {rootHref}
        </span>
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
          <StructureTree key={rootHref} rootHref={rootHref} />
        </div>
        {hasSelection && (
          <>
            {/* The one control for Inspector's width — grab to resize
             * continuously, drag past `MIN_INSPECTOR_WIDTH` to snap it
             * fully away, drag it back out from the right edge to bring it
             * back, or double-click for a quick collapse/restore without
             * dragging at all. */}
            <div
              onMouseDown={beginResize}
              onDoubleClick={toggleCollapse}
              title={
                inspectorWidth > 0
                  ? 'Drag to resize · double-click to hide Inspector'
                  : 'Drag left, or double-click, to show Inspector'
              }
              style={{
                width: HANDLE_WIDTH,
                flexShrink: 0,
                cursor: 'col-resize',
                background: 'var(--color-border)',
              }}
            />
            {inspectorWidth > 0 && (
              <div ref={inspectorScrollRef} style={{ width: inspectorWidth, flexShrink: 0, overflow: 'auto' }}>
                <DetailPanel />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default App
