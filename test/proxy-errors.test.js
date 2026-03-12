import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractApiErrorMessage, formatProxyRequestError } from '../proxy-errors.js';

describe('extractApiErrorMessage', () => {
  it('提取 error.message', () => {
    const text = JSON.stringify({
      type: 'error',
      error: { type: 'rate_limit_error', message: '模型全局请求额度超限(并发限流)' }
    });
    assert.equal(extractApiErrorMessage(429, text), '模型全局请求额度超限(并发限流)');
  });

  it('提取顶层 message', () => {
    const text = JSON.stringify({ message: 'service unavailable' });
    assert.equal(extractApiErrorMessage(503, text), 'service unavailable');
  });

  it('非 JSON 返回兜底信息', () => {
    const text = 'bad gateway';
    assert.equal(extractApiErrorMessage(502, text), 'API Error (502): bad gateway');
  });
});

describe('formatProxyRequestError', () => {
  it('将头超时转换为固定提示', () => {
    const err = new Error('fetch failed');
    err.cause = { code: 'UND_ERR_HEADERS_TIMEOUT' };
    assert.equal(formatProxyRequestError(err), '[CC-Viewer Proxy] Request failed: Upstream headers timeout');
  });

  it('保留普通错误内容', () => {
    const err = new Error('network down');
    assert.equal(formatProxyRequestError(err), '[CC-Viewer Proxy] Request failed: network down');
  });
});
