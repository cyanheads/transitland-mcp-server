#!/usr/bin/env node
/**
 * @fileoverview transitland-mcp-server MCP server entry point. Wraps the Transitland
 * v2 REST API — operators, feeds, routes, stops, and real-time-aware departures.
 * @module index
 */

import { createApp } from '@cyanheads/mcp-ts-core';
import { allResourceDefinitions } from './mcp-server/resources/definitions/index.js';
import { allToolDefinitions } from './mcp-server/tools/definitions/index.js';
import { initTransitlandService } from './services/transitland/transitland-service.js';

/**
 * The running server. Exported so a test (or an embedder) can reach
 * `shutdown()` after importing this entry point.
 */
export const app = await createApp({
  name: 'transitland-mcp-server',
  title: 'transitland-mcp-server',
  tools: allToolDefinitions,
  resources: allResourceDefinitions,
  skills: 'skills',
  instructions:
    'Use openstreetmap_search_places to geocode place names before passing lat/lon or bbox. Use Onestop IDs to connect operators, feeds, routes, and stops. transitland_find_feeds returns data URLs and license terms. transitland_get_departures returns stop or station departures and service alerts, with realtime=true for live predictions.',
  // Session posture declared in code rather than left to a deployment's
  // MCP_SESSION_MODE (which still wins when it carries a meaningful value).
  // Every tool is a per-call read against the registry and none calls
  // ctx.requestInput, so stateless drops the session store and the
  // per-session McpServer allocation.
  sessionMode: 'stateless',
  setup(core) {
    initTransitlandService(core.config, core.storage);
  },
});
