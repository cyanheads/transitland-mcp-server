/**
 * @fileoverview TransitlandService — a thin typed HTTP client over the Transitland
 * v2 REST API. Injects the `apikey` query parameter, normalizes the pagination
 * cursor (reads `meta.after`, discards the apikey-leaking `meta.next` URL),
 * classifies upstream failures (401/404/429), and exposes one method per endpoint
 * returning normalized domain shapes.
 * @module services/transitland/transitland-service
 */

import { type Context, z } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import {
  JsonRpcErrorCode,
  McpError,
  notFound,
  rateLimited,
  serializationError,
  serviceUnavailable,
  unauthorized,
} from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import {
  defaultIsTransient,
  fetchWithTimeout,
  requestContextService,
  withRetry,
} from '@cyanheads/mcp-ts-core/utils';
import { getServerConfig } from '@/config/server-config.js';
import { assembleDepartures } from './assemble-departures.js';
import {
  blankToNull,
  locationTypeLabel,
  modeForRouteType,
  wheelchairState,
} from './gtfs-values.js';
import type {
  DeparturesResult,
  FeedRecord,
  OperatorAgency,
  OperatorFeedOptions,
  OperatorFeedRef,
  OperatorRecord,
  OperatorSummary,
  Page,
  PlaceSummary,
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
} from './types.js';

const FETCH_TIMEOUT_MS = 15_000;
const REQUEST_DEADLINE_MS = 48_000;
const OPERATOR_FEED_DEADLINE_MS = 54_000;
const PARENT_LOOKUP_DEADLINE_MS = 5_000;
const OPERATOR_ID_GUIDANCE =
  'Use a public operator Onestop ID such as o-9q9-bart. Find one with transitland_find_operators.';
/** Rate-limited free tier recovers within ~1-2s; calibrate backoff to that. */
const RETRY_BASE_DELAY_MS = 1_500;

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
  const spec = blankToNull(raw.spec) ?? 'unknown';
  const fetchUrl =
    spec.toUpperCase() === 'GBFS'
      ? raw.urls?.gbfs_auto_discovery
      : spec.toUpperCase() === 'MDS'
        ? raw.urls?.mds_provider
        : raw.urls?.static_current;
  return {
    onestopId: blankToNull(raw.onestop_id) ?? '',
    spec,
    name: blankToNull(raw.name),
    fetchUrl: blankToNull(fetchUrl),
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
      shareAlikeOptional: triState(raw.license?.share_alike_optional),
      attributionText: blankToNull(raw.license?.attribution_text),
      attributionInstructions: blankToNull(raw.license?.attribution_instructions),
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
  const routeType = raw.route_type ?? null;
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

function embeddedParentId(raw: RawStop): string | null {
  return typeof raw.parent === 'string'
    ? blankToNull(raw.parent)
    : blankToNull(raw.parent?.onestop_id);
}

function internalParentId(raw: RawStop): number | null {
  return typeof raw.parent === 'object' ? (raw.parent?.id ?? null) : null;
}

function normalizeStop(raw: RawStop, parents: ReadonlyMap<number, string>): StopRecord {
  const coords = raw.geometry?.coordinates;
  const locationType = raw.location_type ?? 0;
  const parentId = internalParentId(raw);
  return {
    onestopId: blankToNull(raw.onestop_id) ?? '',
    name: blankToNull(raw.stop_name),
    code: blankToNull(raw.stop_code),
    platformCode: blankToNull(raw.platform_code),
    description: blankToNull(raw.stop_desc),
    lat: coords?.[1] ?? null,
    lon: coords?.[0] ?? null,
    locationType,
    locationTypeLabel: locationTypeLabel(locationType),
    wheelchairBoarding: wheelchairState(raw.wheelchair_boarding),
    timezone: blankToNull(raw.stop_timezone),
    parentOnestopId:
      embeddedParentId(raw) ?? (parentId === null ? null : (parents.get(parentId) ?? null)),
    place: {
      country: blankToNull(raw.place?.adm0_name),
      region: blankToNull(raw.place?.adm1_name),
    },
    feedOnestopId: blankToNull(raw.feed_version?.feed?.onestop_id),
  };
}

/** Query-parameter values accepted by the service request helper. */
type QueryValue = string | number | boolean | undefined;

/** Translate a numeric exact filter without coercing the caller's string. */
function internalId(value: QueryValue): string | undefined {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined;
  const leadingZero = value.search(/[1-9]/);
  return leadingZero === -1 ? '0' : value.slice(leadingZero);
}

function matchInternalId(raw: { id?: number }, wanted: string): boolean {
  return Number.isSafeInteger(raw.id) && String(raw.id) === wanted;
}

const ParentDetailSchema = z.object({
  stops: z.array(
    z.object({
      id: z.number().optional(),
      onestop_id: z.string().nullish(),
    }),
  ),
});

const OPTIONAL_PARENT_FAILURES = new Set([
  JsonRpcErrorCode.InvalidRequest,
  JsonRpcErrorCode.InvalidParams,
  JsonRpcErrorCode.ValidationError,
  JsonRpcErrorCode.Unauthorized,
  JsonRpcErrorCode.Forbidden,
  JsonRpcErrorCode.NotFound,
  JsonRpcErrorCode.Conflict,
  JsonRpcErrorCode.RateLimited,
  JsonRpcErrorCode.ServiceUnavailable,
  JsonRpcErrorCode.Timeout,
  JsonRpcErrorCode.SerializationError,
]);

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
 * identifier surfaced in the message; `fail` supplies the declared reason so
 * the framework can fill the matching recovery hint on the wire.
 */
interface NotFoundLookup {
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
      // Transitland treats exact zero point coordinates as an absent filter.
      const queryValue = (key === 'lat' || key === 'lon') && value === 0 ? 1e-9 : value;
      url.searchParams.set(key, String(queryValue));
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
    options: { expectedStatuses?: number[]; signal?: AbortSignal; maxRetries?: number } = {},
  ): Promise<T> {
    const url = this.buildUrl(path, params);
    const signal = options.signal ?? ctx.signal;
    // Child context under the handler's own — inherits requestId/traceId/
    // tenantId/sessionId/spanId, relabeled with the upstream operation name.
    const reqCtx = requestContextService.createRequestContext({
      operation,
      parentContext: ctx,
    });
    return withRetry(
      async (attempt) => {
        attempt.signal.throwIfAborted();
        let response: Response;
        try {
          response = await fetchWithTimeout(
            url,
            Math.min(FETCH_TIMEOUT_MS, attempt.remainingMs),
            reqCtx,
            {
              signal: attempt.signal,
              headers: { accept: 'application/json' },
              ...(options.expectedStatuses && { expectedStatuses: options.expectedStatuses }),
            },
          );
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
        signal,
        deadlineMs: REQUEST_DEADLINE_MS,
        ...(options.maxRetries !== undefined && { maxRetries: options.maxRetries }),
        isTransient: (err) => err instanceof McpError && defaultIsTransient(err),
      },
    );
  }

  /**
   * Build the NotFound a single-record lookup throws — clean message naming the
   * caller's ID (never the internal endpoint path), with the tool's declared
   * contract `reason` on `error.data`; the framework fills its recovery hint.
   * Shared by the HTTP-404 path and the 200-with-empty-array path.
   */
  private notFoundFor(lookup: NotFoundLookup, options?: { cause?: unknown }): Error {
    const { fail, key, kind } = lookup;
    return notFound(
      `No ${kind} found for "${key}".`,
      {
        [`${kind}Key`]: key,
        ...(fail && { reason: fail.reason }),
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
    if (code === JsonRpcErrorCode.Unauthorized) {
      return unauthorized(
        'Transitland rejected the API key (HTTP 401). Verify TRANSITLAND_API_KEY.',
        { path },
        { cause: err },
      );
    }
    if (code === JsonRpcErrorCode.NotFound) {
      // Single-record fetches 404 on an absent key; surface the caller's contract
      // reason + a clean ID-named message rather than leaking the endpoint path.
      if (notFoundLookup) return this.notFoundFor(notFoundLookup, { cause: err });
      return notFound(`Transitland returned not found for ${path}.`, { path }, { cause: err });
    }
    if (code === JsonRpcErrorCode.RateLimited) {
      return rateLimited(
        'Transitland rate limit hit (HTTP 429). Wait a few seconds and retry; a Pro key raises the quota.',
        { path, reason: 'rate_limited', retryable: true },
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
    if (internalId(params.onestop_id) !== undefined) {
      return { items: [], notices: [OPERATOR_ID_GUIDANCE] };
    }
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
   * Fetch one operator by Onestop ID. Throws NotFound when
   * absent — `failReason` carries the caller's contract reason onto `data.reason`
   * (and its recovery hint onto the wire) so clients see a stable identifier.
   */
  async getOperator(key: string, ctx: Context, failReason?: NotFoundFail): Promise<OperatorRecord> {
    if (internalId(key) !== undefined) {
      throw notFound(OPERATOR_ID_GUIDANCE, { operatorKey: key, reason: 'operator_not_found' });
    }
    const lookup: NotFoundLookup = {
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
      { expectedStatuses: [404] },
    );
    const raw = body.operators?.find((operator) => operator.onestop_id === key);
    if (!raw) throw this.notFoundFor(lookup);
    return normalizeOperatorRecord(raw);
  }

  // --- Feeds --------------------------------------------------------------

  async listFeeds(params: Record<string, QueryValue>, ctx: Context): Promise<Page<FeedRecord>> {
    const exact = params.onestop_id;
    const id = internalId(exact);
    if (typeof exact === 'string' && (exact.trim() === '' || exact.includes(',') || id === '0')) {
      return { items: [] };
    }
    const page = await this.fetchFeedPage(
      id === undefined ? params : { ...params, onestop_id: undefined, id },
      ctx,
    );
    if (typeof exact === 'string') {
      const match = page.items.find((raw) =>
        id === undefined ? raw.onestop_id === exact : matchInternalId(raw, id),
      );
      return { items: match ? [normalizeFeed(match)] : [] };
    }
    return {
      items: page.items.map(normalizeFeed),
      ...(page.after !== undefined && { after: page.after }),
    };
  }

  private async fetchFeedPage(
    params: Record<string, QueryValue>,
    ctx: Context,
    signal?: AbortSignal,
  ): Promise<Page<RawFeed>> {
    const body = await this.request<{ meta?: RawMeta; feeds?: RawFeed[] }>(
      '/feeds',
      { ...params, 'feed_versions.limit': 1 },
      ctx,
      'transitland.listFeeds',
      undefined,
      signal && { signal, expectedStatuses: [404] },
    );
    return this.extractPage<RawFeed>(body, 'feeds');
  }

  /**
   * Fetch the raw feed record for a key (latest version only). Returns null when
   * the feed is absent — both the HTTP 404 and 200-with-empty-array cases — so
   * callers choose whether absence is an error (`getFeed`) or skippable
   * (`listFeedsForOperator`, where a stale operator feed-ref shouldn't fail all).
   */
  private async fetchFeedRaw(
    key: string,
    ctx: Context,
    signal?: AbortSignal,
  ): Promise<RawFeed | null> {
    const id = internalId(key);
    if (id === '0') return null;
    try {
      const body = await this.request<{ feeds?: RawFeed[] }>(
        `/feeds/${encodeURIComponent(id ?? key)}`,
        { 'feed_versions.limit': 1 },
        ctx,
        'transitland.getFeed',
        undefined,
        { expectedStatuses: [404], ...(signal && { signal }) },
      );
      return (
        body.feeds?.find((raw) =>
          id === undefined ? raw.onestop_id === key : matchInternalId(raw, id),
        ) ?? null
      );
    } catch (err) {
      if ((err as { code?: number })?.code === JsonRpcErrorCode.NotFound) return null;
      throw err;
    }
  }

  /** Fetch one feed by Onestop ID or internal int ID. Throws NotFound when absent. */
  async getFeed(key: string, ctx: Context, failReason?: NotFoundFail): Promise<FeedRecord> {
    const raw = await this.fetchFeedRaw(key, ctx);
    if (!raw) {
      throw this.notFoundFor({
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
  listFeedsForOperator(
    operatorKey: string,
    ctx: Context,
    opts: OperatorFeedOptions,
  ): Promise<Page<FeedRecord>> {
    return withRetry(
      async ({ signal }) => {
        const operator = await this.getOperator(operatorKey, { ...ctx, signal }, opts.failReason);
        const wantSpec = opts.spec ? specToUpstream(opts.spec) : undefined;
        const feedIds = operator.feeds
          .filter((feed) => wantSpec === undefined || feed.spec.toUpperCase() === wantSpec)
          .map((feed) => feed.onestopId);
        const exact = opts.onestop_id;
        const id = internalId(exact);
        if (exact !== undefined) {
          if (id === '0' || (id === undefined && !feedIds.includes(exact))) return { items: [] };
          const matches = await this.matchOperatorFeeds(
            id === undefined ? { onestop_id: exact } : { id },
            opts,
            ctx,
            signal,
          );
          const match = matches.find(
            (raw) =>
              raw.onestop_id != null &&
              feedIds.includes(raw.onestop_id) &&
              (id === undefined ? raw.onestop_id === exact : matchInternalId(raw, id)),
          );
          return { items: match ? [normalizeFeed(match)] : [] };
        }
        if (opts.search || opts.fetch_error !== undefined) {
          const items: FeedRecord[] = [];
          for (const onestop_id of feedIds) {
            const matches = await this.matchOperatorFeeds({ onestop_id }, opts, ctx, signal);
            const raw = matches.find((feed) => feed.onestop_id === onestop_id);
            if (raw) items.push(normalizeFeed(raw));
            if (items.length >= opts.limit) break;
          }
          return { items };
        }
        const cappedIds = feedIds.slice(0, opts.limit);
        const raws = await Promise.all(cappedIds.map((key) => this.fetchFeedRaw(key, ctx, signal)));
        const missing = cappedIds.filter((_, index) => raws[index] === null);
        return {
          items: raws.filter((raw): raw is RawFeed => raw !== null).map(normalizeFeed),
          ...(missing.length > 0 && {
            notices: [`Could not resolve operator feed references: ${missing.join(', ')}.`],
          }),
        };
      },
      {
        operation: 'transitland.listFeedsForOperator',
        deadlineMs: OPERATOR_FEED_DEADLINE_MS,
        signal: ctx.signal,
        maxRetries: 0,
        isTransient: () => false,
      },
    );
  }

  private async matchOperatorFeeds(
    identity: Record<string, QueryValue>,
    opts: OperatorFeedOptions,
    ctx: Context,
    signal: AbortSignal,
  ): Promise<RawFeed[]> {
    try {
      const page = await this.fetchFeedPage(
        {
          ...identity,
          ...(opts.spec && { spec: opts.spec }),
          search: opts.search,
          fetch_error: opts.fetch_error,
        },
        ctx,
        signal,
      );
      return page.items;
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) return [];
      throw err;
    }
  }

  // --- Routes -------------------------------------------------------------

  async listRoutes(params: Record<string, QueryValue>, ctx: Context): Promise<Page<RouteRecord>> {
    const id = internalId(params.onestop_id);
    if (id === '0') return { items: [] };
    const body = await this.request<{ meta?: RawMeta; routes?: RawRoute[] }>(
      '/routes',
      id === undefined ? params : { ...params, onestop_id: undefined, id },
      ctx,
      'transitland.listRoutes',
    );
    const page = this.extractPage<RawRoute>(body, 'routes');
    if (id !== undefined) page.items = page.items.filter((raw) => matchInternalId(raw, id));
    return {
      items: page.items.map(normalizeRoute),
      ...(page.after !== undefined &&
        (id === undefined || page.items.length > 0) && { after: page.after }),
    };
  }

  // --- Stops --------------------------------------------------------------

  async listStops(params: Record<string, QueryValue>, ctx: Context): Promise<Page<StopRecord>> {
    const startedAt = performance.now();
    const id = internalId(params.onestop_id);
    if (id === '0') return { items: [] };
    const body = await this.request<{ meta?: RawMeta; stops?: RawStop[] }>(
      '/stops',
      id === undefined ? params : { ...params, onestop_id: undefined, id },
      ctx,
      'transitland.listStops',
    );
    const page = this.extractPage<RawStop>(body, 'stops');
    const items =
      id === undefined ? page.items : page.items.filter((raw) => matchInternalId(raw, id));
    const parents = new Map<number, string>();
    for (const stop of page.items) {
      const onestopId = blankToNull(stop.onestop_id);
      if (stop.id !== undefined && onestopId !== null) parents.set(stop.id, onestopId);
    }
    const missing = new Set<number>();
    for (const stop of items) {
      const parentId = internalParentId(stop);
      if (embeddedParentId(stop) === null && parentId !== null && !parents.has(parentId)) {
        missing.add(parentId);
      }
    }
    const notice =
      missing.size === 0
        ? undefined
        : await this.resolveStopParents(
            missing,
            parents,
            ctx,
            Math.max(0, REQUEST_DEADLINE_MS - (performance.now() - startedAt)),
          );
    return {
      items: items.map((raw) => normalizeStop(raw, parents)),
      ...(page.after !== undefined &&
        (id === undefined || items.length > 0) && { after: page.after }),
      ...(notice !== undefined && { notices: [notice] }),
    };
  }

  private async resolveStopParents(
    missing: Set<number>,
    parents: Map<number, string>,
    ctx: Context,
    remainingMs: number,
  ): Promise<string | undefined> {
    const ids = missing.values();
    const unresolved = new Set(missing);
    const controller = new AbortController();
    const signal = AbortSignal.any([ctx.signal, controller.signal]);
    const budgetMs = Math.min(PARENT_LOOKUP_DEADLINE_MS, remainingMs);
    const timeoutReason = new DOMException('Parent lookup timed out', 'TimeoutError');
    const timer = setTimeout(() => controller.abort(timeoutReason), budgetMs);
    let rateLimited = false;
    const resolve = async () => {
      while (!signal.aborted && !rateLimited && budgetMs > 0) {
        const next = ids.next();
        if (next.done) return;
        const id = next.value;
        try {
          const path = `/stops/${id}`;
          const body = await this.request<unknown>(
            path,
            {},
            ctx,
            'transitland.resolveStopParent',
            undefined,
            {
              expectedStatuses: [404],
              signal,
              maxRetries: 0,
            },
          );
          const detail = ParentDetailSchema.safeParse(body);
          if (!detail.success) continue;
          const parent = detail.data.stops.find((stop) => stop.id === id);
          const onestopId = blankToNull(parent?.onestop_id);
          if (onestopId !== null) {
            parents.set(id, onestopId);
            unresolved.delete(id);
          }
        } catch (err) {
          if (
            !ctx.signal.aborted &&
            controller.signal.aborted &&
            controller.signal.reason !== timeoutReason
          )
            return;
          if (
            ctx.signal.aborted ||
            !(err instanceof McpError) ||
            !OPTIONAL_PARENT_FAILURES.has(err.code)
          ) {
            controller.abort(err);
            throw err;
          }
          if (err.code === JsonRpcErrorCode.RateLimited) rateLimited = true;
        }
      }
    };
    try {
      const results = await Promise.allSettled([resolve(), resolve()]);
      for (const result of results) {
        if (result.status === 'rejected') throw result.reason;
      }
      ctx.signal.throwIfAborted();
    } finally {
      clearTimeout(timer);
    }
    if (unresolved.size === 0) return undefined;
    const pending = [...unresolved].join(', ');
    return rateLimited
      ? `Transitland rate limited parent lookups. Parent Onestop IDs remain unresolved for internal stop IDs: ${pending}.`
      : `Could not resolve parent Onestop IDs for internal stop IDs: ${pending}.`;
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
      { ...params, include_alerts: true },
      ctx,
      'transitland.getDepartures',
    );
    const stop = body.stops?.[0];
    if (!stop) {
      return { found: false };
    }
    return {
      found: true,
      result: assembleDepartures(
        stop,
        key,
        typeof params.limit === 'number' ? params.limit : undefined,
      ),
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
