/** @fileoverview Transitland endpoint and normalization regressions at the fetch boundary. */
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { TransitlandService } from '@/services/transitland/transitland-service.js';

beforeAll(() => vi.stubEnv('TRANSITLAND_API_KEY', 'test-key'));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function service() {
  return new TransitlandService({} as never, {} as never);
}

function mockFetch(handler: (url: URL, signal: AbortSignal) => Response | Promise<Response>) {
  const mock = vi.fn((url: string, init: RequestInit) => handler(new URL(url), init.signal!));
  vi.stubGlobal('fetch', mock);
  return mock;
}

it.each([
  ['listStops', 'stops', 's'],
  ['listRoutes', 'routes', 'r'],
  ['listFeeds', 'feeds', 'f'],
] as const)(
  'translates numeric %s filters and checks raw identity',
  async (method, collection, prefix) => {
    const fetch = mockFetch((url) => {
      expect(url.searchParams.get('id')).toBe('4045678901');
      expect(url.searchParams.get('onestop_id')).toBeNull();
      expect(url.searchParams.get('search')).toBe('west');
      expect(url.searchParams.get('after')).toBe('12');
      return Response.json({
        meta: { after: 19 },
        [collection]: [
          { id: 1, onestop_id: `${prefix}-unrelated` },
          { id: 4045678901, onestop_id: `${prefix}-match` },
        ],
      });
    });
    const target = service();
    expect(await target[method]({ onestop_id: '00', search: 'west' }, createMockContext())).toEqual(
      { items: [] },
    );
    expect(fetch).not.toHaveBeenCalled();
    const result = await target[method](
      { onestop_id: '004045678901', search: 'west', after: 12 },
      createMockContext(),
    );
    expect(result.items.map((item) => item.onestopId)).toEqual([`${prefix}-match`]);
    if (method !== 'listFeeds') expect(result.after).toBe(19);
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

it('rejects numeric operator lookups before I/O and checks successful response identity', async () => {
  const fetch = mockFetch(() => Response.json({ operators: [{ onestop_id: 'o-other' }] }));
  const target = service();
  const ctx = createMockContext();
  const contract = { code: JsonRpcErrorCode.NotFound, data: { reason: 'operator_not_found' } };
  await expect(target.getOperator('14490042', ctx)).rejects.toMatchObject(contract);
  expect(await target.listOperators({ onestop_id: '14490042' }, ctx)).toMatchObject({
    items: [],
    notices: [expect.stringContaining('Onestop ID')],
  });
  expect(fetch).not.toHaveBeenCalled();
  await expect(
    target.getOperator('o-unknown', ctx, { reason: 'operator_not_found' }),
  ).rejects.toMatchObject(contract);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('filters operator refs before applying the limit and preserves exact membership', async () => {
  const fetch = mockFetch((url) => {
    if (url.pathname.endsWith('/operators/o-test'))
      return Response.json({
        operators: [
          {
            onestop_id: 'o-test',
            feeds: [{ onestop_id: 'f-first' }, { onestop_id: 'f-later' }],
          },
        ],
      });
    expect(url.pathname).toMatch(/\/feeds$/);
    expect(url.searchParams.get('search')).toBe('seattle');
    expect(url.searchParams.get('fetch_error')).toBe('false');
    return Response.json({
      feeds: [
        { id: 2, onestop_id: 'f-outsider' },
        ...(url.searchParams.get('onestop_id') === 'f-first'
          ? []
          : [
              {
                id: 2,
                onestop_id: 'f-later',
                spec: 'GBFS',
                urls: { gbfs_auto_discovery: 'https://example.com/gbfs' },
                license: {
                  share_alike_optional: 'no',
                  attribution_instructions: ' Cite the provider ',
                },
              },
            ]),
      ],
    });
  });
  const target = service();
  const options = { limit: 1, search: 'seattle', fetch_error: false };
  const filtered = await target.listFeedsForOperator('o-test', createMockContext(), options);
  expect(filtered.items).toMatchObject([
    {
      onestopId: 'f-later',
      fetchUrl: 'https://example.com/gbfs',
      license: { shareAlikeOptional: 'no', attributionInstructions: 'Cite the provider' },
    },
  ]);
  expect(fetch).toHaveBeenCalledTimes(3);
  const exact = await target.listFeedsForOperator('o-test', createMockContext(), {
    ...options,
    onestop_id: '2',
  });
  expect(exact.items.map((item) => item.onestopId)).toEqual(['f-later']);
  expect(new URL(fetch.mock.calls[4]![0]).searchParams.get('id')).toBe('2');
});

it('discloses missing unfiltered refs and retains the capped detail request path', async () => {
  const fetch = mockFetch((url) => {
    if (url.pathname.endsWith('/operators/o-test'))
      return Response.json({
        operators: [
          {
            onestop_id: 'o-test',
            feeds: [{ onestop_id: 'f-stale' }, { onestop_id: 'f-beyond-cap' }],
          },
        ],
      });
    expect(url.pathname).toMatch(/\/feeds\/f-stale$/);
    return new Response(null, { status: 404 });
  });
  expect(
    await service().listFeedsForOperator('o-test', createMockContext(), { limit: 1 }),
  ).toMatchObject({
    items: [],
    notices: [expect.stringContaining('f-stale')],
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each([400, 401, 403, 404, 409, 410, 422, 429, 500, 'malformed'] as const)(
  'keeps stop rows on parent lookup failure %s',
  async (status) => {
    const fetch = mockFetch((url) => {
      if (url.pathname.endsWith('/stops'))
        return Response.json({
          stops: [
            { id: 1, onestop_id: 's-one', parent: { id: 40 } },
            { id: 2, onestop_id: 's-two', parent: { id: 40 } },
            {
              id: 3,
              onestop_id: 's-three',
              parent: { id: 50 },
              platform_code: ' 2 ',
              stop_desc: ' Northbound ',
              stop_code: '03',
            },
            { id: 50, onestop_id: 's-in-page' },
          ],
        });
      expect(url.pathname).toMatch(/\/stops\/40$/);
      return status === 'malformed'
        ? Response.json({ stops: [null] })
        : new Response(null, { status });
    });
    const page = await service().listStops({ search: 'Westlake' }, createMockContext());
    expect(page.items.map((stop) => stop.parentOnestopId)).toEqual([null, null, 's-in-page', null]);
    expect(page.items[2]).toMatchObject({
      code: '03',
      platformCode: '2',
      description: 'Northbound',
    });
    expect(page.notices).toEqual([expect.stringContaining('40')]);
    expect(fetch).toHaveBeenCalledTimes(2);
  },
);

function unresolvedStops() {
  return Response.json({
    stops: [10, 11, 12, 13].map((id) => ({
      onestop_id: `s-${id}`,
      parent: { id },
    })),
  });
}

it('rejects wrong numeric feed detail records and never requests a zero feed ID', async () => {
  const fetch = mockFetch(() =>
    Response.json({
      feeds: [
        { id: 2, onestop_id: 'f-other' },
        { id: 339, onestop_id: 'f-match' },
      ],
    }),
  );
  const target = service();
  await expect(target.getFeed('0', createMockContext())).rejects.toMatchObject({
    code: JsonRpcErrorCode.NotFound,
  });
  expect(fetch).not.toHaveBeenCalled();
  await expect(target.getFeed('339', createMockContext())).resolves.toMatchObject({
    onestopId: 'f-match',
  });
  await expect(target.getFeed('340', createMockContext())).rejects.toMatchObject({
    code: JsonRpcErrorCode.NotFound,
  });
});

it.each([
  { stops: [] },
  { stops: [{ id: 11, onestop_id: 's-wrong' }] },
  { stops: [{ id: 10, onestop_id: null }] },
])(
  'reports a successful parent lookup without a usable matching identity ($stops)',
  async ({ stops }) => {
    const fetch = mockFetch((url) =>
      url.pathname.endsWith('/stops')
        ? Response.json({ stops: [{ onestop_id: 's-child', parent: { id: 10 } }] })
        : Response.json({ stops }),
    );
    const result = await service().listStops({}, createMockContext());
    expect(result).toMatchObject({
      items: [{ onestopId: 's-child', parentOnestopId: null }],
      notices: [expect.stringContaining('10')],
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  },
);

function pendingResponse(signal: AbortSignal): Promise<Response> {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

it('stops queued parent requests after a rate limit and keeps an outstanding match', async () => {
  const fetch = mockFetch((url) => {
    if (url.pathname.endsWith('/stops')) return unresolvedStops();
    if (url.pathname.endsWith('/10')) return new Response(null, { status: 429 });
    expect(url.pathname).toMatch(/\/11$/);
    return Response.json({ stops: [{ id: 11, onestop_id: 's-parent' }] });
  });
  const result = await service().listStops({}, createMockContext());
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(result.items.map((stop) => stop.parentOnestopId)).toEqual([null, 's-parent', null, null]);
  expect(result.notices).toEqual([expect.stringMatching(/rate limited.*10, 12, 13/)]);
});

it('spends one shared five-second budget for all unresolved parents', async () => {
  vi.useFakeTimers();
  const fetch = mockFetch((url, signal) =>
    url.pathname.endsWith('/stops') ? unresolvedStops() : pendingResponse(signal),
  );
  const result = service().listStops({}, createMockContext());
  const assertion = expect(result).resolves.toMatchObject({
    notices: [expect.stringContaining('10, 11, 12, 13')],
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(5000);
  await assertion;
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('propagates caller cancellation during optional parent lookups', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const fetch = mockFetch((url, signal) =>
    url.pathname.endsWith('/stops') ? unresolvedStops() : pendingResponse(signal),
  );
  const result = service().listStops({}, createMockContext({ signal: controller.signal }));
  const assertion = expect(result).rejects.toMatchObject({
    code: JsonRpcErrorCode.RequestCancelled,
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(3);
  controller.abort();
  await assertion;
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('propagates primary stop request failures', async () => {
  const fetch = mockFetch(() => new Response(null, { status: 401 }));
  await expect(service().listStops({}, createMockContext())).rejects.toMatchObject({
    code: JsonRpcErrorCode.Unauthorized,
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('merges nested departure rows and stop alerts before the global cap', async () => {
  const alert = {
    rt_feed_onestop_id: 'f-first-rt',
    entity_id: '99',
    header_text: [{ text: 'Elevator closed' }, { text: 'Second translation' }],
    active_period: [{ start: 0 }, { end: 60 }],
  };
  const departure = (id: string, scheduled_local?: string) => ({
    departure: { scheduled_local },
    service_date: '2026-11-13',
    trip: { trip_id: id },
  });
  const fetch = mockFetch(() =>
    Response.json({
      stops: [
        {
          onestop_id: 's-station',
          departures: [departure('untimed'), departure('direct', '2026-11-14T00:00:00-08:00')],
          alerts: [alert, { header_text: [{ text: 'Unknown identity' }] }],
          children: [
            {
              onestop_id: 's-platform',
              platform_code: '2',
              alerts: [alert],
              departures: [departure('platform', '2026-11-14T08:00:00Z')],
              children: [
                {
                  onestop_id: 's-boarding',
                  departures: [
                    {
                      ...departure('first', '2026-11-14T08:03:00Z'),
                      departure: {
                        scheduled_local: '2026-11-14T08:03:00Z',
                        estimated_utc: '2026-11-14T07:59:00Z',
                      },
                      trip: { trip_id: 'first', alerts: [alert] },
                    },
                    {
                      ...departure('invalid estimate', '2026-11-14T09:00:00+01:00'),
                      departure: {
                        estimated_local: 'invalid',
                        scheduled_local: '2026-11-14T09:00:00+01:00',
                      },
                    },
                  ],
                },
              ],
            },
            {
              onestop_id: 's-entrance',
              alerts: [
                {
                  ...alert,
                  rt_feed_onestop_id: 'f-second-rt',
                  header_text: [{ text: 'Entrance' }],
                },
                { header_text: [{ text: 'Unknown identity' }] },
              ],
            },
          ],
        },
      ],
    }),
  );
  const found = await service().getDepartures('s-station', { limit: 3 }, createMockContext());
  expect(new URL(fetch.mock.calls[0]![0]).searchParams.get('include_alerts')).toBe('true');
  expect(found).toMatchObject({
    found: true,
    result: {
      realtimeAvailable: true,
      alerts: [
        {
          header: 'Elevator closed',
          description: null,
          url: null,
          effect: null,
          cause: null,
          severity: null,
          activePeriods: [
            { start: '1970-01-01T00:00:00.000Z', end: null },
            { start: null, end: '1970-01-01T00:01:00.000Z' },
          ],
        },
        { header: 'Unknown identity' },
        { header: 'Entrance' },
        { header: 'Unknown identity' },
      ],
      departures: [
        {
          tripId: 'first',
          serviceDate: '2026-11-13',
          platform: { onestopId: 's-boarding', code: null },
          alerts: [{ header: 'Elevator closed' }],
        },
        { tripId: 'direct', platform: { onestopId: 's-station', code: null } },
        { tripId: 'platform', platform: { onestopId: 's-platform', code: '2' } },
      ],
    },
  });
});
