# About STAC Lens

STAC Lens is a free, open-source, browser-only tool that shows the shape, health, and real behavior of any [STAC](https://stacspec.org/) (SpatioTemporal Asset Catalog) catalog or API. Paste a catalog URL and it draws the publisher's structure as a tree, its coverage in time and space beside it, and marks where the metadata contradicts itself or the specification. Nothing is uploaded: every request goes from your browser to the catalog you are looking at.

It runs at [staclens.com](https://staclens.com/) and can be [self-hosted](/deploy/) from the [source on GitHub](https://github.com/rednotfound/stac-lens) (Apache-2.0).

## What it is for

STAC is the open standard for describing geospatial data — satellite imagery, aerial photography, elevation models, climate grids, vector layers — as catalogs of Collections and Items with a footprint, a time, and assets you can download. Hundreds of public catalogs exist, from NASA, ESA, Microsoft Planetary Computer, Element 84, national mapping agencies, and research groups. STAC Lens is a lens on any of them. It answers three questions that a field-by-field browser does not:

- **Shape.** How did the publisher actually organize this data? Deep and nested, or a flat root with four hundred Collections? Where are the Items, and how many?
- **Health.** Where does the metadata contradict itself or the standard? Two disjoint spatial extents, a `rel:collection` link that disagrees with `rel:parent`, a deprecated license value, an extent that does not contain its own parts.
- **Distance from the specification.** What does an API *declare* it supports, and what does it *do* when asked? STAC Lens sends real requests and reports the difference.

## Who it is for

- **People choosing a data source** — see how a catalog is organized, what it covers in time and space, and whether its API behaves, before writing code against it. The landing page lists [more than a hundred public catalogs](/catalogs/), each verified to be live, real STAC, and readable from a browser.
- **Publishers checking their own catalog** — a picture of the structure you shipped, with the problems marked. Schema validators check the JSON; this checks what the JSON *does*.
- **People learning STAC** — the Catalog → Collection → Item model, extents, links, and API capabilities as one visual language rather than a set of documents.
- **The STAC community** — an empirical view of conformance in the wild. Everything the app has learned about real servers is written down in the project's [design log](https://github.com/rednotfound/stac-lens/blob/main/docs/DESIGN.md), with the requests that established it.

## Not another STAC Browser

[STAC Browser](https://github.com/radiantearth/stac-browser) is the reference browser for STAC and it does its job well. STAC Lens is not a replacement for it and is not trying to become one.

| | STAC Browser | STAC Lens |
|---|---|---|
| Purpose | Read a catalog: every object, every field, faithfully | Understand a catalog: its shape, health, and real behavior |
| Deployment | One instance per catalog, configured by its publisher | One instance, any catalog — paste a URL |
| Unit of view | The current object (a page per Catalog / Collection / Item) | The whole graph, with time and space alongside it |
| Server behavior | Trusts the server | Exercises the server and reports what it actually does |
| Metadata problems | Renders what is there | Flags contradictions and deprecated forms, never silently resolves them |
| Item browsing | Complete | Deliberately sufficient — lists, pages, a timeline and a map |

If you publish a catalog and want visitors to read it, deploy STAC Browser. If you want to see what a catalog *is* — yours or anyone's — open it in STAC Lens.

## What "health" means here

Health is not a score. It is a list of findings, each traceable to a rule somebody else wrote down: the STAC core specification, its best-practices document, the community linter [stac-check](https://github.com/stac-utils/stac-check), the [STAC API](https://github.com/radiantearth/stac-api-spec) specification, and the method of [stac-api-validator](https://github.com/stac-utils/stac-api-validator) (declared conformance versus actual response). Nothing is invented by this project. When no rule exists — a flat root with 422 Collections, a Collection with millions of Items — the fact is reported as an **observation**, never as a problem.

Every rule the app applies or could apply, with its source, its severity tier, and whether it is built, is on the [health rules](/health-rules/) page. Rules have stable identifiers (`C-04`, `A-02`, `S-01`) so a finding can be cited.

## Principles

- **Never enumerate what cannot be enumerated.** A 51-million-Item Collection is browsed through the API's own cursor, one page at a time. There is no "load everything".
- **Never invent structure.** The tree shows the hierarchy the publisher made — flat where it is flat. No client-side grouping, no synthetic nodes, no counts the source did not give.
- **Show a failure as a failure.** A rejected request is an error message with the server's own words, never an empty result.
- **Declared versus observed.** A capability an API declares in its conformance classes is shown as declared; what the server actually does is shown only after a real request, with the request and the response quoted.
- **Conformance-gated UI.** A control that depends on a server capability exists only when the server declares it.
- **Direct manipulation over controls.** Drag to pan, wheel to zoom, drag a divider to resize; windows have title bars; the map pans by default and draws only when a tool is armed.
- **Nothing leaves the browser.** No backend, no proxy, no analytics. The catalog you open is the only server that sees your request.

## Vocabulary

Short definitions of the terms this site uses, in the sense the STAC specification gives them.

- **STAC** — SpatioTemporal Asset Catalog: an open specification (also an OGC Community Standard) for describing geospatial assets as JSON documents linked into catalogs, so that data from any provider can be searched the same way.
- **Catalog** — a JSON document that links to other Catalogs, Collections, or Items. It is the folder of STAC: structure, not data.
- **Collection** — a Catalog with metadata about a coherent set of data: a license, a spatial extent (one or more bounding boxes), a temporal extent (one or more intervals), and summaries. A Collection typically holds the Items of one product, such as Sentinel-2 Level-2A.
- **Item** — a GeoJSON Feature with a datetime, a footprint, and one or more Assets. One scene, one tile, one file set.
- **Asset** — a link to an actual file (a Cloud-Optimized GeoTIFF, a Parquet table, a thumbnail) with a media type and roles.
- **Static catalog** — a tree of JSON files on a web server or object store, walked by following links.
- **STAC API** — a web service that serves the same objects and adds search: `/search` with `bbox`, `datetime`, `collections`, and pagination through `next` links.
- **Conformance classes** — the list of capabilities a STAC API declares in its landing page (`conformsTo`). STAC Lens reads it to decide which controls to show, then checks whether the server honors what it declared.
- **Extent** — a Collection's declared coverage. Spatially, an array of bounding boxes whose first entry must be the overall extent; temporally, an array of intervals whose first entry must be the overall interval.
- **Health finding** — a place where a catalog breaks a normative rule (invalid), ignores a recommendation (warning), or behaves differently from what it declared (behavior). See the [rule list](/health-rules/).

## Names in other languages

The same tool, described in the words people search for. STAC Lens is a viewer and health checker for STAC catalogs of open geospatial data: Earth observation, remote sensing imagery, GIS and mapping data, climate and elevation grids.

- 中文：STAC Lens 是一个开源的、纯浏览器端的 STAC（时空资产目录）目录可视化与健康检查工具，用于查看遥感影像、对地观测、开放地理数据、GIS 数据目录的结构、时空覆盖范围和元数据质量。[中文说明](/zh/about/)
- 日本語：STAC Lens は、STAC（時空間アセットカタログ）カタログの構造・時空間範囲・メタデータの健全性を可視化する、オープンソースのブラウザ専用ツールです。リモートセンシング、地球観測、オープン地理空間データ向け。
- Español: STAC Lens es una herramienta de código abierto, que se ejecuta solo en el navegador, para visualizar la estructura, la cobertura espacio-temporal y la salud de los metadatos de catálogos STAC de datos geoespaciales abiertos y de observación de la Tierra.

## Project facts

- **License:** Apache-2.0. **Source:** [github.com/rednotfound/stac-lens](https://github.com/rednotfound/stac-lens).
- **Stack:** TypeScript, React, Vite, D3, Leaflet. No backend.
- **STAC versions:** 1.0 and 1.1; STAC API Core, Features, Item Search, and the extensions listed on the [health rules](/health-rules/) page.
- **How the code was written:** largely with an AI coding assistant, directed and reviewed by a designer, and verified by driving the app in a real browser against real catalogs. It works, it is tested, and it will still contain mistakes not yet found. If something looks wrong, it probably is — [say so](https://github.com/rednotfound/stac-lens/issues).
- **Cite it:** the repository carries a `CITATION.cff`; GitHub's "Cite this repository" button reads it.
