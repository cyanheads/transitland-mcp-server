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

await createApp({
  name: 'transitland-mcp-server',
  title: 'transitland-mcp-server',
  tools: allToolDefinitions,
  resources: allResourceDefinitions,
  instructions:
    'Wraps the global Transitland v2 registry (GTFS, GTFS-Realtime, GBFS feeds worldwide). ' +
    'Onestop IDs (o-/f-/r-/s-) are the identifier spine — surfaced in every result, accepted on input. ' +
    'Transitland does not geocode: turn place names into coordinates with openstreetmap_geocode first, then pass lat/lon or bbox. ' +
    'find_feeds is the standout — fetch URLs, license terms, and freshness for open transit data. ' +
    'get_departures distinguishes live GTFS-Realtime predictions (realtime=true) from static schedule (realtime=false) per departure. ' +
    'For deep live tracking in a configured region, prefer onebusaway-mcp-server.',
  setup(core) {
    initTransitlandService(core.config, core.storage);
  },
});
