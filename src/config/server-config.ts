/**
 * @fileoverview Server-specific environment configuration for transitland-mcp-server.
 * Lazy-parsed Zod schema, separate from framework config. Maps schema paths to env
 * var names so a missing key fails at startup with a banner naming the variable.
 * @module config/server-config
 */

import { z } from '@cyanheads/mcp-ts-core';
import { parseEnvConfig } from '@cyanheads/mcp-ts-core/config';

const ServerConfigSchema = z.object({
  apiKey: z
    .string()
    .min(1)
    .describe('Transitland v2 API key, sent as the `apikey` query parameter.'),
  baseUrl: z
    .string()
    .url()
    .default('https://transit.land/api/v2/rest')
    .describe('Transitland REST API base URL.'),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

let _config: ServerConfig | undefined;

/**
 * Lazily parse and cache the server config from the environment. Throws
 * `ConfigurationError` (rendered as a startup banner) when `TRANSITLAND_API_KEY`
 * is missing or empty.
 */
export function getServerConfig(): ServerConfig {
  _config ??= parseEnvConfig(ServerConfigSchema, {
    apiKey: 'TRANSITLAND_API_KEY',
    baseUrl: 'TRANSITLAND_BASE_URL',
  });
  return _config;
}
