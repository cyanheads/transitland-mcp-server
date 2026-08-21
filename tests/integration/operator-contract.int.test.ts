/**
 * @fileoverview Tool-contract integration coverage for transitland_get_operator —
 * drives the full production pipeline (input parse → handler → output parse →
 * format() → enrichment) for a success case and the invalid-input error envelope.
 * @module tests/integration/operator-contract.int.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { toolContractSuite } from '@cyanheads/mcp-ts-core/testing/vitest';
import { vi } from 'vitest';

const service = {
  getOperator: vi.fn(),
};

vi.mock('@/services/transitland/transitland-service.js', () => ({
  getTransitlandService: () => service,
}));

const { getOperatorTool } = await import('@/mcp-server/tools/definitions/get-operator.tool.js');

service.getOperator.mockResolvedValue({
  onestopId: 'o-9q9-bart',
  name: 'Bay Area Rapid Transit',
  shortName: 'BART',
  website: null,
  agencies: [],
  feeds: [],
  tags: { wikidataId: 'Q610120', usNtdId: null, twitter: null },
});

toolContractSuite(getOperatorTool, {
  success: [
    {
      name: 'validates, invokes, and formats a successful call',
      input: { operator_key: 'o-9q9-bart' },
      expected: { onestopId: 'o-9q9-bart', name: 'Bay Area Rapid Transit' },
    },
  ],
  errors: [
    {
      name: 'rejects an empty key at the input schema',
      input: { operator_key: '' },
      code: JsonRpcErrorCode.ValidationError,
    },
  ],
});
