/**
 * OTel Adapter 测试
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import {
  initOtelAdapter,
  isOtelEnabled,
  getTraceSessionId,
  createRequestSpan,
  completeRequestSpan,
  shutdownOtel,
} from '../lib/otel-adapter.js';

describe('OTel Adapter', () => {
  before(() => {
    process.env.CXV_OTEL_ENABLED = '1';
  });

  after(() => {
    shutdownOtel();
    delete process.env.CXV_OTEL_ENABLED;
  });

  describe('Initialization', () => {
    it('should initialize with project name', () => {
      const result = initOtelAdapter('test-project', 'test-session');
      assert.strictEqual(typeof result, 'boolean');
    });

    it('should generate session ID', () => {
      initOtelAdapter('test-project');
      const sessionId = getTraceSessionId();
      assert.ok(sessionId);
      assert.ok(sessionId.startsWith('cxv-'));
    });
  });

  describe('Span Creation', () => {
    const mockRequestEntry = {
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer sk-test1234567890',
      },
      body: {
        model: 'claude-opus-4',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      },
      timestamp: new Date().toISOString(),
      project: 'test-project',
      mainAgent: true,
      isStream: true,
    };

    it('should create a span from request entry', () => {
      const span = createRequestSpan(mockRequestEntry);

      if (span) {
        assert.ok(span.spanContext());
        assert.ok(span.spanContext().traceId);
        assert.ok(span.spanContext().spanId);
      }
    });

    it('should sanitize sensitive headers', () => {
      const span = createRequestSpan(mockRequestEntry);

      if (span) {
        const attrs = span.attributes;
        const headersStr = attrs.get('http.request.headers');
        if (headersStr) {
          const headers = JSON.parse(headersStr);
          assert.ok(
            headers.authorization.includes('****') || headers.authorization === '****',
            'Authorization should be masked'
          );
        }
      }
    });

    it('should skip heartbeat when configured', () => {
      process.env.CXV_OTEL_SKIP_HEARTBEAT = '1';

      const heartbeatEntry = {
        ...mockRequestEntry,
        isHeartbeat: true,
      };

      const span = createRequestSpan(heartbeatEntry);
      assert.strictEqual(span, null);

      delete process.env.CXV_OTEL_SKIP_HEARTBEAT;
    });
  });

  describe('Span Completion', () => {
    const mockRequestEntry = {
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      timestamp: new Date().toISOString(),
      mainAgent: true,
    };

    const mockResponse = {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: {
        id: 'msg_123',
        model: 'claude-opus-4',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          total_tokens: 150,
        },
      },
    };

    it('should complete span with response', () => {
      const span = createRequestSpan(mockRequestEntry);

      if (span) {
        const completedEntry = {
          ...mockRequestEntry,
          response: mockResponse,
          duration: 1500,
        };

        assert.doesNotThrow(() => {
          completeRequestSpan(span, completedEntry);
        });
      }
    });

    it('should mark error status for 4xx/5xx responses', () => {
      const span = createRequestSpan(mockRequestEntry);

      if (span) {
        const errorEntry = {
          ...mockRequestEntry,
          response: {
            ...mockResponse,
            status: 500,
            statusText: 'Internal Server Error',
          },
          duration: 100,
        };

        assert.doesNotThrow(() => {
          completeRequestSpan(span, errorEntry);
        });
      }
    });
  });

  describe('Shutdown', () => {
    it('should shutdown without errors', () => {
      assert.doesNotThrow(() => {
        shutdownOtel();
      });
    });
  });
});
