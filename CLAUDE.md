# Developer Protocol

**Server:** transitland-mcp-server
**Version:** 0.1.0
**Framework:** [@cyanheads/mcp-ts-core](https://www.npmjs.com/package/@cyanheads/mcp-ts-core) `^0.10.6`
**Engines:** Bun ≥1.3.0, Node ≥24.0.0
**MCP SDK:** `@modelcontextprotocol/sdk` ^1.29.0
**Zod:** ^4.4.3

> **Read the framework docs first:** `node_modules/@cyanheads/mcp-ts-core/CLAUDE.md` contains the full API reference — builders, Context, error codes, exports, patterns. This file covers server-specific conventions only.

---

## Overview

Wraps the [Transitland v2 REST API](https://www.transit.land/documentation) — the open registry aggregating GTFS, GTFS-Realtime, and GBFS feeds from thousands of transit operators worldwide. Six tools and two resources over a single upstream: operators → feeds → routes → stops → departures.

- **Onestop IDs are the identifier spine.** Every output surfaces the stable, public Onestop ID (`o-`/`f-`/`r-`/`s-`); every ID input also accepts an internal integer ID. Internal integers are instance-mutable and never the primary output identifier.
- **No geocoding.** Transitland takes `lat`+`lon`+`radius` or a `bbox`, never a place name. Geography-capable tools name a geocoding pre-step (`openstreetmap_geocode`) in their descriptions and empty-result notices.
- **`find_feeds` is the standout** — fetch URL + license terms + freshness for open transit data. License fields normalize to explicit `yes`/`no`/`unknown` and are never inferred from a blank registry field.
- **Real-time is structural.** `get_departures` sets a per-departure `realtime` boolean and `scheduleRelationship`, plus a top-level `realtimeAvailable`, so a static timetable time is never mistaken for a live GTFS-RT prediction.
- **The `meta.next` pagination URL embeds the API key in plaintext** — the service discards it and returns only the opaque integer `after` cursor, so the key never reaches tool output or logs.

Full design rationale, verified response shapes, and the decisions log live in [`docs/design.md`](./docs/design.md).

---

## Core Rules

- **Logic throws, framework catches.** Tool/resource handlers are pure — throw on failure, no `try/catch`. Plain `Error` is fine; the framework catches, classifies, and formats. Use error factories (`notFound()`, `validationError()`, etc.) when the error code matters.
- **Use `ctx.log`** for request-scoped logging. No `console` calls.
- **Use `ctx.state`** for tenant-scoped storage. Never access persistence directly.
- **Check `ctx.elicit`** for presence before calling.
- **Secrets in env vars only** — never hardcoded.
- **Close the loop on issues.** When implementing work tracked by a GitHub issue, comment on the issue with what landed and close it. Do both — a comment without a close leaves stale issues open; a close without a comment leaves no record of what shipped. The comment is for future readers — state the concrete changes, not the conversation that produced them.

---

## Patterns

### Tool

Real example from `src/mcp-server/tools/definitions/get-operator.tool.ts` — a single-record fetch with a typed error contract. The service throws the declared `operator_not_found` reason; the handler stays a thin pass-through.

```ts
import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getTransitlandService } from '@/services/transitland/transitland-service.js';

export const getOperatorTool = tool('transitland_get_operator', {
  title: 'transitland-mcp-server: get operator',
  description:
    'Fetch the full operator record by Onestop ID or internal integer ID — agencies, places served, published feeds, and source tags (Wikidata QID, US NTD ID, social handles).',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    operator_key: z
      .string()
      .min(1)
      .describe('Operator Onestop ID (e.g. "o-9q9-bart") or internal integer ID.'),
  }),
  output: z.object({
    onestopId: z.string().describe('Stable public Onestop ID.'),
    name: z.string().describe('Operator name.'),
    // …agencies, feeds, tags
  }),
  errors: [
    {
      reason: 'operator_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No operator exists for the given Onestop ID or internal ID.',
      recovery:
        'Verify the ID format (e.g. "o-9q9-bart") or search with transitland_find_operators to get a valid Onestop ID.',
    },
  ],

  handler(input, ctx) {
    ctx.log.info('get_operator', { operatorKey: input.operator_key });
    return getTransitlandService().getOperator(input.operator_key, ctx, {
      reason: 'operator_not_found',
    });
  },

  // format() populates content[] — the markdown twin of structuredContent.
  // Different clients read different surfaces (Claude Code → structuredContent,
  // Claude Desktop → content[]); both must carry the same data.
  // Enforced at lint time: every field in `output` must appear in the rendered text.
  format: (result) => [{ type: 'text', text: `## ${result.name}\n**Onestop ID:** ${result.onestopId}` }],
});
```

List tools (`find_operators`, `find_feeds`, `find_routes`, `find_stops`) follow the same shape with an `enrichment` block: `ctx.enrich.total(n)` for the always-present count, `ctx.enrich({ cursor })` for the `after` pager, `ctx.enrich.truncated({ shown, cap })` when capped, and `ctx.enrich.notice(...)` for an empty-result recovery hint (truncation fields stay `.optional()` — the framework only populates them when the cap is hit).

### Resource

Real example from `src/mcp-server/resources/definitions/feed.resource.ts` — a URI-addressable mirror of a single feed record.

```ts
import { resource, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getTransitlandService } from '@/services/transitland/transitland-service.js';

export const feedResource = resource('transitland://feed/{onestop_id}', {
  name: 'transitland-feed',
  title: 'transitland-mcp-server: feed record',
  description:
    'Feed record by Onestop ID — spec, fetch URL, license terms, and latest-fetch freshness.',
  mimeType: 'application/json',
  params: z.object({
    onestop_id: z.string().min(1).describe('Feed Onestop ID (e.g. "f-9q9-bart") or internal integer ID.'),
  }),
  output: z.object({ onestopId: z.string().describe('Feed Onestop ID.') /* …license, urls, freshness */ }),
  errors: [
    {
      reason: 'feed_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No feed exists for the given Onestop ID or internal ID.',
      recovery: 'Verify the ID format (e.g. "f-9q9-bart") or discover feeds with transitland_find_feeds.',
    },
  ],
  handler(params, ctx) {
    return getTransitlandService().getFeed(params.onestop_id, ctx, { reason: 'feed_not_found' });
  },
});
```

No prompts — the domain is operational data lookup, so workflow guidance lives in the tool descriptions (geocode-first, operator-then-feeds, stop-then-departures) rather than a prompt template.

### Server config

The actual `src/config/server-config.ts` — two server-specific vars, lazy-parsed and separate from framework config.

```ts
import { z } from '@cyanheads/mcp-ts-core';
import { parseEnvConfig } from '@cyanheads/mcp-ts-core/config';

const ServerConfigSchema = z.object({
  apiKey: z.string().min(1).describe('Transitland v2 API key, sent as the `apikey` query parameter.'),
  baseUrl: z
    .string()
    .url()
    .default('https://transit.land/api/v2/rest')
    .describe('Transitland REST API base URL.'),
});

let _config: z.infer<typeof ServerConfigSchema> | undefined;
export function getServerConfig() {
  _config ??= parseEnvConfig(ServerConfigSchema, {
    apiKey: 'TRANSITLAND_API_KEY',
    baseUrl: 'TRANSITLAND_BASE_URL',
  });
  return _config;
}
```

`parseEnvConfig` maps Zod schema paths → env var names so errors name the variable (`TRANSITLAND_API_KEY`) not the path (`apiKey`). Throws `ConfigurationError`, which the framework prints as a clean startup banner — a missing key fails at startup, not at the first tool call.

### Server identity and instructions

`createApp()` accepts optional identity fields forwarded to the SDK's `initialize` response and the server manifest (`/.well-known/mcp.json`):

```ts
await createApp({
  name: 'my-mcp-server',
  title: 'My Server',                         // human-readable display name
  websiteUrl: 'https://github.com/owner/repo', // canonical homepage URL
  description: 'One-line description.',        // wins over MCP_SERVER_DESCRIPTION
  icons: [{ src: 'https://example.com/icon.png', sizes: ['48x48'], mimeType: 'image/png' }],
  instructions: 'Use shortcut alpha for the most common case.', // session-level context
});
```

`instructions` is optional server-level orientation, sent on every `initialize` as session-level context. Use it for deployment guidance (connection aliases, regional notes, scope hints) instead of repeating the same context across tool descriptions. Client adoption is uneven, but there's no downside when set.

---

## Context

Handlers receive a unified `ctx` object. Key properties:

| Property | Description |
|:---------|:------------|
| `ctx.log` | Request-scoped logger — `.debug()`, `.info()`, `.notice()`, `.warning()`, `.error()`. Auto-correlates requestId, traceId, tenantId. |
| `ctx.enrich` | Out-of-band response metadata. `ctx.enrich.total(n)` (always-present count), `ctx.enrich({ cursor })` (the `after` pager), `ctx.enrich.truncated({ shown, cap })` (capped lists), `ctx.enrich.notice(msg)` (empty-result recovery hints). Used by every list tool here. |
| `ctx.fail` | Throw a typed contract error — `ctx.fail(reason, message?, data?)`, with `ctx.recoveryFor(reason)` to spread the declared recovery hint. |
| `ctx.signal` | `AbortSignal` for cancellation, forwarded into upstream fetches. |
| `ctx.state` | Tenant-scoped KV. Unused by current tools (read-mostly registry, per-call) — available if session caching is added later. |
| `ctx.requestId` | Unique request ID. |
| `ctx.tenantId` | Tenant ID from JWT or `'default'` for stdio. |

---

## Errors

Handlers throw — the framework catches, classifies, and formats.

**Recommended: typed error contract.** Declare `errors: [{ reason, code, when, recovery, retryable? }]` on `tool()` / `resource()` to receive `ctx.fail(reason, …)` typed against the reason union. TypeScript catches typos at compile time, `data.reason` is auto-populated for observability, linter enforces conformance against the handler body. `recovery` is required descriptive metadata for the agent's next move (≥ 5 words, lint-validated); for the wire `data.recovery.hint` (mirrored into `content[]` text), pass explicitly at the throw site when dynamic context matters: `ctx.fail('reason', msg, { recovery: { hint: '...' } })`. Baseline codes (`InternalError`, `ServiceUnavailable`, `Timeout`, `ValidationError`, `SerializationError`) bubble freely and don't need declaring.

```ts
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';

errors: [
  { reason: 'no_match', code: JsonRpcErrorCode.NotFound,
    when: 'No item matched the query',
    recovery: 'Broaden the query or check the spelling and try again.' },
],
async handler(input, ctx) {
  const item = await db.find(input.id);
  if (!item) throw ctx.fail('no_match', `No item ${input.id}`);
  return item;
}
```

**Declare contracts inline on each tool.** The contract is part of the tool's public surface — one file should give the full picture. Don't extract a shared `errors[]` constant; per-tool repetition is the intended cost of locality.

**Fallback (no contract entry fits):** throw via factories or plain `Error`.

```ts
// Error factories — explicit code
import { notFound, serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
throw notFound('Item not found', { itemId });
throw serviceUnavailable('API unavailable', { url }, { cause: err });

// Plain Error — framework auto-classifies from message patterns
throw new Error('Item not found');           // → NotFound
throw new Error('Invalid query format');     // → ValidationError

// McpError — when no factory exists for the code
import { McpError, JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
throw new McpError(JsonRpcErrorCode.DatabaseError, 'Connection failed', { pool: 'primary' });
```

See framework CLAUDE.md and the `api-errors` skill for the full auto-classification table, all available factories, and the contract reference.

---

## Structure

```text
src/
  index.ts                              # createApp() entry point — registers tools + resources, inits the service
  config/
    server-config.ts                    # TRANSITLAND_API_KEY / TRANSITLAND_BASE_URL (Zod schema)
  services/
    transitland/
      transitland-service.ts            # Transitland v2 REST client (init/accessor pattern)
      types.ts                          # Raw / domain / output types
  mcp-server/
    tools/definitions/
      find-operators.tool.ts            # transitland_find_operators
      get-operator.tool.ts              # transitland_get_operator
      find-feeds.tool.ts                # transitland_find_feeds
      find-routes.tool.ts               # transitland_find_routes
      find-stops.tool.ts                # transitland_find_stops
      get-departures.tool.ts            # transitland_get_departures
      index.ts                          # barrel → allToolDefinitions
    resources/definitions/
      operator.resource.ts              # transitland://operator/{onestop_id}
      feed.resource.ts                  # transitland://feed/{onestop_id}
      index.ts                          # barrel → allResourceDefinitions
```

No prompts directory — this server defines none.

---

## Naming

| What | Convention | Example |
|:-----|:-----------|:--------|
| Files | kebab-case with suffix | `search-docs.tool.ts` |
| Tool/resource/prompt names | snake_case | `search_docs` |
| Directories | kebab-case | `src/services/doc-search/` |
| Descriptions | Single string or template literal, no `+` concatenation | `'Search items by query and filter.'` |

---

## Skills

Skills are modular instructions in `skills/` at the project root. Read them directly when a task matches — e.g., `skills/add-tool/SKILL.md` when adding a tool.

**Agent skill directory:** Copy skills into the directory your agent discovers (Claude Code: `.claude/skills/`, others: equivalent). Skills then load as context without referencing `skills/` paths. After framework updates, run the `maintenance` skill — Phase B re-syncs the agent directory.

Available skills:

| Skill | Purpose |
|:------|:--------|
| `setup` | Post-init project orientation |
| `design-mcp-server` | Design tool surface, resources, and services for a new server |
| `add-tool` | Scaffold a new tool definition |
| `add-app-tool` | Scaffold an MCP App tool + paired UI resource |
| `add-resource` | Scaffold a new resource definition |
| `add-prompt` | Scaffold a new prompt definition |
| `add-service` | Scaffold a new service integration |
| `add-test` | Scaffold test file for a tool, resource, or service |
| `field-test` | Exercise tools/resources/prompts with real inputs, verify behavior, report issues |
| `tool-defs-analysis` | Read-only audit of MCP definition language across the surface — voice, leaks, defaults, recovery hints, output descriptions |
| `security-pass` | Audit server for MCP-flavored security gaps: output injection, scope blast radius, input sinks, tenant isolation |
| `code-simplifier` | Post-session cleanup against `git diff` — modernize syntax, consolidate duplication, align with the codebase |
| `devcheck` | Lint, format, typecheck, audit |
| `polish-docs-meta` | Finalize docs, README, metadata, and agent protocol for shipping |
| `git-wrapup` | Land working-tree changes as a versioned commit + annotated tag — version bump, changelog, verify, tag. Local only. |
| `release-and-publish` | Push + npm + MCP Registry + GH Release + Docker. Picks up from `git-wrapup` |
| `maintenance` | Investigate changelogs, adopt upstream changes, sync skills to agent dirs |
| `orchestrations` | Chain task skills into a gated multi-phase pipeline — build-out, QA-fix, update-ship — when you can spawn sub-agents |
| `report-issue-framework` | File a bug or feature request against `@cyanheads/mcp-ts-core` via `gh` CLI |
| `report-issue-local` | File a bug or feature request against this server's own repo via `gh` CLI |
| `api-auth` | Auth modes, scopes, JWT/OAuth |
| `api-canvas` | DataCanvas: register tabular data, run SQL, export, plus the `spillover()` helper for big result sets — Tier 3 opt-in |
| `api-config` | AppConfig, parseConfig, env vars |
| `api-context` | Context interface, logger, state, progress |
| `api-errors` | McpError, JsonRpcErrorCode, error patterns |
| `api-linter` | Definition linter rule catalog — invoked by `bun run lint:mcp` and `devcheck` |
| `api-services` | LLM, Speech, Graph services |
| `api-testing` | createMockContext, test patterns |
| `api-utils` | Formatting, parsing, security, pagination, scheduling, telemetry helpers |
| `api-telemetry` | OTel catalog: spans, metrics, completion logs, env config, cardinality rules |
| `api-workers` | Cloudflare Workers runtime |

**Chaining skills into pipelines.** When the user wants a multi-phase effort — build this server out, QA-and-fix the surface, update-and-ship — *and you can spawn sub-agents*, `skills/orchestrations/SKILL.md` sequences the task skills above into a gated pipeline with verification at each step. Read it to drive the run. Optional: skip it if you can't orchestrate sub-agents, and ignore it entirely if you were *spawned* as one — you've already been scoped to a single phase.

When you complete a skill's checklist, check the boxes and add a completion timestamp at the end (e.g., `Completed: 2026-03-11`).

---

## Commands

**Runtime:** Scripts use Bun's native TypeScript execution — `bun run <cmd>` is the standard invocation. `npm run <cmd>` also works (npm delegates to bun).

| Command | Purpose |
|:--------|:--------|
| `npm run build` | Compile TypeScript |
| `npm run rebuild` | Clean + build |
| `npm run clean` | Remove build artifacts |
| `npm run devcheck` | Lint + format + typecheck + security + changelog sync |
| `bun run audit:refresh` | Delete `bun.lock`, reinstall, and re-run `bun audit`. Use when `devcheck` flags a transitive advisory — Bun's `update` is sticky on transitive resolutions, so the advisory may be a stale-lockfile false positive. If it survives the refresh, it's real. |
| `npm run tree` | Generate directory structure doc |
| `npm run format` | Auto-fix formatting (safe fixes only) |
| `npm run format:unsafe` | Also apply Biome's unsafe autofixes — review the diff; they can change behavior |
| `npm run lint:mcp` | Validate MCP tool/resource definitions against the linter rules |
| `npm run lint:packaging` | Verify `server.json` ↔ `manifest.json` env var consistency (run by devcheck) |
| `npm test` | Run the Vitest suite |
| `npm run start:stdio` | Production mode (stdio) |
| `npm run start:http` | Production mode (HTTP) |
| `npm run changelog:build` | Regenerate `CHANGELOG.md` from `changelog/*.md` |
| `npm run changelog:check` | Verify `CHANGELOG.md` is in sync (used by devcheck) |
| `npm run bundle` | Build, pack, and clean a `.mcpb` for one-click Claude Desktop install |
| `npm run release:github` | Create the GitHub release from the changelog + tag |
| `npm run list-skills` | List the project skills and their paths |

---

## Bundling

`npm run bundle` produces a `.mcpb` extension bundle for one-click install in Claude Desktop. The pack step is followed by `scripts/clean-mcpb.ts`, which prunes dev dependencies (`mcpb clean`) and strips dependency-shipped agent docs (`node_modules/**` `skills/`, `.claude/`, `.agents/`, `SKILL.md`) that root-anchored `.mcpbignore` patterns cannot reach. MCPB is stdio-only — HTTP and Cloudflare Workers deployments are unaffected. Consumers who don't need it can delete `manifest.json` and `.mcpbignore`; `lint:packaging` skips cleanly.

**Adding an env var requires both files:** `server.json` (registry discovery, `environmentVariables[]`) and `manifest.json` (bundle install UX, `mcp_config.env` + `user_config`). `lint:packaging` (run by `devcheck`) verifies the env var names match.

**README install badges** (Claude Desktop `.mcpb`, Cursor, VS Code) and the `base64` / `encodeURIComponent` config-generation commands are ship-time concerns — run the `polish-docs-meta` skill, which carries the badge format, layout, and generation snippets in `skills/polish-docs-meta/references/readme.md`.

---

## Changelog

Directory-based, grouped by minor series via the `.x` semver-wildcard convention. Source of truth: `changelog/<major.minor>.x/<version>.md` (e.g. `changelog/0.1.x/0.1.0.md`) — one file per release, shipped in the npm package. At release, author the per-version file with a concrete version and date, then run `npm run changelog:build` to regenerate the rollup. `changelog/template.md` is a **pristine format reference** — never edited or moved; read it for the frontmatter + section layout when scaffolding. `CHANGELOG.md` is a **navigation index** (header + link + summary per version), regenerated by `npm run changelog:build` — devcheck hard-fails on drift; never hand-edit it.

Each per-version file opens with YAML frontmatter:

```markdown
---
summary: "One-line headline, ≤350 chars"  # required — powers the rollup index
breaking: false                            # optional — true flags breaking changes
security: false                            # optional — true flags security fixes
---

# 0.1.0 — YYYY-MM-DD
...
```

`breaking: true` renders a `· ⚠️ Breaking` badge — use it when consumers must update code on upgrade (signature changes, removed APIs, config renames). `security: true` renders a `· 🛡️ Security` badge and pairs with a `## Security` body section. When both are set, badges render `· ⚠️ Breaking · 🛡️ Security`.

`agent-notes` is an optional free-form field for maintenance agents processing the release downstream. Content here won't appear in the rendered CHANGELOG — it's consumed by agents running the `maintenance` skill. Use it for adoption instructions that don't fit the human-facing sections: new files to create, fields to populate, one-time migration steps. Omit entirely when there's nothing to say.

**Section order** (Keep a Changelog): Added, Changed, Deprecated, Removed, Fixed, Security. Include only sections with entries — don't ship empty headers.

**Tag annotations** render as GitHub Release bodies via `--notes-from-tag`. They must be structured markdown — never a flat comma-separated string. Subject omits the version number (GitHub prepends it). See `changelog/template.md` for the full format reference.

---

## Imports

```ts
// Framework — z is re-exported, no separate zod import needed
import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';

// Server's own code — via path alias
import { getTransitlandService } from '@/services/transitland/transitland-service.js';
```

---

## Checklist

- [ ] Zod schemas: all fields have `.describe()`, only JSON-Schema-serializable types (no `z.custom()`, `z.date()`, `z.transform()`, `z.bigint()`, `z.symbol()`, `z.void()`, `z.map()`, `z.set()`, `z.function()`, `z.nan()`)
- [ ] Optional nested objects: handler guards for empty inner values from form-based clients (`if (input.obj?.field && ...)`, not just `if (input.obj)`). When regex/length constraints matter, use `z.union([z.literal(''), z.string().regex(...).describe(...)])` — literal variants are exempt from `describe-on-fields`.
- [ ] JSDoc `@fileoverview` + `@module` on every file
- [ ] `ctx.log` for logging, `ctx.state` for storage
- [ ] Handlers throw on failure — error factories or plain `Error`, no try/catch
- [ ] `format()` renders all data the LLM needs — different clients forward different surfaces (Claude Code → `structuredContent`, Claude Desktop → `content[]`); both must carry the same data
- [ ] If wrapping external API: raw/domain/output schemas reviewed against real upstream sparsity/nullability before finalizing required vs optional fields
- [ ] If wrapping external API: normalization and `format()` preserve uncertainty; do not fabricate facts from missing upstream data
- [ ] If wrapping external API: tests include at least one sparse payload case with omitted upstream fields
- [ ] Registered in `createApp()` arrays (directly or via barrel exports)
- [ ] Tests use `createMockContext()` from `@cyanheads/mcp-ts-core/testing`
- [ ] `.codex-plugin/plugin.json` populated — `name`, `version`, `description`, `repository`, `license` from `package.json`; `interface.displayName` = package name; `interface.shortDescription` from `package.json` description
- [ ] `.codex-plugin/mcp.json` updated — server name key matches `package.json` name; env vars added for any required API keys
- [ ] `.claude-plugin/plugin.json` populated — `name`, `version`, `description`, `repository`, `license` from `package.json`; inline `mcpServers` entry with server name key, env vars for any required API keys
- [ ] `npm run devcheck` passes
