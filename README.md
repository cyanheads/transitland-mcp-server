<div align="center">
  <h1>@cyanheads/transitland-mcp-server</h1>
  <p><b>Global transit data from the Transitland v2 registry — operators, GTFS/GTFS-RT/GBFS feeds with license terms, routes, stops, and real-time-aware departures via MCP. STDIO or Streamable HTTP.</b>
  <div>6 Tools • 2 Data Resources • 1 Skill</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.2.0-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/transitland-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.4.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/transitland-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/transitland-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.4.4-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/transitland-mcp-server/releases/latest/download/transitland-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=transitland-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvdHJhbnNpdGxhbmQtbWNwLXNlcnZlciJdLCJlbnYiOnsiVFJBTlNJVExBTkRfQVBJX0tFWSI6InlvdXItYXBpLWtleSJ9fQ==) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22transitland-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Ftransitland-mcp-server%22%5D%2C%22env%22%3A%7B%22TRANSITLAND_API_KEY%22%3A%22your-api-key%22%7D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

---

## Overview

Transit data for thousands of operators worldwide from Transitland, the open aggregator of GTFS, GTFS-Realtime, GBFS, and MDS feeds. Find operators and their feeds, and look up routes, stops, departures, and service alerts.

### Tools

| Tool | Description |
|:---|:---|
| `transitland_find_operators` | Find transit operators/agencies by name, point/radius, bounding box, country/region, or Onestop ID |
| `transitland_get_operator` | Fetch the full operator record by Onestop ID — agencies, feeds, and source tags |
| `transitland_find_feeds` | Find GTFS, GTFS-Realtime, GBFS, and MDS feeds with fetch URLs, license terms, and feed version metadata |
| `transitland_find_routes` | Find routes by point/radius, bounding box, operator, Onestop ID, or GTFS mode |
| `transitland_find_stops` | Find stops/stations by name, point/radius, bounding box, Onestop ID, or operator network |
| `transitland_get_departures` | Stop and station departures with platform, real-time predictions, and service alerts |

For geography filters, resolve place names to coordinates with `openstreetmap_search_places` from [`openstreetmap-mcp-server`](https://github.com/cyanheads/openstreetmap-mcp-server).

### Resources

| Resource | Description |
|:---|:---|
| `transitland://operator/{onestop_id}` | Operator record by Onestop ID — agencies, places served, published feeds, and source tags |
| `transitland://feed/{onestop_id}` | Feed record by Onestop ID — spec, fetch URL, license terms, and freshness |

All resource data is also reachable via tools (`transitland_get_operator`, `transitland_find_feeds`).

The [transitland guide](./skills/transitland-guide/SKILL.md) covers station and platform selection, overnight service days, alert scope, and feed reuse checks. It ships with plugin, npm, Docker, and MCPB installs and is available over MCP as `skill://transitland-guide/SKILL.md`.

## Capability reference

Page limits default to 20 and are capped at 100. A larger `limit` is clamped with a notice. Pages that reach the limit carry `truncated`, `shown`, and `cap`. When `cursor` is present, pass it as `after` with the same filters. An empty continuation means the listing is exhausted.

The geography tools accept `bbox` in `minLon,minLat,maxLon,maxLat` order. Longitude must be within ±180, latitude within ±90, and each minimum must be at most its maximum. A box and a point/radius can be combined to search their intersection.

### `transitland_find_operators` <sub>tool</sub>

- Filter by `search` (name), `lat`+`lon`+`radius` (max 100,000m, default 1,000m), `bbox`, `onestop_id`, or `adm0_name`/`adm1_name` (country/region) — at least one required, or the call fails as `no_filter`
- `lat` requires `lon` and vice versa, or the call fails as `incomplete_point`
- Use an operator Onestop ID (e.g. `o-9q9-bart`). A numeric ID filter returns an empty page with guidance.
- Returns each operator's Onestop ID, name, places served, published feeds (a `GTFS_RT` entry signals real-time departures may be available), and Wikidata QID

---

### `transitland_get_operator` <sub>tool</sub>

- Accepts an operator Onestop ID (e.g. `o-9q9-bart`)
- Returns agencies (each with places served), published feeds, and source tags: Wikidata QID, US NTD ID, general Twitter/X handle
- `operator_not_found` for unknown or numeric IDs

---

### `transitland_find_feeds` <sub>tool</sub>

- Supply at least one filter. Use `onestop_id` for one exact feed Onestop ID or positive internal feed ID as a string. Combine it with `operator_onestop_id`, `spec` (`gtfs`, `gtfs-rt`, `gbfs`, `mds`, or variants such as `GTFS_RT`), `search`, or `fetch_error`.
- Operator scope applies the other filters before the limit and returns one page in operator feed order. Use an operator Onestop ID. A numeric or unknown operator key returns `operator_not_found`. Supplying `after` in this scope produces a notice.
- Each feed includes its download or discovery URL, any GTFS-Realtime endpoints, and its selected version’s recorded fetch timestamp, hash, and calendar window.
- License terms include redistribution, commercial use, derived products, share-alike, and attribution requirements as `yes`/`no`/`unknown`, plus SPDX identifier, attribution text, and attribution instructions where recorded.
- `authorizationRequired` flags feeds whose download needs a separate key or registration

---

### `transitland_find_routes` <sub>tool</sub>

- Filter by `lat`+`lon`+`radius` (max 50,000m, default 1,000m), `bbox`, `operator_onestop_id`, `onestop_id`, `route_type` (GTFS mode integer), or `search` — at least one required
- `lat` requires `lon` and vice versa, or the call fails as `incomplete_point`
- `onestop_id` also accepts an internal route ID as a string and combines with other filters. Use the returned `feedOnestopId` as `onestop_id` in `transitland_find_feeds` to look up its source feed.
- Returns short/long name, GTFS mode (bus, subway, rail, ferry, tram, …), brand color, and the operating agency's and source feed's Onestop IDs. A missing route type is `null` with mode `unknown`
- Scheduled (GTFS static) route definitions, not live vehicle positions

---

### `transitland_find_stops` <sub>tool</sub>

- Filter by `lat`+`lon`+`radius` (max 10,000m, default 500m), `bbox`, `onestop_id`, `served_by_onestop_ids` (comma-separated operator/route Onestop IDs), or stop-name `search` — at least one required. Name searches need no geocoding
- `onestop_id` also accepts an internal stop ID as a string and combines with other filters.
- Returns location type, coordinates, accessibility, timezone, and source feed Onestop ID, plus separate stop code, platform code, and description fields when published.
- Use a station ID or a stop's `parentOnestopId` for station-wide departures. A platform ID scopes the lookup to that platform.

---

### `transitland_get_departures` <sub>tool</sub>

- Find a stop or station with `transitland_find_stops`, then pass its Onestop ID as `stop_key`. An internal stop ID also works. An unknown stop returns `stop_not_found`.
- `next_seconds` sets the window from now (60–86,400 seconds, default 3,600). Set `service_date` to start at the service day's first departure, or add `start_time` in GTFS `HH:MM:SS` to start a `next_seconds` window at that time. GTFS hours can exceed 23. Set `use_service_window: true` to allow a typical-service fallback.
- Station results include departures from the station and its returned children, ordered by estimated time when available and scheduled time otherwise, with a single limit. Each row identifies the boarding location in `platform` and carries the upstream `serviceDate` when available.
- Each departure includes its route, trip, headsign, scheduled and estimated times, delay, `realtime`, and `scheduleRelationship`. `realtimeAvailable` is true when a returned row carries a live prediction.
- Top-level `alerts` cover the queried stop and its returned children, including entrances. A departure's optional `alerts` cover that trip. Stop alerts can be present on an empty departure list.

---

### `transitland://operator/{onestop_id}` <sub>resource</sub>

- Mirrors `transitland_get_operator` — agencies, places served, published feeds, and source tags
- Use an operator Onestop ID (e.g. `o-9q9-bart`). Unknown and numeric IDs return `operator_not_found`.

---

### `transitland://feed/{onestop_id}` <sub>resource</sub>

- Mirrors a single-feed result from `transitland_find_feeds` — spec, fetch URL, real-time endpoints, license terms, and freshness
- `onestop_id` accepts a feed Onestop ID (e.g. `f-9q9-bart`) or internal integer ID; `feed_not_found` when it doesn't resolve
- Blank license fields come back as `unknown`/null, never inferred as permissive

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core): stdio and Streamable HTTP transports, pluggable auth (`none` / `jwt` / `oauth`), swappable storage (`in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`), structured logging with optional OpenTelemetry tracing.

Transitland-specific:

- Direct HTTP client for the Transitland v2 REST API — no SDK dependency, a flat query-param contract over a handful of GET endpoints
- Onestop IDs (`o-`/`f-`/`r-`/`s-`) are the public identifiers. Internal ID support is limited to the feed, route, stop, and departure lookups described above.
- Feed lookups return the recorded metadata of the first version supplied by Transitland.
- Coverage polygons and route/stop geometry are omitted; results carry a compact country/region/city place summary instead

Agent-friendly output:

- Real-time status is explicit: per-departure `realtime` and `scheduleRelationship`, plus a top-level `realtimeAvailable`
- Blank license fields come back as `unknown`/null, never inferred as permissive, and agents are told to confirm against the license URL before redistributing
- Upstream pagination URLs embed the API key; only the opaque `after` cursor is surfaced, so the key never reaches tool output or logs
- Empty results include a notice with query guidance or pagination status.

## Getting started

Add the following to your MCP client configuration file. A Transitland API key is required — see [Prerequisites](#prerequisites) for how to get one.

```json
{
  "mcpServers": {
    "transitland-mcp-server": {
      "type": "stdio",
      "command": "bunx",
      "args": ["@cyanheads/transitland-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info",
        "TRANSITLAND_API_KEY": "your-api-key"
      }
    }
  }
}
```

Or with npx (no Bun required):

```json
{
  "mcpServers": {
    "transitland-mcp-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cyanheads/transitland-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info",
        "TRANSITLAND_API_KEY": "your-api-key"
      }
    }
  }
}
```

Or with Docker:

```json
{
  "mcpServers": {
    "transitland-mcp-server": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "MCP_TRANSPORT_TYPE=stdio",
        "-e", "TRANSITLAND_API_KEY=your-api-key",
        "ghcr.io/cyanheads/transitland-mcp-server:latest"
      ]
    }
  }
}
```

For Streamable HTTP, set the transport and start the server:

```sh
MCP_TRANSPORT_TYPE=http MCP_HTTP_PORT=3010 TRANSITLAND_API_KEY=your-api-key bun run start:http
# Server listens at http://localhost:3010/mcp
```

### Prerequisites

- [Bun v1.4.4](https://bun.sh/) or higher (or Node.js v24+).
- A Transitland v2 API key — register at the [Transitland developer portal](https://www.transit.land/documentation). The free tier is rate-limited; the Pro tier raises the quota.

### Installation

1. **Clone the repository:**

```sh
git clone https://github.com/cyanheads/transitland-mcp-server.git
```

2. **Navigate into the directory:**

```sh
cd transitland-mcp-server
```

3. **Install dependencies:**

```sh
bun install
```

4. **Configure environment:**

```sh
cp .env.example .env
# edit .env and set TRANSITLAND_API_KEY
```

## Configuration

All configuration is validated at startup via Zod schemas in `src/config/server-config.ts`. A missing `TRANSITLAND_API_KEY` fails at startup with a banner naming the variable, not at the first tool call.

| Variable | Description | Default |
|:---|:---|:---|
| `TRANSITLAND_API_KEY` | **Required.** Transitland v2 API key, sent as the `apikey` query parameter. | — |
| `TRANSITLAND_BASE_URL` | Transitland REST API base URL. Override to pin a specific deployment or a self-hosted instance. | `https://transit.land/api/v2/rest` |
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http`. | `stdio` |
| `MCP_HTTP_PORT` | Port for the HTTP server. | `3010` |
| `MCP_HTTP_ENDPOINT_PATH` | HTTP endpoint path where the MCP server is mounted. | `/mcp` |
| `MCP_AUTH_MODE` | Authentication mode: `none`, `jwt`, or `oauth`. | `none` |
| `MCP_LOG_LEVEL` | Log level (`debug`, `info`, `notice`, `warning`, `error`). | `info` |
| `LOGS_DIR` | Directory for log files (Node.js only). Relative paths resolve from the server package. Set an absolute path to store logs elsewhere. | `<server-root>/logs` |
| `LOG_TOOL_FAILURE_PAYLOADS` | Log failed calls' arguments and result, redacted by key name (secrets in free-form values remain). Size capped by `LOG_TOOL_FAILURE_PAYLOAD_MAX_BYTES` (default `16384`). | `false` |
| `STORAGE_PROVIDER_TYPE` | Storage backend: `in-memory`, `filesystem`, `supabase`, `cloudflare-kv/r2/d1`. | `in-memory` |
| `OTEL_ENABLED` | Enable [OpenTelemetry instrumentation](https://github.com/cyanheads/mcp-ts-core/tree/main/docs/telemetry) (spans, metrics, completion logs). | `false` |

See [`.env.example`](./.env.example) for the full list of optional overrides.

HTTP sessions are stateless by default; set `MCP_SESSION_MODE` to override.

## Running the server

### Local development

- **Build and run:**

  ```sh
  # One-time build
  bun run rebuild

  # Run the built server
  bun run start:stdio
  # or
  bun run start:http
  ```

- **Run checks and tests:**

  ```sh
  bun run devcheck   # Lint, format, typecheck, security, changelog sync
  bun run test       # Vitest test suite
  bun run lint:mcp   # Validate MCP definitions against spec
  ```

### Docker

```sh
docker build -t transitland-mcp-server .
docker run --rm -e TRANSITLAND_API_KEY=your-key -p 3010:3010 transitland-mcp-server
```

The Dockerfile defaults to HTTP transport, stateless session mode, and logs to `/var/log/transitland-mcp-server`. OpenTelemetry peer dependencies are installed by default — build with `--build-arg OTEL_ENABLED=false` to omit them.

## Project structure

| Directory | Purpose |
|:---|:---|
| `src/index.ts` | `createApp()` entry point — registers tools and resources, inits the Transitland service. |
| `src/config` | Server-specific environment variable parsing and validation with Zod. |
| `src/mcp-server/tools` | Tool definitions (`*.tool.ts`). Six tools across operators, feeds, routes, stops, and departures. |
| `src/mcp-server/resources` | Resource definitions (`*.resource.ts`). Operator and feed records. |
| `src/services/transitland` | Transitland v2 REST client — HTTP, `apikey` injection, cursor normalization, error classification, and per-endpoint typed methods. |
| `tests/` | Unit and integration tests mirroring `src/`. |

## Development guide

See [`CLAUDE.md`](./CLAUDE.md) / [`AGENTS.md`](./AGENTS.md) for development guidelines and architectural rules. The short version:

- Handlers throw, framework catches — no `try/catch` in tool logic
- Use `ctx.log` for request-scoped logging, `ctx.state` for tenant-scoped storage
- Register new tools and resources via the barrels in `src/mcp-server/*/definitions/index.ts`
- Wrap the Transitland API: validate raw → normalize to domain type → return output schema; never fabricate missing fields (especially license terms — blanks are `unknown`, not permissive)

## Data & licensing

Transit data is provided by [Transitland](https://www.transit.land/terms) — an open registry aggregating GTFS, GTFS-Realtime, and GBFS feeds from thousands of operators worldwide. Products built on Transitland data must display the name "Transitland" with a link to [transit.land/terms](https://www.transit.land/terms), clearly visible to end users.

Transitland aggregates feeds from thousands of operators, each of which may carry its own license and attribution requirements. Review the per-feed license terms at [transit.land/terms](https://www.transit.land/terms) and comply with each source feed's requirements before redistributing or publishing data obtained through this server.

## Contributing

Issues are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
