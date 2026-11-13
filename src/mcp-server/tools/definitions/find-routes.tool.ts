/**
 * @fileoverview transitland_find_routes — find routes near a point, within a bounding
 * box, by operator, by Onestop ID, or by mode. Returns scheduled (GTFS static) route
 * records: name, mode, brand color, operating agency.
 * @module mcp-server/tools/definitions/find-routes.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { bboxSchema, normalizeBbox } from '@/mcp-server/shared/bbox-schema.js';
import { enrichPage } from '@/mcp-server/shared/enrich-page.js';
import { formatValue } from '@/mcp-server/shared/format-value.js';
import { getTransitlandService } from '@/services/transitland/transitland-service.js';

export const findRoutesTool = tool('transitland_find_routes', {
  title: 'transitland-mcp-server: find routes',
  description:
    "Find routes near a point, within a bounding box, by operator, by Onestop ID, or by mode. Returns each route's Onestop ID, short and long name, mode (bus, rail, ferry, subway, tram, …), brand color, and the operating agency's Onestop ID. These are scheduled (GTFS static) route definitions, not live vehicle positions. Geocode place names to coordinates with openstreetmap_search_places before passing lat/lon. Provide at least one of: lat+lon, bbox, operator_onestop_id, onestop_id, or search.",
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    lat: z
      .number()
      .min(-90)
      .max(90)
      .optional()
      .describe(
        'Latitude of the search center (WGS84). Requires lon. Geocode place names with openstreetmap_search_places first — Transitland does not accept place names.',
      ),
    lon: z
      .number()
      .min(-180)
      .max(180)
      .optional()
      .describe('Longitude of the search center (WGS84). Requires lat.'),
    radius: z
      .number()
      .min(0)
      .max(50000)
      .default(1000)
      .describe(
        'Search radius in meters around lat/lon (max 50,000). Routes are matched when they pass within the radius.',
      ),
    bbox: bboxSchema,
    operator_onestop_id: z
      .string()
      .optional()
      .describe(
        'Restrict to routes operated by this operator (Onestop ID, e.g. "o-9q9-bart"). Combine with search to find a specific line within an operator.',
      ),
    onestop_id: z
      .string()
      .optional()
      .describe(
        'Fetch one route directly by its Onestop ID (e.g. "r-9q9p-800") or internal integer ID.',
      ),
    route_type: z
      .number()
      .int()
      .optional()
      .describe(
        'GTFS route_type filter: 0=tram/streetcar, 1=subway/metro, 2=rail, 3=bus, 4=ferry, 5=cable tram, 6=aerial lift, 7=funicular, 11=trolleybus, 12=monorail. Omit for all modes.',
      ),
    search: z
      .string()
      .optional()
      .describe(
        'Full-text search over route short and long names (e.g. "Red Line", "44"). Pair with operator_onestop_id or geography to disambiguate.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .default(20)
      .describe(
        'Maximum routes to return. Values above 100 apply the 100-result page cap with a notice. Page further with the after cursor.',
      ),
    after: z
      .number()
      .int()
      .optional()
      .describe('Pagination cursor from a previous response (cursor). The next page may be empty.'),
  }),
  output: z.object({
    routes: z
      .array(
        z
          .object({
            onestopId: z.string().describe('Stable public Onestop ID (e.g. "r-9q9p-800").'),
            shortName: z
              .string()
              .nullable()
              .describe(
                'Route short name/number as shown to riders (e.g. "44", "Red"). Null when the feed omits it.',
              ),
            longName: z
              .string()
              .nullable()
              .describe('Full route name (e.g. "Harlem - 14th Street"). Null when omitted.'),
            description: z
              .string()
              .nullable()
              .describe('Route description (e.g. "via Columbus / 7 Av"). Often null.'),
            routeType: z
              .number()
              .nullable()
              .describe('GTFS route_type integer. Null when omitted upstream.'),
            mode: z
              .string()
              .describe(
                'Human-readable basic or recognized extended GTFS mode, including coach and water transport. Extended urban rail 400–404 uses the coarse label subway. "unknown" when route_type is missing; "type N" for other present codes.',
              ),
            color: z
              .string()
              .nullable()
              .describe(
                'Brand color as a hex string without "#" (e.g. "00AEEF"). Null when unspecified.',
              ),
            operator: z
              .object({
                onestopId: z
                  .string()
                  .nullable()
                  .describe(
                    'Operating agency Onestop ID (e.g. "o-dr5r-nyct"). Use with transitland_get_operator.',
                  ),
                name: z.string().describe('Operating agency name.'),
              })
              .describe('The agency that runs this route.'),
            feedOnestopId: z
              .string()
              .nullable()
              .describe(
                'Onestop ID of the feed this route came from. Pass to transitland_find_feeds as onestop_id for source data and license.',
              ),
          })
          .describe('A matching route.'),
      )
      .describe('Matching routes, upstream-ranked.'),
  }),
  enrichment: {
    totalCount: z.number().describe('Number of routes returned.'),
    cursor: z
      .number()
      .optional()
      .describe('Pass as after with the same filters to fetch the next page, which may be empty.'),
    truncated: z.boolean().optional().describe('True when results were capped at the limit.'),
    shown: z.number().optional().describe('Number of routes returned.'),
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
      when: 'No coordinates, bbox, operator, onestop_id, or search provided (server-enforced guard — the API accepts unfiltered requests but returns a global dump).',
      recovery:
        'Provide at least one of: lat+lon, bbox, operator_onestop_id, onestop_id, or search. Geocode place names with openstreetmap_search_places first.',
    },
    {
      reason: 'incomplete_point',
      code: JsonRpcErrorCode.ValidationError,
      when: 'lat without lon or lon without lat.',
      recovery: 'Provide both lat and lon together, or use bbox for an area.',
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
    if ((input.lat === undefined) !== (input.lon === undefined)) {
      throw ctx.fail('incomplete_point');
    }
    const hasPoint = input.lat !== undefined && input.lon !== undefined;
    const bbox = normalizeBbox(input.bbox);
    const hasFilter =
      hasPoint ||
      !!bbox ||
      !!input.operator_onestop_id ||
      !!input.onestop_id ||
      !!input.search ||
      input.route_type !== undefined;
    if (!hasFilter) {
      throw ctx.fail('no_filter');
    }

    const params: Record<string, string | number | boolean | undefined> = {
      limit,
      bbox,
      operator_onestop_id: input.operator_onestop_id,
      onestop_id: input.onestop_id,
      route_type: input.route_type,
      search: input.search,
      after: input.after,
    };
    if (hasPoint) {
      params.lat = input.lat;
      params.lon = input.lon;
      params.radius = input.radius;
    }

    const page = await getTransitlandService().listRoutes(params, ctx);
    enrichPage(ctx, page, {
      limit,
      requestedLimit: input.limit,
      after: input.after,
      firstPageNotice:
        'No routes matched. If you passed a place name, geocode it to coordinates with openstreetmap_search_places first. Otherwise widen the radius or filter by operator_onestop_id.',
    });
    ctx.log.info('find_routes resolved', { count: page.items.length });
    return { routes: page.items };
  },

  format: (result) => {
    if (result.routes.length === 0) {
      return [{ type: 'text', text: 'No routes on this page.' }];
    }
    const lines: string[] = [];
    for (const route of result.routes) {
      lines.push(`**Route short name:** ${formatValue(route.shortName)}`);
      lines.push(`**Route name:** ${formatValue(route.longName)}`);
      lines.push(`**Onestop ID:** ${formatValue(route.onestopId)}`);
      lines.push(
        `**Mode:** ${formatValue(route.mode)} (route_type ${route.routeType ?? 'unknown'})`,
      );
      lines.push(`**Color:** ${route.color ? `#${formatValue(route.color)}` : 'Not available'}`);
      lines.push(
        `**Operator:** ${formatValue(route.operator.name)}${route.operator.onestopId === null ? '' : ` (${formatValue(route.operator.onestopId)})`}`,
      );
      lines.push(`**Description:** ${formatValue(route.description)}`);
      lines.push(`**Feed:** ${formatValue(route.feedOnestopId)}`);
      lines.push('');
    }
    return [{ type: 'text', text: lines.join('\n').trimEnd() }];
  },
});
