/** @fileoverview Shared geographic scope input for Transitland listing tools. */

import { z } from '@cyanheads/mcp-ts-core';

const coordinate = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`;
const bboxPattern = new RegExp(
  String.raw`^(?:\s*${coordinate}(?:\s*,\s*${coordinate}){3}\s*|\s*)$`,
);
const bboxMessage =
  'Expected a bounding box in minLon,minLat,maxLon,maxLat order with longitude within ±180, latitude within ±90, and minima no greater than maxima.';

/** Validate the box before forwarding decimal coordinates to Transitland. */
export const bboxSchema = z
  .string()
  .regex(bboxPattern, { message: bboxMessage, abort: true })
  .refine((value) => {
    if (value.trim() === '') return true;
    const [minLon, minLat, maxLon, maxLat] = value.split(',').map(Number);
    return (
      minLon !== undefined &&
      minLat !== undefined &&
      maxLon !== undefined &&
      maxLat !== undefined &&
      Math.abs(minLon) <= 180 &&
      Math.abs(maxLon) <= 180 &&
      minLon <= maxLon &&
      Math.abs(minLat) <= 90 &&
      Math.abs(maxLat) <= 90 &&
      minLat <= maxLat
    );
  }, bboxMessage)
  .optional()
  .describe(
    'Bounding box "minLon,minLat,maxLon,maxLat" (e.g. "-122.5,37.7,-122.3,37.9"). If combined with lat/lon, results must satisfy both geographic filters.',
  );

/** Preserve the numeric notation while removing whitespace from each coordinate. */
export function normalizeBbox(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed
    ? trimmed
        .split(',')
        .map((part) => part.trim())
        .join(',')
    : undefined;
}
