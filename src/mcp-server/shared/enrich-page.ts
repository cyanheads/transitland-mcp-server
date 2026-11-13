/** @fileoverview Consistent pagination guidance for Transitland listing tools. */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { Page } from '@/services/transitland/types.js';

/** Disclose the cap, continuation, and service notices together. */
export function enrichPage(
  ctx: Context,
  page: Page<unknown>,
  {
    limit,
    requestedLimit,
    after,
    firstPageNotice,
    singlePage = false,
  }: {
    limit: number;
    requestedLimit: number;
    after: number | undefined;
    firstPageNotice: string;
    singlePage?: boolean;
  },
): void {
  const count = page.items.length;
  const cursor = singlePage ? undefined : page.after;
  const notices = [...(page.notices ?? [])];
  ctx.enrich.total(count);
  if (requestedLimit > limit) {
    notices.push(`Requested ${requestedLimit} results; applied the ${limit}-result page cap.`);
  }
  if (cursor !== undefined) {
    ctx.enrich({ cursor });
    notices.push(
      'Pass the cursor as after with the same filters to request the next page, which may be empty.',
    );
  }
  if (singlePage && after !== undefined) {
    notices.push(
      'The after value was ignored because operator-scoped feeds are returned on one page.',
    );
  }
  if (count === 0) {
    const emptyNotice =
      !singlePage && after !== undefined
        ? 'This listing is exhausted for the supplied after cursor.'
        : firstPageNotice;
    if (emptyNotice) notices.push(emptyNotice);
  }
  if (count >= limit) {
    if (cursor === undefined) {
      notices.push(
        limit < 100
          ? 'Narrow the filters or raise the limit up to 100.'
          : 'Narrow the filters to return fewer results.',
      );
    }
    ctx.enrich.truncated({ shown: count, cap: limit, guidance: notices.join(' ') });
  } else if (notices.length > 0) {
    ctx.enrich.notice(notices.join(' '));
  }
}
