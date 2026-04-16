/**
 * appserver-bridge.js — Codex App-Server WebSocket 中间代理
 *
 * 架构：
 *   codex TUI (--remote ws://127.0.0.1:PROXY_PORT)
 *        ↕ WebSocket (JSON-RPC)
 *   cxv WS proxy (本模块) ← 记录所有双向消息 → LOG_FILE
 *        ↕ WebSocket (JSON-RPC)
 *   codex app-server (--listen ws://127.0.0.1:SERVER_PORT)
 *
 * cxv 作为中间代理转发所有消息，同时解析 server→client 的 notifications
 * 并转换为 cx-viewer entry 格式写入 LOG_FILE。
 */

import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { basename } from 'node:path';
import { BINARY_NAME } from '../findcx.js';
import WebSocket, { WebSocketServer } from 'ws';

let _appServerProcess = null;
let _proxyServer = null;
let _upstreamWs = null;
let _logFile = null;
let _currentModel = null;
let _currentProject = null;
let _messages = [];       // 累积 messages 用于 MainAgent entry
let _pendingContent = []; // 当前 turn 的 assistant content blocks
let _turnStartTime = null;

/**
 * 找一个空闲端口
 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * 等待 app-server 就绪
 */
async function waitForReady(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`App-server not ready after ${timeoutMs}ms`);
}

/**
 * 写入一条 entry 到 LOG_FILE
 */
function writeEntry(entry) {
  if (!entry || !_logFile) return;
  try {
    appendFileSync(_logFile, JSON.stringify(entry) + '\n---\n');
  } catch {}
}

/**
 * 发出累积式 MainAgent entry
 */
function emitMainAgentEntry(timestamp, responseContent, usage) {
  const entry = {
    timestamp,
    project: _currentProject || 'codex',
    url: `codex://api/${_currentModel || 'codex'}`,
    method: 'POST',
    headers: {},
    body: {
      model: _currentModel,
      system: 'You are Codex',
      messages: _messages.map(m => ({ ...m })),
      tools: [{ name: 'Bash' }, { name: 'Edit' }, { name: 'Task' }],
    },
    response: {
      status: 200,
      statusText: 'OK',
      headers: {},
      body: {
        content: responseContent,
        model: _currentModel,
        stop_reason: 'end_turn',
        ...(usage ? { usage } : {}),
      },
    },
    duration: _turnStartTime ? Date.now() - _turnStartTime : 0,
    isStream: true,
    mainAgent: true,
    _appServerSource: true,
  };
  writeEntry(entry);
}

/**
 * 解析 app-server → client 的 JSON-RPC notification
 */
function parseServerMessage(msg) {
  if (!msg || !msg.method) return; // 只处理 notifications（有 method 无 id）
  if (msg.id !== undefined && msg.id !== null) return; // 忽略 response

  const params = msg.params || {};
  const ts = new Date().toISOString();
  const base = {
    timestamp: ts,
    project: _currentProject || 'codex',
    headers: {},
    isStream: false,
    _appServerSource: true,
  };

  const method = msg.method;

  // turn/started
  if (method === 'turn/started') {
    _turnStartTime = Date.now();
    _pendingContent = [];
    return;
  }

  // turn/completed
  if (method === 'turn/completed') {
    if (_pendingContent.length > 0) {
      _messages.push({ role: 'assistant', content: _pendingContent });
      emitMainAgentEntry(ts, _pendingContent, null);
      _pendingContent = [];
    }
    return;
  }

  // thread/tokenUsageUpdated
  if (method === 'thread/tokenUsageUpdated') {
    const u = params.tokenUsage?.last;
    if (!u) return;
    writeEntry({
      ...base,
      url: 'codex://token_usage',
      method: 'INFO',
      body: { model: _currentModel },
      response: {
        status: 200, statusText: 'OK', headers: {},
        body: {
          usage: {
            input_tokens: u.inputTokens || 0,
            output_tokens: u.outputTokens || 0,
            cache_read_input_tokens: u.cachedInputTokens || 0,
          },
          model: _currentModel,
        },
      },
      duration: 0,
      mainAgent: false,
      isCountTokens: true,
    });
    return;
  }

  // item/completed — ResponseItem 完成（包含 message、function_call、function_call_output、reasoning 等）
  if (method === 'item/completed' || method === 'rawResponseItem/completed' || method === 'rawResponseItemCompleted') {
    const item = params.item || {};
    const type = item.type;

    // userMessage — 用户输入（也通过 item/completed 到达）
    if (type === 'userMessage') {
      const content = item.content || [];
      for (const block of content) {
        if ((block.type === 'text' || block.type === 'input_text') && block.text) {
          _messages.push({ role: 'user', content: block.text });
        }
      }
      return;
    }

    // message (assistant text)
    if (type === 'message') {
      const content = item.content || [];
      for (const block of content) {
        if (block.type === 'output_text' || block.type === 'text') {
          _pendingContent.push({ type: 'text', text: block.text || '' });
        }
      }
      // 如果有 end_turn，立即 flush
      if (item.end_turn) {
        _messages.push({ role: 'assistant', content: _pendingContent });
        emitMainAgentEntry(ts, [..._pendingContent], null);
        _pendingContent = [];
      }
      return;
    }

    // reasoning
    if (type === 'reasoning') {
      const text = (item.content || []).map(c => c.text || '').join('');
      if (text) {
        _pendingContent.push({ type: 'thinking', thinking: text, summary: item.summary });
      }
      return;
    }

    // function_call
    if (type === 'function_call') {
      let args = item.arguments;
      if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch {}
      }
      _pendingContent.push({
        type: 'tool_use',
        id: item.call_id || item.id,
        name: item.name || 'unknown',
        input: args || {},
      });
      writeEntry({
        ...base,
        url: `codex://tool/${item.name || 'unknown'}`,
        method: 'TOOL',
        body: { tool_name: item.name, tool_input: args, _callId: item.call_id },
        response: null,
        duration: 0,
        mainAgent: false,
      });
      return;
    }

    // function_call_output
    if (type === 'function_call_output') {
      // Flush pending assistant content
      if (_pendingContent.length > 0) {
        _messages.push({ role: 'assistant', content: _pendingContent });
        _pendingContent = [];
      }
      _messages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: item.call_id,
          content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output),
        }],
      });
      writeEntry({
        ...base,
        url: `codex://tool_result/${item.call_id || ''}`,
        method: 'TOOL_RESULT',
        body: { _callId: item.call_id },
        response: {
          status: 200, statusText: 'OK', headers: {},
          body: { output: item.output },
        },
        duration: 0,
        mainAgent: false,
      });
      return;
    }

    // custom_tool_call (MCP)
    if (type === 'custom_tool_call') {
      _pendingContent.push({
        type: 'tool_use',
        id: item.call_id || item.id,
        name: item.name || 'unknown',
        input: item.input || {},
      });
      writeEntry({
        ...base,
        url: `codex://mcp_tool/${item.name || 'unknown'}`,
        method: 'TOOL',
        body: { tool_name: item.name, tool_input: item.input, _callId: item.call_id, _source: 'mcp' },
        response: null,
        duration: 0,
        mainAgent: false,
      });
      return;
    }

    // custom_tool_call_output
    if (type === 'custom_tool_call_output') {
      if (_pendingContent.length > 0) {
        _messages.push({ role: 'assistant', content: _pendingContent });
        _pendingContent = [];
      }
      _messages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: item.call_id, content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output) }],
      });
      writeEntry({
        ...base,
        url: `codex://mcp_tool_result/${item.call_id || ''}`,
        method: 'TOOL_RESULT',
        body: { _callId: item.call_id },
        response: { status: 200, statusText: 'OK', headers: {}, body: { output: item.output } },
        duration: 0,
        mainAgent: false,
      });
      return;
    }
  }

  // agentMessage/delta or agentMessageDelta — 流式文本（可选记录）
  if (method === 'agentMessage/delta' || method === 'agentMessageDelta') {
    return;
  }

  // error — 错误通知
  if (method === 'error') {
    writeEntry({
      ...base,
      url: 'codex://error',
      method: 'POST',
      body: {
        model: _currentModel,
        system: 'You are Codex',
        messages: _messages.map(m => ({ ...m })),
        tools: [{ name: 'Bash' }, { name: 'Edit' }, { name: 'Task' }],
      },
      response: {
        status: 500, statusText: 'Error', headers: {},
        body: { error: params.error || params },
      },
      duration: _turnStartTime ? Date.now() - _turnStartTime : 0,
      mainAgent: true,
      _appServerSource: true,
    });
    return;
  }
}

/**
 * 解析 client → server 的 JSON-RPC request（提取用户输入）
 */
function parseClientMessage(msg) {
  if (!msg || !msg.method) return;

  // turn/start — 用户发起新 turn（不在此处添加 messages，由 item/completed userMessage 统一处理）
  if (msg.method === 'turn/start') {
    const params = msg.params || {};
    _currentModel = params.model || _currentModel;
    _turnStartTime = Date.now();
    _pendingContent = [];
    return;
  }

  // thread/start — 新会话
  if (msg.method === 'thread/start') {
    const params = msg.params || {};
    _currentProject = params.cwd ? basename(params.cwd) : _currentProject;
    _messages = [];
    _pendingContent = [];
    return;
  }
}

/**
 * 启动 App-Server Bridge
 *
 * @param {object} options
 * @param {string} options.cwd - 工作目录
 * @param {string} options.codexPath - codex 二进制路径
 * @param {string} options.logFile - LOG_FILE 路径
 * @param {object} [options.env] - 环境变量
 * @returns {Promise<{ proxyPort: number, appServerPort: number, stop: Function }>}
 */
export async function startAppServerBridge(options) {
  const { cwd, codexPath, logFile, env = process.env } = options;
  _logFile = logFile;
  _currentModel = null;
  _currentProject = cwd ? basename(cwd) : 'codex';
  _messages = [];
  _pendingContent = [];

  // 1. 找两个空闲端口
  const appServerPort = await findFreePort();
  const proxyPort = await findFreePort();

  // 2. 启动 codex app-server（确保代理环境变量传递）
  const appEnv = { ...env };
  if (!appEnv.HTTPS_PROXY && !appEnv.HTTP_PROXY && !appEnv.https_proxy && !appEnv.http_proxy) {
    try {
      const shell = process.env.SHELL || '/bin/zsh';
      const funcBody = execSync(
        `${shell} -ic 'declare -f ${BINARY_NAME} 2>/dev/null || type ${BINARY_NAME} 2>/dev/null'`,
        { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const proxyRe = /\b(HTTPS?_PROXY|https?_proxy|ALL_PROXY|all_proxy|NO_PROXY|no_proxy)=(\S+)/g;
      let m;
      while ((m = proxyRe.exec(funcBody)) !== null) {
        appEnv[m[1]] = m[2];
      }
    } catch {}
  }

  let command = codexPath;
  let appServerArgs = ['app-server', '--listen', `ws://127.0.0.1:${appServerPort}`];
  // npm 版 codex 是 .js 文件，需要 node 运行
  if (codexPath.endsWith('.js')) {
    command = process.execPath;
    appServerArgs = [codexPath, ...appServerArgs];
  }
  _appServerProcess = spawn(command, appServerArgs, {
    cwd,
    env: appEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  _appServerProcess.stdout.on('data', (data) => {
    if (process.env.CXV_DEBUG) process.stderr.write(`[app-server] ${data}`);
  });
  _appServerProcess.stderr.on('data', (data) => {
    if (process.env.CXV_DEBUG) process.stderr.write(`[app-server] ${data}`);
  });

  // 3. 等待就绪
  await waitForReady(`http://127.0.0.1:${appServerPort}/readyz`);

  // 4. 启动 WebSocket proxy server
  const httpServer = createServer((req, res) => {
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (clientWs) => {
    // 为每个 TUI 客户端连接创建到 app-server 的上游连接
    const upstream = new WebSocket(`ws://127.0.0.1:${appServerPort}`);
    _upstreamWs = upstream;
    const pendingQueue = []; // 上游未就绪时暂存的消息
    let upstreamReady = false;

    upstream.on('open', () => {
      upstreamReady = true;
      for (const m of pendingQueue) upstream.send(m);
      pendingQueue.length = 0;
    });

    // client → proxy → upstream
    clientWs.on('message', (data) => {
      const str = typeof data === 'string' ? data : data.toString();
      try {
        parseClientMessage(JSON.parse(str));
      } catch {}

      if (upstreamReady) {
        upstream.send(str);
      } else {
        pendingQueue.push(str);
      }
    });

    // upstream → proxy → client（记录 server notifications）
    upstream.on('message', (data) => {
      const str = typeof data === 'string' ? data : data.toString();
      try {
        parseServerMessage(JSON.parse(str));
      } catch {}

      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(str);
      }
    });

    // 清理
    clientWs.on('close', () => { upstream.close(); _upstreamWs = null; });
    upstream.on('close', () => clientWs.close());
    clientWs.on('error', () => upstream.close());
    upstream.on('error', () => clientWs.close());
  });

  await new Promise((resolve, reject) => {
    httpServer.listen(proxyPort, '127.0.0.1', () => resolve());
    httpServer.on('error', reject);
  });
  _proxyServer = httpServer;

  return {
    proxyPort,
    appServerPort,
    stop() {
      if (_proxyServer) { _proxyServer.close(); _proxyServer = null; }
      if (_upstreamWs) { _upstreamWs.close(); _upstreamWs = null; }
      if (_appServerProcess) { _appServerProcess.kill(); _appServerProcess = null; }
    },
  };
}
