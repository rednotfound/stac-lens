# The known-catalog list

The landing page offers a list of public STAC catalogs and APIs to open.
This file is the rule book for that list: what it is, how an entry gets
in, how entries are re-checked, and how one leaves. The list itself is
data — `src/data/catalogs.json` — not code, so that every change to it is
a visible, reviewable diff of one record.

The list exists to give a first-time visitor something real to open. It
is **not** a directory of all STAC in the world; [STAC Index](https://stacindex.org)
is that, and most entries here were taken from it.

## Each entry

```json
{
  "title": "Overture Maps Releases",
  "description": "Overture Maps Foundation releases — ... one Collection per layer per release (table extension).",
  "href": "https://stac.overturemaps.org/catalog.json",
  "kind": "static",
  "addedOn": "2026-09-07",
  "verifiedOn": "2026-09-17"
}
```

| Field | Meaning |
|---|---|
| `title` | The catalog's own title, or the name its publisher uses. |
| `description` | One sentence on what is inside, written for someone deciding whether to open it. |
| `href` | The root Catalog or API landing page. Never a URL with a key or token in it. |
| `kind` | `api` when the root advertises Item Search (a GET `rel:search` link), `static` otherwise — the same rule the app applies at runtime. |
| `addedOn` | Date of the first commit that listed this href. |
| `verifiedOn` | Last date the verifier found the entry passing every check. |

## Inclusion criteria

An entry must pass all of these, checked against the live server, not
assumed from a directory listing:

1. **Reachable** — the root answers 2xx.
2. **Cross-origin readable** — the response carries
   `Access-Control-Allow-Origin` (`*` or the requesting origin). STAC Lens
   runs entirely in the browser; without this header no browser-side app,
   this one included, can open the catalog.
3. **Genuinely STAC** — the body is JSON with a `stac_version`. Several
   directory entries are OGC API - Records or plain JSON that merely look
   similar.
4. **Declared kind matches the server** — `kind` agrees with what the root
   actually advertises.
5. **Something to show within reach** — for a static catalog, a
   breadth-first walk over child links (depth 3, at most 16 documents)
   reaches Items (`rel:item` or `rel:items`) or at least a Collection.
   Those are what STAC Lens renders: a Collection shows its extent and
   collection-level assets even when it has no Items (fiboa and TriMet
   are like that). A tree of nothing but nested Catalogs, or of documents
   without a STAC `type`, is a warning. For an API, the root has
   `rel:child` links or `/collections` answers with a `collections`
   array, in that order, as the app itself does. This check exists
   because of the Overture entry in the log below: the question it asks
   is the one that note should have answered.
6. **Honest to redistribute** — no URL that embeds an API key or access
   token, and no plain `http://` URL (a mixed-content failure once opened
   from an HTTPS page).

## Adding an entry

1. Add the record to `src/data/catalogs.json` with `addedOn` = today, no
   `verifiedOn`.
2. Run the verifier on just that entry and paste its line into the pull
   request:

   ```bash
   npm run verify:catalogs -- --only stac.overturemaps.org --stamp
   ```

   `--stamp` writes `verifiedOn` for entries that pass. Commit the stamped
   record.
3. Open the catalog in the app and look at it — the verifier proves
   reachability and shape, not that the tree makes sense to a person.

## Re-verification

`npm run verify:catalogs` checks every entry and prints one line each;
`.github/workflows/catalogs.yml` runs it every Monday and publishes the
report in the job summary. The script **never adds or removes an entry**.
A red run is a prompt for a person to look, decide, and record the
decision below.

`warn` means the entry still opens but something is off (declared kind
disagrees with the server; a static catalog where neither a Collection nor
an Item was found within the walk's budget). `fail` means a visitor clicking it would get an
error (unreachable, no CORS, not STAC, or an API whose `/collections` is
down).

## Removing an entry

Remove the record and add a row to the log below with the date, the
reason, and how the reason was established, in enough detail that someone
can repeat the check later. A catalog that fails once on a Monday is not
removed; one that has failed for several weeks, or whose content changed
shape, is.

Removals are the part that used to go wrong here. The log's first two rows
were removed on the strength of a one-line note; when one of them was
questioned a week later, the note could not be re-checked because it did
not say what had been looked at. Hence the rule: a removal is a
reproducible observation, or it does not happen.

## Log

| Date | Catalog | Change | Reason, and how it was established |
|---|---|---|---|
| 2026-09-10 | MSC GeoMet - GeoMet-OGC-API (Environment Canada), `https://api.weather.gc.ca/stac/?f=json` | removed | Listed as static but is a live pygeoapi service: a sampled child path was date-stamped with the day it was fetched (`.../msc-datamart/20260909`). Recorded in `docs/DESIGN.md`, "Growing the known-catalog list", third update. Not re-checked since. |
| 2026-09-10 | Overture Maps Releases, `https://stac.overturemaps.org/catalog.json` | removed | Note at the time: "collections list raw Parquet part files in a `registry.manifest` array, not STAC Items". The note did not say which collection was inspected. |
| 2026-09-17 | Overture Maps Releases | **restored** | Re-checked every collection of release `2026-08-19.0`: 15 Collections, STAC 1.1.0, table extension, 987 `rel:item` links in total, no `registry.manifest` anywhere; the previous release `2026-07-22.0` looks the same. CORS `*`. Opened in the app down to an Item without error. The Wayback snapshot of 2026-09-09 has the root and theme levels (identical to today) but not the collection files, so whether the 2026-09-10 note was ever accurate cannot be determined. Criterion 5 above was written because of this. |
| 2026-09-11 | 8 STAC Index API entries | not added | Two GISTDA (Thailand) endpoints carry `?api_key=` in the directory URL; one Ellipsis Drive URL (SkyServe Mission Data) embeds what looks like an access token as a path segment; five were unreachable at check time (timeout, expired certificate, or 5xx). |
| 2026-09-10 | ~11 STAC Index static entries | not added | Out of ~73 checked, 62 passed. Excluded: missing CORS, dead or redirecting links, not actually STAC, and one that passed but is served over plain `http://`. |
| 2026-09-17 | USGS Landsat Collection 2 API, `https://landsatlook.usgs.gov/stac-server/` | flagged, kept | Fails CORS: `Access-Control-Allow-Origin` echoes the server's own origin (`https://landsatlook.usgs.gov/stac-server`) whatever origin asks. Confirmed in Chromium: "blocked by CORS policy". Passed the same check when added on 2026-09-11, so the server changed. Left in the list pending the weekly re-checks. |
| 2026-09-17 | UK NCEO Analysis Ready Data (ARD), `https://gws-access.jasmin.ac.uk/public/nceo_ard/NCEO_ARD_STAC/catalog.json` | flagged, kept | Fails CORS: the header is sent twice (`*, *`), which browsers reject as multiple values. Confirmed in Chromium. `curl` shows a single `*`, so the duplication is request-dependent (likely a proxy layer). Left in the list pending the weekly re-checks. |
