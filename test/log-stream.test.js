/**
 * log-stream.js 单元测试
 * 验证 countLogEntries 和 streamReconstructedEntries 的正确性，
 * 并与 readLogFile 的全量重建结果对比确保一致。
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { countLogEntries, streamReconstructedEntries, streamRawEntriesAsync } from '../lib/log-stream.js';
import { readLogFile } from '../lib/log-watcher.js';
import { reconstructSegment, reconstructEntries } from '../lib/delta-reconstructor.js';

// ============================================================================
// Helpers
// ============================================================================

function msg(role, text) {
  return { role, content: text };
}

const CHECKPOINT_INTERVAL = 10;

/** 模拟 interceptor 写入 delta 日志（与 delta-e2e.test.js 一致） */
function simulateInterceptorWrites(logFile, turns) {
  let lastMessagesCount = 0;
  let deltaCount = 0;
  const fullConversation = [];

  for (const turn of turns) {
    fullConversation.push(...turn.newMessages);
    const allMessages = [...fullConversation];
    deltaCount++;

    const needsCheckpoint =
      lastMessagesCount === 0 ||
      allMessages.length < lastMessagesCount ||
      (deltaCount % CHECKPOINT_INTERVAL === 0);

    const entry = {
      timestamp: new Date(Date.now() + deltaCount * 1000).toISOString(),
      url: 'https://api.anthropic.com/v1/messages',
      mainAgent: turn.mainAgent !== undefined ? turn.mainAgent : true,
      body: {
        model: 'claude-opus-4-6',
        system: [{ type: 'text', text: 'You are helpful.' }],
      },
      response: {
        status: 200,
        body: {
          content: [{ type: 'text', text: `response-${deltaCount}` }],
          usage: { input_tokens: 100, output_tokens: 50 }
        }
      },
      duration: 100,
    };

    if (turn.mainAgent === false) {
      entry.body.messages = [...allMessages];
      entry.teammate = turn.teammate || 'worker-1';
      entry.teamName = 'test-team';
    } else if (needsCheckpoint) {
      entry._deltaFormat = 1;
      entry._totalMessageCount = allMessages.length;
      entry._conversationId = 'mainAgent';
      entry._isCheckpoint = true;
      entry.body.messages = [...allMessages];
    } else {
      entry._deltaFormat = 1;
      entry._totalMessageCount = allMessages.length;
      entry._conversationId = 'mainAgent';
      entry._isCheckpoint = false;
      entry.body.messages = allMessages.slice(lastMessagesCount);
    }

    // inProgress + completed
    const inProgressEntry = { ...entry, inProgress: true, requestId: `req_${deltaCount}` };
    appendFileSync(logFile, JSON.stringify(inProgressEntry) + '\n---\n');
    appendFileSync(logFile, JSON.stringify(entry) + '\n---\n');

    if (entry.mainAgent !== false) {
      lastMessagesCount = allMessages.length;
    }
  }

  return fullConversation;
}

/** 收集 streamReconstructedEntries 的所有输出 */
function collectStreamEntries(filePath, opts = {}) {
  const all = [];
  streamReconstructedEntries(filePath, (segment) => {
    all.push(...segment);
  }, opts);
  return all;
}

// ============================================================================
// Tests
// ============================================================================

let tmpDir;
let logFile;

describe('countLogEntries', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'log-stream-'));
    logFile = join(tmpDir, 'test.jsonl');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('不存在的文件返回 0', () => {
    assert.equal(countLogEntries(join(tmpDir, 'nope.jsonl')), 0);
  });

  it('空文件返回 0', () => {
    writeFileSync(logFile, '');
    assert.equal(countLogEntries(logFile), 0);
  });

  it('单条目（无尾部分隔符）', () => {
    writeFileSync(logFile, '{"a":1}');
    assert.equal(countLogEntries(logFile), 1);
  });

  it('单条目（有尾部分隔符）', () => {
    writeFileSync(logFile, '{"a":1}\n---\n');
    assert.equal(countLogEntries(logFile), 1);
  });

  it('多条目', () => {
    writeFileSync(logFile, '{"a":1}\n---\n{"b":2}\n---\n{"c":3}\n---\n');
    assert.equal(countLogEntries(logFile), 3);
  });

  it('与实际 delta 写入一致', () => {
    writeFileSync(logFile, '');
    const turns = [];
    for (let i = 0; i < 15; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`), msg('assistant', `a${i}`)] });
    }
    simulateInterceptorWrites(logFile, turns);
    // 15 turns × 2 (inProgress + completed) = 30 条目
    assert.equal(countLogEntries(logFile), 30);
  });
});

describe('streamReconstructedEntries', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'log-stream-'));
    logFile = join(tmpDir, 'test.jsonl');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('不存在的文件返回 0 个条目', () => {
    const entries = collectStreamEntries(join(tmpDir, 'nope.jsonl'));
    assert.equal(entries.length, 0);
  });

  it('空文件返回 0 个条目', () => {
    writeFileSync(logFile, '');
    const entries = collectStreamEntries(logFile);
    assert.equal(entries.length, 0);
  });

  it('5 轮对话：与 readLogFile 输出一致', () => {
    writeFileSync(logFile, '');
    const turns = [
      { newMessages: [msg('user', 'hello')] },
      { newMessages: [msg('assistant', 'hi'), msg('user', 'how are you')] },
      { newMessages: [msg('assistant', 'good'), msg('user', 'joke')] },
      { newMessages: [msg('assistant', 'why...')] },
      { newMessages: [msg('user', 'haha')] },
    ];

    const expectedConversation = simulateInterceptorWrites(logFile, turns);

    const streamEntries = collectStreamEntries(logFile);
    const batchEntries = readLogFile(logFile);

    assert.equal(streamEntries.length, batchEntries.length,
      `条目数不一致: stream=${streamEntries.length}, batch=${batchEntries.length}`);

    // 逐条比较 mainAgent 条目的 messages
    for (let i = 0; i < streamEntries.length; i++) {
      const s = streamEntries[i];
      const b = batchEntries[i];
      assert.equal(s.timestamp, b.timestamp, `Entry ${i} timestamp mismatch`);
      if (s.mainAgent && Array.isArray(s.body?.messages)) {
        assert.equal(s.body.messages.length, b.body.messages.length,
          `Entry ${i} messages length mismatch: stream=${s.body.messages.length}, batch=${b.body.messages.length}`);
      }
    }

    // 最后一条 mainAgent 条目应有完整对话
    const lastMain = streamEntries.filter(e => e.mainAgent && !e.inProgress).pop();
    assert.equal(lastMain.body.messages.length, expectedConversation.length);
  });

  it('跨越 checkpoint 边界（15 轮）：与 readLogFile 一致', () => {
    writeFileSync(logFile, '');
    const turns = [];
    for (let i = 0; i < 15; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`), msg('assistant', `a${i}`)] });
    }

    simulateInterceptorWrites(logFile, turns);

    const streamEntries = collectStreamEntries(logFile);
    const batchEntries = readLogFile(logFile);

    assert.equal(streamEntries.length, batchEntries.length);

    // 逐条比较 mainAgent messages
    const streamMains = streamEntries.filter(e => e.mainAgent && !e.inProgress);
    const batchMains = batchEntries.filter(e => e.mainAgent && !e.inProgress);

    assert.equal(streamMains.length, batchMains.length);
    for (let i = 0; i < streamMains.length; i++) {
      assert.equal(streamMains[i].body.messages.length, batchMains[i].body.messages.length,
        `MainAgent entry ${i} messages length mismatch`);
      // 验证每条 message 内容
      for (let j = 0; j < streamMains[i].body.messages.length; j++) {
        assert.equal(streamMains[i].body.messages[j].content, batchMains[i].body.messages[j].content,
          `MainAgent entry ${i}, msg ${j} content mismatch`);
      }
    }
  });

  it('穿插 teammate 条目：与 readLogFile 一致', () => {
    writeFileSync(logFile, '');
    const turns = [
      { newMessages: [msg('user', 'start')] },
      { newMessages: [msg('assistant', 'ok')], mainAgent: false, teammate: 'worker-1' },
      { newMessages: [msg('user', 'next')] },
      { newMessages: [msg('assistant', 'done')] },
    ];

    simulateInterceptorWrites(logFile, turns);

    const streamEntries = collectStreamEntries(logFile);
    const batchEntries = readLogFile(logFile);

    assert.equal(streamEntries.length, batchEntries.length);
  });

  it('分段回调被多次调用', () => {
    writeFileSync(logFile, '');
    // 写入 25 轮以确保跨越多个 checkpoint（每 10 条一个）
    const turns = [];
    for (let i = 0; i < 25; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`), msg('assistant', `a${i}`)] });
    }
    simulateInterceptorWrites(logFile, turns);

    let segmentCount = 0;
    streamReconstructedEntries(logFile, () => { segmentCount++; });
    // 25 轮 = 至少 2 个 checkpoint 边界 = 至少 3 段
    assert.ok(segmentCount >= 2, `Expected multiple segments, got ${segmentCount}`);
  });

  it('since 过滤：只返回时间戳之后的条目', () => {
    writeFileSync(logFile, '');
    const turns = [];
    for (let i = 0; i < 5; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`)] });
    }
    simulateInterceptorWrites(logFile, turns);

    const allEntries = collectStreamEntries(logFile);
    // 取中间某条的时间戳作为 since
    const midTimestamp = allEntries[Math.floor(allEntries.length / 2)].timestamp;
    const filtered = collectStreamEntries(logFile, { since: midTimestamp });

    assert.ok(filtered.length < allEntries.length, 'Filtered should have fewer entries');
    assert.ok(filtered.length > 0, 'Filtered should have some entries');
    // 所有 filtered 条目的时间戳应大于 since
    for (const e of filtered) {
      assert.ok(new Date(e.timestamp).getTime() > new Date(midTimestamp).getTime(),
        `Entry timestamp ${e.timestamp} should be after since ${midTimestamp}`);
    }
  });

  it('旧格式（无 delta）条目正确处理', () => {
    // 直接写入旧格式全量条目
    const entries = [
      { timestamp: '2026-01-01T00:00:00Z', url: '/v1/messages', mainAgent: true, body: { messages: [msg('user', 'a'), msg('assistant', 'b')] } },
      { timestamp: '2026-01-01T00:01:00Z', url: '/v1/messages', mainAgent: true, body: { messages: [msg('user', 'a'), msg('assistant', 'b'), msg('user', 'c'), msg('assistant', 'd')] } },
    ];
    writeFileSync(logFile, entries.map(e => JSON.stringify(e)).join('\n---\n') + '\n---\n');

    const streamEntries = collectStreamEntries(logFile);
    assert.equal(streamEntries.length, 2);
    assert.equal(streamEntries[0].body.messages.length, 2);
    assert.equal(streamEntries[1].body.messages.length, 4);
  });

  it('去重：同一 timestamp|url 保留最后一个', () => {
    const entry1 = { timestamp: '2026-01-01T00:00:00Z', url: '/v1/messages', mainAgent: true, inProgress: true, body: { messages: [msg('user', 'hello')] } };
    const entry2 = { timestamp: '2026-01-01T00:00:00Z', url: '/v1/messages', mainAgent: true, body: { messages: [msg('user', 'hello')], response: { text: 'world' } } };
    writeFileSync(logFile, [JSON.stringify(entry1), JSON.stringify(entry2)].join('\n---\n') + '\n---\n');

    const streamEntries = collectStreamEntries(logFile);
    assert.equal(streamEntries.length, 1, 'Should deduplicate to 1 entry');
    assert.ok(!streamEntries[0].inProgress, 'Should keep the completed entry');
  });
});

describe('reconstructSegment', () => {
  it('单条 checkpoint 段', () => {
    const entry = {
      _deltaFormat: 1, _isCheckpoint: true, _totalMessageCount: 3,
      mainAgent: true, body: { messages: [msg('user', 'a'), msg('assistant', 'b'), msg('user', 'c')] }
    };
    const result = reconstructSegment([entry], null);
    assert.equal(result.length, 1);
    assert.equal(result[0].body.messages.length, 3);
  });

  it('checkpoint + delta 段', () => {
    const cp = {
      _deltaFormat: 1, _isCheckpoint: true, _totalMessageCount: 2,
      mainAgent: true, body: { messages: [msg('user', 'a'), msg('assistant', 'b')] }
    };
    const delta = {
      _deltaFormat: 1, _isCheckpoint: false, _totalMessageCount: 4,
      mainAgent: true, body: { messages: [msg('user', 'c'), msg('assistant', 'd')] }
    };
    const result = reconstructSegment([cp, delta], null);
    assert.equal(result[1].body.messages.length, 4);
    assert.equal(result[1].body.messages[0].content, 'a');
    assert.equal(result[1].body.messages[3].content, 'd');
  });

  it('broken delta 用 nextCheckpoint 修复', () => {
    const cp = {
      _deltaFormat: 1, _isCheckpoint: true, _totalMessageCount: 2,
      mainAgent: true, body: { messages: [msg('user', 'a'), msg('assistant', 'b')] }
    };
    // delta 声称总共 6 条，但只追加了 2 条（缺了中间的）
    const brokenDelta = {
      _deltaFormat: 1, _isCheckpoint: false, _totalMessageCount: 6,
      mainAgent: true, body: { messages: [msg('user', 'e'), msg('assistant', 'f')] }
    };
    // nextCheckpoint 有完整的 8 条
    const nextCp = {
      _deltaFormat: 1, _isCheckpoint: true, _totalMessageCount: 8,
      mainAgent: true, body: { messages: [
        msg('user', 'a'), msg('assistant', 'b'),
        msg('user', 'c'), msg('assistant', 'd'),
        msg('user', 'e'), msg('assistant', 'f'),
        msg('user', 'g'), msg('assistant', 'h'),
      ] }
    };

    const result = reconstructSegment([cp, brokenDelta], nextCp);
    // broken delta 应被修复为 6 条（从 nextCp 截取前 6 条）
    assert.equal(result[1].body.messages.length, 6);
    assert.equal(result[1].body.messages[0].content, 'a');
    assert.equal(result[1].body.messages[5].content, 'f');
  });
});

// ============================================================================
// streamRawEntriesAsync — 异步原始条目流（server SSE 热路径）
// ============================================================================

describe('streamRawEntriesAsync', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'log-stream-raw-'));
    logFile = join(tmpDir, 'test.jsonl');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('空文件返回 0', async () => {
    writeFileSync(logFile, '');
    const raws = [];
    const count = await streamRawEntriesAsync(logFile, (r) => raws.push(r));
    assert.equal(count, 0);
    assert.equal(raws.length, 0);
  });

  it('不存在的文件返回 0', async () => {
    const count = await streamRawEntriesAsync(join(tmpDir, 'nope.jsonl'), () => {});
    assert.equal(count, 0);
  });

  it('发送原始 JSON 字符串（不是 parsed 对象）', async () => {
    const entry = { timestamp: '2026-01-01T00:00:00Z', url: '/v1/messages', mainAgent: true, body: { messages: [] } };
    writeFileSync(logFile, JSON.stringify(entry) + '\n---\n');

    const raws = [];
    await streamRawEntriesAsync(logFile, (r) => raws.push(r));
    assert.equal(raws.length, 1);
    assert.equal(typeof raws[0], 'string', 'Should be raw string, not parsed object');
    // 解析后应与原始条目一致
    const parsed = JSON.parse(raws[0]);
    assert.equal(parsed.timestamp, '2026-01-01T00:00:00Z');
  });

  it('去重：inProgress 被 completed 覆盖', async () => {
    const ip = { timestamp: '2026-01-01T00:00:00Z', url: '/v1/messages', inProgress: true, body: {} };
    const done = { timestamp: '2026-01-01T00:00:00Z', url: '/v1/messages', body: { response: 'ok' } };
    writeFileSync(logFile, [JSON.stringify(ip), JSON.stringify(done)].join('\n---\n') + '\n---\n');

    const raws = [];
    await streamRawEntriesAsync(logFile, (r) => raws.push(r));
    assert.equal(raws.length, 1, 'Should deduplicate to 1');
    const parsed = JSON.parse(raws[0]);
    assert.ok(!parsed.inProgress, 'Should keep completed entry');
  });

  it('无 timestamp/url 的条目也能发送', async () => {
    const entry = { type: 'special', data: 'test' };
    writeFileSync(logFile, JSON.stringify(entry) + '\n---\n');

    const raws = [];
    await streamRawEntriesAsync(logFile, (r) => raws.push(r));
    assert.equal(raws.length, 1);
  });

  it('与 readLogFile + reconstructEntries 结果一致（端到端）', async () => {
    writeFileSync(logFile, '');
    const turns = [];
    for (let i = 0; i < 15; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`), msg('assistant', `a${i}`)] });
    }
    simulateInterceptorWrites(logFile, turns);

    // streamRawEntriesAsync → parse → reconstructEntries（模拟客户端流程）
    const raws = [];
    await streamRawEntriesAsync(logFile, (r) => raws.push(r));
    const parsed = raws.map(r => JSON.parse(r));
    const clientResult = reconstructEntries(parsed);

    // readLogFile（旧全量路径）
    const serverResult = readLogFile(logFile);

    // 比较 mainAgent 条目数和最终 messages
    const clientMains = clientResult.filter(e => e.mainAgent && !e.inProgress);
    const serverMains = serverResult.filter(e => e.mainAgent && !e.inProgress);
    assert.equal(clientMains.length, serverMains.length, 'MainAgent entry count should match');

    // 最后一条的 messages 应完全一致
    const cLast = clientMains[clientMains.length - 1];
    const sLast = serverMains[serverMains.length - 1];
    assert.equal(cLast.body.messages.length, sLast.body.messages.length, 'Last entry messages count should match');
    for (let i = 0; i < cLast.body.messages.length; i++) {
      assert.equal(cLast.body.messages[i].content, sLast.body.messages[i].content, `Message ${i} content mismatch`);
    }
  });

  it('yield 确实被调用（多条目时不会同步阻塞）', async () => {
    writeFileSync(logFile, '');
    const turns = [];
    for (let i = 0; i < 25; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`)] });
    }
    simulateInterceptorWrites(logFile, turns);

    let yieldCount = 0;
    const origSetImmediate = globalThis.setImmediate;
    globalThis.setImmediate = (cb) => { yieldCount++; origSetImmediate(cb); };
    try {
      await streamRawEntriesAsync(logFile, () => {});
      assert.ok(yieldCount > 0, 'Should have yielded at least once via setImmediate');
    } finally {
      globalThis.setImmediate = origSetImmediate;
    }
  });
});
