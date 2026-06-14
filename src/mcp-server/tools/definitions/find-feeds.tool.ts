/**
 * @fileoverview transitland_find_feeds — discover GTFS, GTFS-Realtime, and GBFS feeds
 * in the open-data registry. The standout capability: where to legally get a place's
 * transit data, the fetch URL, the license terms, and last-fetch freshness.
 * @module mcp-server/tools/definitions/find-feeds.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getTransitlandService } from '@/services/transitland/transitland-service.js';

const triStateField = z.enum(['yes', 'no', 'unknown']);

export const findFeedsTool = tool('transitland_find_feeds', {
  title: 'transitland-mcp-server: find feeds',
  description:
    'Discover GTFS, GTFS-Realtime, and GBFS feeds in the open-data registry. Filter by operator (Onestop ID), feed spec, fetch state, or a search term. Each feed returns its Onestop ID, spec, the fetch URL to download the data, the license terms (redistribution, commercial use, attribution, SPDX identifier where known), and last-fetch freshness (when it was retrieved and the calendar window it covers). Use this to answer "where do I get this agency\'s GTFS, and may I redistribute it?". Pass operator_onestop_id (from transitland_find_operators) to list exactly the feeds an operator publishes — the reliable way to a specific agency\'s feeds; spec also narrows that set. Returns the open-data catalog entry, not departures; for schedules see transitland_get_departures. Provide at least one filter.',
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    operator_onestop_id: z
      .string()
      .optional()
      .describe(
        'Restrict to feeds published by this operator (Onestop ID, e.g. "o-9q9-bart"). The reliable way to find a specific agency\'s feeds — get the ID from transitland_find_operators.',
      ),
    spec: z
      .enum(['gtfs', 'gtfs-rt', 'gbfs', 'mds'])
      .optional()
      .describe(
        'Filter by feed spec. "gtfs" = static schedule data; "gtfs-rt" = real-time (trip updates, vehicle positions, alerts); "gbfs" = bikeshare/micromobility; "mds" = mobility data spec. Omit to return all specs. The API accepts both lowercase ("gtfs-rt") and uppercase ("GTFS_RT") on input; the output spec is always uppercase (GTFS, GTFS_RT, GBFS, MDS).',
      ),
    search: z
      .string()
      .optional()
      .describe(
        'Full-text search over feed names and identifiers (e.g. "511 Regional", "MBTA"). Useful when you know a feed by name but not its operator.',
      ),
    fetch_error: z
      .boolean()
      .optional()
      .describe(
        'When true, return only feeds whose most recent fetch failed (stale/broken sources). When false, only successfully-fetched feeds. Omit for both. Useful for data-quality auditing.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Maximum feeds to return (max 100). Page further with the after cursor.'),
    after: z
      .number()
      .int()
      .optional()
      .describe('Pagination cursor from a previous response (enrichment.cursor).'),
  }),
  output: z.object({
    feeds: z
      .array(
        z
          .object({
            onestopId: z
              .string()
              .describe('Feed Onestop ID (e.g. "f-9q9-bart"). The durable handle for this feed.'),
            spec: z.string().describe('Feed spec: GTFS, GTFS_RT, GBFS, or MDS.'),
            name: z
              .string()
              .nullable()
              .describe('Feed name. Often null for single-operator feeds.'),
            fetchUrl: z
              .string()
              .nullable()
              .describe(
                'Direct URL to download the current feed data (the GTFS .zip for static feeds; the realtime endpoint for GTFS-RT/GBFS). Null when the registry has no current URL.',
              ),
            realtimeUrls: z
              .object({
                tripUpdates: z
                  .string()
                  .nullable()
                  .describe(
                    'GTFS-RT trip-updates endpoint (delays/predictions). Non-null implies this feed powers real-time departures.',
                  ),
                vehiclePositions: z
                  .string()
                  .nullable()
                  .describe('GTFS-RT vehicle-positions endpoint.'),
                alerts: z.string().nullable().describe('GTFS-RT service-alerts endpoint.'),
              })
              .describe(
                'Real-time endpoints when the feed carries GTFS-RT. All null for a static-only GTFS feed.',
              ),
            license: z
              .object({
                spdxIdentifier: z
                  .string()
                  .nullable()
                  .describe(
                    'SPDX license identifier (e.g. "CC-BY-4.0") when the registry knows it. Null/unknown is common — do not infer a license that is not stated.',
                  ),
                url: z.string().nullable().describe('URL of the license or terms-of-use document.'),
                redistributionAllowed: triStateField.describe(
                  'Whether redistribution is permitted. "unknown" when the registry has no value — surface honestly, do not assume permissive.',
                ),
                commercialUseAllowed: triStateField.describe(
                  'Whether commercial use is permitted.',
                ),
                createDerivedProduct: triStateField.describe(
                  'Whether derived products are permitted.',
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
                'License/terms as recorded by Transitland. Empty registry fields are normalized to "unknown" or null — never fabricated. Confirm against the license url before redistributing.',
              ),
            latestFetch: z
              .object({
                fetchedAt: z
                  .string()
                  .nullable()
                  .describe(
                    'ISO 8601 timestamp of the most recent successful fetch (data freshness).',
                  ),
                earliestServiceDate: z
                  .string()
                  .nullable()
                  .describe('Earliest calendar date the current data covers (YYYY-MM-DD).'),
                latestServiceDate: z
                  .string()
                  .nullable()
                  .describe(
                    'Latest calendar date the current data covers — when service data runs out.',
                  ),
                sha1: z.string().nullable().describe('Content hash of the fetched feed version.'),
              })
              .describe(
                'Freshness of the current feed version. fetchedAt long in the past or latestServiceDate near today signals stale data.',
              ),
            authorizationRequired: z
              .boolean()
              .describe(
                'True when fetching the feed itself needs a separate API key/registration (the fetchUrl alone is insufficient).',
              ),
          })
          .describe('A matching feed with fetch URL, license, and freshness.'),
      )
      .describe('Matching feeds with fetch URLs, license terms, and freshness.'),
  }),
  enrichment: {
    totalCount: z.number().describe('Number of feeds returned.'),
    cursor: z
      .number()
      .optional()
      .describe('Pass as `after` to fetch the next page. Present only when more results exist.'),
    truncated: z.boolean().optional().describe('True when results were capped at the limit.'),
    shown: z.number().optional().describe('Number of feeds returned.'),
    cap: z.number().optional().describe('The limit applied.'),
    notice: z.string().optional().describe('Guidance when nothing matched.'),
  },
  errors: [
    {
      reason: 'no_filter',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'No operator_onestop_id, spec, search, or fetch_error filter was provided (server-enforced guard — the upstream API accepts unfiltered requests but returns a global firehose).',
      recovery:
        'Provide at least one filter — operator_onestop_id (from transitland_find_operators) is the most reliable.',
    },
    {
      reason: 'operator_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'operator_onestop_id was provided but no operator exists for it (feeds are resolved from the operator record).',
      recovery:
        'Verify the operator Onestop ID (e.g. "o-9q9-bart") or find it with transitland_find_operators.',
    },
    {
      reason: 'rate_limited',
      code: JsonRpcErrorCode.ServiceUnavailable,
      retryable: true,
      when: 'Transitland returned HTTP 429.',
      recovery: 'Wait a few seconds and retry; the free key is rate-limited.',
    },
  ],

  async handler(input, ctx) {
    const hasFilter =
      !!input.operator_onestop_id ||
      !!input.spec ||
      !!input.search ||
      input.fetch_error !== undefined;
    if (!hasFilter) {
      throw ctx.fail('no_filter', undefined, { ...ctx.recoveryFor('no_filter') });
    }

    const service = getTransitlandService();
    // Transitland's /feeds endpoint has no operator filter, so an operator scope
    // is satisfied by resolving the operator record's feeds (the search/fetch_error
    // filters and the cursor don't apply to that resolved set — spec still narrows).
    const page = input.operator_onestop_id
      ? await service.listFeedsForOperator(input.operator_onestop_id, ctx, {
          ...(input.spec && { spec: input.spec }),
          limit: input.limit,
          failReason: { reason: 'operator_not_found' },
        })
      : await service.listFeeds(
          {
            spec: input.spec,
            search: input.search,
            fetch_error: input.fetch_error,
            limit: input.limit,
            after: input.after,
          },
          ctx,
        );
    ctx.enrich.total(page.items.length);
    if (page.after !== undefined) ctx.enrich({ cursor: page.after });
    if (page.items.length >= input.limit) {
      ctx.enrich.truncated({ shown: page.items.length, cap: input.limit });
    }
    if (page.items.length === 0) {
      ctx.enrich.notice(
        input.operator_onestop_id
          ? 'This operator publishes no feeds matching that spec. Drop the spec filter, or check the operator record with transitland_get_operator.'
          : 'No feeds matched. Find the operator with transitland_find_operators, then pass its operator_onestop_id here to list its feeds.',
      );
    }
    ctx.log.info('find_feeds resolved', { count: page.items.length });
    return { feeds: page.items };
  },

  format: (result) => {
    if (result.feeds.length === 0) {
      return [{ type: 'text', text: 'No feeds matched.' }];
    }
    const lines: string[] = [];
    for (const feed of result.feeds) {
      lines.push(`## ${feed.onestopId} — ${feed.spec}${feed.name ? ` (${feed.name})` : ''}`);
      lines.push(`**Fetch URL:** ${feed.fetchUrl ?? 'Not available'}`);
      lines.push(
        `**Authorization required:** ${feed.authorizationRequired ? 'Yes (separate key/registration)' : 'No'}`,
      );
      const rt = feed.realtimeUrls;
      if (rt.tripUpdates || rt.vehiclePositions || rt.alerts) {
        lines.push(
          `**Realtime:** trip-updates ${rt.tripUpdates ?? '—'} · vehicles ${rt.vehiclePositions ?? '—'} · alerts ${rt.alerts ?? '—'}`,
        );
      } else {
        lines.push('**Realtime:** none (static feed)');
      }
      const lic = feed.license;
      lines.push(
        `**License:** SPDX ${lic.spdxIdentifier ?? 'unknown'} · redistribution ${lic.redistributionAllowed} · commercial ${lic.commercialUseAllowed} · derived ${lic.createDerivedProduct} · attribution-optional ${lic.useWithoutAttribution}`,
      );
      lines.push(`**License URL:** ${lic.url ?? 'Not available'}`);
      lines.push(`**Attribution text:** ${lic.attributionText ?? 'Not available'}`);
      const fetch = feed.latestFetch;
      lines.push(
        `**Latest fetch:** ${fetch.fetchedAt ?? 'Not available'} · covers ${fetch.earliestServiceDate ?? '?'} → ${fetch.latestServiceDate ?? '?'} · sha1 ${fetch.sha1 ?? 'n/a'}`,
      );
      lines.push('');
    }
    return [{ type: 'text', text: lines.join('\n').trimEnd() }];
  },
});
