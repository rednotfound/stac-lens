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
  highlightHref,
  statedBbox,
  fitKey,
  onSelectItem,
}: {
  items: StacNode[]
  highlightHref?: string
  /** A reference footprint to draw as a dashed rectangle (e.g. a
   *  Collection's own declared `extent.spatial.bbox`) — omit when there's
   *  nothing meaningful to compare against in this context. */
  statedBbox?: number[]
  /** Refit the view to the currently-visible footprints once per distinct
   *  value of this key (e.g. the Collection's own href, or a page number)
   *  — not on every render, so it doesn't fight a manual pan/zoom. */
  fitKey?: string
  onSelectItem: (href: string) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerGroupRef = useRef<L.LayerGroup | null>(null)
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
  }, [itemsWithBbox, statedBbox, highlightHref, palette, onSelectItem])

  // Fit the whole visible set into view once per distinct `fitKey` — not
  // on every render, so it doesn't fight a manual pan/zoom.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !fitKey) return
    if (lastFitTargetRef.current === fitKey) return
    lastFitTargetRef.current = fitKey

    const boundsList = itemsWithBbox.map((i) => bboxToBounds(i.spatial.bbox))
    if (statedBbox) boundsList.push(bboxToBounds(statedBbox))
    if (boundsList.length === 0) return
    const bounds = boundsList.reduce<L.LatLngBounds | undefined>(
      (acc, b) => (acc ? acc.extend(b) : L.latLngBounds(b)),
      undefined,
    )
    if (bounds) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12 })
  }, [fitKey, itemsWithBbox, statedBbox])

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
