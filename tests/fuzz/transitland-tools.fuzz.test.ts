/**
 * @fileoverview Property-based fuzz coverage for all six Transitland tools. The
 * service is mocked; generated and adversarial inputs must never crash a handler
 * or leak internals — guard rejections are handled contract outcomes.
 * @module tests/fuzz/transitland-tools.fuzz.test
 */

import { fuzzTool } from '@cyanheads/mcp-ts-core/testing/fuzz';
import { beforeEach, expect, it, vi } from 'vitest';

const service = {
  listOperators: vi.fn(),
  getOperator: vi.fn(),
  listFeeds: vi.fn(),
  listFeedsForOperator: vi.fn(),
  listRoutes: vi.fn(),
  listStops: vi.fn(),
  getDepartures: vi.fn(),
};

vi.mock('@/services/transitland/transitland-service.js', () => ({
  getTransitlandService: () => service,
}));

const { findOperatorsTool } = await import('@/mcp-server/tools/definitions/find-operators.tool.js');
const { getOperatorTool } = await import('@/mcp-server/tools/definitions/get-operator.tool.js');
const { findFeedsTool } = await import('@/mcp-server/tools/definitions/find-feeds.tool.js');
const { findRoutesTool } = await import('@/mcp-server/tools/definitions/find-routes.tool.js');
const { findStopsTool } = await import('@/mcp-server/tools/definitions/find-stops.tool.js');
const { getDeparturesTool } = await import('@/mcp-server/tools/definitions/get-departures.tool.js');

beforeEach(() => {
  for (const fn of Object.values(service)) fn.mockReset();
  // Valid minimal domain shapes — inputs that clear the guards hit these.
  service.listOperators.mockResolvedValue({ items: [] });
  service.getOperator.mockResolvedValue({
    onestopId: 'o-9q9-bart',
    name: 'BART',
    shortName: null,
    website: null,
    agencies: [],
    feeds: [],
    tags: { wikidataId: null, usNtdId: null, twitter: null },
  });
  service.listFeeds.mockResolvedValue({ items: [] });
  service.listFeedsForOperator.mockResolvedValue({ items: [] });
  service.listRoutes.mockResolvedValue({ items: [] });
  service.listStops.mockResolvedValue({ items: [] });
  service.getDepartures.mockResolvedValue({ found: false });
});

const FUZZ_OPTIONS = { numRuns: 50, numAdversarial: 30, seed: 20_260_821 } as const;

for (const tool of [
  ['find_operators', findOperatorsTool],
  ['get_operator', getOperatorTool],
  ['find_feeds', findFeedsTool],
  ['find_routes', findRoutesTool],
  ['find_stops', findStopsTool],
  ['get_departures', getDeparturesTool],
] as const) {
  const [name, definition] = tool;
  it(`keeps ${name} safe across generated and adversarial inputs`, async () => {
    const report = await fuzzTool(definition, FUZZ_OPTIONS);
    expect(report.crashes).toHaveLength(0);
    expect(report.leaks).toHaveLength(0);
    expect(report.prototypePollution).toBe(false);
  });
}
