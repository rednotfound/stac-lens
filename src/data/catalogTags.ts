/** The closed vocabularies behind the landing page's facet filters. Three
 *  facets — topic, region, publisher — plus `kind`, which the data already
 *  had. Closed on purpose: a free tag bag drifts within weeks (see
 *  docs/CATALOGS.md, "Tags"). Adding a value means adding it here *and*
 *  defining it in that document; the verifier and a unit test reject any
 *  record that uses a value not listed here.
 *
 *  Values are ids (stable, in URLs and data); labels are what the UI shows.
 *  Neither STAC nor STAC Index has anything like this, so every assignment
 *  is an editorial judgment made from the catalog's own description and
 *  contents, and can be corrected by a pull request. */

export const TOPICS = {
  'eo-imagery': 'Imagery',
  'climate-weather': 'Climate & weather',
  elevation: 'Elevation & terrain',
  'land-cover': 'Land cover & land use',
  'vector-basemap': 'Vector & basemap',
  'ocean-hydrology': 'Ocean, coasts & water',
  disaster: 'Disasters & hazards',
  agriculture: 'Agriculture & forestry',
  urban: 'Urban & infrastructure',
  population: 'Population & humanitarian',
  ecology: 'Ecology & biodiversity',
  planetary: 'Planetary science',
  'ml-training': 'ML training data',
  reference: 'Reference & samples',
  'multi-domain': 'Multi-domain archive',
} as const

export const REGIONS = {
  global: 'Global',
  africa: 'Africa',
  antarctica: 'Antarctica',
  arctic: 'Arctic',
  asia: 'Asia',
  europe: 'Europe',
  'north-america': 'North America',
  oceania: 'Oceania',
  'south-america': 'South America',
  'beyond-earth': 'Beyond Earth',
} as const

export const PUBLISHERS = {
  'space-agency': 'Space agency',
  government: 'Government',
  intergovernmental: 'Intergovernmental',
  research: 'Research',
  commercial: 'Commercial',
  community: 'Community & non-profit',
} as const

export const KINDS = {
  static: 'Static catalog',
  api: 'STAC API',
} as const

export type TopicId = keyof typeof TOPICS
export type RegionId = keyof typeof REGIONS
export type PublisherId = keyof typeof PUBLISHERS
export type KindId = keyof typeof KINDS

export type FacetId = 'kind' | 'topics' | 'regions' | 'publisher'

export interface FacetDef {
  id: FacetId
  label: string
  values: Readonly<Record<string, string>>
}

/** Display order of the facet rows on the landing page. */
export const FACETS: readonly FacetDef[] = [
  { id: 'topics', label: 'Topic', values: TOPICS },
  { id: 'regions', label: 'Region', values: REGIONS },
  { id: 'publisher', label: 'Publisher', values: PUBLISHERS },
  { id: 'kind', label: 'Access', values: KINDS },
]
