/**
 * @fileoverview transitland_find_operators — find transit operators/agencies by name,
 * near a point or bounding box, by country/region, or by Onestop ID. The entry point
 * for "what transit runs here?". Surfaces scheduled-data operators and their feeds.
 * @module mcp-server/tools/definitions/find-operators.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getTransitlandService } from '@/services/transitland/transitland-service.js';

export const findOperatorsTool = tool('transitland_find_operators', {
  title: 'transitland-mcp-server: find operators',
  description:
    'Find transit operators/agencies by name, near a point or within a bounding box, by country/region, or by Onestop ID. Returns each operator\'s Onestop ID, name, the agencies it covers, the places it serves, and the feeds it publishes. The entry point for "what transit runs here?". Transitland does not geocode place names — geocode a city to coordinates with openstreetmap_geocode first, then pass lat and lon (with an optional radius) or a bbox. Provide at least one of: search, lat+lon, bbox, onestop_id, or a place filter (adm0_name/adm1_name).',
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
        'Operator Onestop ID (e.g. "o-9q9-bart") or internal integer ID, for a direct lookup. When set, other filters are ignored. For the complete record prefer transitland_get_operator.',
      ),
    lat: z
      .number()
      .min(-90)
      .max(90)
      .optional()
      .describe(
        'Latitude of the search center (WGS84 decimal degrees). Requires lon. Transitland does not geocode — use openstreetmap_geocode to turn a place name into coordinates first.',
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
    bbox: z
      .string()
      .optional()
      .describe(
        'Bounding box "minLon,minLat,maxLon,maxLat" (e.g. "-122.5,37.7,-122.3,37.9"). Alternative to lat/lon/radius for area surveys. Cannot be combined with lat/lon.',
      ),
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
      .max(100)
      .default(20)
      .describe('Maximum operators to return (max 100). Page further with the after cursor.'),
    after: z
      .number()
      .int()
      .optional()
      .describe(
        'Pagination cursor from a previous response (enrichment.cursor). Returns the next page after this internal ID.',
      ),
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
                        'Feed Onestop ID. Pass to transitland_find_feeds (operator_onestop_id) or look up directly.',
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
      .describe('Pass as `after` to fetch the next page. Present only when more results exist.'),
    truncated: z.boolean().optional().describe('True when results were capped at the limit.'),
    shown: z.number().optional().describe('Number of operators returned.'),
    cap: z.number().optional().describe('The limit applied.'),
    notice: z
      .string()
      .optional()
      .describe('Guidance when nothing matched (e.g. geocode-first reminder).'),
  },
  errors: [
    {
      reason: 'no_filter',
      code: JsonRpcErrorCode.ValidationError,
      when: 'No search, coordinates, bbox, onestop_id, or place filter was provided (server-enforced guard — the API accepts unfiltered requests but returns a paginated global dump).',
      recovery:
        'Provide at least one of: search, lat+lon, bbox, onestop_id, or adm0_name. For a place, geocode it with openstreetmap_geocode first.',
    },
    {
      reason: 'incomplete_point',
      code: JsonRpcErrorCode.ValidationError,
      when: 'lat without lon or lon without lat.',
      recovery: 'Provide both lat and lon together, or use bbox instead for an area.',
    },
    {
      reason: 'rate_limited',
      code: JsonRpcErrorCode.ServiceUnavailable,
      retryable: true,
      when: 'Transitland returned HTTP 429 (free-tier rate limit).',
      recovery:
        'Wait a few seconds and retry. The free key is rate-limited; a Pro key raises the quota.',
    },
  ],

  async handler(input, ctx) {
    if ((input.lat === undefined) !== (input.lon === undefined)) {
      throw ctx.fail('incomplete_point', undefined, ctx.recoveryFor('incomplete_point'));
    }
    const hasPoint = input.lat !== undefined && input.lon !== undefined;
    const hasFilter =
      !!input.search ||
      !!input.onestop_id ||
      hasPoint ||
      !!input.bbox ||
      !!input.adm0_name ||
      !!input.adm1_name;
    if (!hasFilter) {
      throw ctx.fail('no_filter', undefined, ctx.recoveryFor('no_filter'));
    }

    const params: Record<string, string | number | boolean | undefined> = {
      limit: input.limit,
      search: input.search,
      onestop_id: input.onestop_id,
      adm0_name: input.adm0_name,
      adm1_name: input.adm1_name,
      bbox: input.bbox,
      after: input.after,
    };
    if (hasPoint) {
      params.lat = input.lat;
      params.lon = input.lon;
      params.radius = input.radius;
    }

    const page = await getTransitlandService().listOperators(params, ctx);
    ctx.enrich.total(page.items.length);
    if (page.after !== undefined) ctx.enrich({ cursor: page.after });
    if (page.items.length >= input.limit) {
      ctx.enrich.truncated({ shown: page.items.length, cap: input.limit });
    }
    if (page.items.length === 0) {
      ctx.enrich.notice(
        'No operators matched. If you passed a place name, Transitland needs coordinates — geocode it with openstreetmap_geocode first, then pass lat/lon or bbox. Otherwise broaden the search or radius.',
      );
    }
    ctx.log.info('find_operators resolved', { count: page.items.length });
    return { operators: page.items };
  },

  format: (result) => {
    if (result.operators.length === 0) {
      return [{ type: 'text', text: 'No operators matched.' }];
    }
    const lines: string[] = [];
    for (const op of result.operators) {
      lines.push(`## ${op.name}${op.shortName ? ` (${op.shortName})` : ''}`);
      lines.push(`**Onestop ID:** ${op.onestopId}`);
      lines.push(`**Website:** ${op.website ?? 'Not available'}`);
      lines.push(`**Wikidata:** ${op.wikidataId ?? 'Not available'}`);
      if (op.places.length > 0) {
        const places = op.places
          .map((p) => [p.city, p.region, p.country].filter(Boolean).join(', '))
          .filter(Boolean)
          .join(' · ');
        lines.push(`**Places:** ${places || 'Not available'}`);
      } else {
        lines.push('**Places:** Not available');
      }
      if (op.feeds.length > 0) {
        lines.push(
          `**Feeds:** ${op.feeds.map((f) => `${f.onestopId} (${f.spec})${f.name ? ` "${f.name}"` : ''}`).join(', ')}`,
        );
      } else {
        lines.push('**Feeds:** Not available');
      }
      lines.push('');
    }
    return [{ type: 'text', text: lines.join('\n').trimEnd() }];
  },
});
