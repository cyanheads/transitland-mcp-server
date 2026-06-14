/**
 * @fileoverview Tests for the operator and feed resources. The service is mocked; each
 * resource is verified for its happy-path record, its not-found contract, and its list().
 * @module tests/resources/resources.test
 */

import { JsonRpcErrorCode, notFound } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = {
  getOperator: vi.fn(),
  getFeed: vi.fn(),
};

vi.mock('@/services/transitland/transitland-service.js', () => ({
  getTransitlandService: () => service,
}));

const { operatorResource } = await import(
  '@/mcp-server/resources/definitions/operator.resource.js'
);
const { feedResource } = await import('@/mcp-server/resources/definitions/feed.resource.js');

beforeEach(() => {
  service.getOperator.mockReset();
  service.getFeed.mockReset();
});

describe('operatorResource', () => {
  it('returns the operator record for a valid Onestop ID', async () => {
    service.getOperator.mockResolvedValueOnce({
      onestopId: 'o-9q9-bart',
      name: 'BART',
      shortName: 'BART',
      website: null,
      agencies: [],
      feeds: [],
      tags: { wikidataId: null, usNtdId: null, twitter: null },
    });
    const ctx = createMockContext({ errors: operatorResource.errors });
    const params = operatorResource.params.parse({ onestop_id: 'o-9q9-bart' });
    const result = await operatorResource.handler(params, ctx);
    expect(result.onestopId).toBe('o-9q9-bart');
    expect(service.getOperator).toHaveBeenCalledWith('o-9q9-bart', ctx, {
      reason: 'operator_not_found',
    });
  });

  it('bubbles NotFound for a missing operator', async () => {
    service.getOperator.mockRejectedValueOnce(
      notFound('No operator found', { reason: 'operator_not_found' }),
    );
    const ctx = createMockContext({ errors: operatorResource.errors });
    const params = operatorResource.params.parse({ onestop_id: 'o-nope' });
    await expect(operatorResource.handler(params, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
    });
  });

  it('lists a discoverable example', async () => {
    const listing = await operatorResource.list!();
    expect(listing.resources.length).toBeGreaterThan(0);
    for (const r of listing.resources) {
      expect(r).toHaveProperty('uri');
      expect(r).toHaveProperty('name');
    }
  });
});

describe('feedResource', () => {
  it('returns the feed record for a valid Onestop ID', async () => {
    service.getFeed.mockResolvedValueOnce({
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
      latestFetch: {
        fetchedAt: null,
        earliestServiceDate: null,
        latestServiceDate: null,
        sha1: null,
      },
      authorizationRequired: false,
    });
    const ctx = createMockContext({ errors: feedResource.errors });
    const params = feedResource.params.parse({ onestop_id: 'f-9q9-bart' });
    const result = await feedResource.handler(params, ctx);
    expect(result.onestopId).toBe('f-9q9-bart');
    expect(result.license.redistributionAllowed).toBe('unknown');
    expect(service.getFeed).toHaveBeenCalledWith('f-9q9-bart', ctx, { reason: 'feed_not_found' });
  });

  it('bubbles NotFound for a missing feed', async () => {
    service.getFeed.mockRejectedValueOnce(notFound('No feed found', { reason: 'feed_not_found' }));
    const ctx = createMockContext({ errors: feedResource.errors });
    const params = feedResource.params.parse({ onestop_id: 'f-nope' });
    await expect(feedResource.handler(params, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
    });
  });

  it('lists a discoverable example', async () => {
    const listing = await feedResource.list!();
    expect(listing.resources.length).toBeGreaterThan(0);
  });
});
