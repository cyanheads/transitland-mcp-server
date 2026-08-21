/**
 * @fileoverview Handler-level tests for all six Transitland tools. The service is
 * mocked so each test drives handler logic — guards, enrichment, the headline promised
 * outcome, and format() completeness — without the network. Each tool has at least one
 * test exercising its actual promised result, plus its guard/error paths.
 * @module tests/tools/tools.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});

// ---------------------------------------------------------------------------
// find_operators
// ---------------------------------------------------------------------------

describe('transitland_find_operators', () => {
  const sampleOperator = {
    onestopId: 'o-9q9-bart',
    name: 'Bay Area Rapid Transit',
    shortName: 'BART',
    website: null,
    places: [{ country: 'United States of America', region: 'California', city: 'Oakland' }],
    feeds: [{ onestopId: 'f-9q9-bart', spec: 'GTFS', name: null }],
    wikidataId: 'Q610120',
  };

  it('resolves operators for a place near coordinates (headline outcome)', async () => {
    service.listOperators.mockResolvedValueOnce({ items: [sampleOperator], after: 999 });
    const ctx = createMockContext({ errors: findOperatorsTool.errors });
    const input = findOperatorsTool.input.parse({ lat: 37.8, lon: -122.27, radius: 2000 });
    const result = await findOperatorsTool.handler(input, ctx);

    expect(result.operators[0]!.onestopId).toBe('o-9q9-bart');
    const enrich = getEnrichment(ctx);
    expect(enrich.totalCount).toBe(1);
    expect(enrich.cursor).toBe(999);

    // The service received lat/lon/radius.
    expect(service.listOperators).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 37.8, lon: -122.27, radius: 2000 }),
      ctx,
    );
  });

  it('throws no_filter when no filter is supplied', async () => {
    const ctx = createMockContext({ errors: findOperatorsTool.errors });
    const input = findOperatorsTool.input.parse({});
    await expect(findOperatorsTool.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: { reason: 'no_filter' },
    });
    expect(service.listOperators).not.toHaveBeenCalled();
  });

  it('throws incomplete_point when lat is given without lon', async () => {
    const ctx = createMockContext({ errors: findOperatorsTool.errors });
    const input = findOperatorsTool.input.parse({ lat: 37.8 });
    await expect(findOperatorsTool.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'incomplete_point' },
    });
  });

  it('emits a geocode-first notice on an empty result', async () => {
    service.listOperators.mockResolvedValueOnce({ items: [] });
    const ctx = createMockContext({ errors: findOperatorsTool.errors });
    const input = findOperatorsTool.input.parse({ search: 'nowhere' });
    await findOperatorsTool.handler(input, ctx);
    expect(String(getEnrichment(ctx).notice)).toMatch(/openstreetmap_geocode/);
  });

  it('format renders the onestop ID and feed name', () => {
    const blocks = findOperatorsTool.format!({
      operators: [
        {
          ...sampleOperator,
          feeds: [{ onestopId: 'f-9q9-bart', spec: 'GTFS', name: 'BART Static' }],
        },
      ],
    });
    const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
    expect(text).toContain('o-9q9-bart');
    expect(text).toContain('BART Static');
  });
});

// ---------------------------------------------------------------------------
// get_operator
// ---------------------------------------------------------------------------

describe('transitland_get_operator', () => {
  it('returns the full operator record by key (headline outcome)', async () => {
    service.getOperator.mockResolvedValueOnce({
      onestopId: 'o-9q9-bart',
      name: 'Bay Area Rapid Transit',
      shortName: 'BART',
      website: null,
      agencies: [{ agencyId: 'BA', agencyName: 'BART', places: [] }],
      feeds: [{ onestopId: 'f-9q9-bart', spec: 'GTFS', name: null }],
      tags: { wikidataId: 'Q610120', usNtdId: '90003', twitter: 'sfbart' },
    });
    const ctx = createMockContext({ errors: getOperatorTool.errors });
    const input = getOperatorTool.input.parse({ operator_key: 'o-9q9-bart' });
    const result = await getOperatorTool.handler(input, ctx);
    expect(result.onestopId).toBe('o-9q9-bart');
    expect(result.tags.wikidataId).toBe('Q610120');
    // The not-found reason is threaded to the service so data.reason stays stable.
    expect(service.getOperator).toHaveBeenCalledWith('o-9q9-bart', ctx, {
      reason: 'operator_not_found',
    });
  });

  it('bubbles a NotFound from the service', async () => {
    const { notFound } = await import('@cyanheads/mcp-ts-core/errors');
    service.getOperator.mockRejectedValueOnce(notFound('No operator found for "o-nope".'));
    const ctx = createMockContext({ errors: getOperatorTool.errors });
    const input = getOperatorTool.input.parse({ operator_key: 'o-nope' });
    await expect(getOperatorTool.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
    });
  });

  it('format renders agencies and feeds', () => {
    const blocks = getOperatorTool.format!({
      onestopId: 'o-9q9-bart',
      name: 'BART',
      shortName: 'BART',
      website: 'https://bart.gov',
      agencies: [{ agencyId: 'BA', agencyName: 'BART', places: [] }],
      feeds: [{ onestopId: 'f-9q9-bart', spec: 'GTFS', name: null }],
      tags: { wikidataId: null, usNtdId: null, twitter: null },
    });
    const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
    expect(text).toContain('f-9q9-bart');
    expect(text).toContain('BA');
  });
});

// ---------------------------------------------------------------------------
// find_feeds
// ---------------------------------------------------------------------------

describe('transitland_find_feeds', () => {
  const sparseFeed = {
    onestopId: 'f-9q9-bart',
    spec: 'GTFS',
    name: null,
    fetchUrl: 'http://bart.gov/gtfs.zip',
    realtimeUrls: { tripUpdates: null, vehiclePositions: null, alerts: null },
    license: {
      spdxIdentifier: null,
      url: 'http://bart.gov/license',
      redistributionAllowed: 'unknown' as const,
      commercialUseAllowed: 'unknown' as const,
      createDerivedProduct: 'unknown' as const,
      useWithoutAttribution: 'yes' as const,
      attributionText: null,
    },
    latestFetch: {
      fetchedAt: '2026-06-10T23:22:37Z',
      earliestServiceDate: null,
      latestServiceDate: null,
      sha1: null,
    },
    authorizationRequired: false,
  };

  it('routes an operator scope to listFeedsForOperator, not the unfiltered /feeds (headline outcome)', async () => {
    // /feeds has no operator filter; an operator scope must resolve via the operator record.
    service.listFeedsForOperator.mockResolvedValueOnce({ items: [sparseFeed] });
    const ctx = createMockContext({ errors: findFeedsTool.errors });
    const input = findFeedsTool.input.parse({ operator_onestop_id: 'o-9q9-bart' });
    const result = await findFeedsTool.handler(input, ctx);
    expect(result.feeds[0]!.fetchUrl).toBe('http://bart.gov/gtfs.zip');
    expect(result.feeds[0]!.license.redistributionAllowed).toBe('unknown');
    expect(getEnrichment(ctx).totalCount).toBe(1);
    expect(service.listFeedsForOperator).toHaveBeenCalledWith(
      'o-9q9-bart',
      ctx,
      expect.objectContaining({ failReason: { reason: 'operator_not_found' } }),
    );
    expect(service.listFeeds).not.toHaveBeenCalled();
  });

  it('passes the spec filter through to the operator feed resolution', async () => {
    service.listFeedsForOperator.mockResolvedValueOnce({ items: [] });
    const ctx = createMockContext({ errors: findFeedsTool.errors });
    const input = findFeedsTool.input.parse({ operator_onestop_id: 'o-9q9-bart', spec: 'gtfs-rt' });
    await findFeedsTool.handler(input, ctx);
    expect(service.listFeedsForOperator).toHaveBeenCalledWith(
      'o-9q9-bart',
      ctx,
      expect.objectContaining({ spec: 'gtfs-rt' }),
    );
    // The operator-aware empty notice fires, not the generic one.
    expect(String(getEnrichment(ctx).notice)).toMatch(/transitland_get_operator/);
  });

  it('uses the plain /feeds path for a non-operator filter (spec/search/fetch_error)', async () => {
    service.listFeeds.mockResolvedValueOnce({ items: [sparseFeed], after: 1078 });
    const ctx = createMockContext({ errors: findFeedsTool.errors });
    const input = findFeedsTool.input.parse({ spec: 'gtfs-rt', limit: 3 });
    const result = await findFeedsTool.handler(input, ctx);
    expect(result.feeds).toHaveLength(1);
    expect(getEnrichment(ctx).cursor).toBe(1078);
    expect(service.listFeedsForOperator).not.toHaveBeenCalled();
  });

  it('throws no_filter without any filter', async () => {
    const ctx = createMockContext({ errors: findFeedsTool.errors });
    const input = findFeedsTool.input.parse({});
    await expect(findFeedsTool.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'no_filter' },
    });
  });

  it('format surfaces unknown license terms honestly (no fabricated permissive values)', () => {
    const blocks = findFeedsTool.format!({ feeds: [sparseFeed] });
    const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
    expect(text).toContain('redistribution unknown');
    expect(text).toContain('SPDX unknown');
    expect(text).toContain('http://bart.gov/gtfs.zip');
  });
});

// ---------------------------------------------------------------------------
// find_routes
// ---------------------------------------------------------------------------

describe('transitland_find_routes', () => {
  const route = {
    onestopId: 'r-9q9p-800',
    shortName: '800',
    longName: 'All Nighter',
    description: null,
    routeType: 3,
    mode: 'bus',
    color: 'BC8E2D',
    operator: { onestopId: 'o-9q9-actransit', name: 'AC TRANSIT' },
    feedOnestopId: 'f-sf~bay~area~rg',
  };

  it('finds routes near a point with mode labels (headline outcome)', async () => {
    service.listRoutes.mockResolvedValueOnce({ items: [route] });
    const ctx = createMockContext({ errors: findRoutesTool.errors });
    const input = findRoutesTool.input.parse({ lat: 37.8, lon: -122.27 });
    const result = await findRoutesTool.handler(input, ctx);
    expect(result.routes[0]!.onestopId).toBe('r-9q9p-800');
    expect(result.routes[0]!.mode).toBe('bus');
  });

  it('throws incomplete_point for lon without lat', async () => {
    const ctx = createMockContext({ errors: findRoutesTool.errors });
    const input = findRoutesTool.input.parse({ lon: -122.27 });
    await expect(findRoutesTool.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'incomplete_point' },
    });
  });

  it('accepts route_type alone as a sufficient filter', async () => {
    service.listRoutes.mockResolvedValueOnce({ items: [] });
    const ctx = createMockContext({ errors: findRoutesTool.errors });
    const input = findRoutesTool.input.parse({ route_type: 1 });
    await findRoutesTool.handler(input, ctx);
    expect(service.listRoutes).toHaveBeenCalled();
  });

  it('format renders the route Onestop ID and mode', () => {
    const blocks = findRoutesTool.format!({ routes: [route] });
    const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
    expect(text).toContain('r-9q9p-800');
    expect(text).toContain('bus');
  });
});

// ---------------------------------------------------------------------------
// find_stops
// ---------------------------------------------------------------------------

describe('transitland_find_stops', () => {
  const stop = {
    onestopId: 's-9q8yyw3xjw-powell',
    name: 'Powell',
    code: null,
    lat: 37.78459,
    lon: -122.40737,
    locationType: 1,
    locationTypeLabel: 'station',
    wheelchairBoarding: 'unknown' as const,
    timezone: 'America/Los_Angeles',
    parentOnestopId: null,
    place: { country: 'United States of America', region: 'California' },
    feedOnestopId: 'f-sf~bay~area~rg',
  };

  it('finds stops near a point (headline outcome)', async () => {
    service.listStops.mockResolvedValueOnce({ items: [stop] });
    const ctx = createMockContext({ errors: findStopsTool.errors });
    const input = findStopsTool.input.parse({ lat: 37.78, lon: -122.41 });
    const result = await findStopsTool.handler(input, ctx);
    expect(result.stops[0]!.onestopId).toBe('s-9q8yyw3xjw-powell');
    expect(result.stops[0]!.lat).toBeCloseTo(37.78459);
  });

  it('throws no_filter without any filter', async () => {
    const ctx = createMockContext({ errors: findStopsTool.errors });
    const input = findStopsTool.input.parse({});
    await expect(findStopsTool.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'no_filter' },
    });
  });

  it('accepts served_by_onestop_ids alone as a filter', async () => {
    service.listStops.mockResolvedValueOnce({ items: [] });
    const ctx = createMockContext({ errors: findStopsTool.errors });
    const input = findStopsTool.input.parse({ served_by_onestop_ids: 'o-9q9-bart' });
    await findStopsTool.handler(input, ctx);
    expect(service.listStops).toHaveBeenCalled();
  });

  it('format renders the location type integer and label', () => {
    const blocks = findStopsTool.format!({ stops: [stop] });
    const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
    expect(text).toContain('s-9q8yyw3xjw-powell');
    expect(text).toContain('station (1)');
  });
});

// ---------------------------------------------------------------------------
// get_departures
// ---------------------------------------------------------------------------

describe('transitland_get_departures', () => {
  const rtDeparture = {
    realtime: true,
    scheduleRelationship: 'SCHEDULED',
    scheduledTime: '2026-06-13T16:21:07-04:00',
    estimatedTime: '2026-06-13T17:01:39-04:00',
    delaySeconds: 2432,
    headsign: '14 ST via 7 AV',
    route: {
      onestopId: 'r-dr72h-m7',
      shortName: 'M7',
      longName: 'Harlem - 14th Street',
      mode: 'bus',
      color: '00AEEF',
    },
    operatorName: 'MTA New York City Transit',
    tripId: 'OF_B6',
    directionId: 1,
    wheelchairAccessible: 'unknown' as const,
  };

  it('returns departures and distinguishes live predictions (headline outcome)', async () => {
    service.getDepartures.mockResolvedValueOnce({
      found: true,
      result: {
        stop: { onestopId: 's-1', name: '7 AV', timezone: 'America/New_York' },
        departures: [rtDeparture],
        realtimeAvailable: true,
      },
    });
    const ctx = createMockContext({ errors: getDeparturesTool.errors });
    const input = getDeparturesTool.input.parse({ stop_key: 's-1' });
    const result = await getDeparturesTool.handler(input, ctx);
    expect(result.realtimeAvailable).toBe(true);
    expect(result.departures[0]!.realtime).toBe(true);
    expect(result.departures[0]!.delaySeconds).toBe(2432);
    // The look-ahead window is passed as `next`, not `next_seconds`.
    expect(service.getDepartures).toHaveBeenCalledWith(
      's-1',
      expect.objectContaining({ next: 3600 }),
      ctx,
    );
  });

  it('throws stop_not_found when the stop record is absent (HTTP 200 + empty array)', async () => {
    service.getDepartures.mockResolvedValueOnce({ found: false });
    const ctx = createMockContext({ errors: getDeparturesTool.errors });
    const input = getDeparturesTool.input.parse({ stop_key: 's-INVALID-notexist' });
    await expect(getDeparturesTool.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
      data: { reason: 'stop_not_found' },
    });
  });

  it('returns empty departures with a widen-window notice (not an error)', async () => {
    service.getDepartures.mockResolvedValueOnce({
      found: true,
      result: {
        stop: { onestopId: 's-1', name: 'Quiet', timezone: 'America/New_York' },
        departures: [],
        realtimeAvailable: false,
      },
    });
    const ctx = createMockContext({ errors: getDeparturesTool.errors });
    const input = getDeparturesTool.input.parse({ stop_key: 's-1' });
    const result = await getDeparturesTool.handler(input, ctx);
    expect(result.departures).toEqual([]);
    expect(String(getEnrichment(ctx).notice)).toMatch(/use_service_window|child platform/);
  });

  it('format marks realtime departures and renders the route name', () => {
    const blocks = getDeparturesTool.format!({
      stop: { onestopId: 's-1', name: '7 AV', timezone: 'America/New_York' },
      departures: [rtDeparture],
      realtimeAvailable: true,
    });
    const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
    expect(text).toContain('Yes (live prediction)');
    expect(text).toContain('Harlem - 14th Street');
    expect(text).toContain('r-dr72h-m7');
  });
});
