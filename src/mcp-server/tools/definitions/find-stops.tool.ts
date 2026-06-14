/**
 * @fileoverview transitland_find_stops — find stops/stations near a point or within a
 * bounding box, by Onestop ID, or filtered to one operator's network. The locate-a-stop
 * step before departures.
 * @module mcp-server/tools/definitions/find-stops.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getTransitlandService } from '@/services/transitland/transitland-service.js';

export const findStopsTool = tool('transitland_find_stops', {
  title: 'transitland-mcp-server: find stops',
  description:
    "Find stops and stations near a point or within a bounding box, by Onestop ID, or filtered to one operator's network. Returns each stop's Onestop ID, name, code, coordinates, type (platform vs. station vs. entrance), wheelchair accessibility, and timezone. The locate-a-stop step before departures — pass a returned stop Onestop ID to transitland_get_departures. Geocode place names to coordinates with openstreetmap_geocode first. Provide at least one of: lat+lon, bbox, onestop_id, or served_by_onestop_ids.",
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    lat: z
      .number()
      .min(-90)
      .max(90)
      .optional()
      .describe(
        'Latitude of the search center (WGS84). Requires lon. Geocode place names with openstreetmap_geocode first.',
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
      .max(10000)
      .default(500)
      .describe(
        'Search radius in meters around lat/lon (max 10,000). Keep small (≤500m) in dense areas — stations multiply quickly.',
      ),
    bbox: z
      .string()
      .optional()
      .describe(
        'Bounding box "minLon,minLat,maxLon,maxLat". Alternative to lat/lon/radius. Cannot be combined with lat/lon.',
      ),
    onestop_id: z
      .string()
      .optional()
      .describe(
        'Fetch one stop directly by its Onestop ID (e.g. "s-9q8yyw3xjw-powell") or internal integer ID.',
      ),
    served_by_onestop_ids: z
      .string()
      .optional()
      .describe(
        'Restrict to stops served by these operators or routes — a comma-separated list of operator/route Onestop IDs (e.g. "o-9q9-bart"). Combine with geography to find an operator\'s stops in an area.',
      ),
    search: z
      .string()
      .optional()
      .describe(
        'Full-text search over stop names (e.g. "Powell", "Union Station"). Pair with geography to disambiguate common names.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Maximum stops to return (max 100). Page further with the after cursor.'),
    after: z
      .number()
      .int()
      .optional()
      .describe('Pagination cursor from a previous response (enrichment.cursor).'),
  }),
  output: z.object({
    stops: z
      .array(
        z
          .object({
            onestopId: z
              .string()
              .describe(
                'Stable public Onestop ID (e.g. "s-9q8yyw3xjw-powell"). Pass to transitland_get_departures.',
              ),
            name: z
              .string()
              .nullable()
              .describe('Stop/station name. Null for unnamed generic nodes (location_type 3).'),
            code: z
              .string()
              .nullable()
              .describe('Public stop code printed on signage, when published. Null otherwise.'),
            lat: z.number().describe('Latitude (WGS84), normalized from the GeoJSON Point.'),
            lon: z.number().describe('Longitude (WGS84).'),
            locationType: z
              .number()
              .describe(
                'GTFS location_type: 0=platform/stop, 1=station, 2=entrance/exit, 3=generic node, 4=boarding area.',
              ),
            locationTypeLabel: z
              .string()
              .describe(
                'Human-readable location type: stop, station, entrance, node, or boarding area.',
              ),
            wheelchairBoarding: z
              .enum(['accessible', 'not_accessible', 'unknown'])
              .describe('Wheelchair accessibility, mapped from GTFS (1/2/0).'),
            timezone: z
              .string()
              .nullable()
              .describe(
                'IANA timezone of the stop (e.g. "America/Los_Angeles"). Null when the feed omits it.',
              ),
            parentOnestopId: z
              .string()
              .nullable()
              .describe(
                'Onestop ID of the parent station when this is a child platform. Null for top-level stops.',
              ),
            place: z
              .object({
                country: z.string().nullable().describe('Country (adm0) name.'),
                region: z.string().nullable().describe('State/province (adm1) name.'),
              })
              .describe('Country/region the stop sits in.'),
            feedOnestopId: z
              .string()
              .nullable()
              .describe(
                'Onestop ID of the source feed. Pass to transitland_find_feeds for license/fetch URL.',
              ),
          })
          .describe('A matching stop or station.'),
      )
      .describe(
        'Matching stops. Departures attach to platform-level stops (location_type 0) — a station (type 1) may return no departures; use its child platforms.',
      ),
  }),
  enrichment: {
    totalCount: z.number().describe('Number of stops returned.'),
    cursor: z
      .number()
      .optional()
      .describe('Pass as `after` to fetch the next page. Present only when more results exist.'),
    truncated: z.boolean().optional().describe('True when results were capped at the limit.'),
    shown: z.number().optional().describe('Number of stops returned.'),
    cap: z.number().optional().describe('The limit applied.'),
    notice: z.string().optional().describe('Guidance when nothing matched.'),
  },
  errors: [
    {
      reason: 'no_filter',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'No coordinates, bbox, onestop_id, or served_by_onestop_ids provided (server-enforced guard — the API accepts unfiltered requests but returns a global dump).',
      recovery:
        'Provide at least one of: lat+lon, bbox, onestop_id, or served_by_onestop_ids. Geocode place names with openstreetmap_geocode first.',
    },
    {
      reason: 'incomplete_point',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'lat without lon or lon without lat.',
      recovery: 'Provide both lat and lon together, or use bbox for an area.',
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
    if ((input.lat === undefined) !== (input.lon === undefined)) {
      throw ctx.fail('incomplete_point', undefined, { ...ctx.recoveryFor('incomplete_point') });
    }
    const hasPoint = input.lat !== undefined && input.lon !== undefined;
    const hasFilter =
      hasPoint ||
      !!input.bbox ||
      !!input.onestop_id ||
      !!input.served_by_onestop_ids ||
      !!input.search;
    if (!hasFilter) {
      throw ctx.fail('no_filter', undefined, { ...ctx.recoveryFor('no_filter') });
    }

    const params: Record<string, string | number | boolean | undefined> = {
      limit: input.limit,
      bbox: input.bbox,
      onestop_id: input.onestop_id,
      served_by_onestop_ids: input.served_by_onestop_ids,
      search: input.search,
      after: input.after,
    };
    if (hasPoint) {
      params.lat = input.lat;
      params.lon = input.lon;
      params.radius = input.radius;
    }

    const page = await getTransitlandService().listStops(params, ctx);
    ctx.enrich.total(page.items.length);
    if (page.after !== undefined) ctx.enrich({ cursor: page.after });
    if (page.items.length >= input.limit) {
      ctx.enrich.truncated({ shown: page.items.length, cap: input.limit });
    }
    if (page.items.length === 0) {
      ctx.enrich.notice(
        'No stops matched. If you passed a place name, geocode it with openstreetmap_geocode first. Otherwise widen the radius or check the served_by_onestop_ids list.',
      );
    }
    ctx.log.info('find_stops resolved', { count: page.items.length });
    return { stops: page.items };
  },

  format: (result) => {
    if (result.stops.length === 0) {
      return [{ type: 'text', text: 'No stops matched.' }];
    }
    const lines: string[] = [];
    for (const stop of result.stops) {
      lines.push(`## ${stop.name ?? '(unnamed)'} — ${stop.locationTypeLabel}`);
      lines.push(`**Onestop ID:** ${stop.onestopId}`);
      lines.push(`**Location type:** ${stop.locationTypeLabel} (${stop.locationType})`);
      lines.push(`**Coordinates:** ${stop.lat}, ${stop.lon}`);
      lines.push(`**Code:** ${stop.code ?? 'Not available'}`);
      lines.push(`**Wheelchair:** ${stop.wheelchairBoarding}`);
      lines.push(`**Timezone:** ${stop.timezone ?? 'Not available'}`);
      lines.push(`**Parent station:** ${stop.parentOnestopId ?? 'None'}`);
      const place = [stop.place.region, stop.place.country].filter(Boolean).join(', ');
      lines.push(`**Place:** ${place || 'Not available'}`);
      lines.push(`**Feed:** ${stop.feedOnestopId ?? 'Not available'}`);
      lines.push('');
    }
    return [{ type: 'text', text: lines.join('\n').trimEnd() }];
  },
});
