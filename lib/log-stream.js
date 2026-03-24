/**
 * Log Stream — 流式分段读取模块
 *
 * 关键设计：server 不做 delta 重建，只做去重和流式发送。
 * 重建交给客户端（浏览器内存更充裕）。
 *
 * 内存控制：
 * - 文件读取：openSync + readSync 1MB 分块，generator 逐条 yield
 * - 去重：用 regex 提取 key，不做 JSON.parse（存原始字符串）
 * - 异步发送：逐条 write + 定期 setImmediate yield（GC + buffer drain）
 */

import { existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { isCheckpointEntry, isDeltaEntry, reconstructSegment } from './delta-reconstructor.js';

const READ_CHUNK_SIZE = 1024 * 1024; // 1MB
const SEPARATOR = '\n---\n';

/**
 * Generator：分块读取 JSONL 文件，逐条 yield 原始 JSON 字符串。
 * 内存 = 1MB buffer + pending。
 */
function* iterateRawEntries(filePath) {
  const fileSize = statSync(filePath).size;
  if (fileSize === 0) return;

  const fd = openSync(filePath, 'r');
  const buf = Buffer.alloc(Math.min(READ_CHUNK_SIZE, fileSize));
  let offset = 0;
  let pending = '';

  try {
    while (offset < fileSize) {
      const toRead = Math.min(buf.length, fileSize - offset);
      const bytesRead = readSync(fd, buf, 0, toRead, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;

      const raw = pending + buf.toString('utf-8', 0, bytesRead);
      const parts = raw.split(SEPARATOR);
      pending = parts.pop() || '';

      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed) yield trimmed;
      }
    }

    if (pending.trim()) {
      yield pending.trim();
    }
  } finally {
    closeSync(fd);
  }
}

/**
 * 轻量预扫描：统计条目总数（原始条目数，不去重）。
 * 用于 SSE load_start 的 total 字段（进度显示）。
 */
export function countLogEntries(filePath) {
  if (!existsSync(filePath)) return 0;
  let count = 0;
  for (const _ of iterateRawEntries(filePath)) { count++; }
  return count;
}

/** 用 regex 从原始 JSON 字符串中提取 timestamp|url 去重 key（不做 JSON.parse） */
function extractDedupKey(raw) {
  const tsMatch = raw.match(/"timestamp"\s*:\s*"([^"]+)"/);
  const urlMatch = raw.match(/"url"\s*:\s*"([^"]+)"/);
  if (tsMatch && urlMatch) return `${tsMatch[1]}|${urlMatch[1]}`;
  // fallback: 无法提取 key 则用内容哈希
  return null;
}

function isSegmentBoundary(entry) {
  if (!entry.mainAgent) return false;
  if (!entry._deltaFormat) return true;
  return isCheckpointEntry(entry);
}

// ============================================================================
// 同步 API — 用于 mergeLogFiles（合并需要重建为全量格式写入磁盘）
// ============================================================================

export function streamReconstructedEntries(filePath, onSegment, opts = {}) {
  if (!existsSync(filePath)) return 0;
  const stat = statSync(filePath);
  if (stat.size === 0) return 0;

  const sinceMs = opts.since ? new Date(opts.since).getTime() : 0;
  let currentSegment = [];
  let dedup = new Map();
  let sentCount = 0;

  function flushSegment(nextCp) {
    if (currentSegment.length === 0) return;
    const dedupedSegment = Array.from(dedup.values());
    reconstructSegment(dedupedSegment, nextCp);

    let toSend = dedupedSegment;
    if (sinceMs) {
      toSend = dedupedSegment.filter(e => {
        const ts = e.timestamp ? new Date(e.timestamp).getTime() : 0;
        return ts > sinceMs;
      });
    }
    if (toSend.length > 0) {
      onSegment(toSend);
      sentCount += toSend.length;
    }
    currentSegment = [];
    dedup = new Map();
  }

  for (const rawEntry of iterateRawEntries(filePath)) {
    let entry;
    try { entry = JSON.parse(rawEntry); } catch { continue; }

    if (isSegmentBoundary(entry) && currentSegment.length > 0) {
      const key = `${entry.timestamp}|${entry.url}`;
      const last = currentSegment[currentSegment.length - 1];
      const lastKey = `${last.timestamp}|${last.url}`;
      if (key !== lastKey) {
        flushSegment(entry);
      }
    }

    const key = `${entry.timestamp}|${entry.url}`;
    dedup.set(key, entry);
    currentSegment.push(entry);
  }

  flushSegment(null);
  return sentCount;
}

// ============================================================================
// 异步 API — 用于 SSE/HTTP：不做重建，直接发原始 JSON 字符串
// ============================================================================

/**
 * 异步流式发送原始条目（不重建 delta）。
 *
 * - 用 generator 逐条读取原始 JSON 字符串
 * - regex 提取 key 去重（后出现的覆盖先出现的）
 * - 逐条调用 onRawEntry(rawJsonString)
 * - 每 N 条 setImmediate yield 让 GC + write buffer drain
 *
 * server 不做 JSON.parse / JSON.stringify / reconstruct = 内存峰值极低。
 * 客户端收到后自行 reconstructEntries()。
 *
 * @param {string} filePath
 * @param {(rawJson: string) => void} onRawEntry - 原始 JSON 字符串回调
 * @returns {Promise<number>} 发送条目数
 */
export async function streamRawEntriesAsync(filePath, onRawEntry) {
  if (!existsSync(filePath)) return 0;
  const stat = statSync(filePath);
  if (stat.size === 0) return 0;

  // 第一遍：generator 逐条读取 → dedup Map 存原始字符串（不 parse）
  // 内存 = 去重后的原始字符串总量 ≈ 文件大小的一半（inProgress 被 completed 覆盖）
  const dedup = new Map();
  for (const raw of iterateRawEntries(filePath)) {
    const key = extractDedupKey(raw);
    if (key) {
      dedup.set(key, raw);
    } else {
      // 无法提取 key 的条目直接保留（用自增 id 避免被覆盖）
      dedup.set(`__nokey_${dedup.size}`, raw);
    }
  }

  // 第二遍：逐条发送 + 定期 yield
  let sentCount = 0;
  const YIELD_INTERVAL = 20; // 每 20 条 yield 一次

  for (const raw of dedup.values()) {
    onRawEntry(raw);
    sentCount++;
    if (sentCount % YIELD_INTERVAL === 0) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  // 最终 yield 确保最后一批 buffer drain
  await new Promise(resolve => setImmediate(resolve));

  return sentCount;
}
