/**
 * @fileoverview transitland://operator/{onestop_id} — operator record by Onestop ID.
 * Mirrors transitland_get_operator for clients that support injectable context.
 * @module mcp-server/resources/definitions/operator.resource
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getTransitlandService } from '@/services/transitland/transitland-service.js';

export const operatorResource = resource('transitland://operator/{onestop_id}', {
  name: 'transitland-operator',
  title: 'transitland-mcp-server: operator record',
  description:
    'Operator record by Onestop ID — agencies, places served, published feeds, and source tags (Wikidata QID, US NTD ID, social handles). Mirrors transitland_get_operator.',
  mimeType: 'application/json',
  params: z.object({
    onestop_id: z
      .string()
      .min(1)
      .describe('Operator Onestop ID (e.g. "o-9q9-bart") or internal integer ID.'),
  }),
  output: z.object({
    onestopId: z.string().describe('Stable public Onestop ID.'),
    name: z.string().describe('Operator name.'),
    shortName: z.string().nullable().describe('Short name/abbreviation. Null when omitted.'),
    website: z.string().nullable().describe('Operator website. Null when unknown.'),
    agencies: z
      .array(
        z
          .object({
            agencyId: z.string().describe('GTFS agency_id (feed-local identifier).'),
            agencyName: z.string().describe('Agency name as published in its feed.'),
            places: z
              .array(
                z
                  .object({
                    country: z.string().nullable().describe('Country (adm0) name.'),
                    region: z.string().nullable().describe('State/province (adm1) name.'),
                    city: z.string().nullable().describe('City name.'),
                  })
                  .describe('A place this agency serves.'),
              )
              .describe('Places this agency serves.'),
          })
          .describe('An agency grouped under this operator.'),
      )
      .describe('Agencies grouped under this operator.'),
    feeds: z
      .array(
        z
          .object({
            onestopId: z.string().describe('Feed Onestop ID.'),
            spec: z.string().describe('Feed spec: GTFS, GTFS_RT, GBFS, or MDS.'),
            name: z.string().nullable().describe('Feed name. Often null.'),
          })
          .describe('A feed this operator publishes.'),
      )
      .describe('Feeds this operator publishes.'),
    tags: z
      .object({
        wikidataId: z
          .string()
          .nullable()
          .describe(
            'Wikidata QID (e.g. "Q610120") for wikidata-mcp-server cross-reference. Null when absent.',
          ),
        usNtdId: z
          .string()
          .nullable()
          .describe('US National Transit Database ID, where applicable. Null when absent.'),
        twitter: z
          .string()
          .nullable()
          .describe('General Twitter/X handle, where published. Null when absent.'),
      })
      .describe('Selected source tags. Null when the registry has no value.'),
  }),
  errors: [
    {
      reason: 'operator_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No operator exists for the given Onestop ID or internal ID.',
      recovery:
        'Verify the ID format (e.g. "o-9q9-bart") or search with transitland_find_operators to get a valid Onestop ID.',
    },
  ],

  handler(params, ctx) {
    return getTransitlandService().getOperator(params.onestop_id, ctx, {
      reason: 'operator_not_found',
    });
  },

  list: () => ({
    resources: [
      {
        uri: 'transitland://operator/o-9q9-bart',
        name: 'Bay Area Rapid Transit (example)',
        mimeType: 'application/json',
      },
    ],
  }),
});
