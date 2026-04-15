import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { getOriginalCodexBaseUrl, isStaleLocalCodexBaseUrl } from '../lib/codex-config.js';

describe('codex-config', () => {
  let tempDir;
  let originalHome;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cxv-codex-config-'));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
    mkdirSync(join(tempDir, '.codex'), { recursive: true });
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('treats loopback root URLs as stale local proxy values', () => {
    assert.equal(isStaleLocalCodexBaseUrl('http://127.0.0.1:54125'), true);
    assert.equal(isStaleLocalCodexBaseUrl('http://localhost:7008/'), true);
    assert.equal(isStaleLocalCodexBaseUrl('https://127.0.0.1:8443'), true);
  });

  it('does not treat remote URLs or path-prefixed local URLs as stale', () => {
    assert.equal(isStaleLocalCodexBaseUrl('https://api.openai.com'), false);
    assert.equal(isStaleLocalCodexBaseUrl('https://gateway.example.com/proxy'), false);
    assert.equal(isStaleLocalCodexBaseUrl('http://127.0.0.1:7890/v1'), false);
  });

  it('ignores stale loopback URL from ~/.codex/config.toml', () => {
    writeFileSync(
      join(tempDir, '.codex', 'config.toml'),
      'openai_base_url = "http://127.0.0.1:54125"\n'
    );
    assert.equal(getOriginalCodexBaseUrl(), null);
  });

  it('keeps non-loopback URL from ~/.codex/config.toml', () => {
    writeFileSync(
      join(tempDir, '.codex', 'config.toml'),
      'openai_base_url = "https://gateway.example.com/openai"\n'
    );
    assert.equal(getOriginalCodexBaseUrl(), 'https://gateway.example.com/openai');
  });
});
