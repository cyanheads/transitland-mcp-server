/**
 * @fileoverview Barrel collecting all tool definitions for createApp().
 * @module mcp-server/tools/definitions/index
 */

import { findFeedsTool } from './find-feeds.tool.js';
import { findOperatorsTool } from './find-operators.tool.js';
import { findRoutesTool } from './find-routes.tool.js';
import { findStopsTool } from './find-stops.tool.js';
import { getDeparturesTool } from './get-departures.tool.js';
import { getOperatorTool } from './get-operator.tool.js';

export const allToolDefinitions = [
  findOperatorsTool,
  getOperatorTool,
  findFeedsTool,
  findRoutesTool,
  findStopsTool,
  getDeparturesTool,
];
