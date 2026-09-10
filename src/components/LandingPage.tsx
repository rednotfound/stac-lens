import { useState } from 'react'

const KNOWN_CATALOGS = [
  {
    title: 'Africa Agriculture Adaptation Atlas',
    description:
      'Climate hazard rasters, scenarios, and real metadata inconsistencies — the primary stress-test fixture for this project.',
    href: 'https://digital-atlas.s3.amazonaws.com/stac/public_stac/catalog.json',
  },
  {
    title: 'STAC spec example catalog',
    description:
      "The spec's own minimal example tree — the floor case: bare-minimum valid STAC, empty collections, no extensions.",
    href: 'https://raw.githubusercontent.com/radiantearth/stac-spec/master/examples/catalog.json',
  },
  {
    title: 'Earth Search (Element84)',
    description:
      'A real STAC API, not a static catalog — Sentinel-2, Landsat, and more, queried live rather than link-walked.',
    href: 'https://earth-search.aws.element84.com/v1',
  },
  // The rest are static catalogs sourced from STAC Index (stacindex.org) —
  // the same public directory STAC Browser itself defers to rather than
  // maintaining its own list — each individually checked here for CORS and
  // valid STAC content before being added, not copied in blind.
  {
    title: 'Capella Space Open Data',
    description: 'SAR (synthetic aperture radar) satellite imagery.',
    href: 'https://capella-open-data.s3.us-west-2.amazonaws.com/stac/catalog.json',
  },
  {
    title: 'Maxar Open Data Catalog',
    description: 'High-resolution optical imagery released for disaster-response events.',
    href: 'https://maxar-opendata.s3.amazonaws.com/events/catalog.json',
  },
  {
    title: 'NZ Imagery',
    description: 'Aerial imagery of New Zealand — a genuinely large tree (800+ links) for scale-testing.',
    href: 'https://nz-imagery.s3.ap-southeast-2.amazonaws.com/catalog.json',
  },
  {
    title: 'fiboa Field Boundaries',
    description: 'Vector agricultural field-boundary datasets.',
    href: 'https://fiboa.org/stac/catalog.json',
  },
  {
    title: 'Polar Geospatial Center DEMs',
    description: 'High-resolution digital elevation models of the polar regions.',
    href: 'https://pgc-opendata-dems.s3.us-west-2.amazonaws.com/pgc-data-stac.json',
  },
  // A second, much larger verification pass over STAC Index's remaining ~73
  // static (non-API) entries — same methodology, scripted rather than
  // one-by-one: reachability, a real browser-shaped CORS check (GET + an
  // Origin header, not just curl succeeding), and confirming the body is
  // genuine STAC (a `type`/`stac_version`, not an OGC API - Records response
  // that merely looks similar). 62 passed; excluded here are the ones that
  // didn't (missing CORS, dead/redirecting links, or not actually STAC) plus
  // one that did pass but is plain `http://` — a real mixed-content risk once
  // this app is ever served over https, not yet worth the caveat in the UI.
  {
    title: 'CIESIN STAC',
    description: "Datasets from Columbia's Center for International Earth Science Information Network (CIESIN), including GRID3 population and settlement data.",
    href: 'https://ciesin.github.io/sci-apps-stac/stac/catalog.json',
  },
  {
    title: 'CoRE Stack Spatio Temporal Asset Catalog',
    description: 'Tehsil-level land and water resource data layers for India from the CoRE Stack project.',
    href: 'https://spatio-temporal-asset-catalog.s3.ap-south-1.amazonaws.com/CorestackCatalogs_merged_collection/catalog.json',
  },
  {
    title: 'Extremadura SDI (CICTEX)',
    description: 'Geospatial datasets for the Extremadura region of Spain, converted to cloud-native formats (GeoParquet, PMTiles).',
    href: 'https://storage.googleapis.com/carto-portolan-ide-extremadura/catalog.json',
  },
  {
    title: 'California Forest Observatory',
    description: 'Forest and wildfire-risk data for California, including vegetation fuels, weather, and topography.',
    href: 'https://storage.googleapis.com/cfo-public/catalog.json',
  },
  {
    title: 'CoCliCo STAC Catalog',
    description: 'Coastal classification and exposure datasets from sea-level-rise research (TU Delft/Deltares).',
    href: 'https://coclico.blob.core.windows.net/stac/v1/catalog.json',
  },
  {
    title: 'EcoDataCube.eu',
    description: 'European-wide environmental layers (Landsat/Sentinel-2 mosaics, land cover, soil predictions) from OpenGeoHub.',
    href: 'https://s3.eu-central-1.wasabisys.com/stac/odse/catalog.json',
  },
  {
    title: 'Google Earth Engine',
    description: 'Index of all raster and vector datasets in the Google Earth Engine public data catalog.',
    href: 'https://storage.googleapis.com/earthengine-stac/catalog/catalog.json',
  },
  {
    title: 'Cassini VIMS-IR STAC catalog',
    description: "Infrared spectral imaging data from the Cassini spacecraft's VIMS instrument, hosted by the University of Nantes.",
    href: 'https://vims.univ-nantes.fr/stac/catalog.json',
  },
  {
    title: 'Cubes and Clouds - Snow Cover',
    description: 'Snow-cover mapping submissions from participants of the Cubes and Clouds Earth-observation MOOC.',
    href: 'https://esa.pages.eox.at/cubes-and-clouds-catalog/MOOC_Cubes_and_clouds/catalog.json',
  },
  {
    title: 'IDE Facultad de Ciencia y Tecnología UADER',
    description: "Raster and vector geospatial datasets from Argentina's UADER Faculty of Science and Technology.",
    href: 'https://rawcdn.githack.com/IDE-FCyT/IDE-FCyT/main/docs/catalog/stac_catalog.json',
  },
  {
    title: 'Hong Kong CSDI Trial',
    description: "Trial STAC catalog created under Hong Kong's Common Spatial Data Infrastructure (CSDI) platform.",
    href: 'https://raw.githubusercontent.com/Anna-leungtn/STAC_CSDI/refs/heads/main/ib1000_stac/catalog.json',
  },
  {
    title: 'Geoportal des Kantons Bern',
    description: 'Downloadable geospatial data products from the Geoportal of the Canton of Bern, Switzerland.',
    href: 'https://geofiles.be.ch/geoportal/pub/stac/de/catalog.json',
  },
  {
    title: 'HDX HAPI Cloud-Native',
    description: "Cloud-native Parquet exports of UN OCHA's Humanitarian API, covering affected populations, food security, funding, and conflict indicators.",
    href: 'https://data.source.coop/hdx/hapi/collection.json',
  },
  {
    title: 'Agroforestry Tree Detection — India',
    description: 'Machine-learning tree-detection labels and imagery over agroforestry land in India.',
    href: 'https://data.source.coop/planet/agroforestry-individual-tree-detection-india/stac/catalog.json',
  },
  {
    title: 'Distributed Renewable Energy (DRE) Atlas',
    description: 'Settlement-level data for renewable-energy planning across 1.9 million settlements in 58 countries.',
    href: 'https://data.source.coop/vida/dre-atlas/collection.json',
  },
  {
    title: 'FMI ARD Finland',
    description: 'Analysis-ready Sentinel-1/2 mosaics and forestry inventory data over Finland from the Finnish Meteorological Institute.',
    href: 'https://pta.data.lit.fmi.fi/stac/root.json',
  },
  {
    title: 'Argentina National Geographic Institute (IGN) Reference Layers',
    description: "Official reference vector layers (hydrography, transport, boundaries, settlements) from Argentina's National Geographic Institute.",
    href: 'https://data.source.coop/nlebovits/ign-argentina/catalog.json',
  },
  {
    title: 'MideaFind Germany DIY Store Locations',
    description: 'Locations of German DIY (home-improvement) stores from an OpenStreetMap snapshot.',
    href: 'https://mideafind.com/data/stac/catalog.json',
  },
  {
    title: 'Maxar ARD Sample Data',
    description: 'Sample Analysis Ready Data from Maxar, for evaluation use.',
    href: 'https://ard.maxar.com/samples/catalog.json',
  },
  {
    title: 'GHSL Population Grids (GHS-POP R2023A)',
    description: "Global population grids (1975-2030, 100m resolution) from the EC Joint Research Centre's GHS-POP model.",
    href: 'https://data.source.coop/nlebovits/ghsl/catalog.json',
  },
  {
    title: 'Microsoft ML Road Detections',
    description: "Road centerlines detected by Microsoft's machine-learning model from Bing Maps aerial imagery, worldwide.",
    href: 'https://data.source.coop/nlebovits/microsoft-ml-road-detections/catalog.json',
  },
  {
    title: 'NAIP Aerial Imagery Mosaics',
    description: 'Per-scene National Agriculture Imagery Program (NAIP) aerial imagery of the United States as Cloud Optimized GeoTIFFs.',
    href: 'https://data.source.coop/portolan/portolan-pipeline/naip-mosaic/PRs/111/catalog.json',
  },
  {
    title: 'JRC GloFAS Global Flood Hazard Maps',
    description: "Global riverine flood-hazard and depth maps for multiple return periods from the EC Joint Research Centre's GloFAS model.",
    href: 'https://data.source.coop/nlebovits/jrc-glofas/catalog.json',
  },
  {
    title: 'NASA ISERV',
    description: "Early ISS-based Earth imagery (JPEG, georeferenced) from NASA's ISERV Pathfinder instrument.",
    href: 'https://nasa-iserv.s3-us-west-2.amazonaws.com/catalog/catalog.json',
  },
  {
    title: 'Monthly Mosaic of Sentinel 2 Images for Catalonia',
    description: 'Monthly low-cloud Sentinel-2 mosaics over Catalonia, Spain, since 2015.',
    href: 'https://datacloud.icgc.cat/stac-catalog/catalog.json',
  },
  {
    title: 'OpenAerialMap Example',
    description: 'Example STAC items for entries on OpenAerialMap, created for STAC workshops.',
    href: 'https://raw.githubusercontent.com/m-mohr/oam-example/main/catalog.json',
  },
  {
    title: 'MapBiomas Annual Land Cover and Land Use, South America',
    description: 'Annual land-cover and land-use maps (2019-2024) for ten South American countries.',
    href: 'https://data.source.coop/tristangruppwri/mapbiomas/catalog.json',
  },
  {
    title: 'Open Science Catalog',
    description: 'Catalog of ESA-funded Earth observation science products, datasets, and workflows.',
    href: 'https://esa-earthcode.github.io/open-science-catalog-metadata/catalog.json',
  },
  {
    title: 'LUCAS ML',
    description: "Segmented land-use survey photos and statistics from the EU's LUCAS field survey, for land-cover-change machine learning.",
    href: 'https://data.source.coop/jrc-lucas/jrc-lucas-ml/stac/catalog.json',
  },
  {
    title: 'Pangeo Cloud Data Catalog',
    description: 'Ocean, weather, and climate datasets stored in Zarr format on Google Cloud Storage.',
    href: 'https://raw.githubusercontent.com/pangeo-data/pangeo-datastore-stac/master/master/catalog.json',
  },
  {
    title: 'National geospatial data of the Republic of Moldova',
    description: "Cadastral parcels, buildings, addresses, land cover, and geodetic layers from Moldova's national geoportal.",
    href: 'https://data.source.coop/nlebovits/moldova-geodata/catalog.json',
  },
  {
    title: 'New Zealand Coastal Elevation',
    description: "New Zealand's publicly owned coastal elevation data archive.",
    href: 'https://nz-coastal.s3.ap-southeast-2.amazonaws.com/catalog.json',
  },
  {
    title: 'Planet Labs STAC Catalog',
    description: 'Creative Commons-licensed open data from Planet Labs, including disaster imagery and SpaceNet 7 labels.',
    href: 'https://www.planet.com/data/stac/catalog.json',
  },
  {
    title: 'New Zealand Elevation',
    description: "New Zealand's publicly owned elevation data archive.",
    href: 'https://nz-elevation.s3.ap-southeast-2.amazonaws.com/catalog.json',
  },
  {
    title: 'Portolan Reference Catalog',
    description: 'Reference catalog demonstrating vector, raster, and tabular data cases in the Portolan cloud-native catalog specification.',
    href: 'https://data.source.coop/portolan/portolan-pipeline/portolan-reference/main/catalog.json',
  },
  {
    title: 'Sentinel-1 RTC CONUS',
    description: 'Sentinel-1 radiometrically terrain-corrected SAR backscatter tiles over the contiguous United States since 2017.',
    href: 'https://raw.githubusercontent.com/scottyhq/sentinel1-rtc-stac/main/collection.json',
  },
  {
    title: 'OpenLandMap STAC',
    description: 'Global land layers (MODIS, PROBA-V, Landsat, land cover, soil) from OpenGeoHub.',
    href: 'https://s3.eu-central-1.wasabisys.com/stac/openlandmap/catalog.json',
  },
  {
    title: 'OpenTopography Raster DEM Data Catalog',
    description: 'Digital elevation model (DEM) raster datasets hosted by OpenTopography.',
    href: 'https://portal.opentopography.org/stac/raster_catalog.json',
  },
  {
    title: 'Rosetta OSIRIS Anaglyphs of Comet 67P',
    description: "3D anaglyph images of comet 67P/Churyumov-Gerasimenko from ESA's Rosetta mission OSIRIS camera.",
    href: 'https://rosetta-3dcomet.cnes.fr/stac/collection.json',
  },
  {
    title: 'RapidAI4EO',
    description: 'Spatiotemporal satellite imagery and land-use/land-cover labels for machine-learning training.',
    href: 'https://radiantearth.blob.core.windows.net/mlhub/rapidai4eo/stac-v1.0/catalog.json',
  },
  {
    title: 'Portolan NL — Cloud-Native Dutch Geodata',
    description: 'Demonstration cloud-native catalog of open Dutch government geodata, inspired by PDOK.',
    href: 'https://data.source.coop/cholmes/portolan-nl/catalog.json',
  },
  {
    title: 'SPOT Orthoimages of Canada (2005-2010)',
    description: 'Orthorectified 5-band SPOT-4/5 satellite imagery covering Canada, 2005-2010.',
    href: 'https://canada-spot-ortho.s3.amazonaws.com/canada_spot_orthoimages/catalog.json',
  },
  {
    title: 'The Wildland Almanac - CONUS',
    description: '30m Landsat-derived wildland ecosystem property data cube over the contiguous US at decadal snapshots (1990-2024).',
    href: 'https://data.source.coop/wildland-almanac/conus/catalog.json',
  },
  {
    title: 'UK NCEO Analysis Ready Data (ARD)',
    description: 'Sentinel-2 atmospherically corrected surface reflectance over the UK, 2017-2019.',
    href: 'https://gws-access.jasmin.ac.uk/public/nceo_ard/NCEO_ARD_STAC/catalog.json',
  },
  {
    title: 'TriMet Geospatial Data',
    description: 'Transit routes, stops, and rail lines for the Portland, Oregon metro area, mirrored from TriMet.',
    href: 'https://data.source.coop/cholmes/trimet/catalog.json',
  },
  {
    title: 'The Wildland Almanac - Treatment Scenarios',
    description: '30m Landsat-derived wildland ecosystem data cube for 24 forest-management treatment scenarios in the western US.',
    href: 'https://data.source.coop/wildland-almanac/treatment-scenarios/catalog.json',
  },
  {
    title: 'The Wildland Almanac - California',
    description: '30m Landsat-derived wildland ecosystem property data cube over California, water years 1985-2025.',
    href: 'https://data.source.coop/wildland-almanac/california/catalog.json',
  },
  {
    title: 'Umbra Open SAR Data',
    description: 'SAR (synthetic aperture radar) satellite imagery from Umbra, via the AWS Open Data program.',
    href: 'https://s3.us-west-2.amazonaws.com/umbra-open-data-catalog/stac/catalog.json?.language=en',
  },
  {
    title: 'EuroSAT: Land Use and Land Cover Classification',
    description: 'Labeled Sentinel-2 imagery (13 bands, 27,000 images, 10 classes) for land-use/land-cover classification benchmarking.',
    href: 'https://data.source.coop/nlebovits/eurosat-ms/catalog.json',
  },
  {
    title: 'Soft Commodity Infrastructure (Brazil)',
    description: 'Locations of Brazilian grain silos, slaughterhouses, dairy plants, and sugar/ethanol mills, from government registries.',
    href: 'https://data.source.coop/tristangruppwri/soft-commodity-infrastructure/catalog.json',
  },
  {
    title: 'South American Rural Cadastral Boundaries',
    description: 'Cadastral parcel boundaries for South American rural land use and supply-chain analysis.',
    href: 'https://data.source.coop/tristangruppwri/cadastral/catalog.json',
  },
  {
    title: 'Philadelphia Housing and Land Use',
    description: 'Property, zoning, vacancy, and affordable-housing datasets for Philadelphia, mirrored from city ArcGIS services.',
    href: 'https://data.source.coop/nlebovits/phl-housing-demo/catalog.json',
  },
  {
    title: 'Trazo Field Boundaries of South America',
    description: 'Agricultural field boundaries across South America (2023-2024 season) delineated from Sentinel-2 imagery via machine learning.',
    href: 'https://data.source.coop/wri-data-lab/trazofields/catalog.json',
  },
  {
    title: 'US GeoPlatform',
    description: 'Official list of United States National STAC data sources from GeoPlatform.gov.',
    href: 'https://stac.geoplatform.gov/catalog.json',
  },
  {
    title: 'USGS 3DEP LiDAR Point Clouds',
    description: 'LiDAR point-cloud elevation data over the conterminous US, Hawaii, and US territories, hosted on AWS.',
    href: 'https://s3-us-west-2.amazonaws.com/usgs-lidar-stac/ept/catalog.json',
  },
  {
    title: 'World Bank - Light Every Night',
    description: 'Nightly visible radiance (nighttime lights) data from VIIRS DNB NPP, April 2012 through December 2020.',
    href: 'https://globalnightlight.s3.amazonaws.com/VIIRS_npp_catalog.json',
  },
  {
    title: 'Wyvern Open Data',
    description: "Hyperspectral satellite imagery from Wyvern's Open Data Program, processed to surface reflectance.",
    href: 'https://wyvern-odp.com/catalog.json',
  },
  {
    title: 'Disaster Data Releases from Planet Labs',
    description: 'Pre- and post-event high-resolution satellite imagery for major disasters (earthquakes, floods, storms, wildfires).',
    href: 'https://data.source.coop/planet/disasterdata/catalog.json',
  },
  {
    title: 'S2 for Ghana',
    description: 'Sentinel-2 surface reflectance data over Ghana for 2020.',
    href: 'https://gws-access.jasmin.ac.uk/public/odanceo/S2_L2/collection.json',
  },
  {
    title: 'Pergamino SDI: Spatial Data Infrastructure',
    description: 'Geospatial infrastructure data for the Municipality of Pergamino, Buenos Aires Province, Argentina.',
    href: 'https://data.source.coop/nlebovits/pergamino-ide/catalog.json',
  },
]

/** Entry point, not the explorer itself — pick or paste a catalog first,
 *  then move into the coordinated Structure/Time/Space/Detail view. A
 *  STAC Browser gets its first impression right by starting here instead
 *  of dropping straight into a tree; free-text URL input is the actual
 *  "browse any STAC catalog" capability, not just a convenience — it's
 *  also how this list of known catalogs can grow without fabricating
 *  URLs nobody's verified. One search box does both jobs (filter the known
 *  list, or open a pasted URL directly) rather than two overlapping ones —
 *  see docs/DESIGN.md §19. */
export function LandingPage({
  onOpen,
  error,
}: {
  onOpen: (href: string) => void
  /** Set when a `?node=` deep link failed to resolve (bad/stale URL, CORS,
   *  not valid STAC JSON) — surfaced here rather than a silent fallback,
   *  since arriving via a shared link with no explanation when it fails
   *  would look like the link (or the app) is just broken. */
  error?: string | null
}) {
  // One box, two jobs — paste a URL to open it directly, or type anything
  // else to filter the known-catalog grid below live. Having a separate
  // "paste a URL" field and "filter the list" field side by side was two
  // search bars doing overlapping things; a single input can tell which job
  // it's doing from the text itself; no mode switch for the user to think
  // about.
  const [query, setQuery] = useState('')
  const trimmed = query.trim()
  const looksLikeUrl = /^https?:\/\//i.test(trimmed)

  // 69 known catalogs is too many to scan by eye in a 340px scroll box —
  // filter client-side by title/description/href rather than adding
  // pagination or grouping, which would be overkill for this list's scale.
  const filteredCatalogs = KNOWN_CATALOGS.filter((cat) => {
    if (!trimmed) return true
    const q = trimmed.toLowerCase()
    return (
      cat.title.toLowerCase().includes(q) ||
      cat.description.toLowerCase().includes(q) ||
      cat.href.toLowerCase().includes(q)
    )
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (looksLikeUrl) onOpen(trimmed)
  }

  return (
    // Top-anchored, not vertically centered — with 69 known catalogs this is
    // a real page with a real list on it, not a small centered dialog. The
    // hero/URL-input stays a narrow, single-decision column; the catalog
    // list below breaks out to the full page width so a wide screen actually
    // shows more at once instead of squeezing 69 cards through a 560px-wide,
    // 340px-tall porthole (the previous layout — genuinely bad once the list
    // grew past ~8 entries; see docs/DESIGN.md).
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 28,
        padding: '48px 24px',
        background: 'var(--color-bg)',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 32, margin: 0, color: 'var(--color-text)' }}>STAC Lens</h1>
        <p style={{ color: 'var(--color-text-muted)', marginTop: 8, maxWidth: 480, lineHeight: 1.5 }}>
          See the shape of your STAC data. Structure, time, and space as one coordinated view —
          not another STAC Browser.
        </p>
      </div>

      {error && (
        <div
          style={{
            width: '100%',
            maxWidth: 560,
            padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-node-warning)',
            background: 'var(--color-surface)',
            color: 'var(--color-node-warning)',
            fontSize: 13,
          }}
        >
          Couldn't open the linked catalog: {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 560 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search known catalogs, or paste a STAC catalog.json URL…"
          style={{
            flex: 1,
            padding: '10px 12px',
            fontSize: 14,
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            color: 'var(--color-text)',
          }}
        />
        <button
          type="submit"
          disabled={!looksLikeUrl}
          title={looksLikeUrl ? undefined : 'Type or paste a full https:// URL to open it directly'}
          style={{
            padding: '10px 18px',
            fontSize: 14,
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            background: 'var(--color-selection)',
            color: '#fff',
            cursor: looksLikeUrl ? 'pointer' : 'not-allowed',
            opacity: looksLikeUrl ? 1 : 0.5,
          }}
        >
          Explore
        </button>
      </form>

      <div style={{ width: '100%', maxWidth: 1400, marginTop: 8 }}>
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            textTransform: 'uppercase',
            letterSpacing: 0.4,
            marginBottom: 14,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
          }}
        >
          <span>
            Known catalogs ({filteredCatalogs.length} of {KNOWN_CATALOGS.length})
          </span>
          <span style={{ textTransform: 'none', letterSpacing: 0 }}>
            via{' '}
            <a
              href="https://stacindex.org"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--color-text-muted)' }}
            >
              STAC Index
            </a>
          </span>
        </div>
        {filteredCatalogs.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '8px 2px' }}>
            No known catalog matches "{trimmed}". {looksLikeUrl && 'Press Explore to open it directly.'}
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 10,
            }}
          >
            {filteredCatalogs.map((cat) => (
              <button
                key={cat.href}
                onClick={() => onOpen(cat.href)}
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 600, color: 'var(--color-text)', fontSize: 14 }}>{cat.title}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  {cat.description}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--color-text-faint)',
                    marginTop: 4,
                    fontFamily: 'var(--font-mono)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {cat.href}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
