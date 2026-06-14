/**
 * @fileoverview transitland_get_departures — departures from a stop by Onestop ID. The
 * real-time-aware tool: each departure carries a `realtime` flag and `schedule_relationship`
 * so a static timetable entry is never mistaken for a live GTFS-Realtime prediction.
 * @module mcp-server/tools/definitions/get-departures.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getTransitlandService } from '@/services/transitland/transitland-service.js';

export const getDeparturesTool = tool('transitland_get_departures', {
  title: 'transitland-mcp-server: get departures',
  description:
    "Departures from a stop by Onestop ID or internal ID. Returns each upcoming departure's route, headsign, trip, and scheduled time — plus the real-time predicted time and delay only where the feed publishes GTFS-Realtime. Every departure carries a realtime flag and a schedule_relationship so a static timetable entry is never mistaken for a live arrival, and cancellations/added trips are visible. Resolve a stop to its Onestop ID with transitland_find_stops first. Departures attach to platform-level stops; a parent station may return none — query its child platforms. If a stop returns no departures, widen next_seconds or set use_service_window: true (some feeds only expose times inside their active service window).",
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    stop_key: z
      .string()
      .min(1)
      .describe(
        'Stop Onestop ID (e.g. "s-9q8yyw3xjw-powell") or internal integer ID. Get one from transitland_find_stops. Use a platform-level stop (location_type 0); a station may return no departures.',
      ),
    next_seconds: z
      .number()
      .int()
      .min(60)
      .max(86400)
      .default(3600)
      .describe(
        'Look-ahead window in seconds from now (max 86,400 = 24h). Default 3600 (1h). Widen when a stop has infrequent service or returns nothing.',
      ),
    service_date: z
      .union([
        z.literal(''),
        z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe('Service date as YYYY-MM-DD'),
      ])
      .optional()
      .describe(
        "Restrict to a specific service date (YYYY-MM-DD), e.g. to check a future day's schedule. Empty string or omitted uses today. Real-time predictions only apply to the current service day.",
      ),
    use_service_window: z
      .boolean()
      .default(false)
      .describe(
        "When true, clamp the query into the feed's active service window. Set this if a default query returns no departures — some feeds only publish times within their declared calendar window.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Maximum departures to return (max 100), ordered by departure time.'),
  }),
  output: z.object({
    stop: z
      .object({
        onestopId: z.string().describe("The stop's Onestop ID, echoed back."),
        name: z.string().nullable().describe('Stop name.'),
        timezone: z
          .string()
          .nullable()
          .describe('IANA timezone the departure wall-clock times are in.'),
      })
      .describe('The stop the departures belong to.'),
    departures: z
      .array(
        z
          .object({
            realtime: z
              .boolean()
              .describe(
                'TRUE when this time is a live GTFS-Realtime prediction; FALSE when it is a static scheduled time. The single most important field — never present a FALSE time as a live arrival.',
              ),
            scheduleRelationship: z
              .string()
              .describe(
                'Schedule relationship: STATIC (static-schedule trip, no real-time overlay), SCHEDULED (real-time covered, currently on time), ADDED, CANCELED, UNSCHEDULED, or DUPLICATED. STATIC is the common non-RT value; SCHEDULED indicates RT overlay is active. CANCELED implies the trip is not running even if it appears in the schedule.',
              ),
            scheduledTime: z
              .string()
              .describe(
                'Scheduled departure as an ISO 8601 timestamp with the stop\'s UTC offset (e.g. "2026-06-13T16:21:07-04:00").',
              ),
            estimatedTime: z
              .string()
              .nullable()
              .describe(
                'Predicted departure (ISO 8601 with offset) when realtime=true. Null when scheduled-only.',
              ),
            delaySeconds: z
              .number()
              .nullable()
              .describe(
                'Predicted delay in seconds: positive = late, negative = early. Null when no real-time data backs this departure.',
              ),
            headsign: z
              .string()
              .nullable()
              .describe(
                'Trip or stop headsign (the destination shown on the vehicle, e.g. "14 ST via 7 AV"). Null when omitted.',
              ),
            route: z
              .object({
                onestopId: z
                  .string()
                  .describe(
                    'Route Onestop ID (e.g. "r-dr72h-m7"). Use with transitland_find_routes.',
                  ),
                shortName: z.string().nullable().describe('Route short name/number (e.g. "M7").'),
                longName: z.string().nullable().describe('Route long name.'),
                mode: z
                  .string()
                  .describe('Human-readable mode from route_type (bus, subway, rail, ferry, …).'),
                color: z.string().nullable().describe('Route brand color hex without "#".'),
              })
              .describe('The route this departure serves.'),
            operatorName: z.string().nullable().describe('Operating agency name.'),
            tripId: z
              .string()
              .nullable()
              .describe('GTFS trip_id (feed-local). Identifies the specific scheduled trip.'),
            directionId: z
              .number()
              .nullable()
              .describe(
                'GTFS direction_id (0 or 1), distinguishing the two directions of travel. Null when omitted.',
              ),
            wheelchairAccessible: z
              .enum(['accessible', 'not_accessible', 'unknown'])
              .describe('Trip-level wheelchair accessibility, where the feed states it.'),
          })
          .describe(
            'A single upcoming departure (scheduled, with a live prediction when realtime=true).',
          ),
      )
      .describe(
        'Upcoming departures ordered by departure time. A mix of realtime=true and realtime=false entries is normal — only the GTFS-RT-covered trips carry predictions.',
      ),
    realtimeAvailable: z
      .boolean()
      .describe(
        "True when at least one departure carried a real-time prediction — i.e. this stop's feed publishes GTFS-RT. False implies all times are scheduled.",
      ),
  }),
  enrichment: {
    totalCount: z
      .number()
      .describe(
        'Number of departures returned (the API caps server-side; this is the count in the window).',
      ),
    truncated: z.boolean().optional().describe('True when departures were capped at the limit.'),
    shown: z.number().optional().describe('Number of departures returned.'),
    cap: z.number().optional().describe('The limit applied.'),
    notice: z.string().optional().describe('Guidance when no departures were found.'),
  },
  errors: [
    {
      reason: 'stop_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The stops array in the API response is empty for the given Onestop ID or internal ID — the API returns HTTP 200 + {"stops":[]} (not a 404) when the stop does not exist. Detected from the empty stops array, not from an HTTP status.',
      recovery:
        'Verify the ID (e.g. "s-9q8yyw3xjw-powell") or locate the stop with transitland_find_stops.',
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
    // The API uses `next` (seconds) as the look-ahead param; both `next` and
    // `next_seconds` are accepted upstream — send the canonical `next`.
    const params: Record<string, string | number | boolean | undefined> = {
      next: input.next_seconds,
      limit: input.limit,
      use_service_window: input.use_service_window,
    };
    if (input.service_date) params.service_date = input.service_date;

    const response = await getTransitlandService().getDepartures(input.stop_key, params, ctx);
    if (!response.found) {
      throw ctx.fail('stop_not_found', `No stop record found for "${input.stop_key}".`, {
        stopKey: input.stop_key,
        ...ctx.recoveryFor('stop_not_found'),
      });
    }

    const { result } = response;
    ctx.enrich.total(result.departures.length);
    if (result.departures.length >= input.limit) {
      ctx.enrich.truncated({ shown: result.departures.length, cap: input.limit });
    }
    if (result.departures.length === 0) {
      ctx.enrich.notice(
        `No departures in the next ${input.next_seconds}s. Widen next_seconds or set use_service_window=true (some feeds only expose times inside their service window). A parent station may have no direct departures — try a child platform from transitland_find_stops.`,
      );
    }
    ctx.log.info('get_departures resolved', {
      stopKey: input.stop_key,
      count: result.departures.length,
      realtimeAvailable: result.realtimeAvailable,
    });
    return result;
  },

  format: (result) => {
    const lines: string[] = [];
    lines.push(`## Departures — ${result.stop.name ?? result.stop.onestopId}`);
    lines.push(`**Onestop ID:** ${result.stop.onestopId}`);
    lines.push(`**Timezone:** ${result.stop.timezone ?? 'Not available'}`);
    lines.push(
      `**Real-time available:** ${result.realtimeAvailable ? 'Yes (GTFS-RT)' : 'No (scheduled only)'}`,
    );
    if (result.departures.length === 0) {
      lines.push('', 'No departures in the requested window.');
      return [{ type: 'text', text: lines.join('\n') }];
    }
    lines.push('');
    for (const dep of result.departures) {
      const label = dep.route.shortName ?? dep.route.longName ?? dep.route.onestopId;
      const time = dep.realtime ? (dep.estimatedTime ?? dep.scheduledTime) : dep.scheduledTime;
      lines.push(`### ${label} → ${dep.headsign ?? '(no headsign)'}`);
      lines.push(`**Route name:** ${dep.route.longName ?? dep.route.shortName ?? 'Not available'}`);
      lines.push(`**Realtime:** ${dep.realtime ? 'Yes (live prediction)' : 'No (scheduled)'}`);
      lines.push(`**Time:** ${time}`);
      lines.push(`**Scheduled:** ${dep.scheduledTime}`);
      lines.push(`**Estimated:** ${dep.estimatedTime ?? 'Not available'}`);
      lines.push(
        `**Delay:** ${dep.delaySeconds == null ? 'Not available' : `${dep.delaySeconds}s`}`,
      );
      lines.push(`**Schedule relationship:** ${dep.scheduleRelationship}`);
      lines.push(
        `**Route:** ${dep.route.onestopId} · ${dep.route.mode} · ${dep.route.color ? `#${dep.route.color}` : 'no color'}`,
      );
      lines.push(`**Operator:** ${dep.operatorName ?? 'Not available'}`);
      lines.push(
        `**Trip:** ${dep.tripId ?? 'Not available'} · direction ${dep.directionId ?? 'n/a'} · wheelchair ${dep.wheelchairAccessible}`,
      );
      lines.push('');
    }
    return [{ type: 'text', text: lines.join('\n').trimEnd() }];
  },
});
