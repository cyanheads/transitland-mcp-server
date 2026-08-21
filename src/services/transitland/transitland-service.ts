/**
 * @fileoverview TransitlandService — a thin typed HTTP client over the Transitland
 * v2 REST API. Injects the `apikey` query parameter, normalizes the pagination
 * cursor (reads `meta.after`, discards the apikey-leaking `meta.next` URL),
 * classifies upstream failures (401/404/429), and exposes one method per endpoint
 * returning normalized domain shapes.
 * @module services/transitland/transitland-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import {
  notFound,
  rateLimited,
  serializationError,
  serviceUnavailable,
  unauthorized,
} from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { fetchWithTimeout, requestContextService, withRetry } from '@cyanheads/mcp-ts-core/utils';
import { getServerConfig } from '@/config/server-config.js';
import type {
  DepartureRecord,
  DeparturesResult,
  FeedRecord,
  OperatorAgency,
  OperatorFeedRef,
  OperatorRecord,
  OperatorSummary,
  Page,
  PlaceSummary,
  RawDeparture,
  RawDepartureTime,
  RawFeed,
  RawFeedRef,
  RawMeta,
  RawOperator,
  RawPlace,
  RawRoute,
  RawStop,
  RawStopWithDepartures,
  RouteRecord,
  StopRecord,
  TriState,
  WheelchairState,
} from './types.js';

const FETCH_TIMEOUT_MS = 15_000;
/** Rate-limited free tier recovers within ~1-2s; calibrate backoff to that. */
const RETRY_BASE_DELAY_MS = 1_500;

/** GTFS route_type → human-readable mode label. */
const ROUTE_TYPE_MODES: Record<number, string> = {
  0: 'tram',
  1: 'subway',
  2: 'rail',
  3: 'bus',
  4: 'ferry',
  5: 'cable tram',
  6: 'aerial lift',
  7: 'funicular',
  11: 'trolleybus',
  12: 'monorail',
};

/** GTFS location_type → label. */
const LOCATION_TYPE_LABELS: Record<number, string> = {
  0: 'stop',
  1: 'station',
  2: 'entrance',
  3: 'node',
  4: 'boarding area',
};

function modeForRouteType(routeType: number): string {
  return ROUTE_TYPE_MODES[routeType] ?? `type ${routeType}`;
}

function locationTypeLabel(locationType: number): string {
  return LOCATION_TYPE_LABELS[locationType] ?? `type ${locationType}`;
}

/** Map GTFS wheelchair 0/1/2 (and absent) → tri-state. */
function wheelchairState(value: number | null | undefined): WheelchairState {
  if (value === 1) return 'accessible';
  if (value === 2) return 'not_accessible';
  return 'unknown';
}

/** Normalize a Transitland yes/no/unknown/"" license string → tri-state. */
function triState(value: string | null | undefined): TriState {
  if (value === 'yes' || value === 'no') return value;
  return 'unknown';
}

/**
 * Map the tool's lowercase `spec` enum (`gtfs`, `gtfs-rt`, `gbfs`, `mds`) to the
 * uppercase spec the API surfaces on records (`GTFS`, `GTFS_RT`, `GBFS`, `MDS`),
 * for client-side filtering of an operator's resolved feeds.
 */
function specToUpstream(spec: string): string {
  return spec.toUpperCase().replace(/-/g, '_');
}

/** Empty-string-or-null → null; otherwise the trimmed string. */
function blankToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normalizePlace(raw: RawPlace): PlaceSummary {
  return {
    country: blankToNull(raw.adm0_name),
    region: blankToNull(raw.adm1_name),
    city: blankToNull(raw.city_name),
  };
}

/** Distinct place summaries collapsed across an operator's agencies. */
function distinctPlaces(places: RawPlace[]): PlaceSummary[] {
  const seen = new Set<string>();
  const result: PlaceSummary[] = [];
  for (const raw of places) {
    const place = normalizePlace(raw);
    if (place.country == null && place.region == null && place.city == null) continue;
    const key = `${place.country}|${place.region}|${place.city}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(place);
  }
  return result;
}

function normalizeFeedRef(raw: RawFeedRef): OperatorFeedRef | null {
  const onestopId = blankToNull(raw.onestop_id);
  if (onestopId == null) return null;
  return {
    onestopId,
    spec: blankToNull(raw.spec) ?? 'unknown',
    name: blankToNull(raw.name),
  };
}

function normalizeOperatorSummary(raw: RawOperator): OperatorSummary {
  const agencyPlaces = (raw.agencies ?? []).flatMap((a) => a.places ?? []);
  return {
    onestopId: blankToNull(raw.onestop_id) ?? '',
    name: blankToNull(raw.name) ?? '',
    shortName: blankToNull(raw.short_name),
    website: blankToNull(raw.website),
    places: distinctPlaces(agencyPlaces),
    feeds: (raw.feeds ?? []).map(normalizeFeedRef).filter((f): f is OperatorFeedRef => f !== null),
    wikidataId: blankToNull(raw.tags?.wikidata_id),
  };
}

function normalizeOperatorRecord(raw: RawOperator): OperatorRecord {
  const agencies: OperatorAgency[] = (raw.agencies ?? []).map((a) => ({
    agencyId: blankToNull(a.agency_id) ?? '',
    agencyName: blankToNull(a.agency_name) ?? '',
    places: distinctPlaces(a.places ?? []),
  }));
  return {
    onestopId: blankToNull(raw.onestop_id) ?? '',
    name: blankToNull(raw.name) ?? '',
    shortName: blankToNull(raw.short_name),
    website: blankToNull(raw.website),
    agencies,
    feeds: (raw.feeds ?? []).map(normalizeFeedRef).filter((f): f is OperatorFeedRef => f !== null),
    tags: {
      wikidataId: blankToNull(raw.tags?.wikidata_id),
      usNtdId: blankToNull(raw.tags?.us_ntd_id),
      twitter: blankToNull(raw.tags?.twitter_general),
    },
  };
}

function normalizeFeed(raw: RawFeed): FeedRecord {
  const latest = (raw.feed_versions ?? [])[0];
  const authType = blankToNull(raw.authorization?.type);
  return {
    onestopId: blankToNull(raw.onestop_id) ?? '',
    spec: blankToNull(raw.spec) ?? 'unknown',
    name: blankToNull(raw.name),
    fetchUrl: blankToNull(raw.urls?.static_current),
    realtimeUrls: {
      tripUpdates: blankToNull(raw.urls?.realtime_trip_updates),
      vehiclePositions: blankToNull(raw.urls?.realtime_vehicle_positions),
      alerts: blankToNull(raw.urls?.realtime_alerts),
    },
    license: {
      spdxIdentifier: blankToNull(raw.license?.spdx_identifier),
      url: blankToNull(raw.license?.url),
      redistributionAllowed: triState(raw.license?.redistribution_allowed),
      commercialUseAllowed: triState(raw.license?.commercial_use_allowed),
      createDerivedProduct: triState(raw.license?.create_derived_product),
      useWithoutAttribution: triState(raw.license?.use_without_attribution),
      attributionText: blankToNull(raw.license?.attribution_text),
    },
    latestFetch: {
      fetchedAt: blankToNull(latest?.fetched_at),
      earliestServiceDate: blankToNull(latest?.earliest_calendar_date),
      latestServiceDate: blankToNull(latest?.latest_calendar_date),
      sha1: blankToNull(latest?.sha1),
    },
    authorizationRequired: authType !== null,
  };
}

function normalizeRoute(raw: RawRoute): RouteRecord {
  const routeType = raw.route_type ?? 3;
  return {
    onestopId: blankToNull(raw.onestop_id) ?? '',
    shortName: blankToNull(raw.route_short_name),
    longName: blankToNull(raw.route_long_name),
    description: blankToNull(raw.route_desc),
    routeType,
    mode: modeForRouteType(routeType),
    color: blankToNull(raw.route_color),
    operator: {
      onestopId: blankToNull(raw.agency?.onestop_id),
      name: blankToNull(raw.agency?.agency_name) ?? '',
    },
    feedOnestopId: blankToNull(raw.feed_version?.feed?.onestop_id),
  };
}

function normalizeStop(raw: RawStop): StopRecord {
  const coords = raw.geometry?.coordinates;
  const locationType = raw.location_type ?? 0;
  const parent =
    typeof raw.parent === 'string' ? blankToNull(raw.parent) : blankToNull(raw.parent?.onestop_id);
  return {
    onestopId: blankToNull(raw.onestop_id) ?? '',
    name: blankToNull(raw.stop_name),
    code: blankToNull(raw.stop_code),
    lat: coords ? coords[1] : 0,
    lon: coords ? coords[0] : 0,
    locationType,
    locationTypeLabel: locationTypeLabel(locationType),
    wheelchairBoarding: wheelchairState(raw.wheelchair_boarding),
    timezone: blankToNull(raw.stop_timezone),
    parentOnestopId: parent,
    place: {
      country: blankToNull(raw.place?.adm0_name),
      region: blankToNull(raw.place?.adm1_name),
    },
    feedOnestopId: blankToNull(raw.feed_version?.feed?.onestop_id),
  };
}

/**
 * A departure is real-time when the upstream `estimated` time (equivalently
 * `estimated_utc`) is present. `schedule_relationship` is surfaced verbatim:
 * STATIC = no RT overlay, SCHEDULED = RT-covered, plus ADDED/CANCELED/etc.
 */
function normalizeDeparture(raw: RawDeparture): DepartureRecord {
  const time: RawDepartureTime = raw.departure ?? {};
  const realtime = blankToNull(time.estimated ?? time.estimated_utc) !== null;
  const route = raw.trip?.route;
  const routeType = route?.route_type ?? 3;
  return {
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

/** Query-parameter values accepted by the service request helper. */
type QueryValue = string | number | boolean | undefined;

/**
 * Lets a single-record fetch carry its caller's contract reason onto the thrown
 * NotFound, so `error.data.reason` matches what the tool advertises in tools/list.
 */
interface NotFoundFail {
  reason: string;
}

/**
 * Describes a single-record lookup so a 404 (or a 200 + empty record array) can be
 * turned into a clean, contract-carrying NotFound. `key` is the caller-facing
 * identifier surfaced in the message; `ctx`/`fail` thread the tool's declared
 * `reason` + recovery hint onto `error.data` so they match `tools/list`.
 */
interface NotFoundLookup {
  ctx: Context;
  fail?: NotFoundFail;
  key: string;
  kind: string;
}

export class TransitlandService {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(_config: AppConfig, _storage: StorageService) {
    const cfg = getServerConfig();
    this.apiKey = cfg.apiKey;
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, '');
  }

  /**
   * Build the request URL with the `apikey` query param injected. The apikey is
   * carried only on the wire — `fetchWithTimeout` redacts query strings from
   * thrown errors and logs, and `meta.next` (which also embeds the key) is
   * discarded in `extractPage`.
   */
  private buildUrl(path: string, params: Record<string, QueryValue> = {}): string {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    url.searchParams.set('apikey', this.apiKey);
    return url.toString();
  }

  /**
   * Execute a GET against Transitland with retry over the full fetch+parse
   * pipeline. `fetchWithTimeout` throws a classified `McpError` on non-OK
   * responses; this refines 401/404/429 to their domain meanings.
   *
   * `notFoundLookup` is set for single-record fetches: Transitland returns
   * HTTP 404 for an absent `/operators/{key}` or `/feeds/{key}`, so the 404 is
   * mapped to the same clean, contract-carrying NotFound the empty-record-array
   * branch produces (naming the caller's ID, not the internal endpoint path).
   *
   * `expectedStatuses` marks statuses the caller treats as outcomes rather than
   * failures (a 404 mapped to not-found/null), dropping them to debug-level logs.
   */
  private request<T>(
    path: string,
    params: Record<string, QueryValue>,
    ctx: Context,
    operation: string,
    notFoundLookup?: NotFoundLookup,
    expectedStatuses?: number[],
  ): Promise<T> {
    const url = this.buildUrl(path, params);
    // Child context under the handler's own — inherits requestId/traceId/
    // tenantId/sessionId/spanId, relabeled with the upstream operation name.
    const reqCtx = requestContextService.createRequestContext({
      operation,
      parentContext: ctx,
    });
    return withRetry(
      async () => {
        let response: Response;
        try {
          response = await fetchWithTimeout(url, FETCH_TIMEOUT_MS, reqCtx, {
            signal: ctx.signal,
            headers: { accept: 'application/json' },
            ...(expectedStatuses && { expectedStatuses }),
          });
        } catch (err) {
          throw this.classifyFetchError(err, path, notFoundLookup);
        }
        const text = await response.text();
        return this.parse<T>(text, path);
      },
      {
        operation,
        context: reqCtx,
        baseDelayMs: RETRY_BASE_DELAY_MS,
        signal: ctx.signal,
      },
    );
  }

  /**
   * Build the NotFound a single-record lookup throws — clean message naming the
   * caller's ID (never the internal endpoint path), with the tool's declared
   * contract `reason` + recovery hint on `error.data` so it matches `tools/list`.
   * Shared by the HTTP-404 path and the 200-with-empty-array path.
   */
  private notFoundFor(lookup: NotFoundLookup, options?: { cause?: unknown }): Error {
    const { ctx, fail, key, kind } = lookup;
    return notFound(
      `No ${kind} found for "${key}".`,
      {
        [`${kind}Key`]: key,
        ...(fail && { reason: fail.reason, ...ctx.recoveryFor(fail.reason) }),
      },
      options,
    );
  }

  /**
   * Refine the status-classified error from `fetchWithTimeout` into the domain
   * error with the recovery messaging Transitland's failure profile warrants.
   */
  private classifyFetchError(err: unknown, path: string, notFoundLookup?: NotFoundLookup): Error {
    const code = (err as { code?: number })?.code;
    // JsonRpcErrorCode: Unauthorized -32006, NotFound -32001, RateLimited -32003.
    if (code === -32006) {
      return unauthorized(
        'Transitland rejected the API key (HTTP 401). Verify TRANSITLAND_API_KEY.',
        { path },
        { cause: err },
      );
    }
    if (code === -32001) {
      // Single-record fetches 404 on an absent key; surface the caller's contract
      // reason + a clean ID-named message rather than leaking the endpoint path.
      if (notFoundLookup) return this.notFoundFor(notFoundLookup, { cause: err });
      return notFound(`Transitland returned not found for ${path}.`, { path }, { cause: err });
    }
    if (code === -32003) {
      return rateLimited(
        'Transitland rate limit hit (HTTP 429). Wait a few seconds and retry; a Pro key raises the quota.',
        { path },
        { cause: err },
      );
    }
    // 5xx, timeouts, and anything else already classified as transient bubble as-is.
    return err as Error;
  }

  private parse<T>(text: string, path: string): T {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw serializationError(
        `Transitland returned a non-JSON body for ${path}.`,
        { path },
        { cause: err },
      );
    }
    // Transitland surfaces 4xx as {"error": "..."} JSON; the HTTP layer already
    // threw for those. A 200 body carrying an error string is unexpected.
    if (parsed && typeof parsed === 'object' && 'error' in parsed && !('meta' in parsed)) {
      const message = String((parsed as { error: unknown }).error);
      if (/not found/i.test(message)) throw notFound(`Transitland: ${message}`, { path });
      if (/unauthor/i.test(message)) {
        throw unauthorized(`Transitland: ${message}. Verify TRANSITLAND_API_KEY.`, { path });
      }
      throw serviceUnavailable(`Transitland: ${message}`, { path });
    }
    return parsed as T;
  }

  /**
   * Pull the list + integer cursor from a Transitland list envelope. The
   * `meta.next` URL embeds the apikey in plaintext and is deliberately discarded
   * — only the opaque `after` cursor is surfaced.
   */
  private extractPage<T>(body: { meta?: RawMeta } & Record<string, unknown>, key: string): Page<T> {
    const items = (body[key] as T[] | undefined) ?? [];
    const after = body.meta?.after;
    return after === undefined ? { items } : { items, after };
  }

  // --- Operators ----------------------------------------------------------

  async listOperators(
    params: Record<string, QueryValue>,
    ctx: Context,
  ): Promise<Page<OperatorSummary>> {
    const body = await this.request<{ meta?: RawMeta; operators?: RawOperator[] }>(
      '/operators',
      params,
      ctx,
      'transitland.listOperators',
    );
    const page = this.extractPage<RawOperator>(body, 'operators');
    return {
      items: page.items.map(normalizeOperatorSummary),
      ...(page.after !== undefined && { after: page.after }),
    };
  }

  /**
   * Fetch one operator by Onestop ID or internal int ID. Throws NotFound when
   * absent — `failReason` carries the caller's contract reason onto `data.reason`
   * (and its recovery hint onto the wire) so clients see a stable identifier.
   */
  async getOperator(key: string, ctx: Context, failReason?: NotFoundFail): Promise<OperatorRecord> {
    const lookup: NotFoundLookup = {
      ctx,
      key,
      kind: 'operator',
      ...(failReason && { fail: failReason }),
    };
    const body = await this.request<{ operators?: RawOperator[] }>(
      `/operators/${encodeURIComponent(key)}`,
      {},
      ctx,
      'transitland.getOperator',
      lookup,
      [404],
    );
    const raw = body.operators?.[0];
    if (!raw) throw this.notFoundFor(lookup);
    return normalizeOperatorRecord(raw);
  }

  // --- Feeds --------------------------------------------------------------

  async listFeeds(params: Record<string, QueryValue>, ctx: Context): Promise<Page<FeedRecord>> {
    const body = await this.request<{ meta?: RawMeta; feeds?: RawFeed[] }>(
      '/feeds',
      { ...params, 'feed_versions.limit': 1 },
      ctx,
      'transitland.listFeeds',
    );
    const page = this.extractPage<RawFeed>(body, 'feeds');
    return {
      items: page.items.map(normalizeFeed),
      ...(page.after !== undefined && { after: page.after }),
    };
  }

  /**
   * Fetch the raw feed record for a key (latest version only). Returns null when
   * the feed is absent — both the HTTP 404 and 200-with-empty-array cases — so
   * callers choose whether absence is an error (`getFeed`) or skippable
   * (`listFeedsForOperator`, where a stale operator feed-ref shouldn't fail all).
   */
  private async fetchFeedRaw(key: string, ctx: Context): Promise<RawFeed | null> {
    try {
      const body = await this.request<{ feeds?: RawFeed[] }>(
        `/feeds/${encodeURIComponent(key)}`,
        { 'feed_versions.limit': 1 },
        ctx,
        'transitland.getFeed',
        undefined,
        [404],
      );
      return body.feeds?.[0] ?? null;
    } catch (err) {
      if ((err as { code?: number })?.code === -32001) return null;
      throw err;
    }
  }

  /** Fetch one feed by Onestop ID or internal int ID. Throws NotFound when absent. */
  async getFeed(key: string, ctx: Context, failReason?: NotFoundFail): Promise<FeedRecord> {
    const raw = await this.fetchFeedRaw(key, ctx);
    if (!raw) {
      throw this.notFoundFor({
        ctx,
        key,
        kind: 'feed',
        ...(failReason && { fail: failReason }),
      });
    }
    return normalizeFeed(raw);
  }

  /**
   * Resolve the feeds an operator publishes — Transitland's `/feeds` endpoint has
   * no operator filter, so this fetches the operator record, reads its feed
   * Onestop IDs, and fetches each feed individually for the full license/url/
   * freshness payload (the operator-embedded feed refs are sparse). Optionally
   * narrowed to one `spec` and capped at `limit`. Throws the operator's NotFound
   * (carrying `failReason`) when the operator itself is absent.
   */
  async listFeedsForOperator(
    operatorKey: string,
    ctx: Context,
    opts: { spec?: string; limit: number; failReason?: NotFoundFail },
  ): Promise<Page<FeedRecord>> {
    const operator = await this.getOperator(operatorKey, ctx, opts.failReason);
    const wantSpec = opts.spec ? specToUpstream(opts.spec) : undefined;
    const feedIds = operator.feeds
      .filter((f) => wantSpec === undefined || f.spec.toUpperCase() === wantSpec)
      .map((f) => f.onestopId)
      .slice(0, opts.limit);

    const raws = await Promise.all(feedIds.map((id) => this.fetchFeedRaw(id, ctx)));
    return { items: raws.filter((r): r is RawFeed => r !== null).map(normalizeFeed) };
  }

  // --- Routes -------------------------------------------------------------

  async listRoutes(params: Record<string, QueryValue>, ctx: Context): Promise<Page<RouteRecord>> {
    const body = await this.request<{ meta?: RawMeta; routes?: RawRoute[] }>(
      '/routes',
      params,
      ctx,
      'transitland.listRoutes',
    );
    const page = this.extractPage<RawRoute>(body, 'routes');
    return {
      items: page.items.map(normalizeRoute),
      ...(page.after !== undefined && { after: page.after }),
    };
  }

  // --- Stops --------------------------------------------------------------

  async listStops(params: Record<string, QueryValue>, ctx: Context): Promise<Page<StopRecord>> {
    const body = await this.request<{ meta?: RawMeta; stops?: RawStop[] }>(
      '/stops',
      params,
      ctx,
      'transitland.listStops',
    );
    const page = this.extractPage<RawStop>(body, 'stops');
    return {
      items: page.items.map(normalizeStop),
      ...(page.after !== undefined && { after: page.after }),
    };
  }

  // --- Departures ---------------------------------------------------------

  /**
   * Departures for a stop. The endpoint returns HTTP 200 + `{stops:[]}` for a
   * nonexistent stop (NOT a 404), so the caller distinguishes not-found from
   * no-departures via the returned `found` flag — a populated stop record (even
   * with zero departures) is valid; a completely absent stop record is not-found.
   */
  async getDepartures(
    key: string,
    params: Record<string, QueryValue>,
    ctx: Context,
  ): Promise<{ found: false } | { found: true; result: DeparturesResult }> {
    const body = await this.request<{ stops?: RawStopWithDepartures[] }>(
      `/stops/${encodeURIComponent(key)}/departures`,
      params,
      ctx,
      'transitland.getDepartures',
    );
    const stop = body.stops?.[0];
    if (!stop) {
      return { found: false };
    }
    const departures = (stop.departures ?? []).map(normalizeDeparture);
    return {
      found: true,
      result: {
        stop: {
          onestopId: blankToNull(stop.onestop_id) ?? key,
          name: blankToNull(stop.stop_name),
          timezone: blankToNull(stop.stop_timezone),
        },
        departures,
        realtimeAvailable: departures.some((d) => d.realtime),
      },
    };
  }
}

// --- Init/accessor pattern -------------------------------------------------

let _service: TransitlandService | undefined;

export function initTransitlandService(config: AppConfig, storage: StorageService): void {
  _service = new TransitlandService(config, storage);
}

export function getTransitlandService(): TransitlandService {
  if (!_service) {
    throw new Error(
      'TransitlandService not initialized — call initTransitlandService() in setup()',
    );
  }
  return _service;
}
