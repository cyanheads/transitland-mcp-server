/**
 * @fileoverview Pins the server's resolved HTTP session posture to `stateless`.
 *
 * Boots the real entry point over HTTP and reads the SEP-1649 Server Card at
 * `/.well-known/mcp.json`, whose `_meta` carries the mode the framework actually
 * resolved (`auto` never appears there). `MCP_SESSION_MODE` is cleared first, so
 * the only thing that can produce `stateless` is the `sessionMode` declaration in
 * `createApp()` — drop it and the schema default `auto` resolves to `stateful`
 * and this fails.
 * @module tests/integration/session-mode.int.test
 */

import type { ResolvedSessionMode } from '@cyanheads/mcp-ts-core';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * Reverse-DNS `_meta` key the framework publishes the resolved mode under
 * (`serverCard.ts`'s `SESSION_MODE_META_KEY`, which is not exported from the
 * package's public entry points).
 */
const SESSION_MODE_META_KEY = 'io.github.cyanheads.mcp-ts-core/sessionMode';

const HOST = '127.0.0.1';
const PORT = 38417;

/**
 * Env must be in place before the entry module is imported — `createApp()` runs
 * at its top level and starts the transport there.
 */
delete process.env.MCP_SESSION_MODE;
process.env.MCP_TRANSPORT_TYPE = 'http';
process.env.MCP_HTTP_HOST = HOST;
process.env.MCP_HTTP_PORT = String(PORT);
process.env.MCP_AUTH_MODE = 'none';
process.env.MCP_LOG_LEVEL = 'error';
process.env.TRANSITLAND_API_KEY ??= 'test-key-not-used-no-upstream-calls';

const { app } = await import('@/index.js');

afterAll(async () => {
  await app.shutdown('test');
});

describe('resolved session posture', () => {
  it('serves a server card declaring stateless', async () => {
    const response = await fetch(`http://${HOST}:${PORT}/.well-known/mcp.json`);
    expect(response.ok).toBe(true);

    const card = (await response.json()) as { _meta?: Record<string, unknown> };
    const mode = card._meta?.[SESSION_MODE_META_KEY] as ResolvedSessionMode | undefined;

    expect(mode).toBe('stateless');
  });

  it('serves no session id on initialize', async () => {
    const response = await fetch(`http://${HOST}:${PORT}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'session-mode-test', version: '0.0.0' },
        },
      }),
    });

    expect(response.ok).toBe(true);
    // A stateful server mints an Mcp-Session-Id here; a stateless one never does.
    expect(response.headers.get('mcp-session-id')).toBeNull();
    await response.body?.cancel();
  });
});
