/**
 * @fileoverview transitland://feed/{onestop_id} — feed record by Onestop ID: spec,
 * fetch URL, license, latest-fetch freshness. The catalog entry for one feed. Mirrors a
 * single-feed lookup from transitland_find_feeds.
 * @module mcp-server/resources/definitions/feed.resource
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getTransitlandService } from '@/services/transitland/transitland-service.js';

const triStateField = z.enum(['yes', 'no', 'unknown']);

export const feedResource = resource('transitland://feed/{onestop_id}', {
  name: 'transitland-feed',
  title: 'transitland-mcp-server: feed record',
  description:
    'Feed record by Onestop ID — spec, fetch URL, license terms, and latest-fetch freshness. The open-data catalog entry for one feed. Mirrors a single-feed result from transitland_find_feeds.',
  mimeType: 'application/json',
  params: z.object({
    onestop_id: z
      .string()
      .min(1)
      .describe('Feed Onestop ID (e.g. "f-9q9-bart") or internal integer ID.'),
  }),
  output: z.object({
    onestopId: z.string().describe('Feed Onestop ID.'),
    spec: z.string().describe('Feed spec: GTFS, GTFS_RT, GBFS, or MDS.'),
    name: z.string().nullable().describe('Feed name. Often null.'),
    fetchUrl: z
      .string()
      .nullable()
      .describe('Direct URL to download the current feed data. Null when the registry has none.'),
    realtimeUrls: z
      .object({
        tripUpdates: z
          .string()
          .nullable()
          .describe(
            'GTFS-RT trip-updates endpoint (delays/predictions). Non-null implies this feed powers real-time departures.',
          ),
        vehiclePositions: z.string().nullable().describe('GTFS-RT vehicle-positions endpoint.'),
        alerts: z.string().nullable().describe('GTFS-RT service-alerts endpoint.'),
      })
      .describe('Real-time endpoints when the feed carries GTFS-RT. All null for static feeds.'),
    license: z
      .object({
        spdxIdentifier: z
          .string()
          .nullable()
          .describe('SPDX license identifier when known. Null/unknown is common — do not infer.'),
        url: z.string().nullable().describe('URL of the license or terms-of-use document.'),
        redistributionAllowed: triStateField.describe(
          'Whether redistribution is permitted. "unknown" when the registry has no value — do not assume permissive.',
        ),
        commercialUseAllowed: triStateField.describe(
          'Whether commercial use is permitted. "unknown" when unspecified.',
        ),
        createDerivedProduct: triStateField.describe(
          'Whether derived products are permitted. "unknown" when unspecified.',
        ),
        useWithoutAttribution: triStateField.describe(
          'Whether attribution can be omitted. "no"/"unknown" implies attribute the source.',
        ),
        attributionText: z
          .string()
          .nullable()
          .describe('Required attribution text, when specified.'),
      })
      .describe(
        'License/terms as recorded by Transitland. Empty fields are normalized to "unknown"/null — never fabricated. Confirm against the license url before redistributing.',
      ),
    latestFetch: z
      .object({
        fetchedAt: z.string().nullable().describe('ISO 8601 timestamp of the most recent fetch.'),
        earliestServiceDate: z.string().nullable().describe('Earliest covered calendar date.'),
        latestServiceDate: z.string().nullable().describe('Latest covered calendar date.'),
        sha1: z.string().nullable().describe('Content hash of the fetched feed version.'),
      })
      .describe('Freshness of the current feed version.'),
    authorizationRequired: z
      .boolean()
      .describe('True when fetching the feed itself needs a separate API key/registration.'),
  }),
  errors: [
    {
      reason: 'feed_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No feed exists for the given Onestop ID or internal ID.',
      recovery:
        'Verify the ID format (e.g. "f-9q9-bart") or discover feeds with transitland_find_feeds.',
    },
  ],

  handler(params, ctx) {
    return getTransitlandService().getFeed(params.onestop_id, ctx, { reason: 'feed_not_found' });
  },

  list: () => ({
    resources: [
      {
        uri: 'transitland://feed/f-9q9-bart',
        name: 'BART GTFS feed (example)',
        mimeType: 'application/json',
      },
    ],
  }),
});
