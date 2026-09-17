/** Extension Registry (namespace layer). Classifies property/asset field
 *  prefixes as known or custom/unknown.
 *
 *  Deliberately NOT keyed off `stac_extensions` — real fixtures show that's
 *  unreliable in both directions: fields can be present without being
 *  declared (Adaptation Atlas's `atlas:*`, the spec example's `cs:*`), and
 *  declared without covering every field actually present (Earth Search's
 *  `item_assets` under-declaring real asset keys). Classification is by
 *  the field's namespace prefix itself.
 *
 *  Known-prefix list is intentionally small (v0.1) — only extensions we
 *  actually observed in the three reference fixtures. Unknown prefixes are
 *  never an error: they're surfaced generically and never block rendering.
 */
export const KNOWN_EXTENSION_PREFIXES: Record<string, string> = {
  eo: 'Electro-Optical',
  view: 'View Geometry',
  proj: 'Projection',
  raster: 'Raster',
  sat: 'Satellite',
  sar: 'SAR',
  sci: 'Scientific Citation',
  ssys: 'Solar System',
  file: 'File Info',
  table: 'Table',
  processing: 'Processing',
  classification: 'Classification',
  mgrs: 'MGRS',
  grid: 'Grid',
  s2: 'Sentinel-2 (community)',
}

export interface NamespaceScan {
  /** Prefixes found that match a known extension. */
  known: string[]
  /** Prefixes found with no match — always kept, never dropped. */
  unknown: string[]
}

/** Scans a flat-ish object's keys for `namespace:field` patterns. Intended
 *  to be called separately per scope (Item properties, each Asset object,
 *  Collection summaries) since extension fields can live at any of these
 *  levels and even override between Item and Asset scope. */
export function scanNamespaces(obj: Record<string, unknown> | undefined | null): NamespaceScan {
  const known = new Set<string>()
  const unknown = new Set<string>()

  if (obj) {
    for (const key of Object.keys(obj)) {
      const colonIndex = key.indexOf(':')
      if (colonIndex <= 0) continue
      const prefix = key.slice(0, colonIndex)
      if (prefix in KNOWN_EXTENSION_PREFIXES) known.add(prefix)
      else unknown.add(prefix)
    }
  }

  return { known: [...known], unknown: [...unknown] }
}

/** Merges namespace scans across multiple scopes (e.g. Item properties +
 *  every Asset) into the node-level `propertyNamespaces` field. */
export function mergeNamespaceScans(scans: NamespaceScan[]): string[] {
  const all = new Set<string>()
  for (const scan of scans) {
    for (const p of scan.known) all.add(p)
    for (const p of scan.unknown) all.add(p)
  }
  return [...all]
}
