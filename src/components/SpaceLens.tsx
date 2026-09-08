import { useEffect, useMemo, useRef, useState } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useSelectionStore } from '../store/selection'
import { useSelectedItems } from '../hooks/useSelectedItems'
import type { StacNode } from '../stac/types'

// The standard OSM tile server — no API key, unlike CARTO's basemap tiles
// (tried first; they now watermark "API KEY REQUIRED" over the imagery
// without one). No separate dark tile source either — dark mode is a CSS
// filter on the tile pane instead (see `.leaflet-dark` below), since a
// free, no-key dark raster tile set didn't check out as reliably available.
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

const EMPTY_ITEMS: StacNode[] = []

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

/** A real interactive map (Leaflet + the standard OSM tile server) — not
 *  the hand-rolled static equirectangular projection this component used
 *  to be. That version's coastline outline had no
 *  detail to zoom into: plenty of real STAC Items have a bbox the size of
 *  one small island, invisible at world scale no matter how good the
 *  coastline data is. Real pan/zoom plus flying to the selected Item's own
 *  bounds is what actually solves that.
 *
 *  The map container div always renders regardless of loading/empty
 *  status — same rule as every other lens in this app (see docs/DESIGN.md
 *  §5): the mount effect binds to the ref once, and a container that only
 *  appears in some render branches risks binding to a still-null ref. */
export function SpaceLens() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerGroupRef = useRef<L.LayerGroup | null>(null)
  const lastFitTargetRef = useRef<string | undefined>(undefined)
  const lastFlyHrefRef = useRef<string | undefined>(undefined)

  const selectedHref = useSelectionStore((s) => s.selectedHref)
  const select = useSelectionStore((s) => s.select)
  const target = useSelectedItems(selectedHref)
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
    return () => {
      map.remove()
      mapRef.current = null
      layerGroupRef.current = null
    }
  }, [])

  // Dark mode is a CSS filter on the tile pane, not a separate tile source
  // — see the note on TILE_URL above.
  useEffect(() => {
    mapRef.current?.getContainer().classList.toggle('leaflet-dark', isDark)
  }, [isDark])

  const items = target.status === 'ready' ? target.items : EMPTY_ITEMS
  const node = target.status === 'ready' ? target.node : undefined
  const highlightHref = target.status === 'ready' ? target.highlightHref : undefined
  const statedBbox = node?.spatial?.bbox
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
      rect.on('click', () => select(item.href))
      rect.addTo(layerGroup)
    }
  }, [itemsWithBbox, statedBbox, highlightHref, palette, select])

  // Fit the whole visible set into view once per distinct target
  // Collection — not on every render, so it doesn't fight a manual pan/zoom.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !node) return
    if (lastFitTargetRef.current === node.href) return
    lastFitTargetRef.current = node.href

    const boundsList = itemsWithBbox.map((i) => bboxToBounds(i.spatial.bbox))
    if (statedBbox) boundsList.push(bboxToBounds(statedBbox))
    if (boundsList.length === 0) return
    const bounds = boundsList.reduce<L.LatLngBounds | undefined>(
      (acc, b) => (acc ? acc.extend(b) : L.latLngBounds(b)),
      undefined,
    )
    if (bounds) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12 })
  }, [node, itemsWithBbox, statedBbox])

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

  const statusMessage =
    target.status === 'empty'
      ? target.reason === 'no-selection'
        ? 'Select a Collection or Item in Structure to see where it is.'
        : 'This node has no Items directly — drill into a sub-collection.'
      : target.status === 'loading'
        ? 'loading…'
        : itemsWithBbox.length === 0 && !statedBbox
          ? 'No spatial data available.'
          : undefined

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: '6px 10px',
          fontSize: 12,
          color: 'var(--color-text-muted)',
          background: 'var(--color-surface)',
          opacity: 0.92,
          pointerEvents: 'none',
          zIndex: 10,
        }}
      >
        {node ? (
          <>
            <strong style={{ color: 'var(--color-text)' }}>{node.title ?? node.id}</strong>
            {' · '}
            {itemsWithBbox.length} item footprint{itemsWithBbox.length === 1 ? '' : 's'}
          </>
        ) : (
          statusMessage
        )}
      </div>
    </div>
  )
}
