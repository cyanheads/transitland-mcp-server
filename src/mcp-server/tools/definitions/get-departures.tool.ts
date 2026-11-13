/**
 * @fileoverview transitland_get_departures — departures from a stop by Onestop ID. The
 * real-time-aware tool: each departure carries a `realtime` flag and `schedule_relationship`
 * so a static timetable entry is never mistaken for a live GTFS-Realtime prediction.
 * @module mcp-server/tools/definitions/get-departures.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { formatUrl, formatValue } from '@/mcp-server/shared/format-value.js';
import { getTransitlandService } from '@/services/transitland/transitland-service.js';
import type { AlertRecord } from '@/services/transitland/types.js';

const alertSchema = z
  .object({
    header: z.string().nullable().describe('Alert headline.'),
    description: z.string().nullable().describe('Alert details.'),
    url: z.string().nullable().describe('Link for more information.'),
    effect: z.string().nullable().describe('GTFS-Realtime effect.'),
    cause: z.string().nullable().describe('GTFS-Realtime cause.'),
    severity: z.string().nullable().describe('GTFS-Realtime severity level.'),
    activePeriods: z
      .array(
        z
          .object({
            start: z
              .string()
              .nullable()
              .describe('ISO 8601 start of the period, or null if open-ended.'),
            end: z
              .string()
              .nullable()
              .describe('ISO 8601 end of the period, or null if open-ended.'),
          })
          .describe('An active period with optional start and end times.'),
      )
      .describe('Periods when the alert applies.'),
  })
  .describe('A GTFS-Realtime service alert.');

function formatAlerts(alerts: AlertRecord[]): string[] {
  return alerts.flatMap((alert) => [
    '',
    `**Alert:** ${formatValue(alert.header)}`,
    `**Description:** ${formatValue(alert.description)}`,
    `**URL:** ${formatUrl(alert.url)}`,
    `**Effect:** ${formatValue(alert.effect)} · **Cause:** ${formatValue(alert.cause)} · **Severity:** ${formatValue(alert.severity)}`,
    ...alert.activePeriods.map(
      ({ start, end }) => `**Active period:** ${formatValue(start)} → ${formatValue(end)}`,
    ),
  ]);
}

/** Add whole hours to decimal GTFS hours while preserving their width. */
function addHours(hours: string, extraHours: number): string {
  const suffix: number[] = [];
  let index = hours.length;
  while (extraHours > 0 && index > 0) {
    index--;
    const sum = hours.charCodeAt(index) - 48 + extraHours;
    suffix.push(sum % 10);
    extraHours = Math.floor(sum / 10);
  }
  return `${extraHours || ''}${hours.slice(0, index)}${suffix.reverse().join('')}`;
}

export const getDeparturesTool = tool('transitland_get_departures', {
  title: 'transitland-mcp-server: get departures',
  description:
    'Get departures and GTFS-Realtime service alerts for a stop or station. Find its Onestop ID with transitland_find_stops. A station result combines its own departures with those of its platforms. Each departure shows its route, headsign, trip, platform, service date, and scheduled time. Use realtime=true to identify live predictions and scheduleRelationship to identify cancellations or added trips. Omit service_date for departures from now or provide it for a specific service day.',
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    stop_key: z
      .string()
      .min(1)
      .describe(
        'Stop, station, or platform Onestop ID (e.g. "s-9q8yyw3xjw-powell") or internal integer ID. Find it with transitland_find_stops.',
      ),
    next_seconds: z
      .number()
      .int()
      .min(60)
      .max(86400)
      .default(3600)
      .describe(
        'Window in seconds from now, or from start_time when supplied. Default 3600 (1h), maximum 86400 (24h). Ignored when service_date is supplied without start_time.',
      ),
    service_date: z
      .union([z.literal(''), z.iso.date().describe('Service date as YYYY-MM-DD')])
      .optional()
      .describe(
        'Request a particular GTFS service date (YYYY-MM-DD), starting at its first departure by default. Omit or pass an empty string for the current-time window.',
      ),
    start_time: z
      .string()
      .regex(
        /^\d{2,}:[0-5]\d:[0-5]\d$/,
        'Expected GTFS time HH:MM:SS with minutes and seconds from 00 to 59.',
      )
      .optional()
      .describe(
        'Start of the requested service window as GTFS HH:MM:SS. Requires service_date. Hours can exceed 23.',
      ),
    use_service_window: z
      .boolean()
      .default(false)
      .describe(
        "When true, allow Transitland to fall back to a typical service day outside the feed's calendar window.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .default(20)
      .describe(
        'Maximum departures to return, ordered by departure time. Values above 100 apply the 100-result cap with a notice.',
      ),
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
    alerts: z
      .array(alertSchema)
      .describe('Service alerts for the stop and its returned child stops.'),
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
            serviceDate: z
              .string()
              .nullable()
              .describe(
                'GTFS service date supplied by Transitland, including for trips after calendar midnight.',
              ),
            platform: z
              .object({
                onestopId: z
                  .string()
                  .nullable()
                  .describe('Onestop ID of the stop or platform supplying this departure.'),
                code: z.string().nullable().describe('Platform code when published.'),
              })
              .describe('Boarding location for this departure.'),
            alerts: z
              .array(alertSchema)
              .optional()
              .describe('Service alerts associated with this trip, when present.'),
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
                  .describe(
                    'Basic or recognized extended GTFS mode (bus, subway, rail, coach, water transport, ferry, …). Urban rail 400–404 uses subway. "unknown" when route_type is missing; "type N" for unmapped present codes.',
                  ),
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
          .describe('A single departure with a live prediction when realtime=true.'),
      )
      .describe(
        'Departures ordered by estimated or scheduled departure instant. Both live predictions and scheduled times can appear.',
      ),
    realtimeAvailable: z
      .boolean()
      .describe('True when at least one returned departure carries a real-time prediction.'),
  }),
  enrichment: {
    totalCount: z
      .number()
      .describe('Number of departures returned after merging and capping the available rows.'),
    truncated: z.boolean().optional().describe('True when departures were capped at the limit.'),
    shown: z.number().optional().describe('Number of departures returned.'),
    cap: z.number().optional().describe('The limit applied.'),
    notice: z.string().optional().describe('Guidance when no departures were found.'),
  },
  errors: [
    {
      reason: 'start_time_requires_service_date',
      code: JsonRpcErrorCode.ValidationError,
      when: 'start_time is supplied without a service_date.',
      recovery:
        'Provide a service_date with start_time or omit start_time for departures from now.',
    },
    {
      reason: 'stop_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The stops array in the API response is empty for the given Onestop ID or internal ID — the API returns HTTP 200 + {"stops":[]} (not a 404) when the stop does not exist. Detected from the empty stops array, not from an HTTP status.',
      recovery:
        'Verify the ID (e.g. "s-9q8yyw3xjw-powell") or locate the stop with transitland_find_stops.',
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
    const { service_date, start_time, next_seconds } = input;
    if (start_time && !service_date) {
      throw ctx.fail('start_time_requires_service_date');
    }
    const limit = Math.min(input.limit, 100);
    const params: Record<string, string | number | boolean | undefined> = {
      limit,
      use_service_window: input.use_service_window,
    };
    if (service_date) {
      params.service_date = service_date;
      if (start_time) {
        const hours = start_time.slice(0, -6);
        const minutes = Number(start_time.slice(-5, -3));
        const seconds = Number(start_time.slice(-2));
        const offsetSeconds = minutes * 60 + seconds + next_seconds;
        const endHours = addHours(hours, Math.floor(offsetSeconds / 3600));
        const endMinutes = String(Math.floor(offsetSeconds / 60) % 60).padStart(2, '0');
        const endSeconds = String(offsetSeconds % 60).padStart(2, '0');
        params.start_time = start_time;
        params.end_time = `${endHours}:${endMinutes}:${endSeconds}`;
      }
    } else {
      params.next = next_seconds;
    }

    const response = await getTransitlandService().getDepartures(input.stop_key, params, ctx);
    if (!response.found) {
      throw ctx.fail('stop_not_found', `No stop record found for "${input.stop_key}".`, {
        stopKey: input.stop_key,
      });
    }

    const { result } = response;
    ctx.enrich.total(result.departures.length);
    if (result.departures.length >= limit) {
      ctx.enrich.truncated({ shown: result.departures.length, cap: limit });
    }
    const capNotice =
      input.limit > limit
        ? `Requested ${input.limit} departures; applied the ${limit}-result cap. Narrow the service date or look-ahead window for a smaller set. `
        : '';
    if (capNotice) ctx.enrich.notice(capNotice.trimEnd());
    if (result.departures.length === 0) {
      const window = service_date
        ? start_time
          ? `on service date ${service_date} between ${start_time} and ${params.end_time}. Try a different start_time or widen next_seconds.`
          : `on service date ${service_date}. Try a different service_date.`
        : `in the next ${next_seconds}s. Widen next_seconds or choose a service_date.`;
      const fallback = input.use_service_window
        ? ''
        : ' Set use_service_window=true to allow a typical-service fallback.';
      ctx.enrich.notice(`${capNotice}No departures ${window}${fallback}`);
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
    lines.push('## Departures');
    lines.push(`**Stop:** ${formatValue(result.stop.name)}`);
    lines.push(`**Onestop ID:** ${formatValue(result.stop.onestopId)}`);
    lines.push(`**Timezone:** ${formatValue(result.stop.timezone)}`);
    lines.push(
      `**Real-time available:** ${result.realtimeAvailable ? 'Yes (GTFS-RT)' : 'No (scheduled only)'}`,
    );
    if (result.alerts.length > 0) {
      lines.push('', '### Stop alerts');
      for (const line of formatAlerts(result.alerts)) lines.push(line);
    }
    if (result.departures.length === 0) {
      lines.push('', 'No departures in the requested window.');
      return [{ type: 'text', text: lines.join('\n') }];
    }
    lines.push('');
    for (const dep of result.departures) {
      const time = dep.realtime ? (dep.estimatedTime ?? dep.scheduledTime) : dep.scheduledTime;
      lines.push(`**Headsign:** ${formatValue(dep.headsign)}`);
      lines.push(`**Route short name:** ${formatValue(dep.route.shortName)}`);
      lines.push(`**Route name:** ${formatValue(dep.route.longName)}`);
      lines.push(`**Realtime:** ${dep.realtime ? 'Yes (live prediction)' : 'No (scheduled)'}`);
      lines.push(`**Time:** ${formatValue(time)}`);
      lines.push(`**Scheduled:** ${formatValue(dep.scheduledTime)}`);
      lines.push(`**Estimated:** ${formatValue(dep.estimatedTime)}`);
      lines.push(`**Service date:** ${formatValue(dep.serviceDate)}`);
      lines.push(
        `**Platform:** ${formatValue(dep.platform.onestopId)} · **Platform code:** ${formatValue(dep.platform.code)}`,
      );
      lines.push(
        `**Delay:** ${dep.delaySeconds == null ? 'Not available' : `${dep.delaySeconds}s`}`,
      );
      lines.push(`**Schedule relationship:** ${formatValue(dep.scheduleRelationship)}`);
      lines.push(
        `**Route:** ${formatValue(dep.route.onestopId)} · ${formatValue(dep.route.mode)} · ${dep.route.color ? `#${formatValue(dep.route.color)}` : 'no color'}`,
      );
      lines.push(`**Operator:** ${formatValue(dep.operatorName)}`);
      lines.push(
        `**Trip:** ${formatValue(dep.tripId)} · direction ${dep.directionId ?? 'n/a'} · wheelchair ${dep.wheelchairAccessible}`,
      );
      if (dep.alerts?.length) {
        lines.push('', '**Trip alerts**');
        for (const line of formatAlerts(dep.alerts)) lines.push(line);
      }
      lines.push('');
    }
    return [{ type: 'text', text: lines.join('\n').trimEnd() }];
  },
});
