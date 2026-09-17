# Catalog health — the rule list

"Health" in STAC Lens is not a score. It is a list of findings, each traceable to a rule somebody else wrote down. This document is that list: every check the app performs or could perform, where the rule comes from, how severe the spec considers it, and whether it is built. Nothing here is invented by this project; when no rule exists, a fact is reported as an **observation**, never as a problem (see `DESIGN.md` §96 — a flat root of 422 Collections is a fact about the publisher's choices, not a defect).

## Sources

| Key | Source | What it contributes |
|---|---|---|
| **spec** | STAC 1.1 core: [`catalog-spec.md`](https://github.com/radiantearth/stac-spec/blob/master/catalog-spec/catalog-spec.md), [`collection-spec.md`](https://github.com/radiantearth/stac-spec/blob/master/collection-spec/collection-spec.md), [`item-spec.md`](https://github.com/radiantearth/stac-spec/blob/master/item-spec/item-spec.md), [`commons/links.md`](https://github.com/radiantearth/stac-spec/blob/master/commons/links.md), [`commons/assets.md`](https://github.com/radiantearth/stac-spec/blob/master/commons/assets.md) | REQUIRED / MUST / SHALL / STRONGLY RECOMMENDED / SHOULD |
| **bp** | [`best-practices.md`](https://github.com/radiantearth/stac-spec/blob/master/best-practices.md) | RECOMMENDED practice for published catalogs |
| **stac-check** | [stac-utils/stac-check](https://github.com/stac-utils/stac-check) | the community linter's best-practice rules and thresholds |
| **api** | [STAC API](https://github.com/radiantearth/stac-api-spec) Core / Features / Item Search, and extension specs | landing-page requirements, conformance classes, parameters |
| **api-validator** | [stac-utils/stac-api-validator](https://github.com/stac-utils/stac-api-validator) | "declared conformance vs. actual response" as a method |
| **observed** | this project's own verified findings against live servers (`DESIGN.md`) | behaviors no validator currently tests |

## Tiers

| Tier | Meaning | Basis | Shown as |
|---|---|---|---|
| **Invalid** | the object breaks a normative rule | spec REQUIRED / MUST / SHALL, api MUST | ⚠ warning color |
| **Warning** | the object ignores a recommendation | spec STRONGLY RECOMMENDED / SHOULD, bp, stac-check | ⚠ muted |
| **Behavior** | a server does not do what it declares, or refuses a conforming request | api-validator method, observed | shown only after a real request, with the request and the server's response quoted |
| **Observation** | a fact with no rule behind it | — | neutral text, explicitly "not an error" |

## Status legend

✅ built and visible in the UI · 🟡 checkable from data the app already holds (no new request) · 🔵 needs a probe request · ⚪ not checkable from a browser / not worth it · ❌ deliberately not done

---

## Catalog

| ID | Tier | Rule | Source | Status / notes |
|---|---|---|---|---|
| K-01 | Invalid | `type` = `Catalog`, `stac_version`, `id`, `description`, `links` all present | spec catalog | 🟡 |
| K-02 | Warning | `self` and `root` links present ("STRONGLY RECOMMENDED") | spec catalog | 🟡 |
| K-03 | Warning | a non-root Catalog has a `parent` link ("SHOULD") | spec catalog | 🟡 |
| K-04 | Observation | a Catalog with neither `child` nor `item` links (permitted; "genuinely empty") | spec catalog | ✅ hollow node, "leaf-empty" |
| K-05 | Warning | structural links (`root`/`parent`/`child`/`item`) carry a `title` | bp; stac-check | 🟡 |
| K-06 | Warning | a published catalog's root `self` is an absolute URL | bp; stac-check | 🟡 |
| K-07 | Warning | hierarchical links declare the STAC media type (`application/json` for Catalog/Collection, `application/geo+json` for Item) | spec links | 🟡 |
| K-08 | Invalid | no more than one `parent` / one `root` link ("SHALL have no more than one parent entity") | spec links | 🟡 |
| K-09 | Observation | number of direct children; whether they were discovered via `child` links, `/collections`, or `/children` | — | ✅ count + API badge; discovery path in `DESIGN.md`, not yet in UI |
| K-10 | Observation | siblings at one level mix Catalog and Collection types | bp ("use structural elements consistently across each level") | 🟡 — observation, not a warning: the sentence is advice to publishers, not a testable rule |
| K-11 | ❌ | "too many" children / Items under one Catalog | bp ("limit the number of Items in a Catalog") | ❌ no threshold exists; reported only as K-09's count (`DESIGN.md` §96) |

## Collection

| ID | Tier | Rule | Source | Status / notes |
|---|---|---|---|---|
| C-01 | Invalid | `type` = `Collection`, `stac_version`, `id`, non-empty `description`, `license`, `extent`, `links` all present | spec collection | 🟡 |
| C-02 | Invalid | `license` is an SPDX identifier, an SPDX expression, or `other` | spec collection | 🟡 — needs the SPDX id list embedded; expression grammar out of scope |
| C-03 | Warning | `license` is not the deprecated `proprietary` / `various` | spec collection (1.1) | ✅ Inspector note |
| C-04 | Invalid | `extent.spatial.bbox` is an array of bboxes and its first entry is the overall extent | spec collection | ✅ every valid bbox kept and drawn; the first is drawn lighter when it really contains the rest |
| C-05 | Invalid | not exactly two spatial bboxes ("two … don't make sense and will be reported as invalid") | spec 1.1 changelog | ✅ ⚠ (3dep-lidar-returns) |
| C-06 | Warning | every additional bbox lies inside the first (it is the union) | spec collection | ✅ ⚠ when the first does not contain the rest (3dep's two are disjoint; `firstBboxIsUnion`) |
| C-07 | Observation | three or more spatial bboxes ("only if a union would include large uncovered areas") | spec collection | ✅ neutral note; all drawn (fia: 13) |
| C-08 | Invalid | `extent.temporal.interval` inner arrays have exactly two entries, each RFC 3339 or `null`; first is the overall interval | spec collection | 🟡 |
| C-09 | Observation | open-ended temporal extent (`null` bound) | spec collection | ✅ timeline renders it distinctly |
| C-10 | Warning | `summaries` present ("STRONGLY RECOMMENDED") | spec collection; bp ("always provide summaries"); stac-check | 🟡 — shown when present (schema hints), absence not yet flagged |
| C-11 | Warning | `keywords` and `providers` present | bp | 🟡 low priority |
| C-12 | Warning | `self` and `root` links present; non-root has `parent` | spec collection | 🟡 |
| C-13 | Invalid | each `item_assets` definition has at least two fields | spec collection | 🟡 |
| C-14 | Warning | `providers` in chronological order, most recent last | spec collection | ⚪ not decidable from the data |
| C-15 | Warning | Items linked from this Collection link back to it with `rel:collection` ("MUST refer back") | spec links | ✅ Inspector "Containment" flags an Item whose `rel:collection` names a different Collection than the one it was reached through |

## Item

| ID | Tier | Rule | Source | Status / notes |
|---|---|---|---|---|
| I-01 | Invalid | `type` = `Feature`, `stac_version`, `id`, `geometry` (object or `null`), `properties.datetime` (value or `null`), `links`, `assets` all present | spec item | 🟡 |
| I-02 | Invalid | `geometry` is a valid GeoJSON geometry; `GeometryCollection` not allowed | spec item; RFC 7946 | ✅ non-GeoJSON geometry detected (falls back to bbox, ⚠); GeometryCollection not yet rejected 🟡 |
| I-03 | Invalid | `bbox` REQUIRED when `geometry` is not `null`, PROHIBITED when it is | spec item | 🟡 |
| I-04 | Invalid | `bbox` has 4 or 6 numbers; latitudes within ±90, longitudes within ±180 | spec item; stac-check ("definite coordinate errors") | 🟡 |
| I-05 | Warning | `bbox` matches the geometry's own bounds | stac-check (beta) | 🟡 |
| I-06 | Warning | an antimeridian-crossing bbox is written west > east per RFC 7946, not as a world-spanning box | RFC 7946; stac-check | 🟡 |
| I-07 | Invalid | `datetime: null` requires both `start_datetime` and `end_datetime` | spec item | 🟡 — `temporal.ts` normalizes intervals; the missing-bounds case is not yet flagged |
| I-08 | Warning | datetimes are RFC 3339 in UTC ("should be in UTC") | spec item | 🟡 |
| I-09 | Invalid | `collection` field present ⇔ a `rel:collection` link present | spec item | 🟡 |
| I-10 | Warning | `self` and `collection` links present ("STRONGLY RECOMMENDED") | spec item | 🟡 |
| I-11 | Warning | `id` uses only lowercase letters, digits, `_`, `-` ("searchable identifiers") and no `:` or `/` | bp; stac-check | 🟡 |
| I-12 | Observation | `geometry: null` — an unlocated Item (permitted only for "truly unlocated data") | spec item; bp; stac-check | 🟡 — observation: the spec allows it; a client can't know whether the data is truly unlocated |
| I-13 | Warning | a `thumbnail` asset and a `data` asset present ("STRONGLY RECOMMENDED") | spec item | 🟡 — thumbnail detected for the preview ✅, absence not flagged |
| I-14 | Warning | not "bloated": ≤ 20 links, ≤ 20 properties | stac-check thresholds | 🟡 — cite stac-check's numbers, not our own |
| I-15 | Observation | static-catalog file named `<id>.json` | bp; stac-check | 🟡 from the href; N/A for API-served Items |
| I-16 | Observation | `properties` uses extension prefixes not declared in `stac_extensions`, or declares extensions it never uses | spec item (`stac_extensions`) | ✅ Inspector shows declared extensions and observed namespaces side by side; the mismatch itself is not yet called out |

## Asset

| ID | Tier | Rule | Source | Status / notes |
|---|---|---|---|---|
| A-01 | Invalid | `href` present | spec assets | 🟡 |
| A-02 | Warning | at least one `role` per asset ("recommended to include one for every asset") | spec assets; bp | 🟡 |
| A-03 | Warning | `type` present, and the most specific IANA media type (a COG is `image/tiff; application=geotiff; profile=cloud-optimized`, not bare `image/tiff`) | bp | 🟡 — `type` already read for the inline preview |
| A-04 | Warning | properties identical across all `bands` are on the asset, not repeated per band | bp (1.1) | 🟡 low priority |
| A-05 | Observation | `href` scheme a browser cannot fetch (`s3://`, `gs://`) — expected for requester-pays data | bp | ✅ href shown verbatim as a copyable link |

## Link

| ID | Tier | Rule | Source | Status / notes |
|---|---|---|---|---|
| L-01 | Invalid | `href` and `rel` present | spec links | 🟡 |
| L-02 | Warning | a link's `title` matches the destination's own `title` | bp ("link titles should exactly reflect the title of the corresponding entity") | 🟡 for destinations already loaded |
| L-03 | Warning | one consistent href convention — all-relative (self-contained) or all-absolute (published) | bp | 🟡 |
| L-04 | Warning | URLs to directories end with a slash, consistently | bp | 🟡 low priority |
| L-05 | Observation | `alternate` (`text/html`), `canonical`, `via`, `derived_from`, `license`, `preview` links present | bp | 🟡 — not yet surfaced in the Inspector (listed in `DESIGN.md` §96) |
| L-06 | Invalid | a pagination `next` link's `method` / `headers` / `body` / `merge` are honored by the client | api (Features, Item Search); spec 1.1 links | ✅ client obligation, met |

## API — declared

| ID | Tier | Rule | Source | Status / notes |
|---|---|---|---|---|
| D-01 | Invalid | landing page has `conformsTo`, and `self`, `root`, `service-desc` links | api core | 🟡 — `conformsTo` read ✅; link presence not flagged |
| D-02 | Observation | which conformance classes are declared (Features, Item Search, Sort, Filter, Fields, Query, Children, Collection Search, Browseable, Transaction…) | api; extensions index | 🟡 — read for gating ✅ (Sort, Collection Search); not yet shown as a list |
| D-03 | Warning | conformance class URIs are ones the specs define (a private or misspelled URI declares nothing) | api | 🟡 |
| D-04 | Observation | `rel:search` links declare `method`; GET and POST offered as separate links | api item-search | ✅ GET link preferred |

## API — behavior (a real request, then compare with what was declared)

| ID | Tier | Rule | Source | Status / notes |
|---|---|---|---|---|
| B-01 | Behavior | declared `item-search` ⇒ `GET /search?limit=1` returns 200 with a GeoJSON `FeatureCollection` | api item-search; api-validator | ✅ on demand (the error, with the server's body, shows when a search fails — Planetary Computer's `422 collection is required`); 🔵 as an unprompted probe |
| B-02 | Behavior | `bbox` / `datetime` actually filter: two small requests with different `bbox` return different results | api Features / Item Search; **observed** (Planetary Computer's `/items` returns a cached result keyed without them) | 🔵 — worked around today, not yet reported to the user |
| B-03 | Behavior | pagination: following `next` yields new Items and terminates; `limit` respected or clamped | api; api-validator | ✅ followed correctly; 🔵 as a probe |
| B-04 | Observation | whether a total match count is reported (`numberMatched` / `context`), and by which field | api; observed (Earth Search yes, Planetary Computer no) | ✅ "N+" when unknown |
| B-05 | Observation | pagination by POST (`next` link with `method: POST`) | api | 🟡 — honored ✅; not yet stated to the user |
| B-06 | Behavior | declared `#sort` ⇒ `sortby` changes the order | api sort ext | 🔵 |
| B-07 | Behavior | declared `collection-search` ⇒ `/collections?q=…` (or `bbox`/`datetime`) changes the result | api collection-search ext; **observed** (14 of 34 landing-page APIs declare it; Planetary Computer and Earth Search don't and ignore the params) | 🔵 — the *check* belongs here even though the search feature is parked (`DESIGN.md` §92) |
| B-08 | Behavior | declared `children` ⇒ `/children` returns `{children, links}` | api children ext | 🔵 — consumed ✅ when present |
| B-09 | Behavior | `/collections` honors `limit` and paginates with `next` | api Features | 🔵 — observed: Planetary Computer ignores `limit`, returns all 136 |
| B-10 | Warning | CORS: `Access-Control-Allow-Origin` permits browser clients ("enable CORS for all requests") | bp | ✅ every landing-page entry pre-checked; a pasted URL that fails is reported as such |
| B-11 | Warning | served over HTTPS (an `http://` catalog is blocked as mixed content from an HTTPS page) | web platform | ✅ none in the landing list; a pasted `http://` URL fails visibly |
| B-12 | Behavior | `service-desc` served as `application/vnd.oai.openapi+json;version=3.0` | api-validator | ⚪ low value for this app |
| B-13 | Behavior | error responses are meaningful (status + body) | api-validator | ✅ body surfaced verbatim |

## Observations that will never become warnings

These are the facts a reader needs to place a catalog, deliberately left as neutral statements (`DESIGN.md` §96):

- an API root with no `child` links at all, discovered through `/collections` (Planetary Computer) — ✅
- a flat root: N Collections and no intermediate Catalogs (Copernicus Data Space, 422) — ✅ count; "no hierarchy" not yet stated in words
- Collections whose Item count is unknown until queried (any cursor-mode Collection) — ✅ "items via API search"
- a Collection reporting millions of Items (Earth Search Sentinel-2, 51M+) — ✅
- static vs. API-backed, per node — ✅ badge
- nesting depth; widest level — 🟡

---

## How this list gets used

1. A **health summary** for the selected Catalog/Collection aggregates every ✅ finding already computed for it (and its loaded children), grouped by tier, each row citing its rule ID and source — no new checks needed to ship a first version.
2. 🟡 rows are added one at a time, each with a test against a real catalog that exhibits it (the way every ⚠ so far was added).
3. 🔵 rows form a **capability page** for an API root: declared classes (D-02) beside what a small set of probe requests actually returned (B-*). Probes are explicit and user-triggered, never silent background traffic — the app never sends requests a user didn't ask for.
4. Anything not on this list is not a "health" finding. Adding a rule means adding a row here first, with its source.

## Beyond Earth

Almost every STAC dataset is about Earth, and the app draws its extents on an Earth map. The Solar System extension (`ssys`) is how a publisher says otherwise; when it does, an Earth basemap is the wrong picture and the app must not show one.

| ID | Tier | Rule | Source | Status |
|---|---|---|---|---|
| S-01 | Behavior | `ssys:targets` names a body other than Earth (on the node or an ancestor) → its `bbox`/`geometry` are body-fixed lon/lat on that body; drawn on a plain graticule with the body named, never on Earth tiles | ssys extension v1.1 (fields allowed on Catalog, Collection, Item); observed: CNES Rosetta 67P (Collection + Items), Univ. Nantes Cassini VIMS (root Catalog → Titan) | ✅ |
| S-02 | Observation | `ssys:target_class` present alongside `ssys:targets` (planet, satellite, comet, asteroid, …) | ssys extension | ✅ shown with the body name |
| S-03 | Warning | a non-Earth body's Items use a projection whose datum is Earth (`proj:code` EPSG:4326 etc.) — the two declarations contradict | ssys + projection extensions | 🟡 |
