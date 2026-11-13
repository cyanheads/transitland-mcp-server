/**
 * @fileoverview transitland_find_feeds — discover GTFS, GTFS-Realtime, GBFS, and MDS feeds
 * in the open-data registry. The standout capability: where to legally get a place's
 * transit data, the fetch URL, the license terms, and feed-version metadata.
 * @module mcp-server/tools/definitions/find-feeds.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { enrichPage } from '@/mcp-server/shared/enrich-page.js';
import { formatUrl, formatValue } from '@/mcp-server/shared/format-value.js';
import { getTransitlandService } from '@/services/transitland/transitland-service.js';

const triStateField = z.enum(['yes', 'no', 'unknown']);

export const findFeedsTool = tool('transitland_find_feeds', {
  title: 'transitland-mcp-server: find feeds',
  description:
    "Discover GTFS, GTFS-Realtime, and GBFS feeds in the open-data registry. Filter by exact feed ID, operator, feed spec, fetch state, or a search term. Each feed returns its Onestop ID, spec, the fetch URL to download the data, the license terms (redistribution, commercial use, attribution, SPDX identifier where known), and the selected feed version's recorded fetch timestamp and service dates. Use this to answer \"where do I get this agency's GTFS, and may I redistribute it?\". Pass operator_onestop_id (from transitland_find_operators) to list exactly the feeds an operator publishes — the reliable way to a specific agency's feeds; the other filters narrow that set. Returns the open-data catalog entry, not departures; for schedules see transitland_get_departures. Provide at least one filter.",
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    onestop_id: z
      .string()
      .optional()
      .describe(
        'Exact feed Onestop ID (e.g. "f-9q9-bart") or positive internal feed ID as a string. Combines with the other filters.',
      ),
    operator_onestop_id: z
      .string()
      .optional()
      .describe(
        'Restrict to feeds published by this operator (Onestop ID, e.g. "o-9q9-bart"). The reliable way to find a specific agency\'s feeds — get the ID from transitland_find_operators.',
      ),
    spec: z
      .string()
      .pipe(
        z.preprocess(
          (value) => (typeof value === 'string' ? value.toLowerCase().replace(/_/g, '-') : value),
          z.enum(['gtfs', 'gtfs-rt', 'gbfs', 'mds']),
        ),
      )
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
      .default(20)
      .describe(
        'Maximum feeds to return. Values above 100 apply the 100-result page cap with a notice. Page further with the after cursor.',
      ),
    after: z
      .number()
      .int()
      .optional()
      .describe(
        'Pagination cursor from a previous response (cursor). The next page may be empty. Ignored when filtering by operator.',
      ),
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
                'Download or discovery URL for this feed spec. Null when the registry has no current URL.',
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
              .describe('GTFS-RT endpoints. All null when the registry lists none.'),
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
                  'Whether attribution can be omitted. "unknown" means the registry has no recorded term.',
                ),
                shareAlikeOptional: triStateField.describe(
                  'Whether share-alike terms are optional.',
                ),
                attributionInstructions: z
                  .string()
                  .nullable()
                  .describe('Attribution instructions when published.'),
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
                  .describe('ISO 8601 fetch timestamp recorded on the selected feed version.'),
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
                'Recorded fetch timestamp and service coverage of the selected feed version.',
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
      .describe(
        'Pass as after with the same filters to fetch the next page, which may be empty. Absent for operator-scoped feeds.',
      ),
    truncated: z.boolean().optional().describe('True when results were capped at the limit.'),
    shown: z.number().optional().describe('Number of feeds returned.'),
    cap: z.number().optional().describe('The limit applied.'),
    notice: z
      .string()
      .optional()
      .describe('Page status, continuation guidance, or service notices.'),
  },
  errors: [
    {
      reason: 'no_filter',
      code: JsonRpcErrorCode.ValidationError,
      when: 'No onestop_id, operator_onestop_id, spec, search, or fetch_error filter was provided (server-enforced guard — the upstream API accepts unfiltered requests but returns a global firehose).',
      recovery:
        'Provide at least one filter — operator_onestop_id (from transitland_find_operators) is the most reliable.',
    },
    {
      reason: 'operator_not_found',
      code: JsonRpcErrorCode.NotFound,
      thrownBy: 'service',
      when: 'operator_onestop_id was provided but no operator exists for it (feeds are resolved from the operator record).',
      recovery:
        'Verify the operator Onestop ID (e.g. "o-9q9-bart") or find it with transitland_find_operators.',
    },
    {
      reason: 'rate_limited',
      code: JsonRpcErrorCode.RateLimited,
      retryable: true,
      thrownBy: 'service',
      when: 'Transitland returned HTTP 429.',
      recovery: 'Wait a few seconds and retry; the free key is rate-limited.',
    },
  ],

  async handler(input, ctx) {
    const limit = Math.min(input.limit, 100);
    const hasFilter =
      !!input.onestop_id ||
      !!input.operator_onestop_id ||
      !!input.spec ||
      !!input.search ||
      input.fetch_error !== undefined;
    if (!hasFilter) {
      throw ctx.fail('no_filter');
    }

    const service = getTransitlandService();
    const page = input.operator_onestop_id
      ? await service.listFeedsForOperator(input.operator_onestop_id, ctx, {
          ...(input.spec && { spec: input.spec }),
          ...(input.onestop_id && { onestop_id: input.onestop_id }),
          ...(input.search !== undefined && { search: input.search }),
          ...(input.fetch_error !== undefined && { fetch_error: input.fetch_error }),
          limit,
          failReason: { reason: 'operator_not_found' },
        })
      : await service.listFeeds(
          {
            onestop_id: input.onestop_id,
            spec: input.spec,
            search: input.search,
            fetch_error: input.fetch_error,
            limit,
            after: input.after,
          },
          ctx,
        );
    enrichPage(ctx, page, {
      limit,
      requestedLimit: input.limit,
      after: input.after,
      singlePage: Boolean(input.operator_onestop_id),
      firstPageNotice: input.operator_onestop_id
        ? 'This operator publishes no feeds matching these filters. Broaden the filters or check the operator record with transitland_get_operator.'
        : 'No feeds matched. Check the exact feed ID or broaden the filters. To find an operator’s feeds, get its Onestop ID with transitland_find_operators and pass it as operator_onestop_id.',
    });
    ctx.log.info('find_feeds resolved', { count: page.items.length });
    return { feeds: page.items };
  },

  format: (result) => {
    if (result.feeds.length === 0) {
      return [{ type: 'text', text: 'No feeds on this page.' }];
    }
    const lines: string[] = [];
    for (const feed of result.feeds) {
      lines.push(`**Feed:** ${formatValue(feed.onestopId)} — ${formatValue(feed.spec)}`);
      lines.push(`**Name:** ${formatValue(feed.name)}`);
      lines.push(`**Fetch URL:** ${formatUrl(feed.fetchUrl)}`);
      lines.push(
        `**Authorization required:** ${feed.authorizationRequired ? 'Yes (separate key/registration)' : 'No'}`,
      );
      const rt = feed.realtimeUrls;
      if (rt.tripUpdates || rt.vehiclePositions || rt.alerts) {
        lines.push(
          `**GTFS-RT endpoints:** trip-updates ${formatUrl(rt.tripUpdates)} · vehicles ${formatUrl(rt.vehiclePositions)} · alerts ${formatUrl(rt.alerts)}`,
        );
      } else {
        lines.push('**GTFS-RT endpoints:** None');
      }
      const lic = feed.license;
      lines.push(
        `**License:** SPDX ${formatValue(lic.spdxIdentifier ?? 'unknown')} · redistribution ${lic.redistributionAllowed} · commercial ${lic.commercialUseAllowed} · derived ${lic.createDerivedProduct} · attribution-optional ${lic.useWithoutAttribution} · share-alike-optional ${lic.shareAlikeOptional}`,
      );
      lines.push(`**License URL:** ${formatUrl(lic.url)}`);
      lines.push(`**Attribution text:** ${formatValue(lic.attributionText)}`);
      lines.push(`**Attribution instructions:** ${formatValue(lic.attributionInstructions)}`);
      const fetch = feed.latestFetch;
      lines.push(
        `**Feed version fetch timestamp:** ${formatValue(fetch.fetchedAt)} · covers ${formatValue(fetch.earliestServiceDate)} → ${formatValue(fetch.latestServiceDate)} · sha1 ${formatValue(fetch.sha1)}`,
      );
      lines.push('');
    }
    return [{ type: 'text', text: lines.join('\n').trimEnd() }];
  },
});
