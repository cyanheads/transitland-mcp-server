/**
 * @fileoverview Smoke coverage for every definition shipped by the server — all
 * six tools and both resources execute through handler + output parse + format()
 * with the service mocked, proving the definitions stay wired end to end.
 * @module tests/smoke/definitions.smoke.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = {
  listOperators: vi.fn(),
  getOperator: vi.fn(),
  listFeeds: vi.fn(),
  listFeedsForOperator: vi.fn(),
  listRoutes: vi.fn(),
  listStops: vi.fn(),
  getDepartures: vi.fn(),
  getFeed: vi.fn(),
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
const { operatorResource } = await import(
  '@/mcp-server/resources/definitions/operator.resource.js'
);
const { feedResource } = await import('@/mcp-server/resources/definitions/feed.resource.js');

const operatorRecord = {
  onestopId: 'o-9q9-bart',
  name: 'Bay Area Rapid Transit',
  shortName: 'BART',
  website: null,
  agencies: [],
  feeds: [{ onestopId: 'f-9q9-bart', spec: 'GTFS', name: null }],
  tags: { wikidataId: 'Q610120', usNtdId: null, twitter: null },
};

const operatorSummary = {
  ...operatorRecord,
  places: [{ country: 'United States of America', region: 'California', city: 'Oakland' }],
};

const feedRecord = {
  onestopId: 'f-9q9-bart',
  spec: 'GTFS',
  name: null,
  fetchUrl: 'http://bart.gov/gtfs.zip',
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

beforeEach(() => {
  for (const fn of Object.values(service)) fn.mockReset();
});

describe('definition smoke test', () => {
  it('executes every tool definition through handler and format()', async () => {
    service.listOperators.mockResolvedValueOnce({ items: [operatorSummary] });
    service.getOperator.mockResolvedValueOnce(operatorRecord);
    service.listFeedsForOperator.mockResolvedValueOnce({ items: [feedRecord] });
    service.listFeeds.mockResolvedValueOnce({ items: [feedRecord] });
    service.listRoutes.mockResolvedValueOnce({
      items: [
        {
          onestopId: 'r-9q9-bart-6',
          shortName: '6',
          longName: 'Daly City — Richmond',
          description: null,
          routeType: 1,
          mode: 'subway',
          color: null,
          operator: { onestopId: 'o-9q9-bart', name: 'BART' },
          feedOnestopId: 'f-9q9-bart',
        },
      ],
    });
    service.listStops.mockResolvedValueOnce({
      items: [
        {
          onestopId: 's-9q8yyw3xjw-powell',
          name: 'Powell St',
          code: null,
          lat: 37.784,
          lon: -122.408,
          locationType: 0,
          locationTypeLabel: 'stop',
          wheelchairBoarding: 'accessible',
          timezone: 'America/Los_Angeles',
          parentOnestopId: null,
          place: { country: 'United States of America', region: 'California' },
          feedOnestopId: 'f-9q9-bart',
        },
      ],
    });
    service.getDepartures.mockResolvedValueOnce({
      found: true,
      result: {
        stop: {
          onestopId: 's-9q8yyw3xjw-powell',
          name: 'Powell St',
          timezone: 'America/Los_Angeles',
        },
        departures: [
          {
            realtime: true,
            scheduleRelationship: 'SCHEDULED',
            scheduledTime: '2026-08-21T12:00:00-07:00',
            estimatedTime: '2026-08-21T12:01:30-07:00',
            delaySeconds: 90,
            headsign: 'Richmond',
            route: {
              onestopId: 'r-9q9-bart-6',
              shortName: '6',
              longName: null,
              mode: 'subway',
              color: null,
            },
            operatorName: 'BART',
            tripId: 'RT-6-01',
            directionId: 0,
            wheelchairAccessible: 'accessible',
          },
        ],
        realtimeAvailable: true,
      },
    });

    const operators = await findOperatorsTool.handler(
      findOperatorsTool.input.parse({ lat: 37.8, lon: -122.27 }),
      createMockContext({ errors: findOperatorsTool.errors }),
    );
    expect(operators.operators[0]?.onestopId).toBe('o-9q9-bart');
    expect(findOperatorsTool.format!(operators)[0]?.type).toBe('text');

    const operator = await getOperatorTool.handler(
      getOperatorTool.input.parse({ operator_key: 'o-9q9-bart' }),
      createMockContext({ errors: getOperatorTool.errors }),
    );
    expect(getOperatorTool.format!(operator)[0]?.type).toBe('text');

    const feeds = await findFeedsTool.handler(
      findFeedsTool.input.parse({ search: 'bart' }),
      createMockContext({ errors: findFeedsTool.errors }),
    );
    expect(findFeedsTool.format!(feeds)[0]?.type).toBe('text');

    const routes = await findRoutesTool.handler(
      findRoutesTool.input.parse({ lat: 37.8, lon: -122.27 }),
      createMockContext({ errors: findRoutesTool.errors }),
    );
    expect(findRoutesTool.format!(routes)[0]?.type).toBe('text');

    const stops = await findStopsTool.handler(
      findStopsTool.input.parse({ lat: 37.8, lon: -122.27 }),
      createMockContext({ errors: findStopsTool.errors }),
    );
    expect(findStopsTool.format!(stops)[0]?.type).toBe('text');

    const departures = await getDeparturesTool.handler(
      getDeparturesTool.input.parse({ stop_key: 's-9q8yyw3xjw-powell' }),
      createMockContext({ errors: getDeparturesTool.errors }),
    );
    expect(departures.realtimeAvailable).toBe(true);
    expect(getDeparturesTool.format!(departures)[0]?.type).toBe('text');
  });

  it('executes both resource definitions through handler and list()', async () => {
    service.getOperator.mockResolvedValueOnce(operatorRecord);
    service.getFeed.mockResolvedValueOnce(feedRecord);

    const operator = await operatorResource.handler(
      operatorResource.params!.parse({ onestop_id: 'o-9q9-bart' }),
      createMockContext({ errors: operatorResource.errors }),
    );
    expect(operator.onestopId).toBe('o-9q9-bart');

    const feed = await feedResource.handler(
      feedResource.params!.parse({ onestop_id: 'f-9q9-bart' }),
      createMockContext({ errors: feedResource.errors }),
    );
    expect(feed.onestopId).toBe('f-9q9-bart');

    const operatorListing = await operatorResource.list!({} as never);
    const feedListing = await feedResource.list!({} as never);
    expect(operatorListing.resources.length).toBeGreaterThan(0);
    expect(feedListing.resources.length).toBeGreaterThan(0);
  });
});
