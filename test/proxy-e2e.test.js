import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';

/**
 * End-to-end proxy test: starts a mock upstream API server,
 * launches the cxv proxy pointing at it, sends a request through,
 * and verifies the interceptor logged it to the JSONL file.
 */

function startMockApi() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'resp-test-001',
          object: 'chat.completion',
          model: 'gpt-4',
          choices: [{ message: { role: 'assistant', content: 'Hello from mock' } }],
          usage: { input_tokens: 10, output_tokens: 5 },
          _echo_body: body ? JSON.parse(body) : null,
        }));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

describe('proxy e2e', () => {
  let mockApi;

  afterEach(async () => {
    if (mockApi) { mockApi.close(); mockApi = null; }
  });

  it('proxies request to upstream and interceptor logs it', async () => {
    // 1. Start mock upstream API
    mockApi = await startMockApi();
    const mockPort = mockApi.address().port;

    // 2. Point proxy at mock server
    const originalBaseUrl = process.env.OPENAI_BASE_URL;
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${mockPort}`;

    try {
      // 3. Import proxy (which also sets up interceptor)
      const { startProxy } = await import('../proxy.js');
      const proxyPort = await startProxy();

      // 4. Get the interceptor's LOG_FILE to verify writes
      const { LOG_FILE } = await import('../interceptor.js');

      // 5. Send a request through the proxy (simulating codex)
      const reqBody = JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'test prompt' }],
        stream: false,
      });

      const resp = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer test-key-123',
        },
        body: reqBody,
      });

      // 6. Verify proxy forwarded correctly
      assert.equal(resp.status, 200, 'proxy should return 200');
      const data = await resp.json();
      assert.equal(data.id, 'resp-test-001', 'should get mock response');
      assert.equal(data._echo_body?.model, 'gpt-4', 'request body should be forwarded');

      // 7. Verify interceptor logged the request
      await new Promise(r => setTimeout(r, 300));

      assert.ok(LOG_FILE, 'LOG_FILE should be set');

      if (existsSync(LOG_FILE)) {
        const content = readFileSync(LOG_FILE, 'utf-8');
        const entries = content.split('\n---\n')
          .filter(p => p.trim())
          .map(p => { try { return JSON.parse(p); } catch { return null; } })
          .filter(Boolean);

        const matching = entries.filter(e =>
          e.url?.includes('/v1/chat/completions') &&
          !e.inProgress  // completed entries only
        );

        assert.ok(matching.length > 0,
          `Expected interceptor to log completed request. LOG_FILE=${LOG_FILE}, total entries=${entries.length}, ` +
          `urls=${entries.map(e => e.url).join(', ')}`);

        const logged = matching[matching.length - 1];
        assert.equal(logged.method, 'POST');
        assert.ok(logged.response, 'should have response');
        assert.equal(logged.response.status, 200);
      } else {
        assert.fail(`LOG_FILE does not exist: ${LOG_FILE}`);
      }
    } finally {
      if (originalBaseUrl !== undefined) {
        process.env.OPENAI_BASE_URL = originalBaseUrl;
      } else {
        delete process.env.OPENAI_BASE_URL;
      }
    }
  });
});
