// Workspace Registry - 工作区持久化管理
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync, openSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { LOG_DIR } from './findcc.js';

const WORKSPACES_FILE = join(LOG_DIR, 'workspaces.json');
const LOCK_FILE = join(LOG_DIR, 'workspaces.lock');

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withLock(fn) {
  mkdirSync(LOG_DIR, { recursive: true });
  const deadline = Date.now() + 2000;
  while (true) {
    try {
      const fd = openSync(LOCK_FILE, 'wx');
      closeSync(fd);
      break;
    } catch (err) {
      if (err?.code === 'EEXIST' && Date.now() < deadline) {
        sleep(25);
        continue;
      }
      throw err;
    }
  }

  try {
    return fn();
  } finally {
    try { unlinkSync(LOCK_FILE); } catch { }
  }
}

export function loadWorkspaces() {
  try {
    if (!existsSync(WORKSPACES_FILE)) return [];
    const data = JSON.parse(readFileSync(WORKSPACES_FILE, 'utf-8'));
    return Array.isArray(data.workspaces) ? data.workspaces : [];
  } catch {
    return [];
  }
}

export function saveWorkspaces(list) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const tmpFile = `${WORKSPACES_FILE}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
    writeFileSync(tmpFile, JSON.stringify({ workspaces: list }, null, 2));
    renameSync(tmpFile, WORKSPACES_FILE);
  } catch (err) {
    console.error('[CC Viewer] Failed to save workspaces:', err.message);
  }
}

export function registerWorkspace(absolutePath) {
  return withLock(() => {
    const resolvedPath = resolve(absolutePath);
    const projectName = basename(resolvedPath).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    const list = loadWorkspaces();
    const existing = list.find(w => w.path === resolvedPath);
    if (existing) {
      existing.lastUsed = new Date().toISOString();
      existing.projectName = projectName;
      saveWorkspaces(list);
      return existing;
    }
    const now = new Date().toISOString();
    const entry = {
      id: randomBytes(6).toString('hex'),
      path: resolvedPath,
      projectName,
      lastUsed: now,
      createdAt: now,
    };
    list.push(entry);
    saveWorkspaces(list);
    return entry;
  });
}

export function removeWorkspace(id) {
  return withLock(() => {
    const list = loadWorkspaces();
    const filtered = list.filter(w => w.id !== id);
    if (filtered.length !== list.length) {
      saveWorkspaces(filtered);
      return true;
    }
    return false;
  });
}

export function getWorkspaces() {
  const list = loadWorkspaces();
  return list
    .map(w => {
      let logCount = 0;
      let totalSize = 0;
      const logDir = join(LOG_DIR, w.projectName);
      try {
        if (existsSync(logDir)) {
          const files = readdirSync(logDir);
          for (const f of files) {
            if (f.endsWith('.jsonl')) {
              logCount++;
              try { totalSize += statSync(join(logDir, f)).size; } catch { }
            }
          }
        }
      } catch { }
      return { ...w, logCount, totalSize };
    })
    .sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed));
}
