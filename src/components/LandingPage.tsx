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
    isApi: true,
  },
  {
    title: 'Microsoft Planetary Computer',
    description:
      '~136 real-world Collections (Sentinel, Landsat, MODIS, Daymet, and more) via a pure STAC API with no static rel:child links at all — discovered through its OGC "Collections" listing endpoint instead.',
    href: 'https://planetarycomputer.microsoft.com/api/stac/v1/',
    isApi: true,
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
  // A third pass, this time over STAC Index's ~42 API-type entries not yet
  // represented here (this app had only Earth Search and Planetary Computer
  // out of 44 real public ones) — same GET+Origin-header CORS check and
  // genuine-STAC-content check as the static pass above, scripted the same
  // way. 34 of 42 passed; excluded: two GISTDA Thailand endpoints whose STAC
  // Index URLs have an `?api_key=...` baked in (not ours to redistribute),
  // one Ellipsis Drive URL with what looks like an embedded access token as
  // a path segment (SkyServe Mission Data), and five more that were simply
  // unreachable (timeout, expired cert, or 5xx) at check time. `isApi` below
  // mirrors this app's own runtime detection (`conformsTo`/rel:search), not
  // a copy of STAC Index's own flag — checked directly against each entry.
  {
    title: 'Astraea Earth OnDemand',
    description: 'Earth OnDemand — imagery query and analysis over commercial and public satellite archives.',
    href: 'https://eod-catalog-svc-prod.astraea.earth/',
    isApi: true,
  },
  {
    title: 'Boettiger Lab Geospatial Datasets',
    description: 'Biodiversity, conservation, census, and environmental datasets from UC Berkeley, on National Research Platform storage.',
    href: 'https://s3-west.nrp-nautilus.io/public-data/stac/catalog.json',
    isApi: true,
  },
  {
    title: 'BON in a Box STAC',
    description: "Layers used by GEO BON's biodiversity-monitoring workflow tool.",
    href: 'https://stac.geobon.org/',
    isApi: true,
  },
  {
    title: 'Canadian Geospatial Data Collections',
    description: "Canada's federal geospatial datacube, served via stac-fastapi.",
    href: 'https://datacube.services.geo.ca/stac/api/',
    isApi: true,
  },
  {
    title: 'CBERS and Amazonia-1 on AWS',
    description: "CBERS 4/4A and Amazonia-1 satellite imagery over Brazil, on AWS Open Data.",
    href: 'https://stac.scitekno.com.br/v100/',
    isApi: true,
  },
  {
    title: 'Copernicus Data Space Ecosystem',
    description: 'Asset-level catalogue of Copernicus Sentinel and other Earth-observation missions, actively maintained by ESA.',
    href: 'https://stac.dataspace.copernicus.eu/v1/',
    isApi: true,
  },
  {
    title: 'CyVerse STAC API',
    description: 'Geospatial data discovery API from the CyVerse research-computing platform.',
    href: 'https://stac.cyverse.org/',
    isApi: true,
  },
  {
    title: 'data.geo.admin.ch',
    description: "The Swiss Federal Spatial Data Infrastructure's own data catalog.",
    href: 'https://data.geo.admin.ch/api/stac/v1/',
    isApi: true,
  },
  {
    title: 'Destination Earth Data Lake (DEDL) API',
    description: "The EU's Destination Earth Harmonized Data Access STAC API.",
    href: 'https://hda.data.destination-earth.eu/stac/v2',
    isApi: true,
  },
  {
    title: 'Digital Earth Africa',
    description: 'Continent-scale Earth-observation datasets for Africa (cropland, water, coastlines, and more).',
    href: 'https://explorer.digitalearth.africa/stac/',
    isApi: true,
  },
  {
    title: 'Digitale Orthophotos Niedersachsen',
    description: 'Aerial orthophotos (DOP RGBI) of Lower Saxony, Germany.',
    href: 'https://dop.stac.lgln.niedersachsen.de',
    isApi: true,
  },
  {
    title: 'Earth Genome: Sentinel-2 L2A Temporal Mosaics',
    description: 'A public-good STAC instance of Sentinel-2 L2A temporal mosaics from Earth Genome.',
    href: 'https://stac.earthgenome.org/',
    isApi: true,
  },
  {
    title: 'EasierData',
    description: 'A stac-fastapi deployment for the EasierData open geospatial data project.',
    href: 'https://stac.easierdata.info',
    isApi: true,
  },
  {
    title: 'EOC EO Products Service',
    description: "DLR's Earth Observation Center — metadata and access for its EO collections and products.",
    href: 'https://geoservice.dlr.de/eoc/ogc/stac/v1/',
    isApi: true,
  },
  {
    title: 'ERS open data',
    description: "Roscosmos's open Earth-observation datasets — Arktika-M, Elektro-L, and Meteor-M mosaics.",
    href: 'https://s3.gptl.ru/stac-web-free/catalog.json',
    isApi: true,
  },
  {
    title: 'GEP Supersites CSK and CSG data',
    description: 'COSMO-SkyMed and CSG SAR data over geohazard supersites, on a stac-fastapi deployment.',
    href: 'https://gep-supersites-stac.terradue.com/',
    isApi: true,
  },
  {
    title: 'Google Earth Engine (openEO)',
    description: "Google Earth Engine's openEO backend — 1000+ real datasets, browsable through its own Collections listing rather than a STAC search endpoint.",
    href: 'https://earthengine.openeo.org/v1.0/',
  },
  {
    title: "HUB Ocean's Ocean Data Platform Catalog",
    description: 'Public ocean and marine datasets from HUB Ocean.',
    href: 'https://api.hubocean.earth/api/stac',
    isApi: true,
  },
  {
    title: 'Impact Observatory STAC API',
    description: 'Land-use/land-cover and other AI-derived geospatial datasets from Impact Observatory.',
    href: 'https://api.impactobservatory.com/stac-aws/',
    isApi: true,
  },
  {
    title: 'INPE STAC Server',
    description: "Brazil's National Institute for Space Research (INPE) — Earth-observation collections from its Data Cube Brazil program.",
    href: 'https://data.inpe.br/bdc/stac/v1/',
    isApi: true,
  },
  {
    title: 'Kentucky From Above SpatioTemporal Asset Catalog',
    description: 'Aerial imagery and LiDAR elevation data for the Commonwealth of Kentucky since 2010.',
    href: 'https://spved5ihrl.execute-api.us-west-2.amazonaws.com/',
    isApi: true,
  },
  {
    title: 'MISTEO STAC SERVER',
    description: 'A stac-server deployment for MISTEO Earth-observation data.',
    href: 'https://stac-server.dev2prod.co/',
    isApi: true,
  },
  {
    title: 'MTD STAC API',
    description: "Scientific productions from France's UMR TETIS and UMR Espace-Dev remote-sensing research units.",
    href: 'https://api.stac.teledetection.fr',
    isApi: true,
  },
  {
    title: 'NASA CMR CLOUDSTAC Proxy',
    description: "NASA's Common Metadata Repository, cloud-hosted-holdings variant — each linked provider exposes its own STAC endpoint.",
    href: 'https://cmr.earthdata.nasa.gov/cloudstac/',
    isApi: true,
  },
  {
    title: 'NASA CMR STAC',
    description: "NASA's Common Metadata Repository as a STAC API — each linked provider exposes its own STAC endpoint.",
    href: 'https://cmr.earthdata.nasa.gov/stac/',
    isApi: true,
  },
  {
    title: 'OpenAerialMap',
    description: 'Openly licensed aerial and drone imagery, contributed by the humanitarian mapping community.',
    href: 'https://api.imagery.hotosm.org/stac',
    isApi: true,
  },
  {
    title: 'Paituli STAC (Finland)',
    description: 'Finnish geospatial datasets from the Paituli data service, via a GeoServer OGC API - STAC endpoint.',
    href: 'https://paituli.csc.fi/geoserver/ogc/stac/v1',
    isApi: true,
  },
  {
    title: 'Panoramax',
    description: 'Geolocated street-level and 360° pictures from a Panoramax instance.',
    href: 'https://api.panoramax.xyz/api/',
    isApi: true,
  },
  {
    title: 'PGC Data Catalog',
    description: "The Polar Geospatial Center's own digital elevation models, via a live STAC API (a static PGC DEM catalog is already above).",
    href: 'https://stac.pgc.umn.edu/api/v1/',
    isApi: true,
  },
  {
    title: 'Super-Resolved Sentinel-2 2.5m STAC API',
    description: 'A live STAC API over the Copernicus Sentinel-2 L2A catalogue, serving super-resolved 2.5m imagery.',
    href: 'https://console.semablu.com/py/stac',
    isApi: true,
  },
  {
    title: 'Thünen Earth Observation (ThEO)',
    description: "Germany's Thünen Institute — satellite-derived land cover, crop type, and grassland dynamics.",
    href: 'https://eodata.thuenen.de/stac/api/v1/',
    isApi: true,
  },
  {
    title: 'USGS Landsat Collection 2 API',
    description: 'USGS Landsat Collection 2 imagery, via LandsatLook.',
    href: 'https://landsatlook.usgs.gov/stac-server/',
    isApi: true,
  },
  {
    title: 'WorldPop STAC API',
    description: 'Global population distribution and covariate datasets from WorldPop.',
    href: 'https://api.stac.worldpop.org',
    isApi: true,
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
                  // Explicit, not left to CSS Grid's own default stretch
                  // behavior — a `<button>` is a form control, and some
                  // browsers size those to their own content rather than
                  // stretching to fill a grid cell the way a plain `<div>`
                  // would, silently reintroducing per-card widths flush
                  // against the buggy visual this fixes. `display: flex` +
                  // the href's own `marginTop: auto` below is what actually
                  // fixes the reported raggedness, though — a differently-
                  // long description (1 line vs. 3) used to leave the
                  // short URL line sitting at a different height card to
                  // card in the same row, reading as "参差不齐...居中对齐"
                  // (uneven, "like it's all centered") even though nothing
                  // was ever horizontally centered — pinning the URL to
                  // each card's own bottom edge instead gives every card in
                  // a row the same true bottom line, regardless of how
                  // long its own description happens to be.
                  width: '100%',
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ fontWeight: 600, color: 'var(--color-text)', fontSize: 14 }}>{cat.title}</div>
                  {/* Same tag, same convention, as every other API-backed
                   * node in the app (Structure Lens's own tree, Item Set) —
                   * only the special case (a live query endpoint) gets a
                   * badge; the default (static) case stays plain, matching
                   * STAC Browser's own convention this was originally
                   * copied from. Asked about directly: "比如stac browser就
                   * 能看出是static catalog还是api等等的,我们是不是还能做更好呢"
                   * (STAC Browser lets you tell static vs. API apart — can
                   * we do better here too). */}
                  {cat.isApi && (
                    <span
                      style={{
                        display: 'inline-block',
                        flexShrink: 0,
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 7px',
                        borderRadius: 999,
                        background: 'var(--color-badge-api-bg)',
                        color: 'var(--color-badge-api-text)',
                      }}
                    >
                      API
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  {cat.description}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--color-text-faint)',
                    // The actual fix for the reported unevenness — pushes
                    // this line to the bottom of the card's own flex
                    // column regardless of how many lines the description
                    // above it wrapped to, so every card in a row ends on
                    // the same true baseline instead of wherever its own
                    // description happened to stop.
                    marginTop: 'auto',
                    paddingTop: 8,
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
