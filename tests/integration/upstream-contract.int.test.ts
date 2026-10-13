/**
 * @fileoverview Exercises real HTTP classification, sparse output and input normalization.
 * @module tests/integration/upstream-contract.int.test
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { findFeedsTool } from '@/mcp-server/tools/definitions/find-feeds.tool.js';
import { findOperatorsTool } from '@/mcp-server/tools/definitions/find-operators.tool.js';
import { findRoutesTool } from '@/mcp-server/tools/definitions/find-routes.tool.js';
import { findStopsTool } from '@/mcp-server/tools/definitions/find-stops.tool.js';
import { getDeparturesTool } from '@/mcp-server/tools/definitions/get-departures.tool.js';
import { getOperatorTool } from '@/mcp-server/tools/definitions/get-operator.tool.js';
import { initTransitlandService } from '@/services/transitland/transitland-service.js';

let status = 200;
let body: unknown = {};
let pauseResponse = false;
let onRequest = () => {};
const requests: URL[] = [];
const server = createServer((req, res) => {
  requests.push(new URL(req.url!, 'http://127.0.0.1'));
  onRequest();
  if (pauseResponse) return;
  res.writeHead(status, { 'content-type': 'application/json', 'retry-after': '0' });
  res.end(JSON.stringify(body));
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  vi.stubEnv('TRANSITLAND_API_KEY', 'integration-test-key');
  vi.stubEnv('TRANSITLAND_BASE_URL', `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  initTransitlandService({} as never, {} as never);
});
beforeEach(() => {
  status = 200;
  body = {};
  pauseResponse = false;
  onRequest = () => {};
  requests.length = 0;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  vi.unstubAllEnvs();
});
const textOf = (result: Awaited<ReturnType<typeof runToolContract>>) =>
  result.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');

describe('real upstream tool contracts', () => {
  it('preserves caller cancellation without continuing the request or retry loop', async () => {
    pauseResponse = true;
    const started = Promise.withResolvers<void>();
    onRequest = () => started.resolve();
    const controller = new AbortController();
    const pending = runToolContract(
      findStopsTool,
      { search: 'test' },
      { context: { signal: controller.signal } },
    );
    await started.promise;
    controller.abort();
    const result = await pending;
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.RequestCancelled },
    });
    expect(textOf(result)).toContain('was aborted');
    expect(requests).toHaveLength(1);
  });
  it('normalizes uppercase specs while resolving an operator feed set', async () => {
    body = {
      operators: [
        {
          onestop_id: 'o-test',
          feeds: [
            { onestop_id: 'f-static', spec: 'GTFS' },
            { onestop_id: 'f-rt', spec: 'GTFS_RT' },
          ],
        },
      ],
      feeds: [{ onestop_id: 'f-rt', spec: 'GTFS_RT' }],
    };
    const result = await runToolContract(findFeedsTool, {
      operator_onestop_id: 'o-test',
      spec: 'GTFS_RT',
    });
    expect(result.structuredContent).toMatchObject({
      feeds: [{ onestopId: 'f-rt', spec: 'GTFS_RT' }],
    });
    expect(textOf(result)).toContain('f-rt — GTFS_RT');
    expect(requests.map((r) => r.pathname)).toEqual(['/operators/o-test', '/feeds/f-rt']);
  });
  it('retains the missing-key and unauthorized classifications through real fetch', async () => {
    status = 401;
    const unauthorized = await runToolContract(findStopsTool, { search: 'test' });
    expect(unauthorized.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.Unauthorized },
    });
    expect(textOf(unauthorized)).toContain('TRANSITLAND_API_KEY');
    expect(requests).toHaveLength(1);
    requests.length = 0;
    status = 404;
    const missing = await runToolContract(getOperatorTool, { operator_key: 'o-missing' });
    expect(missing.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.NotFound, data: { reason: 'operator_not_found' } },
    });
    expect(textOf(missing)).toContain('No operator found for "o-missing"');
    expect(requests).toHaveLength(1);
  });
  it('preserves unknown stop coordinates and true zero on both surfaces', async () => {
    body = {
      stops: [
        { onestop_id: 's-missing', geometry: null },
        { onestop_id: 's-zero', geometry: { coordinates: [0, 0] } },
      ],
    };
    const result = await runToolContract(findStopsTool, { search: 'test' });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      stops: [
        { lat: null, lon: null },
        { lat: 0, lon: 0 },
      ],
    });
    expect(textOf(result)).toContain('Coordinates:** unknown, unknown');
    expect(textOf(result)).toContain('Coordinates:** 0, 0');
  });
  it('renders missing and extended route modes on both surfaces', async () => {
    body = { routes: [{ onestop_id: 'r-missing' }, { onestop_id: 'r-coach', route_type: 209 }] };
    const result = await runToolContract(findRoutesTool, { search: 'test' });
    expect(result.structuredContent).toMatchObject({
      routes: [
        { routeType: null, mode: 'unknown' },
        { routeType: 209, mode: 'coach' },
      ],
    });
    expect(textOf(result)).toContain('unknown (route_type unknown)');
    expect(textOf(result)).toContain('coach (route_type 209)');
  });
  it('renders missing and extended modes inside departure records', async () => {
    body = {
      stops: [
        { onestop_id: 's-test', departures: [{}, { trip: { route: { route_type: 1000 } } }] },
      ],
    };
    const result = await runToolContract(getDeparturesTool, { stop_key: 's-test' });
    expect(result.structuredContent).toMatchObject({
      departures: [{ route: { mode: 'unknown' } }, { route: { mode: 'water transport' } }],
    });
    expect(textOf(result)).toContain('· unknown ·');
    expect(textOf(result)).toContain('· water transport ·');
  });
  it.each(['GTFS', 'GTFS_RT', 'gtfs_rt', 'GtFs-Rt', 'GBFS', 'MDS', 'gtfs', 'gtfs-rt'])(
    'normalizes %s before upstream work',
    async (spec) => {
      body = { feeds: [{ onestop_id: 'f-test', spec: spec.toUpperCase().replace('-', '_') }] };
      const result = await runToolContract(findFeedsTool, { spec });
      expect(result.isError).not.toBe(true);
      expect(requests).toHaveLength(1);
      expect(requests[0]!.searchParams.get('spec')).toBe(spec.toLowerCase().replace('_', '-'));
      expect(textOf(result)).toContain('f-test');
    },
  );
  it('advertises accepted spec forms without excluding uppercase input', () => {
    const schema = z.toJSONSchema(findFeedsTool.input, { io: 'input' });
    expect(schema.properties?.spec).toMatchObject({ type: 'string' });
    expect(schema.properties?.spec).not.toHaveProperty('enum');
  });
  it('rejects unknown specs before fetching', async () => {
    const result = await runToolContract(findFeedsTool, { spec: 'GTFS___RT' });
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.InvalidParams, data: { reason: 'invalid_arguments' } },
    });
    expect(requests).toHaveLength(0);
  });
  const calls = [
    { tool: findStopsTool, run: () => runToolContract(findStopsTool, { search: 'test' }) },
    { tool: findRoutesTool, run: () => runToolContract(findRoutesTool, { search: 'test' }) },
    { tool: findOperatorsTool, run: () => runToolContract(findOperatorsTool, { search: 'test' }) },
    { tool: findFeedsTool, run: () => runToolContract(findFeedsTool, { search: 'test' }) },
    {
      tool: getOperatorTool,
      run: () => runToolContract(getOperatorTool, { operator_key: 'o-test' }),
    },
    {
      tool: getDeparturesTool,
      run: () => runToolContract(getDeparturesTool, { stop_key: 's-test' }),
    },
  ];
  it.each(calls)(
    'carries rate-limit recovery after real fetch retries ($tool.name)',
    async ({ tool, run }) => {
      status = 429;
      body = { error: 'too many requests' };
      const realSetTimeout = globalThis.setTimeout;
      const clock = vi
        .spyOn(globalThis, 'setTimeout')
        .mockImplementation((callback, delay, ...args) =>
          realSetTimeout(
            callback,
            delay !== undefined && delay >= 1000 && delay < 8000 ? 0 : delay,
            ...args,
          ),
        );
      let result: Awaited<ReturnType<typeof runToolContract>>;
      try {
        result = await run();
      } finally {
        clock.mockRestore();
      }
      const contract = tool.errors!.find((e) => e.reason === 'rate_limited')!;
      expect(requests).toHaveLength(4);
      expect(contract.code).toBe(JsonRpcErrorCode.RateLimited);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: JsonRpcErrorCode.RateLimited,
          data: {
            reason: 'rate_limited',
            retryable: true,
            retryAttempts: 4,
            recovery: { hint: contract.recovery },
          },
        },
      });
      expect(textOf(result)).toContain(contract.recovery);
      expect(textOf(result)).toContain('reason rate_limited');
      expect(JSON.stringify(result)).not.toContain('integration-test-key');
    },
  );
});
