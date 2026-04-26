import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequestNative } from 'node:http';
import { request as httpsRequestNative } from 'node:https';

process.env.CXV_WORKSPACE_MODE = '1';
process.env.CXV_CLI_MODE = '0';

function httpRequest(protocol, port, path, { method = 'GET', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const requestImpl = protocol === 'https' ? httpsRequestNative : httpRequestNative;
    const req = requestImpl({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      rejectUnauthorized: false,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
          json() { return JSON.parse(data); },
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

describe('server plugin endpoints', { concurrency: false }, () => {
  let startViewer, stopViewer, getPort, getProtocol;
  let port;
  let protocol;

  before(async () => {
    const mod = await import('../server.js');
    startViewer = mod.startViewer;
    stopViewer = mod.stopViewer;
    getPort = mod.getPort;
    getProtocol = mod.getProtocol;
    const srv = await startViewer();
    assert.ok(srv);
    port = getPort();
    protocol = getProtocol();
    assert.ok(port > 0);
  });

  after(() => {
    stopViewer();
  });

  it('GET /api/plugins returns plugins list', async () => {
    const res = await httpRequest(protocol, port, '/api/plugins');
    assert.equal(res.status, 200);
    const data = res.json();
    assert.ok(Array.isArray(data.plugins));
    assert.equal(typeof data.pluginsDir, 'string');
  });

  it('POST /api/plugins/upload rejects invalid file type', async () => {
    const res = await httpRequest(protocol, port, '/api/plugins/upload', {
      method: 'POST',
      body: { files: [{ name: 'bad.txt', content: 'not js' }] },
    });
    assert.equal(res.status, 400);
    assert.ok(res.json().error.includes('.js or .mjs'));
  });

  it('POST /api/plugins/upload accepts valid plugin and affects local-url', async () => {
    const pluginContent = `
      export default {
        name: 'upload-plugin',
        hooks: {
          localUrl(v) { return { url: v.url + '/u' }; }
        }
      };
    `;
    const res = await httpRequest(protocol, port, '/api/plugins/upload', {
      method: 'POST',
      body: { files: [{ name: 'test-upload.js', content: pluginContent }] },
    });
    assert.equal(res.status, 200);
    const data = res.json();
    const found = data.plugins.find(p => p.file === 'test-upload.js');
    assert.ok(found);
    assert.equal(found.enabled, true);

    const urlRes = await httpRequest(protocol, port, '/api/local-url');
    assert.equal(urlRes.status, 200);
    const urlData = urlRes.json();
    assert.ok(urlData.url.includes('/u'));
  });

  it('POST /api/plugins/upload accepts capability-only voice plugin and exposes config', async () => {
    const pluginContent = `
      export default {
        name: 'voice-upload-plugin',
        capabilities: ['voiceInput'],
        voiceInput: { appKey: 'voice-upload-key' }
      };
    `;
    const res = await httpRequest(protocol, port, '/api/plugins/upload', {
      method: 'POST',
      body: { files: [{ name: 'test-voice-upload.mjs', content: pluginContent }] },
    });
    assert.equal(res.status, 200);
    const data = res.json();
    const found = data.plugins.find(p => p.file === 'test-voice-upload.mjs');
    assert.ok(found);
    assert.equal(found.loaded, true);
    assert.deepStrictEqual(found.capabilities, ['voiceInput']);
    assert.deepStrictEqual(found.voiceInput, { appKey: 'voice-upload-key' });
  });

  it('GET /api/plugins/module serves uploaded plugin module source', async () => {
    const pluginContent = `
      export function mountVoiceInput() { return () => {}; }
      export default {
        name: 'module-voice-plugin',
        capabilities: ['voiceInput'],
        voiceInput: { appKey: 'voice-module-key', digestEndpoint: '/api/test-plugin-voice' }
      };
    `;
    const uploadRes = await httpRequest(protocol, port, '/api/plugins/upload', {
      method: 'POST',
      body: { files: [{ name: 'test-module-voice.mjs', content: pluginContent }] },
    });
    assert.equal(uploadRes.status, 200);

    const res = await httpRequest(protocol, port, '/api/plugins/module?file=test-module-voice.mjs');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('mountVoiceInput'));
    assert.equal(res.headers['content-type'], 'application/javascript; charset=utf-8');
  });

  it('voice plugin can register server routes via serverStarted hook', async () => {
    const pluginContent = `
      export function mountVoiceInput() { return () => {}; }
      export default {
        name: 'route-voice-plugin',
        capabilities: ['voiceInput'],
        voiceInput: { appKey: 'route-key', digestEndpoint: '/api/test-plugin-voice' },
        hooks: {
          serverStarted({ registerRoute }) {
            registerRoute('POST', '/api/test-plugin-voice', (req, res) => {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, source: 'plugin-route' }));
            });
          }
        }
      };
    `;
    const uploadRes = await httpRequest(protocol, port, '/api/plugins/upload', {
      method: 'POST',
      body: { files: [{ name: 'test-route-voice.mjs', content: pluginContent }] },
    });
    assert.equal(uploadRes.status, 200);

    const reloadRes = await httpRequest(protocol, port, '/api/plugins/reload', { method: 'POST' });
    assert.equal(reloadRes.status, 200);

    const routeRes = await httpRequest(protocol, port, '/api/test-plugin-voice', {
      method: 'POST',
      body: {},
    });
    assert.equal(routeRes.status, 200);
    assert.deepStrictEqual(routeRes.json(), { ok: true, source: 'plugin-route' });
  });

  it('POST /api/plugins/upload auto-enables plugin when same name was previously disabled', async () => {
    let res = await httpRequest(protocol, port, '/api/preferences', {
      method: 'POST',
      body: { disabledPlugins: ['voice-upload-plugin'] },
    });
    assert.equal(res.status, 200);

    const pluginContent = `
      export default {
        name: 'voice-upload-plugin',
        capabilities: ['voiceInput'],
        voiceInput: { appKey: 'voice-upload-key' }
      };
    `;
    res = await httpRequest(protocol, port, '/api/plugins/upload', {
      method: 'POST',
      body: { files: [{ name: 'test-voice-upload.mjs', content: pluginContent }] },
    });
    assert.equal(res.status, 200);
    const data = res.json();
    const found = data.plugins.find(p => p.file === 'test-voice-upload.mjs');
    assert.ok(found);
    assert.equal(found.enabled, true);
    assert.equal(found.loaded, true);
  });

  it('POST /api/plugins/reload returns updated list', async () => {
    const res = await httpRequest(protocol, port, '/api/plugins/reload', { method: 'POST' });
    assert.equal(res.status, 200);
    const data = res.json();
    assert.ok(Array.isArray(data.plugins));
  });

  it('DELETE /api/plugins rejects invalid filename', async () => {
    const res = await httpRequest(protocol, port, '/api/plugins?file=../../evil.js', { method: 'DELETE' });
    assert.equal(res.status, 400);
  });

  it('DELETE /api/plugins returns 404 when file missing', async () => {
    const res = await httpRequest(protocol, port, '/api/plugins?file=not-exist.js', { method: 'DELETE' });
    assert.equal(res.status, 404);
  });

  it('DELETE /api/plugins removes uploaded plugin', async () => {
    const res = await httpRequest(protocol, port, '/api/plugins?file=test-upload.js', { method: 'DELETE' });
    assert.equal(res.status, 200);
    const data = res.json();
    const found = data.plugins.find(p => p.file === 'test-upload.js');
    assert.equal(!!found, false);
  });

  it('DELETE /api/plugins removes uploaded voice plugin', async () => {
    const res = await httpRequest(protocol, port, '/api/plugins?file=test-voice-upload.mjs', { method: 'DELETE' });
    assert.equal(res.status, 200);
    const data = res.json();
    const found = data.plugins.find(p => p.file === 'test-voice-upload.mjs');
    assert.equal(!!found, false);
  });

  it('DELETE /api/plugins removes uploaded module voice plugin', async () => {
    const res = await httpRequest(protocol, port, '/api/plugins?file=test-module-voice.mjs', { method: 'DELETE' });
    assert.equal(res.status, 200);
    const data = res.json();
    const found = data.plugins.find(p => p.file === 'test-module-voice.mjs');
    assert.equal(!!found, false);
  });

  it('DELETE /api/plugins removes uploaded route voice plugin', async () => {
    const res = await httpRequest(protocol, port, '/api/plugins?file=test-route-voice.mjs', { method: 'DELETE' });
    assert.equal(res.status, 200);
    const data = res.json();
    const found = data.plugins.find(p => p.file === 'test-route-voice.mjs');
    assert.equal(!!found, false);
  });

  // --- POST /api/plugins/install-from-url tests ---

  it('POST /api/plugins/install-from-url rejects missing url', async () => {
    const res = await httpRequest(protocol, port, '/api/plugins/install-from-url', {
      method: 'POST',
      body: {},
    });
    assert.equal(res.status, 400);
    assert.ok(res.json().error.includes('required'));
  });

  it('POST /api/plugins/install-from-url rejects invalid URL', async () => {
    const res = await httpRequest(protocol, port, '/api/plugins/install-from-url', {
      method: 'POST',
      body: { url: 'not-a-url' },
    });
    assert.equal(res.status, 400);
    assert.ok(res.json().error.includes('Invalid URL'));
  });

  it('POST /api/plugins/install-from-url rejects non-http protocol', async () => {
    const res = await httpRequest(protocol, port, '/api/plugins/install-from-url', {
      method: 'POST',
      body: { url: 'ftp://example.com/plugin.js' },
    });
    assert.equal(res.status, 400);
    assert.ok(res.json().error.includes('Invalid URL'));
  });

  it('POST /api/plugins/install-from-url returns 500 for unreachable URL', async () => {
    const res = await httpRequest(protocol, port, '/api/plugins/install-from-url', {
      method: 'POST',
      body: { url: 'https://127.0.0.1:1/nonexistent-plugin.js' },
    });
    assert.equal(res.status, 500);
    assert.ok(res.json().error.includes('Failed to fetch'));
  });
}); 
