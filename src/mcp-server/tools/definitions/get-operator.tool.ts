/**
 * @fileoverview transitland_get_operator — fetch the full operator record by Onestop ID
 * or internal integer ID, including agencies, places served, published feeds, and source
 * tags (Wikidata QID, US NTD ID, social handles).
 * @module mcp-server/tools/definitions/get-operator.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getTransitlandService } from '@/services/transitland/transitland-service.js';

export const getOperatorTool = tool('transitland_get_operator', {
  title: 'transitland-mcp-server: get operator',
  description:
    'Fetch the full operator record by Onestop ID or internal integer ID — the agencies it covers, the places served, the feeds it publishes, and source tags (Wikidata QID, US NTD ID, social handles). Use when you already hold an operator ID and want the complete record without a search round-trip.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    operator_key: z
      .string()
      .min(1)
      .describe(
        'Operator Onestop ID (e.g. "o-9q9-bart") or internal integer ID. Get one from transitland_find_operators or an operator reference in another result.',
      ),
  }),
  output: z.object({
    onestopId: z.string().describe('Stable public Onestop ID.'),
    name: z.string().describe('Operator name.'),
    shortName: z.string().nullable().describe('Short name/abbreviation. Null when omitted.'),
    website: z.string().nullable().describe('Operator website. Null when unknown.'),
    agencies: z
      .array(
        z
          .object({
            agencyId: z.string().describe('GTFS agency_id (feed-local identifier).'),
            agencyName: z.string().describe('Agency name as published in its feed.'),
            places: z
              .array(
                z
                  .object({
                    country: z.string().nullable().describe('Country (adm0) name.'),
                    region: z.string().nullable().describe('State/province (adm1) name.'),
                    city: z.string().nullable().describe('City name.'),
                  })
                  .describe('A place this agency serves.'),
              )
              .describe('Places this agency serves.'),
          })
          .describe('An agency grouped under this operator.'),
      )
      .describe(
        'Agencies grouped under this operator. A single operator may bundle several GTFS agencies.',
      ),
    feeds: z
      .array(
        z
          .object({
            onestopId: z
              .string()
              .describe(
                'Feed Onestop ID. Pass to transitland_find_feeds or the feed resource for license + fetch URL.',
              ),
            spec: z.string().describe('Feed spec: GTFS, GTFS_RT, GBFS, or MDS.'),
            name: z.string().nullable().describe('Feed name. Often null.'),
          })
          .describe('A feed this operator publishes.'),
      )
      .describe('Feeds this operator publishes.'),
    tags: z
      .object({
        wikidataId: z
          .string()
          .nullable()
          .describe('Wikidata QID (e.g. "Q610120") for wikidata-mcp-server cross-reference.'),
        usNtdId: z
          .string()
          .nullable()
          .describe('US National Transit Database ID, where applicable.'),
        twitter: z.string().nullable().describe('General Twitter/X handle, where published.'),
      })
      .describe('Selected source tags. Fields are null when the registry has no value.'),
  }),
  errors: [
    {
      reason: 'operator_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No operator exists for the given Onestop ID or internal ID.',
      recovery:
        'Verify the ID format (e.g. "o-9q9-bart") or search with transitland_find_operators to get a valid Onestop ID.',
    },
    {
      reason: 'rate_limited',
      code: JsonRpcErrorCode.ServiceUnavailable,
      retryable: true,
      when: 'Transitland returned HTTP 429.',
      recovery: 'Wait a few seconds and retry; the free key is rate-limited.',
    },
  ],

  handler(input, ctx) {
    ctx.log.info('get_operator', { operatorKey: input.operator_key });
    return getTransitlandService().getOperator(input.operator_key, ctx, {
      reason: 'operator_not_found',
    });
  },

  format: (result) => {
    const lines: string[] = [];
    lines.push(`## ${result.name}${result.shortName ? ` (${result.shortName})` : ''}`);
    lines.push(`**Onestop ID:** ${result.onestopId}`);
    lines.push(`**Website:** ${result.website ?? 'Not available'}`);
    lines.push(
      `**Tags:** Wikidata ${result.tags.wikidataId ?? 'Not available'} · NTD ${result.tags.usNtdId ?? 'Not available'} · Twitter ${result.tags.twitter ?? 'Not available'}`,
    );
    if (result.agencies.length > 0) {
      lines.push('', '### Agencies');
      for (const agency of result.agencies) {
        const places = agency.places
          .map((p) => [p.city, p.region, p.country].filter(Boolean).join(', '))
          .filter(Boolean)
          .join(' · ');
        lines.push(
          `- **${agency.agencyName}** (\`${agency.agencyId}\`)${places ? ` — ${places}` : ''}`,
        );
      }
    }
    if (result.feeds.length > 0) {
      lines.push('', '### Feeds');
      for (const feed of result.feeds) {
        lines.push(`- ${feed.onestopId} (${feed.spec})${feed.name ? ` — ${feed.name}` : ''}`);
      }
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
