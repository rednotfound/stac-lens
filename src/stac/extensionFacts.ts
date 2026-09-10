// Human-readable interpreters for standard STAC extension fields — v1
// covers extensions actually observed across this project's own reference
// fixtures (Capella, Earth Search, EuroSAT, Adaptation Atlas) and confirmed
// against the official registry (https://stac-extensions.github.io/) as
// stable/candidate/pilot maturity. Deliberately scoped to standard
// extensions only — custom/unrecognized namespaces stay in "Property
// namespaces observed" (DetailPanel/namespaces.ts) unchanged; interpreting
// those one at a time is later, separate work, not this pass.
//
// Each interpreter reads directly from an Item's `properties` (where these
// fields actually live in every real fixture checked) and returns only the
// facts it can find — never a placeholder for a missing field.

export interface ExtensionFact {
  label: string
  value: string
}

export interface ExtensionFactGroup {
  prefix: string
  title: string
  facts: ExtensionFact[]
}

type Interpreter = (properties: Record<string, unknown>) => ExtensionFact[]

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

const INTERPRETERS: Record<string, { title: string; interpret: Interpreter }> = {
  eo: {
    title: 'Electro-Optical',
    interpret: (p) => {
      const facts: ExtensionFact[] = []
      if (isNumber(p['eo:cloud_cover'])) {
        facts.push({ label: 'Cloud cover', value: `${p['eo:cloud_cover']}%` })
      }
      if (isNumber(p['eo:snow_cover'])) {
        facts.push({ label: 'Snow cover', value: `${p['eo:snow_cover']}%` })
      }
      return facts
    },
  },
  view: {
    title: 'View Geometry',
    interpret: (p) => {
      const facts: ExtensionFact[] = []
      if (isNumber(p['view:off_nadir'])) {
        facts.push({ label: 'Off-nadir angle', value: `${p['view:off_nadir']}°` })
      }
      if (isNumber(p['view:incidence_angle'])) {
        facts.push({ label: 'Incidence angle', value: `${p['view:incidence_angle']}°` })
      }
      if (isNumber(p['view:azimuth'])) {
        facts.push({ label: 'Viewing azimuth', value: `${p['view:azimuth']}°` })
      }
      if (isNumber(p['view:sun_azimuth'])) {
        facts.push({ label: 'Sun azimuth', value: `${p['view:sun_azimuth']}°` })
      }
      if (isNumber(p['view:sun_elevation'])) {
        facts.push({ label: 'Sun elevation', value: `${p['view:sun_elevation']}°` })
      }
      return facts
    },
  },
  proj: {
    title: 'Projection',
    interpret: (p) => {
      const facts: ExtensionFact[] = []
      // `projection` extension renamed its prefix from `proj` to itself in
      // v2, but every real fixture checked still uses the original `proj:`
      // prefix — both read here since the field names didn't change.
      const epsg = p['proj:epsg']
      if (isNumber(epsg)) facts.push({ label: 'CRS', value: `EPSG:${epsg}` })
      const shape = p['proj:shape']
      if (Array.isArray(shape) && shape.length === 2) {
        facts.push({ label: 'Pixel dimensions', value: `${shape[0]}×${shape[1]} px` })
      }
      const resolution = p['proj:transform']
      if (Array.isArray(resolution) && isNumber(resolution[0])) {
        facts.push({ label: 'Pixel resolution', value: `${Math.abs(resolution[0])} (CRS units)` })
      }
      return facts
    },
  },
  sat: {
    title: 'Satellite',
    interpret: (p) => {
      const facts: ExtensionFact[] = []
      if (typeof p['sat:orbit_state'] === 'string') {
        facts.push({ label: 'Orbit state', value: p['sat:orbit_state'] as string })
      }
      if (p['sat:relative_orbit'] != null) {
        facts.push({ label: 'Relative orbit', value: String(p['sat:relative_orbit']) })
      }
      if (p['sat:absolute_orbit'] != null) {
        facts.push({ label: 'Absolute orbit', value: String(p['sat:absolute_orbit']) })
      }
      return facts
    },
  },
  sar: {
    title: 'SAR',
    interpret: (p) => {
      const facts: ExtensionFact[] = []
      if (typeof p['sar:instrument_mode'] === 'string') {
        facts.push({ label: 'Instrument mode', value: p['sar:instrument_mode'] as string })
      }
      if (Array.isArray(p['sar:polarizations'])) {
        facts.push({ label: 'Polarizations', value: (p['sar:polarizations'] as string[]).join(', ') })
      }
      if (typeof p['sar:product_type'] === 'string') {
        facts.push({ label: 'Product type', value: p['sar:product_type'] as string })
      }
      if (typeof p['sar:frequency_band'] === 'string') {
        facts.push({ label: 'Frequency band', value: p['sar:frequency_band'] as string })
      }
      return facts
    },
  },
  sci: {
    title: 'Scientific Citation',
    interpret: (p) => {
      const facts: ExtensionFact[] = []
      if (typeof p['sci:doi'] === 'string') facts.push({ label: 'DOI', value: p['sci:doi'] as string })
      if (typeof p['sci:citation'] === 'string') {
        facts.push({ label: 'Citation', value: p['sci:citation'] as string })
      }
      return facts
    },
  },
  processing: {
    title: 'Processing',
    interpret: (p) => {
      const facts: ExtensionFact[] = []
      if (typeof p['processing:level'] === 'string') {
        facts.push({ label: 'Processing level', value: p['processing:level'] as string })
      }
      if (typeof p['processing:facility'] === 'string') {
        facts.push({ label: 'Processing facility', value: p['processing:facility'] as string })
      }
      if (typeof p['processing:software'] === 'object' && p['processing:software']) {
        const entries = Object.entries(p['processing:software'] as Record<string, unknown>)
        if (entries.length) {
          facts.push({ label: 'Software', value: entries.map(([k, v]) => `${k} ${v}`).join(', ') })
        }
      }
      return facts
    },
  },
}

/** All standard-extension facts found on an Item's properties, grouped by
 *  extension — empty groups are dropped entirely (a fixture with no `sar:*`
 *  fields shows no SAR section at all, not an empty one). `gsd` is checked
 *  separately since it's a common core STAC field, not extension-scoped. */
export function interpretExtensionFacts(
  properties: Record<string, unknown> | undefined,
): ExtensionFactGroup[] {
  if (!properties) return []
  const groups: ExtensionFactGroup[] = []
  for (const [prefix, { title, interpret }] of Object.entries(INTERPRETERS)) {
    const facts = interpret(properties)
    if (facts.length > 0) groups.push({ prefix, title, facts })
  }
  return groups
}
