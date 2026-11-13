/** @fileoverview Normalization of GTFS value types shared by transit records. */
import type { WheelchairState } from './types.js';

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

/** Recognized extended families; 400–404 is a coarse urban-rail grouping. */
const EXTENDED_ROUTE_TYPE_MODES = [
  [100, 117, 'rail'],
  [200, 209, 'coach'],
  [400, 404, 'subway'],
  [405, 405, 'monorail'],
  [700, 716, 'bus'],
  [800, 800, 'trolleybus'],
  [900, 906, 'tram'],
  [1000, 1000, 'water transport'],
  [1200, 1200, 'ferry'],
  [1300, 1307, 'aerial lift'],
  [1400, 1400, 'funicular'],
] as const;

export function modeForRouteType(routeType: number | null): string {
  if (routeType === null) return 'unknown';
  const basicMode = ROUTE_TYPE_MODES[routeType];
  if (basicMode !== undefined) return basicMode;
  for (const [start, end, mode] of EXTENDED_ROUTE_TYPE_MODES) {
    if (routeType >= start && routeType <= end) return mode;
  }
  return `type ${routeType}`;
}

export function locationTypeLabel(locationType: number): string {
  return LOCATION_TYPE_LABELS[locationType] ?? `type ${locationType}`;
}

/** Map GTFS wheelchair 0/1/2 (and absent) → tri-state. */
export function wheelchairState(value: number | null | undefined): WheelchairState {
  if (value === 1) return 'accessible';
  if (value === 2) return 'not_accessible';
  return 'unknown';
}

/** Empty-string-or-null → null; otherwise the trimmed string. */
export function blankToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
