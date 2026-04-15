/**
 * Tab Worker — child process for each Electron tab.
 * Launched via fork() from electron/main.js.
 * Each worker runs an isolated proxy + server + Codex PTY.
 *
 * Uses workspace mode (CXV_WORKSPACE_MODE=1) so interceptor.js skips auto-init.
 * Then manually: startViewer() → initForWorkspace() → spawnCodex().
 * This mirrors cli.js:runCliModeWorkspaceSelector() + /api/workspaces/launch.
 */
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Set env BEFORE any imports of server.js / interceptor.js
process.env.CXV_CLI_MODE = '1';
process.env.CXV_WORKSPACE_MODE = '1';
process.env.CXV_START_PORT = process.env.CXV_START_PORT || '7048';
process.env.CXV_MAX_PORT = process.env.CXV_MAX_PORT || '7099';

// Receive launch command from parent
process.on('message', async (msg) => {
  if (msg.type === 'launch') {
    try {
      await launch(msg);
    } catch (err) {
      try { process.send({ type: 'error', message: err.message }); } catch {}
      process.exit(1);
    }
  }
  if (msg.type === 'shutdown') {
    await shutdown();
  }
});

// Safety net: parent died
process.on('disconnect', async () => {
  await shutdown();
});

let serverMod = null;
let killPtyFn = null;

async function launch({ path: projectPath, extraArgs = [], codexPath, isNpmVersion }) {
  console.log('[worker] launch:', projectPath, 'codex:', codexPath, 'npm:', isNpmVersion);
  // 1. Register hooks (idempotent)
  const { ensureHooks } = await import(join(rootDir, 'lib', 'ensure-hooks.js'));
  ensureHooks();

  // 2. Start proxy
  const { startProxy } = await import(join(rootDir, 'proxy.js'));
  const proxyPort = await startProxy();
  process.env.CXV_PROXY_PORT = String(proxyPort);
  process.env.CXV_PROJECT_DIR = projectPath;

  // 3. Import server.js (workspace mode → skips auto-start)
  serverMod = await import(join(rootDir, 'server.js'));

  // 4. Manually start server (like cli.js:542)
  await serverMod.startViewer();

  // 5. Get port
  const port = serverMod.getPort();
  if (!port) throw new Error('Server failed to bind port');

  // 6. Store Codex path/args for potential later use by server APIs
  if (codexPath) {
    serverMod.setWorkspaceCodexArgs(extraArgs);
    serverMod.setWorkspaceCodexPath(codexPath, isNpmVersion);
  }

  // 7. Initialize workspace log directory (sets LOG_FILE, _projectName, _logDir)
  //    forceNew: false — 复用最近的日志文件以保留历史数据
  const { initForWorkspace } = await import(join(rootDir, 'interceptor.js'));
  const result = initForWorkspace(projectPath, { forceNew: false });

  // 7b. Mark workspace as launched so React app shows chat view instead of workspace selector
  serverMod.setWorkspaceLaunched(true);

  // 7c. Start log watcher, stats worker, streaming status (mirrors /api/workspaces/launch logic)
  serverMod.initPostLaunch();

  // 8. Notify parent FIRST — let the view load while Codex spawns
  const token = serverMod.getAccessToken();
  console.log('[worker] sending ready:', port, result.projectName);
  process.send({
    type: 'ready',
    port,
    token,
    projectName: result.projectName,
  });

  // 9. Spawn Codex PTY (after ready, so view is already loading)
  const { spawnCodex, killPty, onPtyExit } = await import(join(rootDir, 'pty-manager.js'));
  killPtyFn = killPty;

  onPtyExit((code) => {
    try { process.send({ type: 'pty-exit', code }); } catch {}
  });

  if (codexPath) {
    try {
      console.log('[worker] spawnCodex proxyPort:', proxyPort, 'serverPort:', port, 'path:', projectPath);
      await spawnCodex(proxyPort, projectPath, extraArgs, codexPath, isNpmVersion, port);
    } catch (err) {
      try { process.send({ type: 'pty-error', message: err.message }); } catch {}
    }
  }
}

async function shutdown() {
  try {
    if (killPtyFn) killPtyFn();
    if (serverMod) await serverMod.stopViewer().catch(() => {});
  } catch {}
  process.exit(0);
}
