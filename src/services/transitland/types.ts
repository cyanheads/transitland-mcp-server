/**
 * @fileoverview Domain types for the Transitland v2 REST API — raw upstream shapes
 * (sparse, optional-by-default), normalized domain shapes surfaced to tools, and the
 * GTFS enum/label maps. Raw types mirror real payloads verified against the live API;
 * fields are optional unless presence is guaranteed, so absence stays "unknown".
 * @module services/transitland/types
 */

/** Tri-state for license/accessibility fields the registry records as yes/no/unknown. */
export type TriState = 'yes' | 'no' | 'unknown';

/** Wheelchair accessibility, mapped from GTFS 0/1/2. */
export type WheelchairState = 'accessible' | 'not_accessible' | 'unknown';

// ---------------------------------------------------------------------------
// Raw upstream shapes (what Transitland returns) — optional by default.
// ---------------------------------------------------------------------------

export interface RawMeta {
  after?: number;
  next?: string;
}

export interface RawPlace {
  adm0_iso?: string | null;
  adm0_name?: string | null;
  adm1_iso?: string | null;
  adm1_name?: string | null;
  city_name?: string | null;
}

export interface RawFeedRef {
  id?: number;
  name?: string | null;
  onestop_id?: string | null;
  spec?: string | null;
}

export interface RawAgency {
  agency_id?: string | null;
  agency_name?: string | null;
  id?: number;
  places?: RawPlace[] | null;
}

export interface RawOperatorTags {
  twitter_general?: string;
  us_ntd_id?: string;
  wikidata_id?: string;
  [key: string]: string | undefined;
}

export interface RawOperator {
  agencies?: RawAgency[] | null;
  feeds?: RawFeedRef[] | null;
  id?: number;
  name?: string | null;
  onestop_id?: string | null;
  short_name?: string | null;
  tags?: RawOperatorTags | null;
  website?: string | null;
}

export interface RawLicense {
  attribution_text?: string | null;
  commercial_use_allowed?: string | null;
  create_derived_product?: string | null;
  redistribution_allowed?: string | null;
  share_alike_optional?: string | null;
  spdx_identifier?: string | null;
  url?: string | null;
  use_without_attribution?: string | null;
}

export interface RawFeedUrls {
  gbfs_auto_discovery?: string | null;
  realtime_alerts?: string | null;
  realtime_trip_updates?: string | null;
  realtime_vehicle_positions?: string | null;
  static_current?: string | null;
  static_historic?: string[] | null;
  static_planned?: string[] | null;
}

export interface RawFeedVersion {
  earliest_calendar_date?: string | null;
  fetched_at?: string | null;
  latest_calendar_date?: string | null;
  sha1?: string | null;
  url?: string | null;
}

export interface RawAuthorization {
  info_url?: string | null;
  param_name?: string | null;
  type?: string | null;
}

export interface RawFeed {
  authorization?: RawAuthorization | null;
  feed_versions?: RawFeedVersion[] | null;
  id?: number;
  license?: RawLicense | null;
  name?: string | null;
  onestop_id?: string | null;
  spec?: string | null;
  urls?: RawFeedUrls | null;
}

export interface RawAgencyRef {
  agency_id?: string | null;
  agency_name?: string | null;
  id?: number;
  onestop_id?: string | null;
}

export interface RawFeedVersionRef {
  feed?: { onestop_id?: string | null; id?: number } | null;
  fetched_at?: string | null;
  sha1?: string | null;
}

export interface RawRoute {
  agency?: RawAgencyRef | null;
  feed_version?: RawFeedVersionRef | null;
  id?: number;
  onestop_id?: string | null;
  route_color?: string | null;
  route_desc?: string | null;
  route_id?: string | null;
  route_long_name?: string | null;
  route_short_name?: string | null;
  route_text_color?: string | null;
  route_type?: number | null;
  route_url?: string | null;
}

export interface RawGeometryPoint {
  coordinates?: [number, number];
  type?: string;
}

export interface RawStop {
  feed_version?: RawFeedVersionRef | null;
  geometry?: RawGeometryPoint | null;
  id?: number;
  location_type?: number | null;
  onestop_id?: string | null;
  parent?: { onestop_id?: string | null } | string | null;
  place?: RawPlace | null;
  platform_code?: string | null;
  stop_code?: string | null;
  stop_desc?: string | null;
  stop_id?: string | null;
  stop_name?: string | null;
  stop_timezone?: string | null;
  stop_url?: string | null;
  wheelchair_boarding?: number | null;
  zone_id?: string | null;
}

export interface RawDepartureTime {
  delay?: number | null;
  estimated?: string | null;
  estimated_delay?: number | null;
  estimated_local?: string | null;
  estimated_utc?: string | null;
  scheduled?: string | null;
  scheduled_local?: string | null;
  scheduled_utc?: string | null;
  uncertainty?: number | null;
}

export interface RawDepartureRoute {
  agency?: { onestop_id?: string | null; agency_name?: string | null } | null;
  onestop_id?: string | null;
  route_color?: string | null;
  route_long_name?: string | null;
  route_short_name?: string | null;
  route_type?: number | null;
}

export interface RawDepartureTrip {
  bikes_allowed?: number | null;
  direction_id?: number | null;
  route?: RawDepartureRoute | null;
  trip_headsign?: string | null;
  trip_id?: string | null;
  wheelchair_accessible?: number | null;
}

export interface RawDeparture {
  arrival?: RawDepartureTime | null;
  departure?: RawDepartureTime | null;
  schedule_relationship?: string | null;
  service_date?: string | null;
  stop_headsign?: string | null;
  stop_sequence?: number | null;
  trip?: RawDepartureTrip | null;
}

export interface RawStopWithDepartures {
  departures?: RawDeparture[] | null;
  onestop_id?: string | null;
  stop_name?: string | null;
  stop_timezone?: string | null;
}

// ---------------------------------------------------------------------------
// Normalized domain shapes (what the service returns to tools). A list method
// returns { items, after } where `after` is the opaque integer cursor and the
// raw `meta.next` URL (which embeds the apikey) is discarded.
// ---------------------------------------------------------------------------

export interface Page<T> {
  after?: number;
  items: T[];
}

export interface PlaceSummary {
  city: string | null;
  country: string | null;
  region: string | null;
}

export interface OperatorFeedRef {
  name: string | null;
  onestopId: string;
  spec: string;
}

export interface OperatorSummary {
  feeds: OperatorFeedRef[];
  name: string;
  onestopId: string;
  places: PlaceSummary[];
  shortName: string | null;
  website: string | null;
  wikidataId: string | null;
}

export interface OperatorAgency {
  agencyId: string;
  agencyName: string;
  places: PlaceSummary[];
}

export interface OperatorRecord {
  agencies: OperatorAgency[];
  feeds: OperatorFeedRef[];
  name: string;
  onestopId: string;
  shortName: string | null;
  tags: {
    wikidataId: string | null;
    usNtdId: string | null;
    twitter: string | null;
  };
  website: string | null;
}

export interface FeedRecord {
  authorizationRequired: boolean;
  fetchUrl: string | null;
  latestFetch: {
    fetchedAt: string | null;
    earliestServiceDate: string | null;
    latestServiceDate: string | null;
    sha1: string | null;
  };
  license: {
    spdxIdentifier: string | null;
    url: string | null;
    redistributionAllowed: TriState;
    commercialUseAllowed: TriState;
    createDerivedProduct: TriState;
    useWithoutAttribution: TriState;
    attributionText: string | null;
  };
  name: string | null;
  onestopId: string;
  realtimeUrls: {
    tripUpdates: string | null;
    vehiclePositions: string | null;
    alerts: string | null;
  };
  spec: string;
}

export interface RouteRecord {
  color: string | null;
  description: string | null;
  feedOnestopId: string | null;
  longName: string | null;
  mode: string;
  onestopId: string;
  operator: {
    onestopId: string | null;
    name: string;
  };
  routeType: number;
  shortName: string | null;
}

export interface StopRecord {
  code: string | null;
  feedOnestopId: string | null;
  lat: number;
  locationType: number;
  locationTypeLabel: string;
  lon: number;
  name: string | null;
  onestopId: string;
  parentOnestopId: string | null;
  place: {
    country: string | null;
    region: string | null;
  };
  timezone: string | null;
  wheelchairBoarding: WheelchairState;
}

export interface DepartureRecord {
  delaySeconds: number | null;
  directionId: number | null;
  estimatedTime: string | null;
  headsign: string | null;
  operatorName: string | null;
  realtime: boolean;
  route: {
    onestopId: string;
    shortName: string | null;
    longName: string | null;
    mode: string;
    color: string | null;
  };
  scheduledTime: string;
  scheduleRelationship: string;
  tripId: string | null;
  wheelchairAccessible: WheelchairState;
}

export interface DeparturesResult {
  departures: DepartureRecord[];
  realtimeAvailable: boolean;
  stop: {
    onestopId: string;
    name: string | null;
    timezone: string | null;
  };
}
