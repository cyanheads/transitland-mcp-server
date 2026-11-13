/**
 * @fileoverview transitland_find_operators — find transit operators/agencies by name,
 * near a point or bounding box, by country/region, or by Onestop ID. The entry point
 * for "what transit runs here?". Surfaces scheduled-data operators and their feeds.
 * @module mcp-server/tools/definitions/find-operators.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { bboxSchema, normalizeBbox } from '@/mcp-server/shared/bbox-schema.js';
import { enrichPage } from '@/mcp-server/shared/enrich-page.js';
import { formatUrl, formatValue } from '@/mcp-server/shared/format-value.js';
import { getTransitlandService } from '@/services/transitland/transitland-service.js';

export const findOperatorsTool = tool('transitland_find_operators', {
  title: 'transitland-mcp-server: find operators',
  description:
    'Find transit operators/agencies by name, near a point or within a bounding box, by country/region, or by Onestop ID. Returns each operator\'s Onestop ID, name, the agencies it covers, the places it serves, and the feeds it publishes. The entry point for "what transit runs here?". Transitland does not geocode place names — geocode a city to coordinates with openstreetmap_search_places first, then pass lat and lon (with an optional radius) or a bbox. Provide at least one of: search, lat+lon, bbox, onestop_id, or a place filter (adm0_name/adm1_name).',
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    search: z
      .string()
      .optional()
      .describe(
        'Full-text search over operator and agency names (e.g. "BART", "Sound Transit"). Upstream-ranked. Combine with a place filter to disambiguate common names.',
      ),
    onestop_id: z
      .string()
      .optional()
      .describe(
        'Operator Onestop ID (e.g. "o-9q9-bart") for a direct lookup. For the complete record prefer transitland_get_operator.',
      ),
    lat: z
      .number()
      .min(-90)
      .max(90)
      .optional()
      .describe(
        'Latitude of the search center (WGS84 decimal degrees). Requires lon. Transitland does not geocode — use openstreetmap_search_places to turn a place name into coordinates first.',
      ),
    lon: z
      .number()
      .min(-180)
      .max(180)
      .optional()
      .describe('Longitude of the search center (WGS84 decimal degrees). Requires lat.'),
    radius: z
      .number()
      .min(0)
      .max(100000)
      .default(1000)
      .describe(
        'Search radius in meters around lat/lon (max 100,000). Operators are matched when their service area intersects the radius.',
      ),
    bbox: bboxSchema,
    adm0_name: z
      .string()
      .optional()
      .describe(
        'Filter to a country by full English name (e.g. "United States of America", "Germany"). Coarse — pair with search or geography to narrow.',
      ),
    adm1_name: z
      .string()
      .optional()
      .describe(
        'Filter to a state/province/region by full name (e.g. "California"). Use with adm0_name.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .default(20)
      .describe(
        'Maximum operators to return. Values above 100 apply the 100-result page cap with a notice. Page further with the after cursor.',
      ),
    after: z
      .number()
      .int()
      .optional()
      .describe('Pagination cursor from a previous response (cursor). The next page may be empty.'),
  }),
  output: z.object({
    operators: z
      .array(
        z
          .object({
            onestopId: z
              .string()
              .describe(
                'Stable public Onestop ID (e.g. "o-9q9-bart"). Use for transitland_get_operator and as operator_onestop_id in find_feeds/find_routes.',
              ),
            name: z.string().describe('Operator name.'),
            shortName: z
              .string()
              .nullable()
              .describe('Short name/abbreviation (e.g. "BART"). Null when the feed omits it.'),
            website: z.string().nullable().describe('Operator website. Null when unknown.'),
            places: z
              .array(
                z
                  .object({
                    country: z.string().nullable().describe('Country (adm0) name.'),
                    region: z.string().nullable().describe('State/province (adm1) name.'),
                    city: z
                      .string()
                      .nullable()
                      .describe('City name. Null when the agency spans no single city.'),
                  })
                  .describe('A place (country/region/city) the operator serves.'),
              )
              .describe(
                'Distinct places this operator serves, summarized from its agencies. Empty when unmapped.',
              ),
            feeds: z
              .array(
                z
                  .object({
                    onestopId: z
                      .string()
                      .describe(
                        'Feed Onestop ID. Pass to transitland_find_feeds as onestop_id for license and fetch URL.',
                      ),
                    spec: z.string().describe('Feed spec: GTFS, GTFS_RT, GBFS, or MDS.'),
                    name: z.string().nullable().describe('Feed name. Often null.'),
                  })
                  .describe('A feed this operator publishes.'),
              )
              .describe(
                'Feeds this operator publishes. The bridge to the open-data catalog — a GTFS_RT entry here means real-time departures may be available.',
              ),
            wikidataId: z
              .string()
              .nullable()
              .describe(
                'Wikidata QID from source tags (e.g. "Q610120"), for cross-referencing wikidata-mcp-server. Null when absent.',
              ),
          })
          .describe('A matching operator.'),
      )
      .describe('Matching operators, upstream-ranked.'),
  }),
  enrichment: {
    totalCount: z.number().describe('Number of operators returned.'),
    cursor: z
      .number()
      .optional()
      .describe('Pass as after with the same filters to fetch the next page, which may be empty.'),
    truncated: z.boolean().optional().describe('True when results were capped at the limit.'),
    shown: z.number().optional().describe('Number of operators returned.'),
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
      when: 'No search, coordinates, bbox, onestop_id, or place filter was provided (server-enforced guard — the API accepts unfiltered requests but returns a paginated global dump).',
      recovery:
        'Provide at least one of: search, lat+lon, bbox, onestop_id, or adm0_name. For a place, geocode it with openstreetmap_search_places first.',
    },
    {
      reason: 'incomplete_point',
      code: JsonRpcErrorCode.ValidationError,
      when: 'lat without lon or lon without lat.',
      recovery: 'Provide both lat and lon together, or use bbox instead for an area.',
    },
    {
      reason: 'rate_limited',
      code: JsonRpcErrorCode.RateLimited,
      retryable: true,
      thrownBy: 'service',
      when: 'Transitland returned HTTP 429 (free-tier rate limit).',
      recovery:
        'Wait a few seconds and retry. The free key is rate-limited; a Pro key raises the quota.',
    },
  ],

  async handler(input, ctx) {
    const limit = Math.min(input.limit, 100);
    if ((input.lat === undefined) !== (input.lon === undefined)) {
      throw ctx.fail('incomplete_point');
    }
    const hasPoint = input.lat !== undefined && input.lon !== undefined;
    const bbox = normalizeBbox(input.bbox);
    const hasFilter =
      !!input.search ||
      !!input.onestop_id ||
      hasPoint ||
      !!bbox ||
      !!input.adm0_name ||
      !!input.adm1_name;
    if (!hasFilter) {
      throw ctx.fail('no_filter');
    }

    const params: Record<string, string | number | boolean | undefined> = {
      limit,
      search: input.search,
      onestop_id: input.onestop_id,
      adm0_name: input.adm0_name,
      adm1_name: input.adm1_name,
      bbox,
      after: input.after,
    };
    if (hasPoint) {
      params.lat = input.lat;
      params.lon = input.lon;
      params.radius = input.radius;
    }

    const page = await getTransitlandService().listOperators(params, ctx);
    enrichPage(ctx, page, {
      limit,
      requestedLimit: input.limit,
      after: input.after,
      firstPageNotice: page.notices?.length
        ? ''
        : 'No operators matched. If you passed a place name, Transitland needs coordinates — geocode it with openstreetmap_search_places first, then pass lat/lon or bbox. Otherwise broaden the search or radius.',
    });
    ctx.log.info('find_operators resolved', { count: page.items.length });
    return { operators: page.items };
  },

  format: (result) => {
    if (result.operators.length === 0) {
      return [{ type: 'text', text: 'No operators on this page.' }];
    }
    const lines: string[] = [];
    for (const op of result.operators) {
      lines.push(
        `**Operator:** ${formatValue(op.name)}${op.shortName === null ? '' : ` (${formatValue(op.shortName)})`}`,
      );
      lines.push(`**Onestop ID:** ${formatValue(op.onestopId)}`);
      lines.push(`**Website:** ${formatUrl(op.website)}`);
      lines.push(`**Wikidata:** ${formatValue(op.wikidataId)}`);
      if (op.places.length > 0) {
        const places = op.places
          .map((p) => [p.city, p.region, p.country].filter(Boolean).join(', '))
          .filter(Boolean)
          .join(' · ');
        lines.push(`**Places:** ${formatValue(places || null)}`);
      } else {
        lines.push('**Places:** Not available');
      }
      if (op.feeds.length > 0) {
        lines.push(
          `**Feeds:** ${op.feeds.map((f) => `${formatValue(f.onestopId)} (${formatValue(f.spec)})${f.name === null ? '' : ` "${formatValue(f.name)}"`}`).join(', ')}`,
        );
      } else {
        lines.push('**Feeds:** Not available');
      }
      lines.push('');
    }
    return [{ type: 'text', text: lines.join('\n').trimEnd() }];
  },
});
