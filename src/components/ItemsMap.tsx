import { useEffect, useMemo, useRef, useState } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { StacNode } from '../stac/types'
import { firstBboxIsUnion } from '../stac/spatial'
import { describeBody, type CelestialBody } from '../stac/body'

// The standard OSM tile server — no API key, unlike CARTO's basemap tiles
// (tried first; they now watermark "API KEY REQUIRED" over the imagery
// without one). No separate dark tile source either — dark mode is a CSS
// filter on the tile pane instead, since a free, no-key dark raster tile
// set didn't check out as reliably available.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

// Mirrors src/design/tokens.css — Leaflet's SVG renderer sets fill/stroke
// as plain attributes, which don't reliably resolve CSS custom properties
// the way our own `style={{ fill: 'var(...)' }}` SVG elements do elsewhere
// in this app, so the palette is duplicated here rather than referenced.
const PALETTE = {
  light: { item: '#144e63', selection: '#2563eb', textFaint: '#b7b1a4' },
  dark: { item: '#6fb3d2', selection: '#60a5fa', textFaint: '#6b6558' },
}

function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isDark
}

function bboxToBounds(bbox: number[]): L.LatLngBoundsLiteral {
  const [west, south, east, north] = bbox
  return [
    [south, west],
    [north, east],
  ]
}

/** The pure "given some Items, draw their footprints on a real map"
 *  visualization — extracted out of `SpaceLens.tsx` so it can be shared
 *  between Inspector's own single-object-scoped Spatial field (still
 *  driven by `useSelectedItems()`) and Item Set's own multi-item batch
 *  view (docs/DESIGN.md, "…tabs reuse the app's own tab style, and the
 *  box is now resizable"): time and space are both just another way of
 *  looking at the same batch of data. No selection-scoping logic lives
 *  here — a caller decides what `items`/`highlightHref` mean in its own
 *  context. */
export function ItemsMap({
  items,
  dimmedItems,
  highlightHref,
  statedBboxes,
  appliedBbox,
  body,
  gestures = 'greedy',
  drawMode = false,
  onBboxDrawn,
  fitKey,
  onSelectItem,
}: {
  items: StacNode[]
  /** Footprints from pages/batches already fetched but not currently the
   *  "active" set — drawn faint and non-clickable, behind `items`'s own
   *  full-color, interactive footprints. This is an explicit request, not
   *  a guess: already-loaded pages' data should stay on the map, grayed
   *  out, but still visible. Omit (or pass `[]`) when there's no such
   *  secondary set — e.g. an API-backed Collection's own infinite-scroll
   *  accumulation already puts everything ever loaded into `items` itself,
   *  so it never needs this. */
  dimmedItems?: StacNode[]
  highlightHref?: string
  /** Reference footprints to draw as dashed rectangles — a Collection's
   *  declared `extent.spatial.bbox` array, every entry (Planetary
   *  Computer's 3dep Collections declare CONUS+Alaska and Guam; fia
   *  declares thirteen islands). When there are several and the first
   *  really contains the rest, the first is drawn lighter as the overall
   *  extent; otherwise all are drawn alike. Omit when there's nothing
   *  meaningful to compare against in this context. */
  statedBboxes?: number[][]
  /** A user-applied query filter's own bbox, rendered as a visually
   *  distinct, bolder overlay from `statedBboxes` — deliberately a separate
   *  prop rather than reusing that rendering path: a stated bbox
   *  is a passive fact ("this is what the source declares"), this is an
   *  active filter currently constraining what's on screen, and a
   *  Collection can genuinely have both at once. */
  appliedBbox?: [number, number, number, number]
  /** The world the coordinates belong to when it is not Earth
   *  (`resolveBody`). Then there is no basemap — OpenStreetMap tiles under
   *  Titan's longitudes would be a lie — only a plain lon/lat graticule in
   *  an equirectangular frame, and a corner note naming the body. Fixed
   *  for the life of the map: parents re-key the component when it
   *  changes (`bodyKey`). */
  body?: CelestialBody
  /** How the map competes with the page for gestures — the vocabulary of
   *  the Google Maps API. `greedy` (default): every wheel and every finger
   *  is the map's; right for a map that *is* the panel (the bbox picker,
   *  the Item Set's Time & Space view). `cooperative`: one finger scrolls
   *  the page and a plain wheel scrolls the page; two fingers move the map
   *  and Ctrl/Cmd+wheel zooms it, with a short hint when a blocked gesture
   *  happens. Right for a map embedded in scrolling content (the
   *  Inspector's Spatial field), where a greedy map traps the scroll:
   *  once the map fills the viewport there is nothing left to scroll by. */
  gestures?: 'greedy' | 'cooperative'
  /** While true, dragging on the map draws a rectangle instead of panning
   *  it (`map.dragging.disable()` for the duration — the same conflict
   *  resolution the deleted interactive query tool used, the only way a
   *  drag-to-draw gesture and Leaflet's own drag-to-pan can coexist). */
  drawMode?: boolean
  onBboxDrawn?: (bbox: [number, number, number, number]) => void
  /** Refit the view to the currently-visible footprints once per distinct
   *  value of this key (e.g. the Collection's own href, or a page number)
   *  — not on every render, so it doesn't fight a manual pan/zoom. */
  fitKey?: string
  onSelectItem: (href: string) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  // Cooperative-gesture hint ('Use two fingers to move the map'), shown briefly.
  const [hint, setHint] = useState<string | null>(null)
  const layerGroupRef = useRef<L.LayerGroup | null>(null)
  const appliedBboxLayerRef = useRef<L.Rectangle | null>(null)
  const drawingRectRef = useRef<L.Rectangle | null>(null)
  const drawStartRef = useRef<L.LatLng | null>(null)
  const lastFitTargetRef = useRef<string | undefined>(undefined)
  const lastFlyHrefRef = useRef<string | undefined>(undefined)
  const isDark = useIsDark()

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const cooperative = gestures === 'cooperative'
    const map = body
      ? L.map(el, {
          crs: L.CRS.EPSG4326,
          worldCopyJump: false,
          zoomControl: false,
          attributionControl: false,
          scrollWheelZoom: !cooperative,
        })
      : L.map(el, { worldCopyJump: true, zoomControl: false, scrollWheelZoom: !cooperative })
    map.setView([0, 0], body ? 1 : 2)
    const detachGestures = cooperative ? installCooperativeGestures(map, el, setHint) : undefined
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    if (body) addGraticule(map, palette.textFaint)
    else L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map)
    const layerGroup = L.layerGroup().addTo(map)
    mapRef.current = map
    layerGroupRef.current = layerGroup

    // Leaflet measures its container's pixel size once at init (and caches
    // it internally for every pixel<->latlng conversion after that) — a
    // ResizeObserver calls `invalidateSize()` whenever the real size
    // changes, not just once on mount, since this map lives inline in a
    // flow layout whose size can settle gradually rather than a
    // dedicated, already-sized panel.
    const resizeObserver = new ResizeObserver(() => mapRef.current?.invalidateSize())
    resizeObserver.observe(el)

    return () => {
      detachGestures?.()
      resizeObserver.disconnect()
      // A fit or fly still animating when this map unmounts (navigating to
      // another catalog mid-flight) leaves Leaflet's 250 ms zoom-transition
      // fallback timer armed; it then runs `_onZoomTransitionEnd` on a
      // removed map and throws reading `_leaflet_pos` of the deleted pane.
      // That handler returns at once when no zoom is animating, so clear
      // the flag before removing. Reproduced by the smoke suite's route
      // change; Leaflet's `remove()` does not do this itself.
      map.stop()
      ;(map as L.Map & { _animatingZoom?: boolean })._animatingZoom = false
      map.remove()
      mapRef.current = null
      layerGroupRef.current = null
      // The fit/fly "already done" guards below are meaningless once *this*
      // map instance is gone — without resetting them here, React 18
      // StrictMode's dev-only double-invoke of this exact effect (mount →
      // cleanup → mount again, to surface missing-cleanup bugs) destroys
      // this first map and builds a second, real one, but the guards
      // (plain refs, unaffected by that cleanup/remount cycle) still
      // remember "already fitted" from the map that's now gone — so the fit
      // effect below silently no-ops on the real, final map, permanently
      // stuck at the default whole-world view. This was a reported problem,
      // not a guess: a fresh Collection with a real declared bbox (Planetary
      // Computer's `3dep-lidar-returns`) never flew to it at all — the map
      // stayed put until the user panned over to the footprint by hand. Only
      // reproduces in dev (StrictMode's double-invoke is a dev-only
      // behavior — production never re-runs a mount effect without a real
      // unmount), but a testing environment silently showing broken
      // behavior that isn't real is its own problem worth fixing outright,
      // not just noting away.
      lastFitTargetRef.current = undefined
      lastFlyHrefRef.current = undefined
    }
    // `body` and the graticule color are read once, at mount, on purpose:
    // a Leaflet map's CRS cannot change after creation, so parents re-key
    // this component when the body changes (`bodyKey`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Dark mode is a CSS filter on the tile pane, not a separate tile source.
  useEffect(() => {
    mapRef.current?.getContainer().classList.toggle('leaflet-dark', isDark)
  }, [isDark])

  const palette = isDark ? PALETTE.dark : PALETTE.light
  const itemsWithBbox = useMemo(
    () => items.filter((i): i is StacNode & { spatial: { bbox: number[] } } => !!i.spatial?.bbox),
    [items],
  )
  const dimmedItemsWithBbox = useMemo(
    () => (dimmedItems ?? []).filter((i): i is StacNode & { spatial: { bbox: number[] } } => !!i.spatial?.bbox),
    [dimmedItems],
  )

  // Rebuild the rectangle layers whenever the visible item set changes.
  useEffect(() => {
    const layerGroup = layerGroupRef.current
    if (!layerGroup) return
    layerGroup.clearLayers()

    if (statedBboxes) {
      const overall = statedBboxes.length > 1 && firstBboxIsUnion(statedBboxes)
      statedBboxes.forEach((bbox, i) => {
        const isOverall = overall && i === 0
        L.rectangle(bboxToBounds(bbox), {
          color: palette.textFaint,
          weight: 1,
          dashArray: isOverall ? '2,5' : '3,2',
          opacity: isOverall ? 0.6 : 1,
          fill: false,
        }).addTo(layerGroup)
      })
    }

    // Dimmed (already-loaded, not-currently-active) footprints, drawn
    // before the active set below so they always sit underneath it —
    // faint but genuinely visible, not just a hint, and non-interactive
    // beyond a hover tooltip (no click — selecting an Item on a page
    // that's no longer the displayed one would need to also switch pages
    // to make sense, which is more behavior than was asked for here).
    for (const item of dimmedItemsWithBbox) {
      const rect = L.rectangle(bboxToBounds(item.spatial.bbox), {
        color: palette.textFaint,
        weight: 1,
        fillOpacity: 0.12,
      })
      rect.bindTooltip(item.title ?? item.id, { sticky: true, direction: 'top' })
      rect.addTo(layerGroup)
    }

    // Selected item drawn last (on top) so its outline isn't buried under a
    // stack of overlapping siblings sharing near-identical footprints.
    const ordered = highlightHref
      ? [
          ...itemsWithBbox.filter((i) => i.href !== highlightHref),
          ...itemsWithBbox.filter((i) => i.href === highlightHref),
        ]
      : itemsWithBbox

    for (const item of ordered) {
      const selected = item.href === highlightHref
      const rect = L.rectangle(bboxToBounds(item.spatial.bbox), {
        color: selected ? palette.selection : palette.item,
        weight: selected ? 2 : 1,
        fillOpacity: selected ? 0.25 : 0.1,
      })
      rect.bindTooltip(item.title ?? item.id, { sticky: true, direction: 'top' })
      rect.on('click', () => onSelectItem(item.href))
      rect.addTo(layerGroup)
    }
  }, [itemsWithBbox, dimmedItemsWithBbox, statedBboxes, highlightHref, palette, onSelectItem])

  // Draw-a-bbox mode — a hand-rolled mousedown/mousemove/mouseup pattern
  // (with `map.dragging.disable()` for the duration), driven by a plain
  // prop/callback pair scoped to whichever panel turns this on, not a
  // global store (docs/DESIGN.md, "Past tabs entirely" covers the query
  // tool this pattern comes from). This is the only mechanism found that
  // actually lets a drag-to-draw gesture coexist with Leaflet's own
  // drag-to-pan on the same map.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !drawMode) return

    map.dragging.disable()
    const container = map.getContainer()
    container.style.cursor = 'crosshair'

    function onDown(e: L.LeafletMouseEvent) {
      drawStartRef.current = e.latlng
      drawingRectRef.current?.remove()
      // `interactive: false` — this rectangle is a pure visual preview,
      // sitting directly under the cursor for the whole gesture; it must
      // never itself intercept a mouse event meant for the map underneath
      // (or, later, for an item footprint it happens to be drawn over).
      drawingRectRef.current = L.rectangle(L.latLngBounds(e.latlng, e.latlng), {
        color: '#2563eb',
        weight: 2,
        dashArray: '4,3',
        fillOpacity: 0.05,
        interactive: false,
      }).addTo(map!)
    }
    function onMove(e: L.LeafletMouseEvent) {
      const start = drawStartRef.current
      if (!start || !drawingRectRef.current) return
      drawingRectRef.current.setBounds(L.latLngBounds(start, e.latlng))
    }
    function onUp() {
      const start = drawStartRef.current
      const rect = drawingRectRef.current
      if (!start || !rect) return
      const bounds = rect.getBounds()
      rect.remove()
      drawingRectRef.current = null
      drawStartRef.current = null
      onBboxDrawn?.([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()])
    }

    map.on('mousedown', onDown)
    map.on('mousemove', onMove)
    map.on('mouseup', onUp)

    return () => {
      map.off('mousedown', onDown)
      map.off('mousemove', onMove)
      map.off('mouseup', onUp)
      // Only touch dragging/cursor on a map that's still the *live, current*
      // instance — a real, confirmed race with React's dev-mode double-
      // invoke: this cleanup can run interleaved *after* the base mount
      // effect's own cleanup has already called `map.remove()` on this
      // exact `map` object (confirmed directly by logging call order — it
      // is not simple LIFO here). Calling `map.dragging.enable()` on an
      // already-removed map still re-attaches a real native `mousedown`
      // listener to the container (Leaflet's own `Draggable.enable()` does
      // this unconditionally, regardless of the map's own lifecycle) whose
      // handler then references that removed map's torn-down internal
      // panes — the next real mousedown anywhere throws inside Leaflet's
      // own `getSizedParentNode`, and because that throw happens before
      // `Draggable._dragging` (a *static*, page-wide flag, not per-map) is
      // ever cleared, every drag on every Leaflet map on the page — not
      // just this one — is silently blocked forever after, until reload.
      // Comparing against `mapRef.current` — updated by that other effect
      // — is what actually detects "this exact instance is stale," since
      // Leaflet exposes no public "am I removed" flag of its own.
      if (mapRef.current === map) {
        map.dragging.enable()
        container.style.cursor = ''
      }
      drawingRectRef.current?.remove()
      drawingRectRef.current = null
      drawStartRef.current = null
    }
  }, [drawMode, onBboxDrawn])

  // The currently-applied query bbox, drawn as its own persistent overlay —
  // independent of the item-footprint layer group above (which fully
  // rebuilds whenever the visible item set changes; this shouldn't flicker
  // along with that).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    appliedBboxLayerRef.current?.remove()
    appliedBboxLayerRef.current = null
    if (!appliedBbox) return
    appliedBboxLayerRef.current = L.rectangle(bboxToBounds(appliedBbox), {
      color: '#2563eb',
      weight: 2,
      dashArray: '4,3',
      fillOpacity: 0.05,
      // Purely a visual overlay — must never intercept clicks meant for an
      // item footprint underneath it, or a future draw gesture starting on
      // top of it. Same reasoning as the in-progress drawing rectangle above.
      interactive: false,
    }).addTo(map)
    return () => {
      appliedBboxLayerRef.current?.remove()
      appliedBboxLayerRef.current = null
    }
  }, [appliedBbox])

  // Fit the whole visible set into view once per distinct `fitKey` — not
  // on every render, so it doesn't fight a manual pan/zoom. `fitKey`
  // itself (e.g. a Collection's own href) is available immediately when a
  // box opens, well before its Items have actually finished loading —
  // real user report: opening any Collection's box left the map stuck at
  // the default whole-world view no matter how long you waited, making a
  // handful-of-km footprint invisible as a sub-pixel speck — footprints are
  // often small, so the user can't tell whether the map is showing anything
  // at all, let alone where. Root cause was marking
  // `lastFitTargetRef` done *before* checking whether there was anything
  // to fit yet: the effect's very first run (items still empty) set the
  // guard and returned, so every later re-run once items actually arrived
  // (this effect does depend on `itemsWithBbox`, and does re-run then) was
  // skipped by that same guard, permanently. Only marking it done once a
  // fit has *actually happened* keeps retrying across the async item load
  // instead of giving up on the first, empty attempt — while still fully
  // honoring "once per fitKey, don't fight a manual pan/zoom" once it does.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !fitKey || lastFitTargetRef.current === fitKey) return

    const boundsList = itemsWithBbox.map((i) => bboxToBounds(i.spatial.bbox))
    for (const bbox of statedBboxes ?? []) boundsList.push(bboxToBounds(bbox))
    // Committing a bbox search is a strong, explicit signal of "look here
    // now" — re-framing the map to it (alongside whatever items already
    // loaded) makes the just-applied filter visibly take effect rather than
    // leaving the view wherever it happened to be.
    if (appliedBbox) boundsList.push(bboxToBounds(appliedBbox))
    if (boundsList.length === 0) return
    const bounds = boundsList.reduce<L.LatLngBounds | undefined>(
      (acc, b) => (acc ? acc.extend(b) : L.latLngBounds(b)),
      undefined,
    )
    if (!bounds) return
    lastFitTargetRef.current = fitKey
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12 })
  }, [fitKey, itemsWithBbox, statedBboxes, appliedBbox])

  // Fly to the specifically-selected Item's own bbox — this is what makes
  // an island-sized bbox actually visible instead of a 1-2px speck on a
  // world-scale view. Once per distinct selection.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !highlightHref || lastFlyHrefRef.current === highlightHref) return
    const item = itemsWithBbox.find((i) => i.href === highlightHref)
    if (!item) return
    lastFlyHrefRef.current = highlightHref
    map.flyToBounds(bboxToBounds(item.spatial.bbox), { padding: [60, 60], maxZoom: 16, duration: 0.75 })
  }, [highlightHref, itemsWithBbox])

  return (
    // `zIndex: 0` (not just `position: relative`) is load-bearing, not
    // decorative — it's what actually creates a new stacking context here;
    // without one, Leaflet's own internal panes/controls (z-index up to
    // 1000) aren't contained by their own map element and can stack above
    // sibling UI outside it (see docs/DESIGN.md, "Layout: Time Lens and
    // Space Lens no longer share one fixed-height row").
    <div style={{ position: 'relative', width: '100%', height: '100%', zIndex: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', zIndex: 0 }} />
      {body && <BodyNote body={body} />}
      {hint && <GestureHint text={hint} />}
    </div>
  )
}

/** A plain longitude/latitude grid for a body with no basemap: meridians
 *  and parallels every 30°, labels every 60°/30°, all in the faint text
 *  color. Drawn once at mount into its own layer group, under the
 *  footprints. */
function addGraticule(map: L.Map, color: string) {
  const group = L.layerGroup().addTo(map)
  const style = { color, weight: 1, opacity: 0.5, interactive: false }
  for (let lon = -180; lon <= 180; lon += 30) {
    L.polyline(
      [
        [-90, lon],
        [90, lon],
      ],
      { ...style, weight: lon === 0 ? 1.5 : 1 },
    ).addTo(group)
  }
  for (let lat = -90; lat <= 90; lat += 30) {
    L.polyline(
      [
        [lat, -180],
        [lat, 180],
      ],
      { ...style, weight: lat === 0 ? 1.5 : 1 },
    ).addTo(group)
  }
  const label = (text: string, at: [number, number]) =>
    L.marker(at, {
      interactive: false,
      icon: L.divIcon({
        className: 'stac-lens-graticule-label',
        html: `<span style="font-size:10px;color:${color};font-family:var(--font-mono)">${text}</span>`,
        iconSize: [40, 12],
        iconAnchor: [20, 6],
      }),
    }).addTo(group)
  for (let lon = -180; lon <= 180; lon += 60) label(`${lon}°`, [-4, lon])
  for (let lat = -60; lat <= 60; lat += 30) if (lat !== 0) label(`${lat}°`, [lat, 4])
}

/** Corner note for a non-Earth map, so a viewer never mistakes the grid
 *  for a blank Earth. */
function BodyNote({ body }: { body: CelestialBody }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 6,
        bottom: 6,
        zIndex: 1001,
        pointerEvents: 'none',
        fontSize: 11,
        padding: '2px 7px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--color-surface)',
        color: 'var(--color-text-muted)',
        opacity: 0.92,
      }}
    >
      Body-fixed lon/lat on <strong style={{ color: 'var(--color-text)' }}>{describeBody(body)}</strong> — not Earth
    </div>
  )
}

/** Google-Maps-style "cooperative" gestures for a map embedded in
 *  scrolling content. Touch: the container's `touch-action` lets the
 *  browser own one-finger pans (the page scrolls), and Leaflet's drag
 *  handler is switched off for the duration of any one-finger touch so it
 *  cannot fight; two fingers reach Leaflet's touch-zoom handler, which
 *  pans and zooms together. Wheel: `scrollWheelZoom` is off; a wheel with
 *  Ctrl/Cmd zooms around the pointer and is consumed, a plain wheel scrolls
 *  the page and earns a hint. Mouse drag is untouched — it never scrolls a
 *  page, so there is nothing to protect. */
function installCooperativeGestures(map: L.Map, el: HTMLElement, setHint: (h: string | null) => void): () => void {
  el.style.touchAction = 'pan-x pan-y'
  let hintTimer = 0
  const showHint = (text: string) => {
    setHint(text)
    window.clearTimeout(hintTimer)
    hintTimer = window.setTimeout(() => setHint(null), 1400)
  }
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
  // Two fingers: the browser must not treat the gesture as a page scroll.
  // Leaflet's own touch-zoom listener sits on `document`, which Chrome
  // makes passive, so its preventDefault is ignored; a non-passive
  // listener on the element itself is honored. One finger: nothing is
  // prevented, so the page scrolls as `touch-action` allows.
  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 1) {
      if (map.dragging.enabled()) map.dragging.disable()
      showHint('Use two fingers to move the map')
    } else {
      e.preventDefault()
      setHint(null)
    }
  }
  const onTouchMove = (e: TouchEvent) => {
    if (e.touches.length >= 2) e.preventDefault()
  }
  const onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length === 0 && !map.dragging.enabled()) map.dragging.enable()
  }
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const point = map.mouseEventToContainerPoint(e as unknown as MouseEvent)
      map.setZoomAround(point, map.getZoom() + (e.deltaY < 0 ? 1 : -1))
      setHint(null)
    } else {
      showHint(`Use ${isMac ? '\u2318' : 'Ctrl'} + scroll to zoom the map`)
    }
  }
  el.addEventListener('touchstart', onTouchStart, { capture: true, passive: false })
  el.addEventListener('touchmove', onTouchMove, { passive: false })
  el.addEventListener('touchend', onTouchEnd, { passive: true })
  el.addEventListener('touchcancel', onTouchEnd, { passive: true })
  el.addEventListener('wheel', onWheel, { passive: false })
  return () => {
    window.clearTimeout(hintTimer)
    el.removeEventListener('touchstart', onTouchStart, { capture: true })
    el.removeEventListener('touchmove', onTouchMove)
    el.removeEventListener('touchend', onTouchEnd)
    el.removeEventListener('touchcancel', onTouchEnd)
    el.removeEventListener('wheel', onWheel)
  }
}

function GestureHint({ text }: { text: string }) {
  return (
    <div
      role="status"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 1002,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        background: 'rgba(0,0,0,0.28)',
      }}
    >
      <span
        style={{
          padding: '8px 14px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-text)',
          color: 'var(--color-bg)',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {text}
      </span>
    </div>
  )
}
