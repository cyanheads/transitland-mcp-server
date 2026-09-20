<div align="center">
  <h1>@cyanheads/transitland-mcp-server</h1>
  <p><b>Global transit data via the Transitland v2 registry — operators, GTFS/GTFS-RT/GBFS feeds with license terms, routes, stops, and real-time-aware departures via MCP. STDIO or Streamable HTTP.</b>
  <div>6 Tools • 2 Resources</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.1.2-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/transitland-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.0.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/transitland-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/transitland-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.4.0-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/transitland-mcp-server/releases/latest/download/transitland-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=transitland-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvdHJhbnNpdGxhbmQtbWNwLXNlcnZlciJdLCJlbnYiOnsiVFJBTlNJVExBTkRfQVBJX0tFWSI6InlvdXItYXBpLWtleSJ9fQ==) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22transitland-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Ftransitland-mcp-server%22%5D%2C%22env%22%3A%7B%22TRANSITLAND_API_KEY%22%3A%22your-api-key%22%7D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

---

## Overview

Transit data from the Transitland v2 registry — the open aggregator of GTFS, GTFS-Realtime, and GBFS feeds from thousands of transit operators worldwide. Find operators, discover feeds and their license terms, and look up routes, stops, and real-time-aware departures from any MCP client. Runs as a stdio process or a local Streamable HTTP server.

### Tools

| Tool | Description |
|:---|:---|
| `transitland_find_operators` | Find transit operators/agencies by name, point/radius, bounding box, country/region, or Onestop ID |
| `transitland_get_operator` | Fetch the full operator record by Onestop ID — agencies, feeds, and source tags |
| `transitland_find_feeds` | Discover GTFS, GTFS-Realtime, and GBFS feeds — fetch URLs, license terms, and freshness |
| `transitland_find_routes` | Find routes by point/radius, bounding box, operator, Onestop ID, or GTFS mode |
| `transitland_find_stops` | Find stops/stations by point/radius, bounding box, Onestop ID, or operator network |
| `transitland_get_departures` | Departures from a stop, each flagged `realtime` true/false |

Transitland does not geocode place names — resolve a location to coordinates with a geocoding MCP server (e.g. [`openstreetmap-mcp-server`](https://github.com/cyanheads/openstreetmap-mcp-server)'s `openstreetmap_geocode`) before calling a geography-filtered tool.

### Resources

| Resource | Description |
|:---|:---|
| `transitland://operator/{onestop_id}` | Operator record by Onestop ID — agencies, places served, published feeds, and source tags |
| `transitland://feed/{onestop_id}` | Feed record by Onestop ID — spec, fetch URL, license terms, and freshness |

All resource data is also reachable via tools (`transitland_get_operator`, `transitland_find_feeds`).

## Capability reference

### `transitland_find_operators` <sub>tool</sub>

- Filter by `search` (name), `lat`+`lon`+`radius` (max 100,000m, default 1,000m), `bbox`, `onestop_id`, or `adm0_name`/`adm1_name` (country/region) — at least one required, or the call fails as `no_filter`
- Returns each operator's Onestop ID, name, places served, published feeds (a `GTFS_RT` entry signals real-time departures may be available), and Wikidata QID
- `lat` requires `lon` and vice versa, or the call fails as `incomplete_point`
- `limit` caps at 100 (default 20), paginated via the `after` cursor

---

### `transitland_get_operator` <sub>tool</sub>

- Accepts an Onestop ID (e.g. `o-9q9-bart`) or an internal integer ID
- Returns agencies (each with places served), published feeds, and source tags: Wikidata QID, US NTD ID, general Twitter/X handle
- Idempotent single-record lookup; mirrored by the `transitland://operator/{onestop_id}` resource
- `operator_not_found` when the ID doesn't resolve

---

### `transitland_find_feeds` <sub>tool</sub>

- Filter by `operator_onestop_id` (from `transitland_find_operators` — the reliable path to one agency's feeds), `spec` (`gtfs`/`gtfs-rt`/`gbfs`/`mds`), `search`, or `fetch_error` — at least one required
- Each feed returns its fetch URL, real-time endpoints when present, and license terms — redistribution, commercial use, derived products, and attribution as explicit `yes`/`no`/`unknown` (never inferred from a blank field), plus SPDX identifier and attribution text where known
- Freshness: last-fetch timestamp, content hash, and the calendar window the current data covers
- `authorizationRequired` flags feeds whose download needs a separate key/registration
- `limit` caps at 100 (default 20), paginated via `after`

---

### `transitland_find_routes` <sub>tool</sub>

- Filter by `lat`+`lon`+`radius` (max 50,000m, default 1,000m), `bbox`, `operator_onestop_id`, `onestop_id`, `route_type` (GTFS mode integer), or `search` — at least one required
- Returns short/long name, `route_type` mapped to a human-readable mode (bus, subway, rail, ferry, tram, …), brand color, operating agency's Onestop ID, and source feed's Onestop ID
- Scheduled (GTFS static) route definitions, not live vehicle positions
- `lat` requires `lon` and vice versa, or the call fails as `incomplete_point`
- `limit` caps at 100 (default 20), paginated via `after`

---

### `transitland_find_stops` <sub>tool</sub>

- Filter by `lat`+`lon`+`radius` (max 10,000m, default 500m), `bbox`, `onestop_id`, or `served_by_onestop_ids` (comma-separated operator/route Onestop IDs) — at least one required
- Returns coordinates, `location_type` with a label (stop, station, entrance, node, boarding area), wheelchair accessibility, timezone, and the parent station's Onestop ID for child platforms
- Departures attach to platform-level stops (`location_type` 0) — a station may return none; use its child platforms
- `limit` caps at 100 (default 20), paginated via `after`

---

### `transitland_get_departures` <sub>tool</sub>

- Resolve a stop to its Onestop ID with `transitland_find_stops` first
- Every departure carries a `realtime` flag — `true` for a live GTFS-Realtime prediction, `false` for a static scheduled time — plus a `scheduleRelationship` (`STATIC`, `SCHEDULED`, `ADDED`, `CANCELED`, `UNSCHEDULED`, `DUPLICATED`)
- Returns scheduled and (when real-time) estimated times with delay in seconds, route, headsign, mode, trip, direction, and accessibility
- Top-level `realtimeAvailable` reports whether the stop's feed publishes GTFS-RT at all
- `next_seconds` look-ahead window: 60–86,400 (default 3,600); widen it or set `use_service_window: true` when a stop returns nothing
- `stop_not_found` when the stop doesn't resolve — detected from an empty upstream array, not an HTTP 404

---

### `transitland://operator/{onestop_id}` <sub>resource</sub>

- Mirrors `transitland_get_operator` — agencies, places served, published feeds, and source tags (Wikidata QID, US NTD ID, Twitter/X handle)
- `onestop_id` param accepts an Onestop ID (e.g. `o-9q9-bart`) or internal integer ID
- `operator_not_found` when the ID doesn't resolve

---

### `transitland://feed/{onestop_id}` <sub>resource</sub>

- Mirrors a single-feed result from `transitland_find_feeds` — spec, fetch URL, real-time endpoints, license terms, and latest-fetch freshness
- `onestop_id` param accepts a feed Onestop ID (e.g. `f-9q9-bart`) or internal integer ID
- License fields normalize blank registry values to `unknown`/null — never inferred as permissive
- `feed_not_found` when the ID doesn't resolve

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core): stdio and Streamable HTTP transports, pluggable auth (`none` / `jwt` / `oauth`), swappable storage (`in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`), structured logging with optional OpenTelemetry tracing.

Transitland-specific:

- Direct HTTP client for the Transitland v2 REST API — no SDK dependency, a flat query-param contract over a handful of GET endpoints
- Onestop IDs (`o-`/`f-`/`r-`/`s-`) are the identifier spine — surfaced in every result, accepted on input alongside internal integer IDs
- Feed-version history sliced to the latest version (the raw endpoint returns the entire fetch log — 167 entries for BART), so a feed lookup returns current freshness, not a multi-year history
- Coverage polygons and route/stop geometry omitted by default — a compact country/region/city place summary instead

Agent-friendly output:

- The real-time distinction is structural — a per-departure `realtime` boolean and `scheduleRelationship`, plus a top-level `realtimeAvailable`, so an agent branches on data, never on parsing a timestamp
- License terms surfaced honestly — blank registry fields normalize to `unknown`/null and are never inferred as permissive; the schema descriptions tell agents to confirm against the license URL before redistributing
- The pagination `meta.next` URL embeds the API key in plaintext; the service discards it and surfaces only the opaque integer `after` cursor, so the key never reaches tool output or logs
- Empty results return data plus an actionable notice (geocode-first, widen the window, try a child platform) rather than an error

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

- [Bun v1.4.0](https://bun.sh/) or higher (or Node.js v24+).
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
| `LOGS_DIR` | Directory for log files (Node.js only). | `<project-root>/logs` |
| `STORAGE_PROVIDER_TYPE` | Storage backend: `in-memory`, `filesystem`, `supabase`, `cloudflare-kv/r2/d1`. | `in-memory` |
| `OTEL_ENABLED` | Enable [OpenTelemetry instrumentation](https://github.com/cyanheads/mcp-ts-core/tree/main/docs/telemetry) (spans, metrics, completion logs). | `false` |

See [`.env.example`](./.env.example) for the full list of optional overrides.

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
