/**
 * @fileoverview Pins declared recovery hints across both tool error surfaces.
 * @module tests/integration/recovery-contract.int.test
 */

import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it, vi } from 'vitest';
import { findFeedsTool } from '@/mcp-server/tools/definitions/find-feeds.tool.js';
import { findOperatorsTool } from '@/mcp-server/tools/definitions/find-operators.tool.js';
import { findRoutesTool } from '@/mcp-server/tools/definitions/find-routes.tool.js';
import { findStopsTool } from '@/mcp-server/tools/definitions/find-stops.tool.js';
import { getDeparturesTool } from '@/mcp-server/tools/definitions/get-departures.tool.js';

vi.mock('@/services/transitland/transitland-service.js', () => ({
  getTransitlandService: () => ({ getDepartures: async () => ({ found: false }) }),
}));

const cases = [
  {
    name: 'operators without a filter',
    definition: findOperatorsTool,
    run: () => runToolContract(findOperatorsTool, {}),
    reason: 'no_filter',
  },
  {
    name: 'operators with an incomplete point',
    definition: findOperatorsTool,
    run: () => runToolContract(findOperatorsTool, { lat: 1 }),
    reason: 'incomplete_point',
  },
  {
    name: 'feeds without a filter',
    definition: findFeedsTool,
    run: () => runToolContract(findFeedsTool, {}),
    reason: 'no_filter',
  },
  {
    name: 'routes without a filter',
    definition: findRoutesTool,
    run: () => runToolContract(findRoutesTool, {}),
    reason: 'no_filter',
  },
  {
    name: 'routes with an incomplete point',
    definition: findRoutesTool,
    run: () => runToolContract(findRoutesTool, { lon: 1 }),
    reason: 'incomplete_point',
  },
  {
    name: 'stops without a filter',
    definition: findStopsTool,
    run: () => runToolContract(findStopsTool, {}),
    reason: 'no_filter',
  },
  {
    name: 'stops with an incomplete point',
    definition: findStopsTool,
    run: () => runToolContract(findStopsTool, { lat: 1 }),
    reason: 'incomplete_point',
  },
  {
    name: 'departures for an absent stop',
    definition: getDeparturesTool,
    run: () => runToolContract(getDeparturesTool, { stop_key: 's-missing' }),
    reason: 'stop_not_found',
  },
] as const;

describe('declared recovery parity', () => {
  it.each(cases)('$name', async ({ definition, run, reason }) => {
    const result = await run();
    const contract = definition.errors!.find((entry) => entry.reason === reason)!;
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: contract.code, data: { reason, recovery: { hint: contract.recovery } } },
    });
    const text = result.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('\n');
    expect(text).toContain(contract.recovery);
    expect(text).toContain(`reason ${reason}`);
  });
});
