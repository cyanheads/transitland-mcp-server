/**
 * @fileoverview Tests for TransitlandService — exercises the real normalization,
 * cursor-discard, license tri-state mapping, real-time detection, and HTTP error
 * classification by mocking the framework `fetchWithTimeout` at the network boundary.
 * The mock THROWS an McpError on non-OK (mirroring the real framework behavior) so the
 * service's error-path code is genuinely exercised, not bypassed.
 * @module tests/services/transitland-service.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Mock only fetchWithTimeout; keep withRetry, requestContextService, and the rest real.
const fetchMock = vi.fn();
vi.mock('@cyanheads/mcp-ts-core/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cyanheads/mcp-ts-core/utils')>();
  return { ...actual, fetchWithTimeout: fetchMock };
});

// Set the API key before the service constructor reads server config.
beforeAll(() => {
  vi.stubEnv('TRANSITLAND_API_KEY', 'test-key-123');
});

afterEach(() => {
  fetchMock.mockReset();
});

/** Build a Response-like object whose .text() yields the given JSON. */
function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/** Mirror the real fetchWithTimeout: THROW an McpError on a non-OK upstream. */
function throwsHttp(code: JsonRpcErrorCode, message: string): never {
  throw new McpError(code, message);
}

// Import after the mock is registered so the service binds to the mocked util.
const { TransitlandService } = await import('@/services/transitland/transitland-service.js');

function makeService() {
  // config/storage are unused by the constructor beyond getServerConfig().
  return new TransitlandService({} as never, {} as never);
}

describe('TransitlandService.listOperators', () => {
  it('drops empty places and feed refs while preserving distinct normalized facts', async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({
        operators: [
          {
            agencies: [{ places: [{}, { adm0_name: '  US  ' }, { adm0_name: 'US' }] }, {}],
            feeds: [{}, { onestop_id: ' f-valid ', name: '  Named  ' }],
          },
        ],
      }),
    );
    const page = await makeService().listOperators({}, createMockContext());
    expect(page.items[0]).toMatchObject({
      onestopId: '',
      name: '',
      places: [{ country: 'US', region: null, city: null }],
      feeds: [{ onestopId: 'f-valid', spec: 'unknown', name: 'Named' }],
    });
  });
  it('normalizes an operator, collapses places, and discards meta.next while keeping the after cursor', async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({
        meta: {
          after: 14356265,
          next: 'https://transit.land/api/v2/rest/operators?after=14356265&apikey=test-key-123',
        },
        operators: [
          {
            onestop_id: 'o-9q9-bart',
            id: 14356265,
            name: 'Bay Area Rapid Transit',
            short_name: 'BART',
            tags: { wikidata_id: 'Q610120' },
            agencies: [
              {
                agency_id: 'BA',
                agency_name: 'Bay Area Rapid Transit',
                places: [
                  {
                    adm0_name: 'United States of America',
                    adm1_name: 'California',
                    city_name: 'Oakland',
                  },
                  {
                    adm0_name: 'United States of America',
                    adm1_name: 'California',
                    city_name: 'Oakland',
                  },
                ],
              },
            ],
            feeds: [
              { onestop_id: 'f-9q9-bart', spec: 'GTFS', name: null },
              { onestop_id: 'f-sf~rt', spec: 'GTFS_RT', name: 'RT' },
            ],
          },
        ],
      }),
    );

    const page = await makeService().listOperators({ search: 'BART' }, createMockContext());

    expect(page.after).toBe(14356265);
    expect(page.items).toHaveLength(1);
    const op = page.items[0]!;
    expect(op.onestopId).toBe('o-9q9-bart');
    expect(op.wikidataId).toBe('Q610120');
    // Duplicate places collapse to one.
    expect(op.places).toEqual([
      { country: 'United States of America', region: 'California', city: 'Oakland' },
    ]);
    expect(op.feeds.map((f) => f.spec)).toEqual(['GTFS', 'GTFS_RT']);

    // The apikey rides on the request URL but meta.next is never surfaced.
    const calledUrl = fetchMock.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('apikey=test-key-123');
    expect(JSON.stringify(page)).not.toContain('apikey');
    expect(JSON.stringify(page)).not.toContain('meta');
  });

  it('preserves "unknown" on a sparse operator with omitted fields', async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({ operators: [{ onestop_id: 'o-xyz-min', name: 'Minimal Transit' }] }),
    );

    const page = await makeService().listOperators({ search: 'min' }, createMockContext());
    const op = page.items[0]!;
    expect(op.shortName).toBeNull();
    expect(op.website).toBeNull();
    expect(op.wikidataId).toBeNull();
    expect(op.places).toEqual([]);
    expect(op.feeds).toEqual([]);
    expect(page.after).toBeUndefined();
  });
});

describe('TransitlandService.getOperator', () => {
  it('normalizes nested agencies, tags and missing values on a full record', async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({
        operators: [
          {
            agencies: [
              {},
              {
                agency_id: ' a ',
                agency_name: ' Agency ',
                places: [{ adm0_name: 'US', adm1_name: 'WA', city_name: 'Seattle' }],
              },
            ],
            feeds: [{}],
            tags: { wikidata_id: ' Q1 ', us_ntd_id: ' 123 ', twitter_general: ' handle ' },
          },
        ],
      }),
    );
    expect(await makeService().getOperator('o-test', createMockContext())).toMatchObject({
      onestopId: '',
      name: '',
      agencies: [
        { agencyId: '', agencyName: '', places: [] },
        {
          agencyId: 'a',
          agencyName: 'Agency',
          places: [{ country: 'US', region: 'WA', city: 'Seattle' }],
        },
      ],
      feeds: [],
      tags: { wikidataId: 'Q1', usNtdId: '123', twitter: 'handle' },
    });
    fetchMock.mockResolvedValueOnce(okJson({ operators: [{}] }));
    expect(await makeService().getOperator('o-sparse', createMockContext())).toMatchObject({
      agencies: [],
      tags: { wikidataId: null, usNtdId: null, twitter: null },
    });
  });
  it('throws NotFound with the caller reason when the operators array is empty', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ operators: [] }));
    const ctx = createMockContext();
    const err = (await makeService()
      .getOperator('o-nope', ctx, { reason: 'operator_not_found' })
      .catch((e) => e)) as McpError;
    expect(err).toBeInstanceOf(McpError);
    expect(err.code).toBe(JsonRpcErrorCode.NotFound);
    expect(err.data).toMatchObject({ reason: 'operator_not_found' });
  });

  it('threads the caller reason and a clean (no endpoint path) message on an HTTP 404', async () => {
    // Transitland 404s an absent /operators/{key}; fetchWithTimeout throws NotFound.
    // The 404 must carry the caller's contract reason and never leak the path.
    fetchMock.mockImplementationOnce(() => throwsHttp(JsonRpcErrorCode.NotFound, 'HTTP 404'));
    const err = (await makeService()
      .getOperator('o-zzz-notreal', createMockContext(), { reason: 'operator_not_found' })
      .catch((e) => e)) as McpError;
    expect(err.code).toBe(JsonRpcErrorCode.NotFound);
    expect(err.data).toMatchObject({ reason: 'operator_not_found', operatorKey: 'o-zzz-notreal' });
    expect(String(err.message)).toBe('No operator found for "o-zzz-notreal".');
    expect(String(err.message)).not.toMatch(/\/operators\//);
  });
});

describe('TransitlandService.listFeeds', () => {
  it('normalizes sparse feeds, explicit no terms and authorization requirements', async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({
        feeds: [
          {},
          {
            authorization: { type: 'apikey' },
            license: { redistribution_allowed: 'no' },
            urls: {
              realtime_vehicle_positions: ' https://example.test/vehicles ',
              realtime_alerts: 'https://example.test/alerts',
            },
          },
        ],
      }),
    );
    const page = await makeService().listFeeds({}, createMockContext());
    expect(page.items[0]).toMatchObject({
      onestopId: '',
      spec: 'unknown',
      name: null,
      fetchUrl: null,
      latestFetch: {
        fetchedAt: null,
        earliestServiceDate: null,
        latestServiceDate: null,
        sha1: null,
      },
    });
    expect(page.items[1]).toMatchObject({
      authorizationRequired: true,
      license: { redistributionAllowed: 'no' },
      realtimeUrls: {
        vehiclePositions: 'https://example.test/vehicles',
        alerts: 'https://example.test/alerts',
      },
    });
  });
  it('normalizes license blanks to unknown/null and never fabricates permissive terms', async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({
        feeds: [
          {
            onestop_id: 'f-9q9-bart',
            spec: 'GTFS',
            name: null,
            license: {
              spdx_identifier: '',
              url: 'http://www.bart.gov/license',
              use_without_attribution: 'yes',
              commercial_use_allowed: '',
              redistribution_allowed: '',
              create_derived_product: 'unknown',
              attribution_text: '',
            },
            urls: {
              static_current: 'http://www.bart.gov/google_transit.zip',
              realtime_trip_updates: '',
            },
            feed_versions: [
              {
                sha1: 'abc123',
                fetched_at: '2026-06-10T23:22:37Z',
                earliest_calendar_date: '2026-01-31',
                latest_calendar_date: '2027-01-31',
              },
            ],
            authorization: { type: '' },
          },
        ],
      }),
    );

    const page = await makeService().listFeeds(
      { operator_onestop_id: 'o-9q9-bart' },
      createMockContext(),
    );
    const feed = page.items[0]!;
    expect(feed.fetchUrl).toBe('http://www.bart.gov/google_transit.zip');
    expect(feed.license.spdxIdentifier).toBeNull();
    expect(feed.license.useWithoutAttribution).toBe('yes');
    expect(feed.license.commercialUseAllowed).toBe('unknown'); // blank → unknown, not "no"
    expect(feed.license.redistributionAllowed).toBe('unknown');
    expect(feed.license.createDerivedProduct).toBe('unknown');
    expect(feed.realtimeUrls.tripUpdates).toBeNull(); // empty string → null
    expect(feed.authorizationRequired).toBe(false); // empty auth type → not required
    expect(feed.latestFetch.fetchedAt).toBe('2026-06-10T23:22:37Z');
  });

  it('requests only the latest feed version (feed_versions.limit=1)', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ feeds: [] }));
    await makeService().listFeeds({ search: 'mbta' }, createMockContext());
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('feed_versions.limit=1');
  });
});

describe('TransitlandService.getFeed', () => {
  it('returns a present feed and declares an absent empty-array lookup', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ feeds: [{ onestop_id: 'f-test', spec: 'GBFS' }] }));
    expect(await makeService().getFeed('f-test', createMockContext())).toMatchObject({
      onestopId: 'f-test',
      spec: 'GBFS',
    });
    fetchMock.mockResolvedValueOnce(okJson({}));
    await expect(
      makeService().getFeed('f-none', createMockContext(), { reason: 'feed_not_found' }),
    ).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
      data: { reason: 'feed_not_found' },
    });
  });
  it('threads the caller reason and a clean message on an HTTP 404', async () => {
    fetchMock.mockImplementationOnce(() => throwsHttp(JsonRpcErrorCode.NotFound, 'HTTP 404'));
    const err = (await makeService()
      .getFeed('f-zzz-notreal', createMockContext(), { reason: 'feed_not_found' })
      .catch((e) => e)) as McpError;
    expect(err.code).toBe(JsonRpcErrorCode.NotFound);
    expect(err.data).toMatchObject({ reason: 'feed_not_found', feedKey: 'f-zzz-notreal' });
    expect(String(err.message)).toBe('No feed found for "f-zzz-notreal".');
    expect(String(err.message)).not.toMatch(/\/feeds\//);
  });
});

describe('TransitlandService.listFeedsForOperator', () => {
  it('resolves an operator to exactly its feeds (the /feeds endpoint has no operator filter)', async () => {
    // 1st call: the operator record (carries sparse feed refs).
    fetchMock.mockResolvedValueOnce(
      okJson({
        operators: [
          {
            onestop_id: 'o-9q9-bart',
            name: 'Bay Area Rapid Transit',
            feeds: [
              { onestop_id: 'f-9q9-bart', spec: 'GTFS', name: null },
              { onestop_id: 'f-sf~rt', spec: 'GTFS_RT', name: 'RT' },
            ],
          },
        ],
      }),
    );
    // Per-feed fetches resolve the full record (license/url/freshness).
    fetchMock.mockResolvedValueOnce(
      okJson({
        feeds: [
          {
            onestop_id: 'f-9q9-bart',
            spec: 'GTFS',
            urls: { static_current: 'http://bart.gov/gtfs.zip' },
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(
      okJson({
        feeds: [
          {
            onestop_id: 'f-sf~rt',
            spec: 'GTFS_RT',
            urls: { realtime_trip_updates: 'http://511.org/tu' },
          },
        ],
      }),
    );

    const page = await makeService().listFeedsForOperator('o-9q9-bart', createMockContext(), {
      limit: 20,
    });
    expect(page.items.map((f) => f.onestopId)).toEqual(['f-9q9-bart', 'f-sf~rt']);
    expect(page.items[0]!.fetchUrl).toBe('http://bart.gov/gtfs.zip');
    expect(page.items[1]!.realtimeUrls.tripUpdates).toBe('http://511.org/tu');
    // No meta.after surfaced (the resolved set is not upstream-paginated).
    expect(page.after).toBeUndefined();
  });

  it('narrows the resolved feeds to a requested spec', async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({
        operators: [
          {
            onestop_id: 'o-9q9-bart',
            name: 'BART',
            feeds: [
              { onestop_id: 'f-9q9-bart', spec: 'GTFS' },
              { onestop_id: 'f-sf~rt', spec: 'GTFS_RT' },
            ],
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(
      okJson({ feeds: [{ onestop_id: 'f-sf~rt', spec: 'GTFS_RT' }] }),
    );

    const page = await makeService().listFeedsForOperator('o-9q9-bart', createMockContext(), {
      spec: 'gtfs-rt',
      limit: 20,
    });
    expect(page.items.map((f) => f.onestopId)).toEqual(['f-sf~rt']);
    // Only the operator record + the one matching feed were fetched (2 calls).
    expect(fetchMock.mock.calls).toHaveLength(2);
  });

  it('skips a stale operator feed-ref that 404s rather than failing the whole call', async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({
        operators: [
          {
            onestop_id: 'o-x',
            name: 'X',
            feeds: [
              { onestop_id: 'f-live', spec: 'GTFS' },
              { onestop_id: 'f-stale', spec: 'GTFS' },
            ],
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(okJson({ feeds: [{ onestop_id: 'f-live', spec: 'GTFS' }] }));
    fetchMock.mockImplementationOnce(() => throwsHttp(JsonRpcErrorCode.NotFound, 'HTTP 404'));

    const page = await makeService().listFeedsForOperator('o-x', createMockContext(), {
      limit: 20,
    });
    expect(page.items.map((f) => f.onestopId)).toEqual(['f-live']);
  });

  it('throws the operator NotFound (with reason) when the operator itself is absent', async () => {
    fetchMock.mockImplementationOnce(() => throwsHttp(JsonRpcErrorCode.NotFound, 'HTTP 404'));
    const err = (await makeService()
      .listFeedsForOperator('o-zzz-notreal', createMockContext(), {
        limit: 20,
        failReason: { reason: 'operator_not_found' },
      })
      .catch((e) => e)) as McpError;
    expect(err.code).toBe(JsonRpcErrorCode.NotFound);
    expect(err.data).toMatchObject({ reason: 'operator_not_found' });
  });
});

describe('TransitlandService.getDepartures', () => {
  it('flags a real-time departure (estimated present) and reports realtimeAvailable', async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({
        stops: [
          {
            onestop_id: 's-dr5ru7tjdb-7av',
            stop_name: '7 AV/W 44 ST',
            stop_timezone: 'America/New_York',
            departures: [
              {
                departure: {
                  scheduled_local: '2026-06-13T16:21:07-04:00',
                  estimated_local: '2026-06-13T17:01:39-04:00',
                  estimated_utc: '2026-06-13T21:01:39Z',
                  estimated_delay: 2432,
                },
                schedule_relationship: 'SCHEDULED',
                stop_headsign: '14 ST via 7 AV',
                trip: {
                  trip_id: 'OF_B6',
                  direction_id: 1,
                  route: {
                    onestop_id: 'r-dr72h-m7',
                    route_short_name: 'M7',
                    route_long_name: 'Harlem - 14th Street',
                    route_type: 3,
                    agency: { onestop_id: 'o-dr5r-nyct', agency_name: 'MTA New York City Transit' },
                  },
                },
              },
            ],
          },
        ],
      }),
    );

    const res = await makeService().getDepartures('s-dr5ru7tjdb-7av', {}, createMockContext());
    expect(res.found).toBe(true);
    if (!res.found) throw new Error('expected found');
    expect(res.result.realtimeAvailable).toBe(true);
    const dep = res.result.departures[0]!;
    expect(dep.realtime).toBe(true);
    expect(dep.scheduleRelationship).toBe('SCHEDULED');
    expect(dep.estimatedTime).toBe('2026-06-13T17:01:39-04:00');
    expect(dep.delaySeconds).toBe(2432);
    expect(dep.route.mode).toBe('bus'); // route_type 3
    expect(dep.headsign).toBe('14 ST via 7 AV');
  });

  it('marks a STATIC departure (no estimated) as scheduled, not real-time', async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({
        stops: [
          {
            onestop_id: 's-static',
            stop_name: 'Static Stop',
            departures: [
              {
                departure: { scheduled_local: '2026-06-13T08:00:00-07:00' },
                schedule_relationship: 'STATIC',
                trip: { trip_id: 't1', route: { onestop_id: 'r-1', route_type: 2 } },
              },
            ],
          },
        ],
      }),
    );

    const res = await makeService().getDepartures('s-static', {}, createMockContext());
    if (!res.found) throw new Error('expected found');
    expect(res.result.realtimeAvailable).toBe(false);
    const dep = res.result.departures[0]!;
    expect(dep.realtime).toBe(false);
    expect(dep.estimatedTime).toBeNull();
    expect(dep.delaySeconds).toBeNull();
    expect(dep.scheduleRelationship).toBe('STATIC');
    expect(dep.route.mode).toBe('rail'); // route_type 2
  });

  it('returns found:false for an empty stops array (HTTP 200, nonexistent stop)', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ stops: [] }));
    const res = await makeService().getDepartures('s-INVALID-notexist', {}, createMockContext());
    expect(res.found).toBe(false);
  });

  it('sends the look-ahead window as the `next` query param', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ stops: [{ onestop_id: 's-1', departures: [] }] }));
    await makeService().getDepartures('s-1', { next: 7200 }, createMockContext());
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('next=7200');
  });
});

describe('TransitlandService error classification', () => {
  it('initializes the public service accessor and refuses access before setup', async () => {
    vi.resetModules();
    const { getTransitlandService, initTransitlandService } = await import(
      '@/services/transitland/transitland-service.js'
    );
    expect(() => getTransitlandService()).toThrow('not initialized');
    initTransitlandService({} as never, {} as never);
    fetchMock.mockResolvedValueOnce(okJson({}));
    expect(await getTransitlandService().listOperators({}, createMockContext())).toEqual({
      items: [],
    });
  });
  it('reports malformed JSON as SerializationError without retry', async () => {
    fetchMock.mockResolvedValueOnce({ text: async () => '{bad json' });
    await expect(makeService().listStops({}, createMockContext())).rejects.toMatchObject({
      code: JsonRpcErrorCode.SerializationError,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it.each([
    ['not found', JsonRpcErrorCode.NotFound],
    ['Unauthorized', JsonRpcErrorCode.Unauthorized],
  ])('classifies a 200 error body: %s', async (error, code) => {
    fetchMock.mockResolvedValueOnce(okJson({ error }));
    await expect(makeService().listRoutes({}, createMockContext())).rejects.toMatchObject({ code });
  });
  it('retries an unexpected error body then returns the successful page', async () => {
    vi.useFakeTimers();
    try {
      fetchMock
        .mockResolvedValueOnce(okJson({ error: 'temporary failure' }))
        .mockResolvedValueOnce(okJson({ meta: { after: 8 }, stops: [] }));
      const result = makeService().listStops({}, createMockContext());
      await vi.runAllTimersAsync();
      expect(await result).toEqual({ items: [], after: 8 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it('maps an upstream 401 (thrown by fetchWithTimeout) to Unauthorized', async () => {
    fetchMock.mockImplementationOnce(() => throwsHttp(JsonRpcErrorCode.Unauthorized, 'HTTP 401'));
    const err = (await makeService()
      .listOperators({ search: 'x' }, createMockContext())
      .catch((e) => e)) as McpError;
    expect(err.code).toBe(JsonRpcErrorCode.Unauthorized);
    expect(String(err.message)).toMatch(/TRANSITLAND_API_KEY/);
  });

  it('maps an upstream 404 (thrown by fetchWithTimeout) to NotFound', async () => {
    fetchMock.mockImplementationOnce(() => throwsHttp(JsonRpcErrorCode.NotFound, 'HTTP 404'));
    const err = (await makeService()
      .getOperator('o-9q9-bart', createMockContext())
      .catch((e) => e)) as McpError;
    expect(err.code).toBe(JsonRpcErrorCode.NotFound);
  });
});

describe('sparse geography and route modes', () => {
  it('normalizes parent shapes, location types and wheelchair states without losing coordinates', async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({
        stops: [
          {
            parent: ' s-parent ',
            location_type: 1,
            wheelchair_boarding: 1,
            geometry: { coordinates: [-122, 47] },
          },
          { parent: { onestop_id: 's-parent' }, location_type: 9, wheelchair_boarding: 2 },
          { parent: null, location_type: 0, wheelchair_boarding: 0 },
        ],
      }),
    );
    const page = await makeService().listStops({}, createMockContext());
    expect(
      page.items.map((s) => [s.parentOnestopId, s.locationTypeLabel, s.wheelchairBoarding]),
    ).toEqual([
      ['s-parent', 'station', 'accessible'],
      ['s-parent', 'type 9', 'not_accessible'],
      [null, 'stop', 'unknown'],
    ]);
    expect(page.items[0]).toMatchObject({ lat: 47, lon: -122 });
  });
  it('retains nested departure fallback times and accessibility', async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({
        stops: [
          {
            departures: [
              {
                departure: {
                  estimated: '2026-10-13T12:01:00Z',
                  estimated_local: '2026-10-13T12:01:00Z',
                  scheduled_utc: '2026-10-13T12:00:00Z',
                },
                trip: { wheelchair_accessible: 1 },
              },
              {
                departure: { estimated_utc: '2026-10-13T12:02:00Z' },
                trip: { wheelchair_accessible: 2 },
              },
            ],
          },
        ],
      }),
    );
    const result = await makeService().getDepartures('s-test', {}, createMockContext());
    if (!result.found) throw new Error('expected found');
    expect(result.result.departures[0]).toMatchObject({
      realtime: true,
      scheduledTime: '2026-10-13T12:00:00Z',
      estimatedTime: '2026-10-13T12:01:00Z',
      delaySeconds: null,
      wheelchairAccessible: 'accessible',
    });
    expect(result.result.departures[1]).toMatchObject({
      realtime: true,
      scheduledTime: '',
      estimatedTime: '2026-10-13T12:02:00Z',
      wheelchairAccessible: 'not_accessible',
    });
  });
  const extended = [
    [100, 117, 'rail'],
    [200, 209, 'coach'],
    [400, 404, 'subway'],
    [405, 405, 'monorail'],
    [700, 716, 'bus'],
    [800, 800, 'trolleybus'],
    [900, 906, 'tram'],
    [1000, 1000, 'water transport'],
    [1200, 1200, 'ferry'],
    [1300, 1307, 'aerial lift'],
    [1400, 1400, 'funicular'],
  ] as const;
  const modes: (readonly [number, string])[] = extended.flatMap(([start, end, mode]) =>
    Array.from({ length: end - start + 1 }, (_, i) => [start + i, mode] as const),
  );
  modes.push(
    ...[118, 210, 406, 717, 907, 1308, 1100, 1501, 1700].map(
      (code) => [code, `type ${code}`] as const,
    ),
  );
  it('maps recognized extended families and preserves holes in both paths', async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({ routes: modes.map(([route_type]) => ({ route_type })) }),
    );
    const routes = await makeService().listRoutes({}, createMockContext());
    expect(routes.items.map((r) => [r.routeType, r.mode])).toEqual(modes);
    fetchMock.mockResolvedValueOnce(
      okJson({
        stops: [{ departures: modes.map(([route_type]) => ({ trip: { route: { route_type } } })) }],
      }),
    );
    const departures = await makeService().getDepartures('s-test', {}, createMockContext());
    if (!departures.found) throw new Error('expected found');
    expect(departures.result.departures.map((d) => d.route.mode)).toEqual(
      modes.map(([, mode]) => mode),
    );
  });

  it.each(['listStops', 'listRoutes', 'listOperators'] as const)(
    'replaces only exact query zeros in %s',
    async (method) => {
      for (const [lat, lon, expectedLat, expectedLon] of [
        [0, -140, '1e-9', '-140'],
        [37.7, -0, '37.7', '1e-9'],
        [0, 0, '1e-9', '1e-9'],
        [1e-12, -1e-12, '1e-12', '-1e-12'],
      ]) {
        fetchMock.mockResolvedValueOnce(okJson({}));
        await makeService()[method](
          { lat, lon, radius: 0, search: 'test', after: 42 },
          createMockContext(),
        );
        const url = new URL(fetchMock.mock.calls.at(-1)![0]);
        expect(url.searchParams.get('lat')).toBe(expectedLat);
        expect(url.searchParams.get('lon')).toBe(expectedLon);
        expect(url.searchParams.get('radius')).toBe('0');
        expect(url.searchParams.get('search')).toBe('test');
        expect(url.searchParams.get('after')).toBe('42');
      }
    },
  );
  it('characterizes real zero coordinates and basic route modes', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ stops: [{ geometry: { coordinates: [0, 0] } }] }));
    expect((await makeService().listStops({}, createMockContext())).items[0]).toMatchObject({
      lat: 0,
      lon: 0,
    });
    const basics = [
      [0, 'tram'],
      [1, 'subway'],
      [2, 'rail'],
      [3, 'bus'],
      [4, 'ferry'],
      [5, 'cable tram'],
      [6, 'aerial lift'],
      [7, 'funicular'],
      [11, 'trolleybus'],
      [12, 'monorail'],
    ] as const;
    fetchMock.mockResolvedValueOnce(
      okJson({ routes: basics.map(([route_type]) => ({ route_type })) }),
    );
    expect(
      (await makeService().listRoutes({}, createMockContext())).items.map((r) => r.mode),
    ).toEqual(basics.map(([, mode]) => mode));
  });

  it('preserves missing coordinates independently rather than inventing zero', async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({
        stops: [{}, { geometry: null }, { geometry: {} }, { geometry: { coordinates: [0] } }],
      }),
    );
    const page = await makeService().listStops({}, createMockContext());
    expect(page.items.map((s) => [s.lat, s.lon])).toEqual([
      [null, null],
      [null, null],
      [null, null],
      [null, 0],
    ]);
  });

  it('distinguishes missing types from bus on routes and nested departures', async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({ routes: [{}, { route_type: null }, { route_type: 3 }] }),
    );
    expect(
      (await makeService().listRoutes({}, createMockContext())).items.map((r) => [
        r.routeType,
        r.mode,
      ]),
    ).toEqual([
      [null, 'unknown'],
      [null, 'unknown'],
      [3, 'bus'],
    ]);
    fetchMock.mockResolvedValueOnce(
      okJson({
        stops: [
          {
            departures: [
              {},
              { trip: { route: { route_type: null } } },
              { trip: { route: { route_type: 3 } } },
            ],
          },
        ],
      }),
    );
    const result = await makeService().getDepartures('s-test', {}, createMockContext());
    if (!result.found) throw new Error('expected found');
    expect(result.result.departures.map((d) => d.route.mode)).toEqual([
      'unknown',
      'unknown',
      'bus',
    ]);
  });
});
