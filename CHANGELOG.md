# Changelog

All notable changes to this project. Each entry links to its full per-version file in [changelog/](changelog/).

## [0.1.2](changelog/0.1.x/0.1.2.md) — 2026-09-20

@cyanheads/mcp-ts-core moves ^0.12.3 -> ^0.13.6: HTTP sessions now default to stateless, an invalid tool call classifies as InvalidParams with a synthesized recovery hint, and upstream error responses no longer forward their request URL to callers by default.

## [0.1.1](changelog/0.1.x/0.1.1.md) — 2026-08-21

Adopts @cyanheads/mcp-ts-core ^0.12.3 (SDK v2: protocol 2026-07-28 alongside 2025-era clients, strict tool inputs, JSON Schema 2020-12); guard errors move to ValidationError with recovery hints on the wire; Bun 1.4.0 images, supply-chain guards, dependency refresh.

## [0.1.0](changelog/0.1.x/0.1.0.md) — 2026-06-13

Initial release — Transitland v2 registry MCP server: 6 tools and 2 resources over operators, feeds, routes, stops, and real-time-aware departures.
