/**
 * @fileoverview Page limits retain bounded upstream work and disclose the applied cap on both output surfaces.
 * @module tests/integration/page-limit.int.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findFeedsTool } from '@/mcp-server/tools/definitions/find-feeds.tool.js';
import { findOperatorsTool } from '@/mcp-server/tools/definitions/find-operators.tool.js';
import { findRoutesTool } from '@/mcp-server/tools/definitions/find-routes.tool.js';
import { findStopsTool } from '@/mcp-server/tools/definitions/find-stops.tool.js';
import { getDeparturesTool } from '@/mcp-server/tools/definitions/get-departures.tool.js';

const service = {
  listOperators: vi.fn(),
  listFeeds: vi.fn(),
  listFeedsForOperator: vi.fn(),
  listRoutes: vi.fn(),
  listStops: vi.fn(),
  getDepartures: vi.fn(),
};

vi.mock('@/services/transitland/transitland-service.js', () => ({
  getTransitlandService: () => service,
}));

beforeEach(() => {
  for (const fn of Object.values(service)) fn.mockReset();
  for (const fn of [
    service.listOperators,
    service.listFeeds,
    service.listFeedsForOperator,
    service.listRoutes,
    service.listStops,
  ]) {
    fn.mockResolvedValue({ items: [] });
  }
  service.getDepartures.mockResolvedValue({
    found: true,
    result: {
      stop: { onestopId: 's-test', name: 'Test stop', timezone: null },
      departures: [],
      realtimeAvailable: false,
    },
  });
});

const cases = [
  {
    name: 'operators',
    run: (limit: number) => runToolContract(findOperatorsTool, { search: 'test', limit }),
    called: service.listOperators,
  },
  {
    name: 'feeds',
    run: (limit: number) => runToolContract(findFeedsTool, { search: 'test', limit }),
    called: service.listFeeds,
  },
  {
    name: 'operator feeds',
    run: (limit: number) =>
      runToolContract(findFeedsTool, { operator_onestop_id: 'o-test', limit }),
    called: service.listFeedsForOperator,
  },
  {
    name: 'routes',
    run: (limit: number) => runToolContract(findRoutesTool, { search: 'test', limit }),
    called: service.listRoutes,
  },
  {
    name: 'stops',
    run: (limit: number) => runToolContract(findStopsTool, { search: 'test', limit }),
    called: service.listStops,
  },
  {
    name: 'departures',
    run: (limit: number) => runToolContract(getDeparturesTool, { stop_key: 's-test', limit }),
    called: service.getDepartures,
  },
];

const operator = {
  onestopId: 'o-test',
  name: 'Test',
  shortName: null,
  website: null,
  places: [],
  feeds: [],
  wikidataId: null,
};
const route = {
  onestopId: 'r-test',
  shortName: null,
  longName: null,
  description: null,
  routeType: null,
  mode: 'unknown',
  color: null,
  operator: { onestopId: null, name: '' },
  feedOnestopId: null,
};
const stop = {
  onestopId: 's-test',
  name: null,
  code: null,
  lat: null,
  lon: null,
  locationType: 0,
  locationTypeLabel: 'stop',
  wheelchairBoarding: 'unknown',
  timezone: null,
  parentOnestopId: null,
  place: { country: null, region: null },
  feedOnestopId: null,
};
const feed = {
  onestopId: 'f-test',
  spec: 'GTFS',
  name: null,
  fetchUrl: null,
  realtimeUrls: { tripUpdates: null, vehiclePositions: null, alerts: null },
  license: {
    spdxIdentifier: null,
    url: null,
    redistributionAllowed: 'unknown',
    commercialUseAllowed: 'unknown',
    createDerivedProduct: 'unknown',
    useWithoutAttribution: 'unknown',
    attributionText: null,
  },
  latestFetch: { fetchedAt: null, earliestServiceDate: null, latestServiceDate: null, sha1: null },
  authorizationRequired: false,
};
const departure = {
  realtime: false,
  scheduleRelationship: 'STATIC',
  scheduledTime: '2026-10-13T12:00:00Z',
  estimatedTime: null,
  delaySeconds: null,
  headsign: null,
  route: { onestopId: 'r-test', shortName: null, longName: null, mode: 'unknown', color: null },
  operatorName: null,
  tripId: null,
  directionId: null,
  wheelchairAccessible: 'unknown',
};

function seed(
  name: string,
  called: (typeof cases)[number]['called'],
  count: number,
  after?: number,
) {
  if (name === 'departures') {
    called.mockResolvedValue({
      found: true,
      result: {
        stop: { onestopId: 's-test', name: 'Test stop', timezone: null },
        departures: Array.from({ length: count }, () => departure),
        realtimeAvailable: false,
      },
    });
  } else {
    const item =
      name === 'operators' ? operator : name === 'routes' ? route : name === 'stops' ? stop : feed;
    called.mockResolvedValue({
      items: Array.from({ length: count }, () => item),
      ...(after !== undefined && { after }),
    });
  }
}

describe('bounded page requests', () => {
  it.each(cases)(
    'discloses the applied cap on short complete $name pages without claiming omission',
    async ({ name, run, called }) => {
      seed(name, called, 2);
      const result = await run(101);
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ totalCount: 2 });
      expect(result.structuredContent).not.toHaveProperty('truncated');
      const text = result.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
      expect(text).toContain('Requested 101');
      expect(text).toContain('applied the 100-result');
      expect(text).not.toMatch(/truncated|omitted/i);
    },
  );
  it.each(cases)('marks a full $name page at the applied cap', async ({ name, run, called }) => {
    seed(name, called, 100);
    const result = await run(101);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      totalCount: 100,
      truncated: true,
      shown: 100,
      cap: 100,
    });
    const text = result.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
    expect(result.structuredContent).toMatchObject({
      notice: expect.stringMatching(
        /^Requested 101 (results|departures); applied the 100-result (page cap|cap)\./,
      ),
    });
    expect(text).toMatch(
      /> Requested 101 (results|departures); applied the 100-result (page cap|cap)\./,
    );
    expect(text).toContain('**truncated:** true\n**shown:** 100\n**cap:** 100');
  });
  it.each(cases.filter((c) => !['operator feeds', 'departures'].includes(c.name)))(
    'preserves the $name cursor across continued and final empty pages',
    async ({ name, called }) => {
      seed(name, called, 2, 42);
      const tool =
        name === 'operators'
          ? findOperatorsTool
          : name === 'feeds'
            ? findFeedsTool
            : name === 'routes'
              ? findRoutesTool
              : findStopsTool;
      const first = await runToolContract(tool, { search: 'test', limit: 101 });
      expect(first.structuredContent).toMatchObject({ cursor: 42, totalCount: 2 });
      seed(name, called, 0);
      const last = await runToolContract(tool, { search: 'test', limit: 101, after: 42 });
      expect(called.mock.calls.at(-1)![0]).toMatchObject({ after: 42, limit: 100 });
      expect(last.structuredContent).toMatchObject({ totalCount: 0 });
      expect(last.structuredContent).not.toHaveProperty('cursor');
      expect(last.structuredContent).not.toHaveProperty('truncated');
      expect(last.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')).toContain(
        'Requested 101',
      );
    },
  );
  it.each(cases)('caps $name at 100 and discloses the requested limit', async ({ run, called }) => {
    const result = await run(101);
    expect(result.isError).not.toBe(true);
    expect(called).toHaveBeenCalledOnce();
    expect(called.mock.calls[0]).toContainEqual(expect.objectContaining({ limit: 100 }));
    expect(result.structuredContent).not.toHaveProperty('truncated');
    const text = result.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('\n');
    expect(text).toContain('Requested 101');
    expect(text).toContain('applied the 100-result');
    expect(text).not.toMatch(/truncated|omitted/i);
  });

  it.each(cases)(
    'still rejects a negative $name limit before upstream work',
    async ({ run, called }) => {
      const result = await run(-1);
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.InvalidParams },
      });
      expect(called).not.toHaveBeenCalled();
    },
  );
});
