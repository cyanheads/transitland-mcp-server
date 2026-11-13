/**
 * @fileoverview Property-based fuzz coverage for all six Transitland tools. The
 * service is mocked; generated and adversarial inputs must never crash a handler
 * or leak internals — guard rejections are handled contract outcomes.
 * @module tests/fuzz/transitland-tools.fuzz.test
 */

import { fuzzTool } from '@cyanheads/mcp-ts-core/testing/fuzz';
import { beforeEach, expect, it, vi } from 'vitest';
import { bboxSchema, normalizeBbox } from '@/mcp-server/shared/bbox-schema.js';
import { formatUrl, formatValue } from '@/mcp-server/shared/format-value.js';

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

function cpuTimePerCall(run: () => void): number {
  const start = process.threadCpuUsage();
  let elapsedMs = 0;
  let calls = 0;
  do {
    run();
    calls++;
    const { user, system } = process.threadCpuUsage(start);
    elapsedMs = (user + system) / 1000;
  } while (elapsedMs < 10);
  return elapsedMs / calls;
}

const timings = [
  {
    name: 'bbox digits',
    maxSize: 320_000,
    input: (size: number) => `${'0'.repeat(size)},0,1,1`,
    run: (input: string) => {
      normalizeBbox(bboxSchema.parse(input));
    },
  },
  {
    name: 'bbox whitespace',
    maxSize: 80_000,
    input: (size: number) => `${' \r\n'.repeat(size / 3)}X`,
    run: (input: string) => {
      bboxSchema.safeParse(input);
    },
  },
  {
    name: 'GTFS time digits',
    maxSize: 320_000,
    input: (size: number) => `${'9'.repeat(size)}:00:00`,
    run: (start_time: string) => {
      getDeparturesTool.input.parse({ stop_key: 's-test', start_time });
    },
  },
  {
    name: 'Markdown openers',
    maxSize: 320_000,
    input: (size: number) => '<a'.repeat(size / 2),
    run: formatValue,
  },
  {
    name: 'Markdown terminal break',
    maxSize: 320_000,
    input: (size: number) => `${'§1 x'.repeat(size / 4)}\ny`,
    run: formatValue,
  },
  {
    name: 'Markdown internal breaks',
    maxSize: 320_000,
    input: (size: number) => '  \r\n'.repeat(size / 4),
    run: formatValue,
  },
  {
    name: 'link destination',
    maxSize: 320_000,
    input: (size: number) => `https://example.com/${'a'.repeat(size)}`,
    run: formatUrl,
  },
];

it.each(timings)(
  'bounds thread CPU across sizes for $name',
  { timeout: 0 },
  ({ input, run, maxSize }) => {
    const baseSize = 5000;
    const base = input(baseSize);
    cpuTimePerCall(() => {
      run(base);
    });
    for (let size = 2 * baseSize; size <= maxSize; size *= 2) {
      const value = input(size);
      let growth = Number.POSITIVE_INFINITY;
      const growthLimit = (4 * size) / baseSize;
      for (let sample = 0; sample < 3 && growth >= growthLimit; sample++) {
        const small = cpuTimePerCall(() => {
          run(base);
        });
        const large = cpuTimePerCall(() => {
          run(value);
        });
        expect(large, `${size} characters`).toBeLessThan(1500);
        growth = Math.min(growth, large / small);
      }
      expect(growth, `${size} characters`).toBeLessThan(growthLimit);
    }
  },
);
