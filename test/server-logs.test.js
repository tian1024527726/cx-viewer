import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOG_DIR } from '../findcc.js';

process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

function httpRequest(port, path, { method = 'GET', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
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

describe('server local logs endpoints', () => {
  let startViewer, stopViewer, getPort;
  let port;
  const projectName = `projX_${Date.now()}`;
  const fileName = `${projectName}_20260101_120000.jsonl`;
  const fileRel = `${projectName}/${fileName}`;
  const projectDir = join(LOG_DIR, projectName);

  before(async () => {
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, fileName), JSON.stringify({ timestamp: '2026-01-01T12:00:00Z' }) + '\n---\n');
    writeFileSync(join(projectDir, `${projectName}.json`), JSON.stringify({ files: { [fileName]: { summary: { sessionCount: 3 } } } }));

    const mod = await import('../server.js');
    startViewer = mod.startViewer;
    stopViewer = mod.stopViewer;
    getPort = mod.getPort;
    const srv = await startViewer();
    assert.ok(srv);
    port = getPort();
  });

  after(() => {
    stopViewer();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('GET /api/local-logs returns grouped logs with stats', async () => {
    const res = await httpRequest(port, '/api/local-logs');
    assert.equal(res.status, 200);
    const data = res.json();
    assert.equal(typeof data._currentProject, 'string');
    assert.ok(Array.isArray(data[projectName]));
    assert.equal(data[projectName].length, 1);
    assert.equal(data[projectName][0].file, fileRel);
    assert.equal(data[projectName][0].turns, 3);
    assert.equal(data[projectName][0].timestamp, '20260101_120000');
  });

  it('GET /api/download-log rejects invalid file name', async () => {
    const res = await httpRequest(port, '/api/download-log?file=../../etc/passwd');
    assert.equal(res.status, 400);
    assert.ok(res.json().error.includes('Invalid file name'));
  });

  it('GET /api/download-log rejects invalid file type', async () => {
    const res = await httpRequest(port, '/api/download-log?file=projX/20260101.txt');
    assert.equal(res.status, 400);
    assert.ok(res.json().error.includes('Invalid file type'));
  });

  it('GET /api/download-log returns 404 when file not found', async () => {
    const res = await httpRequest(port, '/api/download-log?file=projX/not-exist.jsonl');
    assert.equal(res.status, 404);
  });

  it('GET /api/download-log returns file content for existing log', async () => {
    const res = await httpRequest(port, `/api/download-log?file=${encodeURIComponent(fileRel)}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/octet-stream');
    assert.ok(res.body.includes('2026-01-01T12:00:00Z'));
  });

  it('GET /api/local-log returns entries for existing log', async () => {
    const res = await httpRequest(port, `/api/local-log?file=${encodeURIComponent(fileRel)}`);
    assert.equal(res.status, 200);
    const data = res.json();
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 1);
    assert.equal(data[0].timestamp, '2026-01-01T12:00:00Z');
  });
});
