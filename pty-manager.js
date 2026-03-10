import { resolveNativePath } from './findcc.js';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { chmodSync, statSync } from 'node:fs';
import { platform, arch } from 'node:os';

let ptyProcess = null;
let dataListeners = [];
let exitListeners = [];
let lastExitCode = null;
let outputBuffer = '';
let currentWorkspacePath = null;
const MAX_BUFFER = 200000;
let batchBuffer = '';
let batchScheduled = false;

/**
 * 在 outputBuffer 截断时，找到安全的截断位置，
 * 避免从 ANSI 转义序列中间开始导致终端状态紊乱。
 * 策略：从截断点向后扫描，跳过可能被截断的不完整转义序列。
 */
function findSafeSliceStart(buf, rawStart) {
  // 从 rawStart 开始，向后最多扫描 64 字节寻找安全起点
  const scanLimit = Math.min(rawStart + 64, buf.length);
  let i = rawStart;
  while (i < scanLimit) {
    const ch = buf.charCodeAt(i);
    // 如果当前字符是 ESC (0x1b)，可能是新转义序列的开头，
    // 但也可能是被截断的序列的中间部分，跳过整个序列
    if (ch === 0x1b) {
      // 找到 ESC，向后寻找序列结束符（字母字符）
      let j = i + 1;
      while (j < scanLimit && !((buf.charCodeAt(j) >= 0x40 && buf.charCodeAt(j) <= 0x7e) && j > i + 1)) {
        j++;
      }
      if (j < scanLimit) {
        // 找到完整序列末尾，从下一个字符开始是安全的
        return j + 1;
      }
      // 序列不完整，继续扫描
      i = j;
      continue;
    }
    // 如果字符是 CSI 参数字符 (0x30-0x3f) 或中间字符 (0x20-0x2f)，
    // 说明我们在转义序列中间，继续向后
    if ((ch >= 0x20 && ch <= 0x3f)) {
      i++;
      continue;
    }
    // 普通可见字符或控制字符（非转义相关），这是安全位置
    break;
  }
  return i < buf.length ? i : rawStart;
}

function flushBatch() {
  batchScheduled = false;
  if (!batchBuffer) return;
  const chunk = batchBuffer;
  batchBuffer = '';
  for (const cb of dataListeners) {
    try { cb(chunk); } catch {}
  }
}

function fixSpawnHelperPermissions() {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const os = platform();
    const cpu = arch();
    const helperPath = join(__dirname, 'node_modules', 'node-pty', 'prebuilds', `${os}-${cpu}`, 'spawn-helper');
    const stat = statSync(helperPath);
    if (!(stat.mode & 0o111)) {
      chmodSync(helperPath, stat.mode | 0o755);
    }
  } catch {}
}

export async function spawnClaude(proxyPort, cwd, extraArgs = [], claudePath = null, isNpmVersion = false) {
  if (ptyProcess) {
    killPty();
  }

  const ptyMod = await import('node-pty');
  const pty = ptyMod.default || ptyMod;

  fixSpawnHelperPermissions();

  // 如果没有提供 claudePath，尝试自动查找
  if (!claudePath) {
    claudePath = resolveNativePath();
    if (!claudePath) {
      throw new Error('claude not found');
    }
  }

  const env = { ...process.env };
  env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${proxyPort}`;
  env.CCV_PROXY_MODE = '1'; // 告诉 interceptor.js 不要再启动 server

  // 通过 --settings 注入 ANTHROPIC_BASE_URL，确保覆盖 settings.json 中的配置。
  // 仅覆盖 env.ANTHROPIC_BASE_URL，不影响其他 settings 字段。
  const settingsJson = JSON.stringify({
    env: {
      ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL
    }
  });

  let command = claudePath;
  let args = ['--settings', settingsJson, ...extraArgs];

  // 如果是 npm 版本（cli.js），需要使用 node 来运行
  if (isNpmVersion && claudePath.endsWith('.js')) {
    command = process.execPath; // node 可执行文件路径
    args = [claudePath, '--settings', settingsJson, ...extraArgs];
  }

  lastExitCode = null;
  outputBuffer = '';
  currentWorkspacePath = cwd || process.cwd();

  ptyProcess = pty.spawn(command, args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: cwd || process.cwd(),
    env,
  });

  ptyProcess.onData((data) => {
    outputBuffer += data;
    if (outputBuffer.length > MAX_BUFFER) {
      const rawStart = outputBuffer.length - MAX_BUFFER;
      const safeStart = findSafeSliceStart(outputBuffer, rawStart);
      outputBuffer = outputBuffer.slice(safeStart);
    }
    batchBuffer += data;
    if (!batchScheduled) {
      batchScheduled = true;
      setImmediate(flushBatch);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    flushBatch();
    lastExitCode = exitCode;
    ptyProcess = null;
    currentWorkspacePath = null;
    for (const cb of exitListeners) {
      try { cb(exitCode); } catch {}
    }
  });

  return ptyProcess;
}

export function writeToPty(data) {
  if (ptyProcess) {
    ptyProcess.write(data);
  }
}

export function resizePty(cols, rows) {
  if (ptyProcess) {
    try { ptyProcess.resize(cols, rows); } catch {}
  }
}

export function killPty() {
  if (ptyProcess) {
    flushBatch();
    batchBuffer = '';
    batchScheduled = false;
    try { ptyProcess.kill(); } catch {}
    ptyProcess = null;
  }
}

export function onPtyData(cb) {
  dataListeners.push(cb);
  return () => {
    dataListeners = dataListeners.filter(l => l !== cb);
  };
}

export function onPtyExit(cb) {
  exitListeners.push(cb);
  return () => {
    exitListeners = exitListeners.filter(l => l !== cb);
  };
}

export function getPtyState() {
  return {
    running: !!ptyProcess,
    exitCode: lastExitCode,
  };
}

export function getCurrentWorkspace() {
  return {
    running: !!ptyProcess,
    exitCode: lastExitCode,
    cwd: currentWorkspacePath,
  };
}

export function getOutputBuffer() {
  return outputBuffer;
}
