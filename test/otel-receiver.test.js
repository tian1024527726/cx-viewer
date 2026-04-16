/**
 * OTel Receiver 单元测试 + proxy→JSONL 端到端测试
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { parseOtlpTraces, writeOtelEntries } from '../lib/otel-receiver.js';

// ─── parseOtlpTraces 单元测试 ───

describe('parseOtlpTraces', () => {
  it('returns empty array for null/undefined input', () => {
    assert.deepStrictEqual(parseOtlpTraces(null), []);
    assert.deepStrictEqual(parseOtlpTraces(undefined), []);
    assert.deepStrictEqual(parseOtlpTraces({}), []);
  });

  it('parses api_request event', () => {
    const otlpData = {
      resourceSpans: [{
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'codex' } },
          ],
        },
        scopeSpans: [{
          spans: [{
            traceId: 'abc123',
            spanId: 'span456',
            name: 'chat_completion',
            startTimeUnixNano: '1700000000000000000',
            endTimeUnixNano: '1700000001500000000',
            attributes: [
              { key: 'codex.model', value: { stringValue: 'gpt-4o' } },
            ],
            events: [{
              name: 'codex.api_request',
              timeUnixNano: '1700000000000000000',
              attributes: [
                { key: 'input_token_count', value: { stringValue: '100' } },
                { key: 'output_token_count', value: { stringValue: '50' } },
                { key: 'cached_token_count', value: { stringValue: '80' } },
                { key: 'success', value: { stringValue: 'true' } },
                { key: 'duration_ms', value: { stringValue: '1500' } },
              ],
            }],
          }],
        }],
      }],
    };

    const results = parseOtlpTraces(otlpData);
    assert.ok(Array.isArray(results));
    assert.ok(results.length > 0);

    const entries = results.flat();
    const apiEntry = entries.find(e => e.url && e.url.includes('codex://api/'));
    assert.ok(apiEntry, 'should have api entry');
    assert.strictEqual(apiEntry.method, 'POST');
    assert.strictEqual(apiEntry.mainAgent, true);
    assert.strictEqual(apiEntry._otelSource, true);
    assert.strictEqual(apiEntry.response.body.usage.input_tokens, 100);
    assert.strictEqual(apiEntry.response.body.usage.output_tokens, 50);
    assert.strictEqual(apiEntry.duration, 1500);
  });

  it('parses tool.call event', () => {
    const otlpData = {
      resourceSpans: [{
        resource: { attributes: [] },
        scopeSpans: [{
          spans: [{
            traceId: 'abc123',
            spanId: 'span789',
            name: 'tool_execution',
            startTimeUnixNano: '1700000000000000000',
            endTimeUnixNano: '1700000000500000000',
            attributes: [],
            events: [{
              name: 'codex.tool.call',
              timeUnixNano: '1700000000000000000',
              attributes: [
                { key: 'tool_name', value: { stringValue: 'Bash' } },
                { key: 'arguments', value: { stringValue: '{"command":"ls -la"}' } },
                { key: 'call_id', value: { stringValue: 'call_001' } },
              ],
            }, {
              name: 'codex.tool_result',
              timeUnixNano: '1700000000500000000',
              attributes: [
                { key: 'call_id', value: { stringValue: 'call_001' } },
                { key: 'output', value: { stringValue: 'file1.txt\nfile2.txt' } },
                { key: 'output_length', value: { stringValue: '25' } },
              ],
            }],
          }],
        }],
      }],
    };

    const results = parseOtlpTraces(otlpData);
    const entries = results.flat();
    const toolEntry = entries.find(e => e.method === 'TOOL');
    assert.ok(toolEntry, 'should have tool entry');
    assert.strictEqual(toolEntry.body.tool_name, 'Bash');
    assert.deepStrictEqual(toolEntry.body.tool_input, { command: 'ls -la' });
    assert.ok(toolEntry.response);
    assert.strictEqual(toolEntry.response.body.output, 'file1.txt\nfile2.txt');
  });

  it('parses user_prompt event', () => {
    const otlpData = {
      resourceSpans: [{
        resource: { attributes: [] },
        scopeSpans: [{
          spans: [{
            traceId: 'abc123',
            spanId: 'span999',
            name: 'user_input',
            startTimeUnixNano: '1700000000000000000',
            endTimeUnixNano: '1700000000100000000',
            attributes: [],
            events: [{
              name: 'codex.user_prompt',
              timeUnixNano: '1700000000000000000',
              attributes: [
                { key: 'prompt', value: { stringValue: 'fix the bug' } },
                { key: 'prompt_length', value: { stringValue: '11' } },
              ],
            }],
          }],
        }],
      }],
    };

    const results = parseOtlpTraces(otlpData);
    const entries = results.flat();
    const promptEntry = entries.find(e => e.url === 'codex://user_prompt');
    assert.ok(promptEntry);
    assert.strictEqual(promptEntry.body.messages[0].content, 'fix the bug');
  });
});

// ─── writeOtelEntries 单元测试 ───

describe('writeOtelEntries', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cxv-otel-test-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes entries to JSONL file', () => {
    const logFile = join(tmpDir, 'test.jsonl');
    const entries = [{
      timestamp: '2025-01-01T00:00:00.000Z',
      url: 'codex://api/test',
      method: 'POST',
      body: { model: 'gpt-4o' },
      response: { status: 200, body: { usage: { input_tokens: 10 } } },
    }];

    writeOtelEntries(logFile, entries);

    const content = readFileSync(logFile, 'utf-8');
    assert.ok(content.includes('"codex://api/test"'));
    assert.ok(content.includes('---'));
  });

  it('skips empty entries array', () => {
    const logFile = join(tmpDir, 'empty.jsonl');
    writeOtelEntries(logFile, []);
    // File should not be created
    try {
      readFileSync(logFile);
      assert.fail('File should not exist');
    } catch (e) {
      assert.strictEqual(e.code, 'ENOENT');
    }
  });
});

// ─── Server /v1/traces 端到端测试 ───

describe('server /v1/traces endpoint', { concurrency: false }, () => {
  let port;
  let startViewer, stopViewer, getPort;
  const tmpDir = mkdtempSync(join(tmpdir(), 'cxv-otel-e2e-'));
  const fakeLogDir = join(tmpDir, 'logs', 'test-project');
  mkdirSync(fakeLogDir, { recursive: true });
  const fakeLogFile = join(fakeLogDir, 'test.jsonl');
  writeFileSync(fakeLogFile, '');

  before(async () => {
    process.env.CXV_WORKSPACE_MODE = '1';
    const mod = await import('../server.js');
    startViewer = mod.startViewer;
    stopViewer = mod.stopViewer;
    getPort = mod.getPort;

    await startViewer();
    port = getPort();
  });

  after(async () => {
    await new Promise(resolve => {
      stopViewer();
      setTimeout(() => {
        rmSync(tmpDir, { recursive: true, force: true });
        resolve();
      }, 200);
    });
  });

  function httpPost(path, body) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = request({
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      }, (res) => {
        let result = '';
        res.on('data', chunk => { result += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: result }));
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  it('accepts OTLP trace data at /v1/traces', async () => {
    const otlpData = {
      resourceSpans: [{
        resource: { attributes: [] },
        scopeSpans: [{
          spans: [{
            traceId: 'e2e-trace',
            spanId: 'e2e-span',
            name: 'test_span',
            startTimeUnixNano: '1700000000000000000',
            endTimeUnixNano: '1700000001000000000',
            attributes: [],
            events: [{
              name: 'codex.api_request',
              attributes: [
                { key: 'input_token_count', value: { stringValue: '42' } },
                { key: 'output_token_count', value: { stringValue: '10' } },
                { key: 'success', value: { stringValue: 'true' } },
              ],
            }],
          }],
        }],
      }],
    };

    const res = await httpPost('/v1/traces', otlpData);
    assert.strictEqual(res.status, 200);
  });

  it('returns 200 for /v1/logs and /v1/metrics', async () => {
    const res1 = await httpPost('/v1/logs', { resourceLogs: [] });
    assert.strictEqual(res1.status, 200);

    const res2 = await httpPost('/v1/metrics', { resourceMetrics: [] });
    assert.strictEqual(res2.status, 200);
  });
});
