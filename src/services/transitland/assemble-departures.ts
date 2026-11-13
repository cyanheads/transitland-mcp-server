/** @fileoverview Normalize and merge departures and alerts from a station tree. */
import { blankToNull, modeForRouteType, wheelchairState } from './gtfs-values.js';
import type {
  AlertRecord,
  DepartureRecord,
  DeparturesResult,
  RawAlert,
  RawDeparture,
  RawDepartureTime,
  RawStopWithDepartures,
} from './types.js';

/**
 * A departure is real-time when the upstream `estimated` time (equivalently
 * `estimated_utc`) is present. `schedule_relationship` is surfaced verbatim:
 * STATIC = no RT overlay, SCHEDULED = RT-covered, plus ADDED/CANCELED/etc.
 */
function normalizeDeparture(
  raw: RawDeparture,
  platform: DepartureRecord['platform'],
): DepartureRecord {
  const time: RawDepartureTime = raw.departure ?? {};
  const realtime = [time.estimated, time.estimated_utc, time.estimated_local].some(
    (value) => blankToNull(value) !== null,
  );
  const route = raw.trip?.route;
  const routeType = route?.route_type ?? null;
  const alerts = raw.trip?.alerts?.map(normalizeAlert);
  return {
    ...(alerts?.length && { alerts }),
    platform,
    serviceDate: blankToNull(raw.service_date),
    realtime,
    scheduleRelationship: blankToNull(raw.schedule_relationship) ?? 'STATIC',
    scheduledTime: blankToNull(time.scheduled_local) ?? blankToNull(time.scheduled_utc) ?? '',
    estimatedTime: realtime
      ? (blankToNull(time.estimated_local) ?? blankToNull(time.estimated_utc))
      : null,
    delaySeconds: realtime ? (time.estimated_delay ?? null) : null,
    headsign: blankToNull(raw.stop_headsign) ?? blankToNull(raw.trip?.trip_headsign),
    route: {
      onestopId: blankToNull(route?.onestop_id) ?? '',
      shortName: blankToNull(route?.route_short_name),
      longName: blankToNull(route?.route_long_name),
      mode: modeForRouteType(routeType),
      color: blankToNull(route?.route_color),
    },
    operatorName: blankToNull(route?.agency?.agency_name),
    tripId: blankToNull(raw.trip?.trip_id),
    directionId: raw.trip?.direction_id ?? null,
    wheelchairAccessible: wheelchairState(raw.trip?.wheelchair_accessible),
  };
}

function isoTime(seconds: number | null | undefined): string | null {
  if (seconds == null) return null;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeAlert(raw: RawAlert): AlertRecord {
  return {
    header: blankToNull(raw.header_text?.[0]?.text),
    description: blankToNull(raw.description_text?.[0]?.text),
    url: blankToNull(raw.url?.[0]?.text),
    effect: blankToNull(raw.effect),
    cause: blankToNull(raw.cause),
    severity: blankToNull(raw.severity_level),
    activePeriods: (raw.active_period ?? []).map(({ start, end }) => ({
      start: isoTime(start),
      end: isoTime(end),
    })),
  };
}

function departureInstant(time: RawDepartureTime | null | undefined): number {
  /** The plain GTFS clock fields lack a date and offset. */
  for (const value of [
    time?.estimated_utc,
    time?.estimated_local,
    time?.scheduled_utc,
    time?.scheduled_local,
  ]) {
    if (value == null) continue;
    const instant = Date.parse(value);
    if (Number.isFinite(instant)) return instant;
  }
  return Number.POSITIVE_INFINITY;
}

/** Merge station and descendant records before applying the caller’s departure limit. */
export function assembleDepartures(
  stop: RawStopWithDepartures,
  key: string,
  limit: number | undefined,
): DeparturesResult {
  const alerts: AlertRecord[] = [];
  const seen = new Set<string>();
  const rows: { raw: RawDeparture; platform: DepartureRecord['platform']; instant: number }[] = [];
  const pending = [stop];
  for (let source = pending.pop(); source !== undefined; source = pending.pop()) {
    const platform = {
      onestopId: blankToNull(source.onestop_id) ?? (source === stop ? key : null),
      code: blankToNull(source.platform_code),
    };
    for (const raw of source.departures ?? []) {
      rows.push({ raw, platform, instant: departureInstant(raw.departure) });
    }
    for (const alert of source.alerts ?? []) {
      if (alert.rt_feed_onestop_id?.trim() && alert.entity_id?.trim()) {
        const identity = JSON.stringify([alert.rt_feed_onestop_id, alert.entity_id]);
        if (seen.has(identity)) continue;
        seen.add(identity);
      }
      alerts.push(normalizeAlert(alert));
    }
    for (const child of source.children?.toReversed() ?? []) pending.push(child);
  }
  rows.sort((a, b) => a.instant - b.instant);
  const departures = rows
    .slice(0, limit)
    .map(({ raw, platform }) => normalizeDeparture(raw, platform));
  return {
    stop: {
      onestopId: blankToNull(stop.onestop_id) ?? key,
      name: blankToNull(stop.stop_name),
      timezone: blankToNull(stop.stop_timezone),
    },
    alerts,
    departures,
    realtimeAvailable: departures.some((departure) => departure.realtime),
  };
}
