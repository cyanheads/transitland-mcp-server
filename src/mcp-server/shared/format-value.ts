/** @fileoverview Render nullable Transitland values as literal Markdown text or links. */

import { escapeMarkdownInline, markdownLink } from '@cyanheads/mcp-ts-core/utils';

/** Render a value in a paragraph, preserving line breaks and markup as data. */
export function formatValue(value: string | null): string {
  /**
   * CommonMark normalizes raw CR to LF. Escape segments before encoding CR so
   * literal entity text stays distinct from the encoded carriage return.
   */
  return value === null
    ? 'Not available'
    : value.split('\r').map(escapeMarkdownInline).join('&#13;');
}

/** Render the URL as both link text and destination for clients that copy the address. */
export function formatUrl(value: string | null): string {
  if (value === null || value.includes('\r')) return formatValue(value);
  return markdownLink(value, value);
}
