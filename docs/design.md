# transitland-mcp-server — Design

## MCP Surface

### Tools

| Name | Description | Key Inputs | Annotations |
|:-----|:------------|:-----------|:------------|
| `transitland_find_operators` | Find transit operators/agencies by name, near a point or bounding box, by place, or by Onestop ID. Returns Onestop ID, name, the agencies covered, the places served, and the feeds each publishes. The entry point — resolve a place or name to operators. Transitland does not geocode place names; geocode a city to coordinates with `openstreetmap_geocode` first, then pass `lat`/`lon` (or a `bbox`). | `search?`, `lat?`+`lon?`+`radius?`, `bbox?`, `onestop_id?`, `adm0_name?`, `adm1_name?`, `limit?` | `readOnlyHint: true`, `openWorldHint: true` |
| `transitland_get_operator` | Fetch the full operator record by Onestop ID (or internal integer ID): the agencies it covers, the places served, the feeds it publishes, and source tags (Wikidata QID, US NTD ID, social handles). Use when you already hold an operator ID and want the complete record without a search round-trip. | `operator_key` | `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: true` |
| `transitland_find_feeds` | Discover GTFS, GTFS-Realtime, and GBFS feeds — the open-data catalog. Filter by operator (Onestop ID), feed spec, fetch state, or a search term. Each feed returns its Onestop ID, spec, the fetch URL to download the data, the license terms (redistribution, commercial use, attribution, SPDX where known), and last-fetch freshness. The unique value of this server: where to legally get a place's transit data and on what terms. Discover feeds by operator (reliable) rather than by radius (coarse — feed geometry spans the whole feed). | `operator_onestop_id?`, `spec?`, `search?`, `fetch_error?`, `limit?` | `readOnlyHint: true`, `openWorldHint: true` |
| `transitland_find_routes` | Find routes near a point, within a bounding box, by operator, or by Onestop ID. Returns route Onestop ID, short and long name, mode (bus, rail, ferry, subway, tram, …), brand color, and the operating agency. Geocode place names to coordinates with `openstreetmap_geocode` before passing `lat`/`lon`. | `lat?`+`lon?`+`radius?`, `bbox?`, `operator_onestop_id?`, `onestop_id?`, `route_type?`, `search?`, `limit?` | `readOnlyHint: true`, `openWorldHint: true` |
| `transitland_find_stops` | Find stops/stations near a point or within a bounding box, by Onestop ID, or filtered to one operator's network. Returns stop Onestop ID, name, code, coordinates, type (platform vs. station), accessibility, and timezone — the locate-a-stop step before departures. Geocode place names to coordinates with `openstreetmap_geocode` first. Pass a returned stop Onestop ID to `transitland_get_departures`. | `lat?`+`lon?`+`radius?`, `bbox?`, `onestop_id?`, `served_by_onestop_ids?`, `search?`, `limit?` | `readOnlyHint: true`, `openWorldHint: true` |
| `transitland_get_departures` | Departures from a stop by Onestop ID (or internal ID). Returns each departure's route, headsign, trip, and scheduled time — plus the real-time predicted time and delay **only where the feed publishes GTFS-Realtime**. The `realtime` flag and `schedule_relationship` on every departure tell you whether a time is a live prediction or a static timetable entry, so a schedule is never mistaken for a live arrival. Resolve a stop to its Onestop ID with `transitland_find_stops` first. | `stop_key`, `next_seconds?`, `service_date?`, `use_service_window?`, `limit?` | `readOnlyHint: true`, `openWorldHint: true` |

### Resources

| URI Template | Description | Pagination |
|:-------------|:------------|:-----------|
| `transitland://operator/{onestop_id}` | Operator record by Onestop ID — agencies, places served, published feeds, source tags. Mirrors `transitland_get_operator`. | No |
| `transitland://feed/{onestop_id}` | Feed record by Onestop ID — spec, fetch URL, license, latest fetch freshness. The catalog entry for one feed. | No |

Both resources are convenience surfaces for clients that support injectable context. Every datum they expose is also reachable through the tool surface (`transitland_get_operator`, `transitland_find_feeds`), so tool-only clients lose nothing. Stops and routes get no resource — they're discovered in bulk by geography, not referenced by a single stable URI an agent would inject.

### Prompts

None. The domain is operational data lookup and feed discovery — there is no recurring analysis framework or report template that earns a prompt. Tool descriptions carry the workflow guidance (geocode-first, operator-then-feeds, stop-then-departures).

---

## Overview

An MCP server wrapping the [Transitland v2 REST API](https://www.transit.land/documentation) — the open registry that aggregates **GTFS**, **GTFS-Realtime**, and **GBFS** feeds from thousands of transit operators worldwide. One key, one base URL (`https://transit.land/api/v2/rest`), a clean resource hierarchy: operators → feeds → routes → stops → departures.

The server answers four questions no other fleet server can at planetary scale:

1. **Which operators serve this place?** (`find_operators` near coordinates or by place name)
2. **Where do I legally get this agency's open transit data, and on what license?** (`find_feeds` — the standout value prop)
3. **What routes and stops are here?** (`find_routes`, `find_stops` by radius/bbox)
4. **When does the next vehicle leave this stop, and is that time live or scheduled?** (`get_departures` with the real-time distinction)

**Relationship to `onebusaway-mcp-server`:** complementary, not overlapping. OneBusAway is real-time-rich but instance-scoped (Puget Sound + other OBA deployments) — deep live arrivals, vehicle positions, schedule deviation. Transitland is global feed coverage (thousands of agencies everywhere) with real-time *only where a feed publishes GTFS-RT*. An agent reaches for Transitland to discover or compare systems anywhere and to find open data feeds; for deep live tracking in a configured region, OneBusAway. The boundary is drawn explicitly in tool descriptions.

**Target users:** transit riders ("what operators run in Berlin?", "when's the next departure here?"), urban and mobility planners, civic-tech and routing developers sourcing GTFS, transportation researchers comparing systems, and agents assembling a "transit profile for a place."

Global coverage. Read-only.

---

## Requirements

- Read-only access to the Transitland registry: operators, feeds, routes, stops, departures.
- **API key required**, passed as the `apikey` **query parameter** (Transitland also accepts an `apikey` header) — **not** an `Authorization: Bearer` header. Config env var: `TRANSITLAND_API_KEY`.
- **Onestop IDs are the surfaced currency.** Accept both Onestop IDs (`o-9q9-bart`, `f-9q9-bart`, `r-9q9p-800`, `s-9q8yyw3xjw-powell`) and internal integer IDs on input; always surface the Onestop ID in output (public, durable, legible across deployments). Internal integer IDs are instance-mutable and never the primary output identifier.
- **Geographic-first, but no geocoding.** Transitland takes `lat`+`lon`+`radius` or a `bbox` — never a place name. Every geography-capable tool documents the `openstreetmap_geocode` pre-step so an agent doesn't pass "Seattle" and get nothing.
- **Feed registry is the differentiator.** `find_feeds` surfaces fetch URL + license terms + fetch freshness for open feeds — uniquely Transitland.
- **Real-time is conditional.** Departures are scheduled unless the feed carries GTFS-RT. Surface `realtime` (boolean) and `schedule_relationship` per departure, and both the scheduled and (when present) estimated times, so a static timetable is never presented as a live prediction.
- **Rate-limited free tier.** The free key is rate-limited (Pro tier raises quotas). The service surfaces 429 as a retryable `rate_limited` error with a back-off hint.
- **Pagination via cursor.** List endpoints return `meta.after` (an integer cursor) and a `meta.next` URL. The `meta.next` URL **embeds the apikey in plaintext** — the service must never surface `meta.next` verbatim; it returns only the opaque `after` cursor for follow-up.
- **GraphQL escape hatch (not exposed).** REST is internally served by Transitland's GraphQL API. Deep nested joins beyond the REST-shaped tools are a documented out-of-scope escape hatch (the operator can query `https://transit.land/api/v2/query` directly); the MCP surface stays REST-shaped.

---

## Services

| Service | Wraps | Used By |
|:--------|:------|:--------|
| `TransitlandService` | Transitland v2 REST API (`https://transit.land/api/v2/rest`) | All six tools and both resources |

Single service, single upstream. A thin HTTP client (native `fetch` via the framework's `fetchWithTimeout` + `withRetry`) that:

- Injects `apikey` as a query parameter on every request from `TRANSITLAND_API_KEY`.
- Exposes one typed method per endpoint: `listOperators`, `getOperator`, `listFeeds`, `getFeed`, `listRoutes`, `listStops`, `getDepartures`.
- Normalizes the cursor: reads `meta.after`, **discards `meta.next`** (it leaks the key), returns `{ items, after }`.
- Classifies upstream failures: 401 → `ConfigurationError`/`Unauthorized` (bad key, surfaced once at the edge), 404 → `NotFound`, 429 → retryable `ServiceUnavailable`, 5xx/timeouts → retryable `ServiceUnavailable`.
- Holds no shared state beyond config — no caching primitive needed for v1 (the registry is read-mostly and per-call; add session caching later only if rate limits bite).

No SDK: Transitland publishes no maintained TypeScript client, and the REST surface is a handful of GET endpoints with a flat query-param contract — a direct client is simpler than wrapping a generated one and avoids a dependency. (Decision logged.)

### Resilience

| Concern | Decision |
|:--------|:---------|
| Retry boundary | `withRetry` wraps the full fetch+parse pipeline per service method. |
| Backoff | Rate-limited upstream → 1–2s base delay (matches the free-tier 429 recovery profile). |
| HTTP status | `fetchWithTimeout` maps non-OK → `ServiceUnavailable`; the service refines 401/404/429 explicitly for better recovery messaging. |
| Parse failure | Transitland returns JSON on success and a `{"error": "..."}` JSON body on 4xx (verified: `{"error":"not found"}`, `{"error":"Unauthorized"}`) — no HTML error pages observed, so parse failures classify as `SerializationError` only on genuinely malformed bodies. |

### API efficiency

| Concern | Decision |
|:--------|:---------|
| Over-fetch on feeds | The feeds endpoint returns the **entire `feed_versions` history** by default (BART: 167 versions). The service requests `feed_versions.limit=1` (or slices to the latest) so a feed lookup returns current freshness, not a multi-year fetch log. |
| `meta.next` leak | Never surfaced; only the integer `after` cursor is returned for pagination. |
| Field bloat | Operator/agency `geometry` polygons and route/stop geometry are large coordinate arrays with no agent decision value — omitted from tool output by default (a coarse place summary is surfaced instead). |

---

## Config

| Env Var | Required | Description |
|:--------|:---------|:------------|
| `TRANSITLAND_API_KEY` | **Yes** | Transitland v2 API key, sent as the `apikey` query parameter. Free tier is rate-limited; Pro raises quotas. Get one at the Transitland developer portal. |
| `TRANSITLAND_BASE_URL` | No | Override the API base (default `https://transit.land/api/v2/rest`). For pinning to a specific deployment or a self-hosted instance. |

Both live in `src/config/server-config.ts` as a lazy-parsed Zod schema (`parseEnvConfig`), separate from framework config. `TRANSITLAND_API_KEY` is `z.string().min(1)` so a missing key fails at startup with a banner naming the variable — not at the first tool call.

Adding `TRANSITLAND_API_KEY` requires both packaging files: `server.json` (`environmentVariables[]`) and `manifest.json` (`mcp_config.env` + `user_config`) — `lint:packaging` verifies the names match.

---

## Implementation Order

1. **Config and server setup** — `server-config.ts` (`TRANSITLAND_API_KEY`, `TRANSITLAND_BASE_URL`); `createApp()` identity block is `name` + `title` ONLY, both = `transitland-mcp-server` (fleet identity rule — no `description`/`websiteUrl` in `createApp`; description derives from `package.json`).
2. **`TransitlandService`** — HTTP client, `apikey` injection, cursor normalization, error classification, typed per-endpoint methods. Define raw/domain/output types here against the verified response shapes (below).
3. **Discovery tools** — `transitland_find_operators`, `transitland_find_feeds` (the two highest-value entry points).
4. **`transitland_get_operator`** — single-record fetch.
5. **Geography tools** — `transitland_find_routes`, `transitland_find_stops`.
6. **`transitland_get_departures`** — the real-time-aware tool (most complex normalization).
7. **Resources** — `transitland://operator/{onestop_id}`, `transitland://feed/{onestop_id}`.

Each step is independently testable. Tests include at least one **sparse payload** case per tool — Transitland leaves many fields as empty strings or null on free/minimal feeds (license fields especially), and the normalization must preserve "unknown" rather than fabricate a value.

---

## Domain Mapping

| Noun | Operations | API Endpoint(s) |
|:-----|:-----------|:----------------|
| Operator | find (search / radius / bbox / place / onestop), get | `GET /operators`, `GET /operators/{onestop_id}` |
| Feed | find (operator / spec / search / fetch-state), get | `GET /feeds`, `GET /feeds/{onestop_id}` |
| Route | find (radius / bbox / operator / onestop / mode / search) | `GET /routes` |
| Stop | find (radius / bbox / onestop / served-by / search) | `GET /stops` |
| Departure | get (for a stop) | `GET /stops/{stop_key}/departures` |

`get` for routes and stops is intentionally folded into `find` with an `onestop_id` filter — a route/stop is discovered in bulk by geography, and the `find` output already carries the full record, so a dedicated single-fetch tool would duplicate it. Operators and feeds keep a `get` tool (and a resource) because they're the durable, referenceable, ID-first entities an agent revisits.

---

## Verified Response Shapes

All shapes below were confirmed with live requests against the production API (key in the gitignored `.env`).

### Operators (`GET /operators`, `GET /operators/{key}`)

```jsonc
{
  "meta": { "after": 14356265 },          // cursor; meta.next URL discarded (leaks apikey)
  "operators": [{
    "onestop_id": "o-9q9-bart",           // SURFACE this
    "id": 14356265,                        // internal integer; accept on input, don't surface as primary
    "name": "Bay Area Rapid Transit",
    "short_name": "BART",                 // often null
    "website": null,                       // often null
    "tags": {                              // free-form; useful keys surfaced selectively
      "wikidata_id": "Q610120",
      "us_ntd_id": "90003",
      "twitter_general": "sfbart"
    },
    "agencies": [{
      "agency_id": "BA",                   // GTFS agency_id (feed-local)
      "agency_name": "Bay Area Rapid Transit",
      "id": 3338907,
      "places": [                          // surface as a compact place summary
        { "adm0_name": "United States of America", "adm1_name": "California", "city_name": "Oakland" }
      ],
      "geometry": { "type": "Polygon", "coordinates": [ /* large — OMIT */ ] }
    }],
    "feeds": [                             // feeds this operator publishes — surface
      { "onestop_id": "f-9q9-bart", "spec": "GTFS", "name": null, "id": 2 },
      { "onestop_id": "f-sf~bay~area~rg~rt", "spec": "GTFS_RT", "name": "…", "id": 4435 }
    ]
  }]
}
```

### Feeds (`GET /feeds`, `GET /feeds/{key}`)

```jsonc
{
  "feeds": [{
    "onestop_id": "f-9q9-bart",            // SURFACE
    "id": 2,
    "spec": "GTFS",                        // GTFS | GTFS_RT | GBFS | MDS
    "name": null,
    "license": {                           // THE value prop — but free feeds leave most blank
      "spdx_identifier": "",               // → normalize "" to null / "unknown"
      "url": "http://www.bart.gov/...",
      "use_without_attribution": "yes",    // "yes" | "no" | "unknown" | ""
      "commercial_use_allowed": "",
      "redistribution_allowed": "",
      "create_derived_product": "unknown",
      "share_alike_optional": "",
      "attribution_text": ""
    },
    "urls": {
      "static_current": "http://www.bart.gov/dev/schedules/google_transit.zip",  // the fetch URL
      "static_historic": [],
      "static_planned": [],
      "realtime_vehicle_positions": "",    // non-empty ⇒ this feed carries GTFS-RT vehicle data
      "realtime_trip_updates": "",
      "realtime_alerts": "",
      "gbfs_auto_discovery": ""            // non-empty ⇒ GBFS bikeshare feed
    },
    "feed_state": { "feed_version": null },// current version pointer (often null on free tier)
    "feed_versions": [{                    // request feed_versions.limit=1 — full history is huge (167 for BART)
      "sha1": "c995688a4fd4e9cd780cfda218c02665395dfceb",
      "fetched_at": "2026-06-10T23:22:37.887044Z",   // freshness
      "earliest_calendar_date": "2026-01-31",
      "latest_calendar_date": "2027-01-31",          // service coverage window
      "url": "https://data.trilliumtransit.com/.../caltrain-ca-us.zip"
    }],
    "languages": [],
    "tags": {},
    "authorization": { "type": "", "param_name": "", "info_url": "" }  // non-empty type ⇒ feed needs its own key to fetch
  }]
}
```

### Routes (`GET /routes`)

```jsonc
{
  "meta": { "after": 136833627 },
  "routes": [{
    "onestop_id": "r-9q9p-800",            // SURFACE
    "id": 136833490,
    "route_id": "AC:800",                  // GTFS route_id (feed-local)
    "route_short_name": "800",
    "route_long_name": "Rich - Oak Transbay All Nighter",
    "route_desc": null,
    "route_type": 3,                       // GTFS route_type — map to a label (see API Reference)
    "route_color": "BC8E2D",               // hex without '#'; often null
    "route_text_color": "000000",
    "route_url": "http://www.actransit.org/...",
    "agency": {                            // operating agency — surface its onestop_id
      "onestop_id": "o-9q9-actransit",
      "agency_id": "AC",
      "agency_name": "AC TRANSIT",
      "id": 3338882
    },
    "feed_version": { "feed": { "onestop_id": "f-sf~bay~area~rg", "id": 4057 }, "fetched_at": "…", "sha1": "…" }
  }]
}
```

### Stops (`GET /stops`)

```jsonc
{
  "meta": { "after": 2284157762 },
  "stops": [{
    "onestop_id": "s-9q8yyw3xjw-powell",   // SURFACE
    "id": 2284157467,
    "stop_id": "mtc:powell",               // GTFS stop_id (feed-local)
    "stop_name": "Powell",
    "stop_code": null,
    "stop_desc": null,
    "geometry": { "type": "Point", "coordinates": [-122.40737, 37.78459] },  // [lon, lat] — normalize to {lat, lon}
    "location_type": 1,                    // 0=platform/stop, 1=station, 2=entrance, 3=generic node, 4=boarding area
    "wheelchair_boarding": 0,              // 0=unknown, 1=accessible, 2=not accessible
    "stop_timezone": "America/Los_Angeles",
    "stop_url": null,
    "platform_code": null,
    "zone_id": null,
    "parent": null,                        // parent station onestop_id when this is a child platform
    "place": { "adm0_iso": "US", "adm0_name": "United States of America", "adm1_iso": "US-CA", "adm1_name": "California" },
    "feed_version": { "feed": { "onestop_id": "f-sf~bay~area~rg" }, "fetched_at": "…", "sha1": "…" }
  }]
}
```

> Routes serving a stop are **not** returned by default. Surface them only if `served_by_route_stops` / an include is requested; v1 keeps the stop record lean and points the agent at `find_routes` near the same coordinates. (Logged.)

### Departures (`GET /stops/{key}/departures`)

```jsonc
{
  "stops": [{
    "onestop_id": "s-dr5ru7tjdb-7av~w44st",
    "stop_name": "7 AV/W 44 ST",
    "stop_timezone": "America/New_York",
    "departures": [{
      "departure": {                       // and an identical "arrival" object
        "scheduled": "16:21:07",           // local wall-clock HH:MM:SS
        "scheduled_local": "2026-06-13T16:21:07-04:00",
        "scheduled_utc": "2026-06-13T20:21:07Z",
        "estimated": "17:01:39",           // PRESENT only with GTFS-RT; null/absent when scheduled-only
        "estimated_local": "2026-06-13T17:01:39-04:00",
        "estimated_utc": "2026-06-13T21:01:39Z",
        "estimated_delay": 2432,           // seconds late (+) / early (−); null when no RT
        "delay": null,
        "uncertainty": null
      },
      "schedule_relationship": "SCHEDULED",// STATIC | SCHEDULED | ADDED | CANCELED | UNSCHEDULED | DUPLICATED
      "service_date": "2026-06-13",
      "stop_sequence": 45,
      "stop_headsign": null,
      "trip": {
        "trip_id": "OF_B6-Saturday-091600_M7_235",
        "trip_headsign": "14 ST via COLUMBUS via 7 AV",
        "direction_id": 1,
        "wheelchair_accessible": null,
        "bikes_allowed": null,
        "route": {
          "onestop_id": "r-dr72h-m7",      // SURFACE
          "route_short_name": "M7",
          "route_long_name": "Harlem - 14th Street",
          "route_type": 3,
          "route_color": "00AEEF",
          "agency": { "onestop_id": "o-dr5r-nyct", "agency_name": "MTA New York City Transit" }
        }
      }
    }]
  }]
}
```

**The real-time test:** a departure is real-time when `departure.estimated` (equivalently `estimated_utc`) is non-null. The normalized output sets `realtime: true` and exposes `estimatedTime` + `delaySeconds`; otherwise `realtime: false` and only `scheduledTime`. `schedule_relationship` is surfaced verbatim. **Observed values from live API:** `STATIC` = static-schedule-only trip (no RT coverage); `SCHEDULED` = RT-covered trip currently on schedule; `ADDED`/`CANCELED`/`UNSCHEDULED`/`DUPLICATED` = RT mutation states. The "STATIC vs SCHEDULED" split is the primary realtime indicator — `STATIC` means no RT overlay at all, confirmed against NYC MTA GTFS-RT feed.

---

## Tool Specifications

> Conventions across all tools: every Zod field has `.describe()`. `lat`/`lon` are `z.number()` with `.min()/.max()` bounds. Onestop-ID inputs accept the Onestop form or an internal integer ID (passed through to the upstream `*_key` path param or `ids` filter); the description states both. Geography-capable tools name the `openstreetmap_geocode` pre-step. Capped-list tools put truncation disclosure in `enrichment` (not `output`) and always emit `totalCount` via `ctx.enrich.total()`.

---

### `transitland_find_operators`

**Description:** Find transit operators/agencies by name, near a point or within a bounding box, by country/region, or by Onestop ID. Returns each operator's Onestop ID, name, the agencies it covers, the places it serves, and the feeds it publishes. The entry point for "what transit runs here?". Transitland does not geocode place names — geocode a city to coordinates with `openstreetmap_geocode` first, then pass `lat` and `lon` (with an optional `radius`) or a `bbox`. Provide at least one of: `search`, `lat`+`lon`, `bbox`, `onestop_id`, or a place filter.

**Input schema:**

```ts
z.object({
  search: z.string().optional()
    .describe('Full-text search over operator and agency names (e.g. "BART", "Sound Transit"). Upstream-ranked. Combine with a place filter to disambiguate common names.'),
  onestop_id: z.string().optional()
    .describe('Operator Onestop ID (e.g. "o-9q9-bart") or internal integer ID, for a direct lookup. When set, other filters are ignored. For the complete record prefer transitland_get_operator.'),
  lat: z.number().min(-90).max(90).optional()
    .describe('Latitude of the search center (WGS84 decimal degrees). Requires lon. Transitland does not geocode — use openstreetmap_geocode to turn a place name into coordinates first.'),
  lon: z.number().min(-180).max(180).optional()
    .describe('Longitude of the search center (WGS84 decimal degrees). Requires lat.'),
  radius: z.number().min(0).max(100000).default(1000)
    .describe('Search radius in meters around lat/lon (max 100,000). Operators are matched when their service area intersects the radius.'),
  bbox: z.string().optional()
    .describe('Bounding box "minLon,minLat,maxLon,maxLat" (e.g. "-122.5,37.7,-122.3,37.9"). Alternative to lat/lon/radius for area surveys. Cannot be combined with lat/lon.'),
  adm0_name: z.string().optional()
    .describe('Filter to a country by full English name (e.g. "United States of America", "Germany"). Coarse — pair with search or geography to narrow.'),
  adm1_name: z.string().optional()
    .describe('Filter to a state/province/region by full name (e.g. "California"). Use with adm0_name.'),
  limit: z.number().int().min(1).max(100).default(20)
    .describe('Maximum operators to return (max 100). Results beyond this are reported via totalCount and the truncation notice; page with the after cursor.'),
  after: z.number().int().optional()
    .describe('Pagination cursor from a previous response (enrichment.cursor). Returns the next page after this internal ID.'),
})
```

**Output schema:**

```ts
z.object({
  operators: z.array(z.object({
    onestopId: z.string().describe('Stable public Onestop ID (e.g. "o-9q9-bart"). Use for transitland_get_operator and as operator_onestop_id in find_feeds/find_routes.'),
    name: z.string().describe('Operator name.'),
    shortName: z.string().nullable().describe('Short name/abbreviation (e.g. "BART"). Null when the feed omits it.'),
    website: z.string().nullable().describe('Operator website. Null when unknown.'),
    places: z.array(z.object({
      country: z.string().nullable().describe('Country (adm0) name.'),
      region: z.string().nullable().describe('State/province (adm1) name.'),
      city: z.string().nullable().describe('City name. Null when the agency spans no single city.'),
    })).describe('Distinct places this operator serves, summarized from its agencies. Empty when unmapped.'),
    feeds: z.array(z.object({
      onestopId: z.string().describe('Feed Onestop ID. Pass to transitland_find_feeds (operator_onestop_id) or look up directly.'),
      spec: z.string().describe('Feed spec: GTFS, GTFS_RT, GBFS, or MDS.'),
      name: z.string().nullable().describe('Feed name. Often null.'),
    })).describe('Feeds this operator publishes. The bridge to the open-data catalog — a GTFS_RT entry here means real-time departures may be available.'),
    wikidataId: z.string().nullable().describe('Wikidata QID from source tags (e.g. "Q610120"), for cross-referencing wikidata-mcp-server. Null when absent.'),
  })).describe('Matching operators, upstream-ranked.'),
})
```

**Enrichment block:**

```ts
enrichment: {
  totalCount: z.number().describe('Total operators matched before the limit.'),
  cursor: z.number().optional().describe('Pass as `after` to fetch the next page. Present only when more results exist.'),
  truncated: z.boolean().optional().describe('True when results were capped at the limit.'),
  shown: z.number().optional().describe('Number of operators returned.'),
  cap: z.number().optional().describe('The limit applied.'),
  notice: z.string().optional().describe('Guidance when nothing matched (e.g. geocode-first reminder).'),
}
```

**Error contract:**

```ts
errors: [
  { reason: 'no_filter', code: JsonRpcErrorCode.InvalidParams,
    when: 'No search, coordinates, bbox, onestop_id, or place filter was provided (server-enforced guard — the API accepts unfiltered requests but returns a paginated global dump)',
    recovery: 'Provide at least one of: search, lat+lon, bbox, onestop_id, or adm0_name. For a place, geocode it with openstreetmap_geocode first.' },
  { reason: 'incomplete_point', code: JsonRpcErrorCode.InvalidParams,
    when: 'lat without lon or lon without lat',
    recovery: 'Provide both lat and lon together, or use bbox instead for an area.' },
  { reason: 'rate_limited', code: JsonRpcErrorCode.ServiceUnavailable, retryable: true,
    when: 'Transitland returned HTTP 429 (free-tier rate limit)',
    recovery: 'Wait a few seconds and retry. The free key is rate-limited; a Pro key raises the quota.' },
]
```

On empty results the handler returns `operators: []` and calls `ctx.enrich.notice(...)` (not an error) — "no operators" is a valid answer; the notice reminds the agent to geocode-first if it passed a place name.

**Annotations:** `readOnlyHint: true`, `openWorldHint: true`

---

### `transitland_get_operator`

**Description:** Fetch the full operator record by Onestop ID or internal integer ID — the agencies it covers, the places served, the feeds it publishes, and source tags (Wikidata QID, US NTD ID, social handles). Use when you already hold an operator ID and want the complete record without a search round-trip.

**Input schema:**

```ts
z.object({
  operator_key: z.string()
    .describe('Operator Onestop ID (e.g. "o-9q9-bart") or internal integer ID. Get one from transitland_find_operators or an operator reference in another result.'),
})
```

**Output schema:**

```ts
z.object({
  onestopId: z.string().describe('Stable public Onestop ID.'),
  name: z.string().describe('Operator name.'),
  shortName: z.string().nullable().describe('Short name/abbreviation. Null when omitted.'),
  website: z.string().nullable().describe('Operator website. Null when unknown.'),
  agencies: z.array(z.object({
    agencyId: z.string().describe('GTFS agency_id (feed-local identifier).'),
    agencyName: z.string().describe('Agency name as published in its feed.'),
    places: z.array(z.object({
      country: z.string().nullable(),
      region: z.string().nullable(),
      city: z.string().nullable(),
    })).describe('Places this agency serves.'),
  })).describe('Agencies grouped under this operator. A single operator may bundle several GTFS agencies.'),
  feeds: z.array(z.object({
    onestopId: z.string().describe('Feed Onestop ID. Pass to transitland_find_feeds or the feed resource for license + fetch URL.'),
    spec: z.string().describe('Feed spec: GTFS, GTFS_RT, GBFS, or MDS.'),
    name: z.string().nullable().describe('Feed name. Often null.'),
  })).describe('Feeds this operator publishes.'),
  tags: z.object({
    wikidataId: z.string().nullable().describe('Wikidata QID (e.g. "Q610120") for wikidata-mcp-server cross-reference.'),
    usNtdId: z.string().nullable().describe('US National Transit Database ID, where applicable.'),
    twitter: z.string().nullable().describe('General Twitter/X handle, where published.'),
  }).describe('Selected source tags. Fields are null when the registry has no value.'),
})
```

**Error contract:**

```ts
errors: [
  { reason: 'operator_not_found', code: JsonRpcErrorCode.NotFound,
    when: 'No operator exists for the given Onestop ID or internal ID',
    recovery: 'Verify the ID format (e.g. "o-9q9-bart") or search with transitland_find_operators to get a valid Onestop ID.' },
  { reason: 'rate_limited', code: JsonRpcErrorCode.ServiceUnavailable, retryable: true,
    when: 'Transitland returned HTTP 429',
    recovery: 'Wait a few seconds and retry; the free key is rate-limited.' },
]
```

**Annotations:** `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: true`

---

### `transitland_find_feeds`

The standout tool. Surfaces where to legally get open transit data and on what terms.

**Description:** Discover GTFS, GTFS-Realtime, and GBFS feeds in the open-data registry. Filter by operator (Onestop ID), feed spec, fetch state, or a search term. Each feed returns its Onestop ID, spec, the fetch URL to download the data, the license terms (redistribution, commercial use, attribution, SPDX identifier where known), and last-fetch freshness (when it was retrieved and the calendar window it covers). Use this to answer "where do I get this agency's GTFS, and may I redistribute it?". Discover feeds by operator (`operator_onestop_id`) for reliable results — radius filtering on feeds is coarse because a feed's geometry spans its whole coverage area.

**Input schema:**

```ts
z.object({
  operator_onestop_id: z.string().optional()
    .describe('Restrict to feeds published by this operator (Onestop ID, e.g. "o-9q9-bart"). The reliable way to find a specific agency\'s feeds — get the ID from transitland_find_operators.'),
  spec: z.enum(['gtfs', 'gtfs-rt', 'gbfs', 'mds']).optional()
    .describe('Filter by feed spec. "gtfs" = static schedule data; "gtfs-rt" = real-time (trip updates, vehicle positions, alerts); "gbfs" = bikeshare/micromobility; "mds" = mobility data spec. Omit to return all specs. Note: the API accepts both lowercase ("gtfs-rt") and uppercase ("GTFS_RT") — the output always returns uppercase (GTFS, GTFS_RT, GBFS, MDS).'),
  search: z.string().optional()
    .describe('Full-text search over feed names and identifiers (e.g. "511 Regional", "MBTA"). Useful when you know a feed by name but not its operator.'),
  fetch_error: z.boolean().optional()
    .describe('When true, return only feeds whose most recent fetch failed (stale/broken sources). When false, only successfully-fetched feeds. Omit for both. Useful for data-quality auditing.'),
  limit: z.number().int().min(1).max(100).default(20)
    .describe('Maximum feeds to return (max 100). Page further with the after cursor.'),
  after: z.number().int().optional()
    .describe('Pagination cursor from a previous response (enrichment.cursor).'),
})
```

**Output schema:**

```ts
z.object({
  feeds: z.array(z.object({
    onestopId: z.string().describe('Feed Onestop ID (e.g. "f-9q9-bart"). The durable handle for this feed.'),
    spec: z.string().describe('Feed spec: GTFS, GTFS_RT, GBFS, or MDS.'),
    name: z.string().nullable().describe('Feed name. Often null for single-operator feeds.'),
    fetchUrl: z.string().nullable().describe('Direct URL to download the current feed data (the GTFS .zip for static feeds; the realtime endpoint for GTFS-RT/GBFS). Null when the registry has no current URL.'),
    realtimeUrls: z.object({
      tripUpdates: z.string().nullable().describe('GTFS-RT trip-updates endpoint (delays/predictions). Non-null ⇒ this feed powers real-time departures.'),
      vehiclePositions: z.string().nullable().describe('GTFS-RT vehicle-positions endpoint.'),
      alerts: z.string().nullable().describe('GTFS-RT service-alerts endpoint.'),
    }).describe('Real-time endpoints when the feed carries GTFS-RT. All null for a static-only GTFS feed.'),
    license: z.object({
      spdxIdentifier: z.string().nullable().describe('SPDX license identifier (e.g. "CC-BY-4.0") when the registry knows it. Null/unknown is common — do not infer a license that is not stated.'),
      url: z.string().nullable().describe('URL of the license or terms-of-use document.'),
      redistributionAllowed: z.enum(['yes', 'no', 'unknown']).describe('Whether redistribution is permitted. "unknown" when the registry has no value — surface honestly, do not assume permissive.'),
      commercialUseAllowed: z.enum(['yes', 'no', 'unknown']).describe('Whether commercial use is permitted.'),
      createDerivedProduct: z.enum(['yes', 'no', 'unknown']).describe('Whether derived products are permitted.'),
      useWithoutAttribution: z.enum(['yes', 'no', 'unknown']).describe('Whether attribution can be omitted. "no"/"unknown" ⇒ attribute the source.'),
      attributionText: z.string().nullable().describe('Required attribution text, when specified.'),
    }).describe('License/terms as recorded by Transitland. Empty registry fields are normalized to "unknown" or null — never fabricated. Confirm against the license url before redistributing.'),
    latestFetch: z.object({
      fetchedAt: z.string().nullable().describe('ISO 8601 timestamp of the most recent successful fetch (data freshness).'),
      earliestServiceDate: z.string().nullable().describe('Earliest calendar date the current data covers (YYYY-MM-DD).'),
      latestServiceDate: z.string().nullable().describe('Latest calendar date the current data covers — when service data runs out.'),
      sha1: z.string().nullable().describe('Content hash of the fetched feed version.'),
    }).describe('Freshness of the current feed version. fetchedAt long in the past or latestServiceDate near today signals stale data.'),
    authorizationRequired: z.boolean().describe('True when fetching the feed itself needs a separate API key/registration (the fetchUrl alone is insufficient).'),
  })).describe('Matching feeds with fetch URLs, license terms, and freshness.'),
})
```

**Enrichment block:** same shape as `find_operators` — `totalCount` (required), optional `cursor`, `truncated`, `shown`, `cap`, `notice`.

**Error contract:**

```ts
errors: [
  { reason: 'no_filter', code: JsonRpcErrorCode.InvalidParams,
    when: 'No operator_onestop_id, spec, search, or fetch_error filter was provided (server-enforced guard — the upstream API accepts unfiltered requests but returns a global firehose)',
    recovery: 'Provide at least one filter — operator_onestop_id (from transitland_find_operators) is the most reliable.' },
  { reason: 'rate_limited', code: JsonRpcErrorCode.ServiceUnavailable, retryable: true,
    when: 'Transitland returned HTTP 429',
    recovery: 'Wait a few seconds and retry; the free key is rate-limited.' },
]
```

> An unfiltered feeds query is allowed by the API (verified: returns data with no params) but produces a global firehose; the `no_filter` contract is server-enforced and requires at least one filter so the agent gets a useful, paginated slice. (Logged.)

**Annotations:** `readOnlyHint: true`, `openWorldHint: true`

---

### `transitland_find_routes`

**Description:** Find routes near a point, within a bounding box, by operator, by Onestop ID, or by mode. Returns each route's Onestop ID, short and long name, mode (bus, rail, ferry, subway, tram, …), brand color, and the operating agency's Onestop ID. Geocode place names to coordinates with `openstreetmap_geocode` before passing `lat`/`lon`. Provide at least one of: `lat`+`lon`, `bbox`, `operator_onestop_id`, `onestop_id`, or `search`.

**Input schema:**

```ts
z.object({
  lat: z.number().min(-90).max(90).optional()
    .describe('Latitude of the search center (WGS84). Requires lon. Geocode place names with openstreetmap_geocode first — Transitland does not accept place names.'),
  lon: z.number().min(-180).max(180).optional()
    .describe('Longitude of the search center (WGS84). Requires lat.'),
  radius: z.number().min(0).max(50000).default(1000)
    .describe('Search radius in meters around lat/lon (max 50,000). Routes are matched when they pass within the radius.'),
  bbox: z.string().optional()
    .describe('Bounding box "minLon,minLat,maxLon,maxLat". Alternative to lat/lon/radius. Cannot be combined with lat/lon.'),
  operator_onestop_id: z.string().optional()
    .describe('Restrict to routes operated by this operator (Onestop ID, e.g. "o-9q9-bart"). Combine with search to find a specific line within an operator.'),
  onestop_id: z.string().optional()
    .describe('Fetch one route directly by its Onestop ID (e.g. "r-9q9p-800") or internal integer ID.'),
  route_type: z.number().int().optional()
    .describe('GTFS route_type filter: 0=tram/streetcar, 1=subway/metro, 2=rail, 3=bus, 4=ferry, 5=cable tram, 6=aerial lift, 7=funicular, 11=trolleybus, 12=monorail. Omit for all modes.'),
  search: z.string().optional()
    .describe('Full-text search over route short and long names (e.g. "Red Line", "44"). Pair with operator_onestop_id or geography to disambiguate.'),
  limit: z.number().int().min(1).max(100).default(20)
    .describe('Maximum routes to return (max 100). Page further with the after cursor.'),
  after: z.number().int().optional()
    .describe('Pagination cursor from a previous response (enrichment.cursor).'),
})
```

**Output schema:**

```ts
z.object({
  routes: z.array(z.object({
    onestopId: z.string().describe('Stable public Onestop ID (e.g. "r-9q9p-800").'),
    shortName: z.string().nullable().describe('Route short name/number as shown to riders (e.g. "44", "Red"). Null when the feed omits it.'),
    longName: z.string().nullable().describe('Full route name (e.g. "Harlem - 14th Street"). Null when omitted.'),
    description: z.string().nullable().describe('Route description (e.g. "via Columbus / 7 Av"). Often null.'),
    routeType: z.number().describe('GTFS route_type integer.'),
    mode: z.string().describe('Human-readable mode derived from route_type: tram, subway, rail, bus, ferry, cable tram, aerial lift, funicular, trolleybus, monorail, or "type N" for unmapped values.'),
    color: z.string().nullable().describe('Brand color as a hex string without "#" (e.g. "00AEEF"). Null when unspecified.'),
    operator: z.object({
      onestopId: z.string().nullable().describe('Operating agency Onestop ID (e.g. "o-dr5r-nyct"). Use with transitland_get_operator.'),
      name: z.string().describe('Operating agency name.'),
    }).describe('The agency that runs this route.'),
    feedOnestopId: z.string().nullable().describe('Onestop ID of the feed this route came from. Pass to transitland_find_feeds for the source data and license.'),
  })).describe('Matching routes, upstream-ranked.'),
})
```

**Enrichment block:** same shape as `find_operators`.

**Error contract:**

```ts
errors: [
  { reason: 'no_filter', code: JsonRpcErrorCode.InvalidParams,
    when: 'No coordinates, bbox, operator, onestop_id, or search provided',
    recovery: 'Provide at least one of: lat+lon, bbox, operator_onestop_id, onestop_id, or search. Geocode place names with openstreetmap_geocode first.' },
  { reason: 'incomplete_point', code: JsonRpcErrorCode.InvalidParams,
    when: 'lat without lon or lon without lat',
    recovery: 'Provide both lat and lon together, or use bbox for an area.' },
  { reason: 'rate_limited', code: JsonRpcErrorCode.ServiceUnavailable, retryable: true,
    when: 'Transitland returned HTTP 429',
    recovery: 'Wait a few seconds and retry; the free key is rate-limited.' },
]
```

**Annotations:** `readOnlyHint: true`, `openWorldHint: true`

---

### `transitland_find_stops`

**Description:** Find stops and stations near a point or within a bounding box, by Onestop ID, or filtered to one operator's network. Returns each stop's Onestop ID, name, code, coordinates, type (platform vs. station vs. entrance), wheelchair accessibility, and timezone. The locate-a-stop step before departures — pass a returned stop Onestop ID to `transitland_get_departures`. Geocode place names to coordinates with `openstreetmap_geocode` first. Provide at least one of: `lat`+`lon`, `bbox`, `onestop_id`, or `served_by_onestop_ids`.

**Input schema:**

```ts
z.object({
  lat: z.number().min(-90).max(90).optional()
    .describe('Latitude of the search center (WGS84). Requires lon. Geocode place names with openstreetmap_geocode first.'),
  lon: z.number().min(-180).max(180).optional()
    .describe('Longitude of the search center (WGS84). Requires lat.'),
  radius: z.number().min(0).max(10000).default(500)
    .describe('Search radius in meters around lat/lon (max 10,000). Keep small (≤500m) in dense areas — stations multiply quickly.'),
  bbox: z.string().optional()
    .describe('Bounding box "minLon,minLat,maxLon,maxLat". Alternative to lat/lon/radius. Cannot be combined with lat/lon.'),
  onestop_id: z.string().optional()
    .describe('Fetch one stop directly by its Onestop ID (e.g. "s-9q8yyw3xjw-powell") or internal integer ID.'),
  served_by_onestop_ids: z.string().optional()
    .describe('Restrict to stops served by these operators or routes — a comma-separated list of operator/route Onestop IDs (e.g. "o-9q9-bart"). Combine with geography to find an operator\'s stops in an area.'),
  search: z.string().optional()
    .describe('Full-text search over stop names (e.g. "Powell", "Union Station"). Pair with geography to disambiguate common names.'),
  limit: z.number().int().min(1).max(100).default(20)
    .describe('Maximum stops to return (max 100). Page further with the after cursor.'),
  after: z.number().int().optional()
    .describe('Pagination cursor from a previous response (enrichment.cursor).'),
})
```

**Output schema:**

```ts
z.object({
  stops: z.array(z.object({
    onestopId: z.string().describe('Stable public Onestop ID (e.g. "s-9q8yyw3xjw-powell"). Pass to transitland_get_departures.'),
    name: z.string().nullable().describe('Stop/station name. Null for unnamed generic nodes (location_type 3).'),
    code: z.string().nullable().describe('Public stop code printed on signage, when published. Null otherwise.'),
    lat: z.number().describe('Latitude (WGS84), normalized from the GeoJSON Point.'),
    lon: z.number().describe('Longitude (WGS84).'),
    locationType: z.number().describe('GTFS location_type: 0=platform/stop, 1=station, 2=entrance/exit, 3=generic node, 4=boarding area.'),
    locationTypeLabel: z.string().describe('Human-readable location type: stop, station, entrance, node, or boarding area.'),
    wheelchairBoarding: z.enum(['accessible', 'not_accessible', 'unknown']).describe('Wheelchair accessibility, mapped from GTFS (1/2/0).'),
    timezone: z.string().nullable().describe('IANA timezone of the stop (e.g. "America/Los_Angeles"). Null when the feed omits it.'),
    parentOnestopId: z.string().nullable().describe('Onestop ID of the parent station when this is a child platform. Null for top-level stops.'),
    place: z.object({
      country: z.string().nullable(),
      region: z.string().nullable(),
    }).describe('Country/region the stop sits in.'),
    feedOnestopId: z.string().nullable().describe('Onestop ID of the source feed. Pass to transitland_find_feeds for license/fetch URL.'),
  })).describe('Matching stops. Departures attach to platform-level stops (location_type 0) — a station (type 1) may return no departures; use its child platforms.'),
})
```

**Enrichment block:** same shape as `find_operators`.

**Error contract:**

```ts
errors: [
  { reason: 'no_filter', code: JsonRpcErrorCode.InvalidParams,
    when: 'No coordinates, bbox, onestop_id, or served_by_onestop_ids provided',
    recovery: 'Provide at least one of: lat+lon, bbox, onestop_id, or served_by_onestop_ids. Geocode place names with openstreetmap_geocode first.' },
  { reason: 'incomplete_point', code: JsonRpcErrorCode.InvalidParams,
    when: 'lat without lon or lon without lat',
    recovery: 'Provide both lat and lon together, or use bbox for an area.' },
  { reason: 'rate_limited', code: JsonRpcErrorCode.ServiceUnavailable, retryable: true,
    when: 'Transitland returned HTTP 429',
    recovery: 'Wait a few seconds and retry; the free key is rate-limited.' },
]
```

**Annotations:** `readOnlyHint: true`, `openWorldHint: true`

---

### `transitland_get_departures`

The real-time-aware tool. Distinguishes live predictions from static schedule.

**Description:** Departures from a stop by Onestop ID or internal ID. Returns each upcoming departure's route, headsign, trip, and scheduled time — plus the real-time predicted time and delay **only where the feed publishes GTFS-Realtime**. Every departure carries a `realtime` flag and a `schedule_relationship` so a static timetable entry is never mistaken for a live arrival, and cancellations/added trips are visible. Resolve a stop to its Onestop ID with `transitland_find_stops` first. Departures attach to platform-level stops; a parent station may return none — query its child platforms. If a stop returns no departures, widen `next_seconds` or set `use_service_window: true` (some feeds only expose times inside their active service window).

**Input schema:**

```ts
z.object({
  stop_key: z.string()
    .describe('Stop Onestop ID (e.g. "s-9q8yyw3xjw-powell") or internal integer ID. Get one from transitland_find_stops. Use a platform-level stop (location_type 0); a station may return no departures.'),
  next_seconds: z.number().int().min(60).max(86400).default(3600)
    .describe('Look-ahead window in seconds from now (max 86,400 = 24h). Default 3600 (1h). Widen when a stop has infrequent service or returns nothing.'),
  service_date: z.union([
    z.literal(''),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Service date as YYYY-MM-DD'),
  ]).optional()
    .describe('Restrict to a specific service date (YYYY-MM-DD), e.g. to check a future day\'s schedule. Empty string or omitted uses today. Real-time predictions only apply to the current service day.'),
  use_service_window: z.boolean().default(false)
    .describe('When true, clamp the query into the feed\'s active service window. Set this if a default query returns no departures — some feeds only publish times within their declared calendar window.'),
  limit: z.number().int().min(1).max(100).default(20)
    .describe('Maximum departures to return (max 100), ordered by departure time.'),
})
```

**Output schema:**

```ts
z.object({
  stop: z.object({
    onestopId: z.string().describe('The stop\'s Onestop ID, echoed back.'),
    name: z.string().nullable().describe('Stop name.'),
    timezone: z.string().nullable().describe('IANA timezone the departure wall-clock times are in.'),
  }).describe('The stop the departures belong to.'),
  departures: z.array(z.object({
    realtime: z.boolean().describe('TRUE when this time is a live GTFS-Realtime prediction; FALSE when it is a static scheduled time. The single most important field — never present a FALSE time as a live arrival.'),
    scheduleRelationship: z.string().describe('Schedule relationship: STATIC (static-schedule trip, no real-time overlay), SCHEDULED (real-time covered, currently on time), ADDED, CANCELED, UNSCHEDULED, or DUPLICATED. STATIC is the common non-RT value; SCHEDULED indicates RT overlay is active. CANCELED ⇒ trip not running even if it appears in the schedule.'),
    scheduledTime: z.string().describe('Scheduled departure as an ISO 8601 timestamp with the stop\'s UTC offset (e.g. "2026-06-13T16:21:07-04:00").'),
    estimatedTime: z.string().nullable().describe('Predicted departure (ISO 8601 with offset) when realtime=true. Null when scheduled-only.'),
    delaySeconds: z.number().nullable().describe('Predicted delay in seconds: positive = late, negative = early. Null when no real-time data backs this departure.'),
    headsign: z.string().nullable().describe('Trip or stop headsign (the destination shown on the vehicle, e.g. "14 ST via 7 AV"). Null when omitted.'),
    route: z.object({
      onestopId: z.string().describe('Route Onestop ID (e.g. "r-dr72h-m7"). Use with transitland_find_routes.'),
      shortName: z.string().nullable().describe('Route short name/number (e.g. "M7").'),
      longName: z.string().nullable().describe('Route long name.'),
      mode: z.string().describe('Human-readable mode from route_type (bus, subway, rail, ferry, …).'),
      color: z.string().nullable().describe('Route brand color hex without "#".'),
    }).describe('The route this departure serves.'),
    operatorName: z.string().nullable().describe('Operating agency name.'),
    tripId: z.string().nullable().describe('GTFS trip_id (feed-local). Identifies the specific scheduled trip.'),
    directionId: z.number().nullable().describe('GTFS direction_id (0 or 1), distinguishing the two directions of travel. Null when omitted.'),
    wheelchairAccessible: z.enum(['accessible', 'not_accessible', 'unknown']).describe('Trip-level wheelchair accessibility, where the feed states it.'),
  })).describe('Upcoming departures ordered by departure time. A mix of realtime=true and realtime=false entries is normal — only the GTFS-RT-covered trips carry predictions.'),
  realtimeAvailable: z.boolean().describe('True when at least one departure carried a real-time prediction — i.e. this stop\'s feed publishes GTFS-RT. False ⇒ all times are scheduled.'),
})
```

**Enrichment block:**

```ts
enrichment: {
  totalCount: z.number().describe('Number of departures returned (the API caps server-side; this is the count in the window).'),
  truncated: z.boolean().optional().describe('True when departures were capped at the limit.'),
  shown: z.number().optional().describe('Number of departures returned.'),
  cap: z.number().optional().describe('The limit applied.'),
  notice: z.string().optional().describe('Guidance when empty — e.g. "No departures in the next 3600s; widen next_seconds or set use_service_window=true. A station may have no direct departures — try a child platform."'),
}
```

**Error contract:**

```ts
errors: [
  { reason: 'stop_not_found', code: JsonRpcErrorCode.NotFound,
    when: 'The stops array in the API response is empty for the given Onestop ID or internal ID — the API returns HTTP 200 + {"stops":[]} (not a 404) when the stop does not exist. The handler must detect this from the empty stops array, not from an HTTP status.',
    recovery: 'Verify the ID (e.g. "s-9q8yyw3xjw-powell") or locate the stop with transitland_find_stops.' },
  { reason: 'rate_limited', code: JsonRpcErrorCode.ServiceUnavailable, retryable: true,
    when: 'Transitland returned HTTP 429',
    recovery: 'Wait a few seconds and retry; the free key is rate-limited.' },
]
```

> **IMPLEMENTATION NOTE:** `GET /stops/{key}/departures` returns `HTTP 200` with `{"stops":[]}` for both a valid stop with no departures AND a nonexistent stop. The handler must distinguish these: a valid stop Onestop ID with no departures in the window → return `departures: []` + enrichment notice; an ID that produced no stop record at all (empty stops array on a well-formed Onestop ID like `s-INVALID-notexist`) → throw `stop_not_found`. Strategy: validate that the input is a well-formed Onestop ID (`s-` prefix) or internal int, and treat a completely absent stop record as not found. A pre-flight GET /stops/{key} is an option but costs a round-trip — alternatively, trust the shape: a populated stops entry (even with 0 departures) is valid; a completely absent stops array on a formatted ID is not-found.

Empty departures is **not** an error — the handler returns `departures: []`, `realtimeAvailable: false`, and an actionable `ctx.enrich.notice(...)` covering the widen-window / child-platform recoveries (the most common real-world cause of an empty result, confirmed during probing on the SF Bay 511 regional feed).

**Annotations:** `readOnlyHint: true`, `openWorldHint: true`

---

## Workflow Analysis

`get_departures` is a single upstream call, but the server's value is the **chained** workflows agents assemble. Documenting them drives the cross-tool guidance baked into descriptions.

### "When's the next departure near me / in <city>?"

| # | Tool | Purpose |
|:--|:-----|:--------|
| 1 | `openstreetmap_geocode` (OSM server) | "Powell St, San Francisco" → `{lat, lon}` |
| 2 | `transitland_find_stops` | coordinates + small radius → stop Onestop IDs (pick a platform, location_type 0) |
| 3 | `transitland_get_departures` | stop Onestop ID → scheduled + real-time departures |

### "Where do I get <city>'s transit data, and may I use it?"

| # | Tool | Purpose |
|:--|:-----|:--------|
| 1 | `openstreetmap_geocode` | city → coordinates |
| 2 | `transitland_find_operators` | coordinates → operators serving the area, each with its feed Onestop IDs |
| 3 | `transitland_find_feeds` | `operator_onestop_id` → fetch URLs + license terms + freshness |

### "Transit profile for a place" (the moonshot, assembled by the agent from the surface)

| # | Tool | Purpose |
|:--|:-----|:--------|
| 1 | `openstreetmap_geocode` | place → coordinates |
| 2 | `transitland_find_operators` | who runs transit here |
| 3 | `transitland_find_feeds` (per operator) | open-data sources + licenses |
| 4 | `transitland_find_routes` | headline routes near the center |
| 5 | `transitland_find_stops` → `transitland_get_departures` | live departures at the nearest hub |

A consolidated single-call "place profile" workflow tool was considered and **deferred** (logged) — it would fan out 4–5 upstream calls with branchy failure modes, and the chain is already legible from the individual tools. Revisit if agents repeatedly assemble it by hand.

---

## Design Decisions

**Six tools, REST-shaped.** The surface mirrors Transitland's resource hierarchy (operators, feeds, routes, stops, departures) because that hierarchy *is* the user's mental model — "who runs transit here → where's their data → what routes/stops → when's the next one." No multi-source aggregation (single upstream), no mode-consolidation (the five nouns are genuinely distinct operations with different inputs).

**Onestop IDs are the surfaced identity, internal IDs accepted on input.** Every ID-bearing input accepts both forms (Transitland's `{key}` path params and `ids`/`*_onestop_id` filters take either); every output surfaces the Onestop ID. Onestop IDs are stable, public, and human-legible (`o-9q9-bart`); internal integers are deployment-mutable and meaningless across instances. This is the single most important output convention.

**Geocode-via-openstreetmap is a hard dependency, surfaced in every geography tool.** Transitland never accepts place names. Rather than silently returning nothing when an agent passes "Seattle", every geography-capable tool's description names `openstreetmap_geocode` as the required pre-step, and a `no_filter`/empty-result `notice` repeats it. The two servers compose: OSM resolves place → coordinates, Transitland resolves coordinates → transit.

**The feed registry leads.** `find_feeds` is the one capability no other fleet server has — license + fetch URL + freshness for open transit data. Its description and output lean into "where do I legally get this data and on what terms." License fields are normalized to explicit `yes`/`no`/`unknown` (or null) and the schema descriptions forbid inferring a permissive license from a blank registry field — honesty about uncertainty over fabricated confidence.

**Scheduled-vs-real-time is explicit per departure.** `get_departures` sets a `realtime` boolean and surfaces `schedule_relationship` on every entry, plus a top-level `realtimeAvailable`. A static timetable time and a GTFS-RT prediction look identical to an agent unless the server distinguishes them — so it does, structurally, not just in prose. Confirmed against a live GTFS-RT feed (NYC MTA): `estimated`/`estimated_delay` present ⇒ real-time; absent ⇒ scheduled.

**Direct HTTP client, no SDK.** Transitland publishes no maintained TypeScript SDK; the REST surface is a few GET endpoints with a flat query-param contract. A direct client (framework `fetchWithTimeout` + `withRetry`) is simpler than wrapping a generated client and adds no dependency.

**`meta.next` is never surfaced.** The pagination `meta.next` URL embeds the apikey in plaintext (verified). The service returns only the opaque integer `after` cursor; surfacing `next` would leak the key to the agent/client and into logs.

**Feed-version history is sliced to latest.** The feeds endpoint returns the entire `feed_versions` array by default (167 entries for BART). The service requests the latest version only — freshness is the agent-relevant signal, not a multi-year fetch log.

**Geometry omitted by default.** Operator/agency coverage polygons and route/stop line geometry are large coordinate arrays with no agent decision value. Output carries a compact `place` summary (country/region/city) instead. A future `include_geometry` opt-in can add it for mapping use cases.

**Routes-serving-a-stop deferred on the stop record.** Transitland doesn't return serving routes on `/stops` by default (requires an include). v1 keeps stops lean and points the agent at `find_routes` near the same coordinates. Add `served_routes` later if the round-trip proves common.

**`find_feeds` requires a filter.** An unfiltered feeds query returns a global firehose. The `no_filter` contract forces at least one filter (operator/spec/search/fetch_error) so the agent gets a useful slice.

**No prompts; two resources.** Pure data lookup — no recurring analysis template earns a prompt. Operators and feeds get resources (`transitland://operator/{onestop_id}`, `transitland://feed/{onestop_id}`) because they're durable ID-addressable entities; stops/routes are geography-discovered in bulk and get none.

---

## Known Limitations

- **No geocoding.** Transitland takes coordinates/bbox only. Place-name resolution is delegated to `openstreetmap_geocode`. An agent that passes a city name to a geography tool gets an `invalid_params` error or empty result with a geocode-first notice — by design.
- **Real-time only where GTFS-RT exists.** The vast majority of feeds are static GTFS. `get_departures` returns scheduled times for those; `realtime` is `false` and `delaySeconds` is null. The presence of a GTFS-RT feed (visible in `find_feeds` `realtimeUrls` / a `GTFS_RT` spec entry on the operator) is the prerequisite for live predictions.
- **Departures attach to platform stops.** A parent station (location_type 1) can return zero departures; the child platform (location_type 0) carries them. Some feeds also only expose times inside their service window — confirmed during probing, where the SF Bay 511 regional feed returned no departures at several stations until queried at a leaf platform on a GTFS-RT-backed feed (NYC MTA). The empty-result notice surfaces both recoveries.
- **License fields are frequently blank.** Free-tier and minimal feeds leave most license fields empty in the registry. The server normalizes blanks to `unknown`/null and never infers terms. Treat `unknown` as "confirm against the license URL before redistributing," not "permissive."
- **Feed radius search is coarse.** A feed's geometry spans its entire coverage area, so radius/bbox filtering on `/feeds` returns broad, sometimes surprising matches (an SF query surfaced a Sydney feed during probing). Discover feeds by `operator_onestop_id` for precision; the tool description says so.
- **`served_by` filter semantics are narrow.** The stops `served_by_onestop_ids` filter expects operator/route Onestop IDs and didn't reliably match on a bare operator ID alone during probing. Pair it with geography rather than relying on it standalone.
- **Free-tier rate limits.** Bursty multi-call workflows (the "place profile" chain) can hit 429 on a free key. Surfaced as a retryable `rate_limited` error; a Pro key raises the quota. Relevant for hosting (the server runs on its own key).
- **GraphQL-only depth is out of scope.** Deep nested joins (e.g. full stop→route→trip→shape traversals) are better served by Transitland's GraphQL endpoint (`/api/v2/query`), which the REST tools don't expose. Documented as an escape hatch, not a tool.

---

## API Reference

### Base, auth, pagination

| Aspect | Value |
|:-------|:------|
| Base URL | `https://transit.land/api/v2/rest` (override via `TRANSITLAND_BASE_URL`) |
| Auth | `apikey` **query parameter** (header `apikey` also accepted). **Not** an `Authorization` header. |
| Pagination | Cursor: response `meta.after` (integer) + `meta.next` (URL — **discard, leaks apikey**). Send `after=<int>` for the next page. `limit` caps page size. |
| Error envelope | JSON `{"error": "<message>"}`. Observed: 404 `{"error":"not found"}`, 401 `{"error":"Unauthorized"}`. |
| Rate limit | Free tier limited (429 on burst); Pro raises quota. |

### Endpoints used

| Endpoint | Tool | Key params |
|:---------|:-----|:-----------|
| `GET /operators` | `find_operators` | `search`, `lat`,`lon`,`radius`, `bbox`, `onestop_id`, `adm0_name`, `adm1_name`, `limit`, `after` |
| `GET /operators/{key}` | `get_operator` | path `{key}` = Onestop ID or int ID |
| `GET /feeds` | `find_feeds` | `spec`, `search`, `fetch_error`, `feed_versions.limit=1`, `limit`, `after` (no operator filter — `operator_onestop_id` is satisfied by resolving the operator record's feeds via `GET /operators/{key}` then `GET /feeds/{key}` per feed) |
| `GET /feeds/{key}` | feed resource | path `{key}` |
| `GET /routes` | `find_routes` | `lat`,`lon`,`radius`, `bbox`, `operator_onestop_id`, `onestop_id`, `route_type`, `search`, `limit`, `after` |
| `GET /stops` | `find_stops` | `lat`,`lon`,`radius`, `bbox`, `onestop_id`, `served_by_onestop_ids`, `search`, `limit`, `after` |
| `GET /stops/{key}/departures` | `get_departures` | path `{key}`; `next` (seconds window; both `next` and `next_seconds` accepted by the API — use `next`), `service_date`, `use_service_window`, `limit` |

### GTFS `route_type` → mode label

| route_type | mode |
|:--|:--|
| 0 | tram |
| 1 | subway |
| 2 | rail |
| 3 | bus |
| 4 | ferry |
| 5 | cable tram |
| 6 | aerial lift |
| 7 | funicular |
| 11 | trolleybus |
| 12 | monorail |
| other | `type N` |

(Extended GTFS route types in the 100–1700 range exist; map the common ones above and fall back to `type N` for the rest.)

### GTFS enum mappings

| Field | Mapping |
|:--|:--|
| `location_type` | 0 stop · 1 station · 2 entrance · 3 node · 4 boarding area |
| `wheelchair_boarding` / `wheelchair_accessible` | 0 unknown · 1 accessible · 2 not_accessible |
| `schedule_relationship` | SCHEDULED · ADDED · CANCELED · UNSCHEDULED · DUPLICATED (surfaced verbatim) |

### Onestop ID prefixes

| Prefix | Entity | Example |
|:--|:--|:--|
| `o-` | Operator | `o-9q9-bart` |
| `f-` | Feed | `f-9q9-bart` |
| `r-` | Route | `r-9q9p-800` |
| `s-` | Stop | `s-9q8yyw3xjw-powell` |

The geohash segment (`9q9`) encodes location; it makes IDs roughly sortable by geography but is not something tools parse.

---

## Decisions Log

| Date | Decision | Rationale |
|:-----|:---------|:----------|
| 2026-06-13 | Six REST-shaped tools mirroring the operator→feed→route→stop→departure hierarchy | The hierarchy is the user's mental model; no aggregation or mode-consolidation needed for a single flat-contract upstream. |
| 2026-06-13 | Surface Onestop IDs everywhere; accept Onestop or internal int IDs on input | Onestop IDs are stable, public, legible across deployments; internal integers are instance-mutable and meaningless across instances. |
| 2026-06-13 | `find_feeds` is the lead capability; license normalized to yes/no/unknown, never inferred | The open-data catalog (fetch URL + license + freshness) is unique to Transitland in the fleet; blank registry fields must read as "unknown," not fabricated permissive terms. |
| 2026-06-13 | `get_departures` sets per-departure `realtime` + `schedule_relationship` + top-level `realtimeAvailable` | A scheduled time and a GTFS-RT prediction are indistinguishable to an agent unless the server marks them; confirmed `estimated`/`estimated_delay` present-iff-RT against NYC MTA live data. |
| 2026-06-13 | Geocode-via-`openstreetmap_geocode` named in every geography tool description + empty-result notice | Transitland never accepts place names; surfacing the dependency prevents the silent-empty failure when an agent passes a city name. |
| 2026-06-13 | Direct HTTP client, no SDK | No maintained TS SDK exists; the REST surface is a few GETs with flat query params — a direct client is simpler and dependency-free. |
| 2026-06-13 | Never surface `meta.next`; return only the integer `after` cursor | The `meta.next` URL embeds the apikey in plaintext (verified) — leaking it to the client/logs is a credential exposure. |
| 2026-06-13 | Slice feeds to the latest `feed_version` (`feed_versions.limit=1`) | Default response returns the entire version history (167 entries for BART); only current freshness is agent-relevant. |
| 2026-06-13 | Omit geometry (coverage polygons, route/stop lines); surface a compact place summary | Large coordinate arrays with no agent decision value; a country/region/city summary is enough. A future `include_geometry` opt-in can add it. |
| 2026-06-13 | Fold route/stop `get` into `find` with an `onestop_id` filter; keep `get` only for operators (+ feed/operator resources) | A route/stop is discovered in bulk by geography and its find-output already carries the full record; operators/feeds are durable ID-first entities worth a dedicated fetch + resource. |
| 2026-06-13 | `find_feeds` requires ≥1 filter (`no_filter` contract) | An unfiltered feeds query is a global firehose; forcing a filter yields a useful paginated slice. |
| 2026-06-13 | Truncation fields (`truncated`/`shown`/`cap`) in `enrichment`, optional; `totalCount` always via `ctx.enrich.total()` | The framework only populates truncation fields when the cap is hit — declaring them required throws -32007 on every non-truncated result; `totalCount` is the always-present honest-disclosure field that satisfies `capped-list-no-truncation`. |
| 2026-06-13 | Empty results (no operators / no departures) return data + `ctx.enrich.notice`, not an error | "Nothing here" is a valid answer; the notice carries the actionable recovery (geocode-first, widen window, child platform) without forcing an error path. |
| 2026-06-13 | Defer a consolidated "place profile" workflow tool | A 4–5-call fan-out with branchy failure modes; the chain is already legible from individual tools. Revisit if agents assemble it by hand repeatedly. |
| 2026-06-13 | Defer `served_routes` on the stop record | Transitland requires an include for serving routes on `/stops`; v1 keeps stops lean and points at `find_routes`. Add if the round-trip proves common. |
| 2026-06-13 | Display identity is the hyphenated machine name `transitland-mcp-server` (createApp `title`, manifest `display_name`) | Fleet identity rule — humans and agents both see the machine name; never Title Case. |
| 2026-06-13 | GraphQL endpoint (`/api/v2/query`) documented as an out-of-scope escape hatch | REST serves the tool-shaped queries; deep nested joins drop to GraphQL, but the MCP surface stays REST-shaped. |
| 2026-06-13 | `schedule_relationship` values are `STATIC` (no RT) and `SCHEDULED` (RT overlay), plus mutation states `ADDED`/`CANCELED`/`UNSCHEDULED`/`DUPLICATED` | Verified against NYC MTA GTFS-RT feed. `STATIC` (not `SCHEDULED`) is the common value for non-RT trips — distinguishing `STATIC` vs `SCHEDULED` is the primary RT indicator, confirmed from live API. |
| 2026-06-13 | `GET /stops/{key}/departures` returns HTTP 200 + `{"stops":[]}` for nonexistent stops — not a 404 | Verified with `s-INVALID-notexist`. The `stop_not_found` error must be detected by the handler from the empty stops array, not from an HTTP error code. Empty stops array on a well-formed input ID = not-found; on an unformatted/invalid ID = validation error. |
| 2026-06-13 | `no_filter` contracts on operators/routes/stops/feeds are server-enforced guards, not API behavior | The upstream API accepts unfiltered requests on all endpoints (verified). The guards exist to prevent global dumps and force agents toward useful, scoped queries. |
| 2026-06-13 | The API accepts both `next` and `next_seconds` as the departures look-ahead parameter; use `next` in the service layer | Both param names work against the live API. Tool input is `next_seconds` (descriptive) but the service layer sends `next` (canonical API param). |
| 2026-06-14 | `GET /feeds` has NO operator filter (field-test finding); `find_feeds` resolves `operator_onestop_id` by fetching the operator record's feed Onestop IDs, then each feed by `onestop_id` | Verified against the live API and the official `/feeds` docs: `operator_onestop_id` (and every operator-scoping variant) is silently ignored — the param is dropped and the unfiltered global feed list returned. The operator→feeds relationship lives only on the operator record (`operator.feeds[]`), whose refs are sparse (`onestop_id`/`spec`/`name`, no license/urls), so each resolved feed is re-fetched via `GET /feeds/{key}` for the full license/url/freshness payload. `spec` narrows the resolved set client-side; `search`/`fetch_error`/`after` don't apply to it. |
| 2026-06-14 | Single-record 404s (`GET /operators/{key}`, `GET /feeds/{key}`) carry the caller's contract reason + a clean ID-named message (field-test finding) | Verified: an absent operator/feed key returns HTTP 404 + `{"error":"not found"}` (NOT a 200 + empty array — only `/departures` does that). The service's `classifyFetchError` was producing a generic `notFound` that leaked the endpoint path and dropped the declared `operator_not_found`/`feed_not_found` reason, making those contract entries dead. The 404 path now threads the contract reason + recovery and names the caller's ID, never the internal path. |

---

## Review pass

**Reviewer:** Independent design review (2026-06-13). Changes made directly to this file.

### Changes applied

| # | Area | Finding | Fix |
|:--|:-----|:--------|:----|
| 1 | Verified Response Shapes — Departures | `schedule_relationship` comment listed `SCHEDULED | ADDED | CANCELED | UNSCHEDULED | DUPLICATED` but omitted `STATIC`. Live API returns `STATIC` for all non-RT static-schedule trips; `SCHEDULED` for RT-covered trips. `STATIC` is the most common value in any feed without GTFS-RT. | Added `STATIC` to the enum comment in the response shape. |
| 2 | Tool Specs — `get_departures` real-time note | The "The real-time test" paragraph mentioned `CANCELED`/`ADDED` as surfaced relationships but gave no explanation of `STATIC` vs `SCHEDULED` — which is the actual primary RT indicator. Implementors would have built the wrong classifier. | Rewrote the real-time paragraph to explain `STATIC` = no RT overlay, `SCHEDULED` = RT active. |
| 3 | Tool Specs — `get_departures` output schema | `scheduleRelationship` described as `SCHEDULED, ADDED, CANCELED, UNSCHEDULED, or DUPLICATED` — wrong, `STATIC` was absent. | Updated `.describe()` text to list all six observed values with correct semantics. |
| 4 | Tool Specs — `get_departures` error contract (`stop_not_found`) | The error's `when` clause implied it triggers on a 404. The API returns HTTP 200 + `{"stops":[]}` for nonexistent stops (verified: `s-INVALID-notexist` → `{"stops":[]}` with HTTP 200). An implementation watching for a 404 would never throw `stop_not_found` — all invalid stop IDs would silently return empty departures. | Rewrote `when` clause to name the HTTP 200 + empty-array behavior, and added an IMPLEMENTATION NOTE explaining the detection strategy. |
| 5 | Tool Specs — `find_feeds` `spec` enum | The input enum `['gtfs', 'gtfs-rt', 'gbfs', 'mds']` is lowercase; API output is always uppercase (`GTFS`, `GTFS_RT`, `GBFS`, `MDS`). No note on the mismatch — an implementor reading the output schema would find `spec: z.string()` and see `GTFS_RT` in the actual response, but nothing in the input enum description warned them the shapes differ. | Added a note to the `.describe()` text clarifying that the API accepts both cases on input, and output is always uppercase. |
| 6 | Tool Specs — `no_filter` error contracts | Three tools (`find_operators`, `find_routes`, `find_stops`) and `find_feeds` declare `no_filter` errors. The upstream API accepts all four endpoints with no filters (verified with live requests — all returned data). The error contracts as written implied this was an API constraint, which would have caused confusion when the service layer implemented it. | Clarified `when` text on each `no_filter` entry: "server-enforced guard — the API accepts unfiltered requests." |
| 7 | Implementation Order | Listed `createApp()` identity as `name`/`title` = `transitland-mcp-server`, `websiteUrl` the repo. Fleet identity rule: `createApp()` identity block is `name` + `title` ONLY — no `websiteUrl`/`description` (those belong in `package.json`/`server.json`). | Fixed the Implementation Order step to state `name` + `title` ONLY. |
| 8 | API Reference — departures endpoint | Listed params as `next(seconds)`. Both `next` and `next_seconds` work (verified), but the canonical API param is `next`. The tool input parameter is named `next_seconds` (for clarity), but the service layer must send `next`. The reference was ambiguous about which name the service sends. | Updated the API Reference table row to note both names are accepted; service sends `next`. |
| 9 | Decisions Log | Key live-API findings were not yet captured. | Added four new decision rows: `schedule_relationship` values, stop-not-found HTTP 200 behavior, `no_filter` server-enforcement, and `next`/`next_seconds` param aliasing. |

### Items confirmed correct (no change needed)

- **`meta.next` apikey leak** — verified: the `meta.next` URL in route responses embeds the apikey in plaintext (e.g., `https://transit.land/api/v2/rest/routes?after=…&apikey=<KEY>&…`). The design's requirement to discard `meta.next` and return only `after` is correct.
- **`truncated`/`shown`/`cap` as `.optional()` in enrichment** — correctly handled. Required truncation fields cause systemic -32007 on every non-truncated result; the design already calls them optional.
- **`totalCount` always present via `ctx.enrich.total()`** — correctly specified.
- **Error shapes** — `{"error":"Unauthorized"}` (401) and `{"error":"not found"}` (404) verified for operator/feed GET endpoints.
- **`served_by_onestop_ids` param name** — verified correct for stops endpoint.
- **`operator_onestop_id` param for routes** — verified: correct param name, returns results.
- **`feed_versions.limit=1` efficiency** — response shape confirmed: the default returns full history (167 entries for BART); slicing to 1 is correct.
- **`spec` API accepts lowercase** — `gtfs`, `gtfs-rt`, `gbfs` all return results; uppercase also accepted. Input enum of lowercase values is fine.
- **Tool count and resource count** — 6 tools (including `get_operator`), 2 resources. Design says "All six tools" in the services section; count is accurate.
- **Geocode-delegation to openstreetmap** — correct; Transitland does not geocode place names (verified: no geocoding param exists on any endpoint).
