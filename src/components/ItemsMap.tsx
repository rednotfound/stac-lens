import { useEffect, useMemo, useRef, useState } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { StacNode } from '../stac/types'

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
  light: { item: '#b45309', selection: '#2563eb', textFaint: '#b7b1a4' },
  dark: { item: '#f0a253', selection: '#60a5fa', textFaint: '#6b6558' },
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
 *  view (§59): "因为不管是时间还是空间都是看待同一批数据的另一种方式而已" (time
 *  and space are both just another way of looking at the same batch of
 *  data). No selection-scoping logic lives here — a caller decides what
 *  `items`/`highlightHref` mean in its own context. */
export function ItemsMap({
  items,
  dimmedItems,
  highlightHref,
  statedBbox,
  appliedBbox,
  drawMode = false,
  onBboxDrawn,
  fitKey,
  onSelectItem,
}: {
  items: StacNode[]
  /** Footprints from pages/batches already fetched but not currently the
   *  "active" set — drawn faint and non-clickable, behind `items`'s own
   *  full-color, interactive footprints. Asked for directly: "已经加载过的
   *  page的数据就留在地图上...灰色的之类的，但是需要能够被看见" (already-loaded
   *  pages' data should stay on the map, grayed out, but visible). Omit
   *  (or pass `[]`) when there's no such secondary set — e.g. an
   *  API-backed Collection's own infinite-scroll accumulation already puts
   *  everything ever loaded into `items` itself, so it never needs this. */
  dimmedItems?: StacNode[]
  highlightHref?: string
  /** A reference footprint to draw as a dashed rectangle (e.g. a
   *  Collection's own declared `extent.spatial.bbox`) — omit when there's
   *  nothing meaningful to compare against in this context. */
  statedBbox?: number[]
  /** A user-applied query filter's own bbox, rendered as a visually
   *  distinct, bolder overlay from `statedBbox` — deliberately a separate
   *  prop rather than reusing `statedBbox`'s rendering path: `statedBbox`
   *  is a passive fact ("this is what the source declares"), this is an
   *  active filter currently constraining what's on screen, and a
   *  Collection can genuinely have both at once. */
  appliedBbox?: [number, number, number, number]
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
    const map = L.map(el, { worldCopyJump: true, zoomControl: false }).setView([0, 0], 2)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map)
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
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
      layerGroupRef.current = null
    }
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

    if (statedBbox) {
      L.rectangle(bboxToBounds(statedBbox), {
        color: palette.textFaint,
        weight: 1,
        dashArray: '3,2',
        fill: false,
      }).addTo(layerGroup)
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
  }, [itemsWithBbox, dimmedItemsWithBbox, statedBbox, highlightHref, palette, onSelectItem])

  // Draw-a-bbox mode — the hand-rolled mousedown/mousemove/mouseup pattern
  // (with `map.dragging.disable()` for the duration) that the now-deleted
  // interactive query tool (docs/DESIGN.md §39) originally used, adapted
  // from that tool's global store to a plain prop/callback pair scoped to
  // whichever panel turns this on. This is the only mechanism found that
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
  // handful-of-km footprint invisible as a sub-pixel speck ("常常范围是小的
  // ...导致用户其实不知道地图上有没有显示，在哪里"). Root cause was marking
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
    if (statedBbox) boundsList.push(bboxToBounds(statedBbox))
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
  }, [fitKey, itemsWithBbox, statedBbox, appliedBbox])

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
    // sibling UI outside it (see docs/DESIGN.md §23).
    <div style={{ position: 'relative', width: '100%', height: '100%', zIndex: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', zIndex: 0 }} />
    </div>
  )
}
