#!/usr/bin/env node
/**
 * perm-bridge.js — PreToolUse hook bridge for tool permission approval.
 *
 * Called by Claude Code when a tool (Bash, Write, Edit, etc.) is about to execute.
 * Reads hook payload from stdin, forwards the tool request to cc-viewer server
 * via long-poll HTTP, waits for user decision (allow/deny), then outputs
 * hookSpecificOutput with the permission decision.
 *
 * Exit 0 = success (stdout contains hookSpecificOutput with permissionDecision)
 * Exit 1 = fallback (Claude Code proceeds with normal terminal UI)
 *
 * Hook config in ~/.claude/settings.json:
 * {
 *   "hooks": {
 *     "PreToolUse": [{
 *       "matcher": "Bash|Write|Edit|NotebookEdit",
 *       "hooks": [{ "type": "command", "command": "node /path/to/perm-bridge.js" }]
 *     }]
 *   }
 * }
 */

import { readFileSync } from 'node:fs';
import http from 'node:http';

const port = process.env.CCVIEWER_PORT;
if (!port) {
  process.exit(1);
}

let stdinData;
try {
  stdinData = readFileSync(0, 'utf-8');
} catch {
  process.exit(1);
}

if (!stdinData || !stdinData.trim()) {
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(stdinData);
} catch {
  process.exit(1);
}

const toolName = payload?.tool_name;
const toolInput = payload?.tool_input;

// Let ask-bridge handle AskUserQuestion
if (toolName === 'AskUserQuestion' || toolName === 'ExitPlanMode') {
  process.exit(1);
}

if (!toolName || !toolInput) {
  process.exit(1);
}

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function postToViewer() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ toolName, input: toolInput });
    const req = http.request({
      hostname: '127.0.0.1',
      port: Number(port),
      path: '/api/perm-hook',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('Invalid response JSON'));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.write(body);
    req.end();
  });
}

try {
  const data = await postToViewer();
  const decision = data.decision === 'allow' ? 'allow' : 'deny';

  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
    },
  };

  // If denied, add a reason message
  if (decision === 'deny') {
    output.hookSpecificOutput.permissionDecisionReason = 'User denied via cc-viewer';
  }

  process.stdout.write(JSON.stringify(output) + '\n');
  process.exit(0);
} catch (err) {
  process.stderr.write(`perm-bridge: ${err.message}\n`);
  process.exit(1);
}
