import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listPlugins, getMarketplace, findPlugin } from '../src/lib/plugin.js';

const TMP = join(tmpdir(), `agonda-plugin-test-${Date.now()}`);

const FAKE_HOME = join(TMP, 'fakehome');
let originalHome;

before(() => {
  originalHome = process.env.HOME;
  process.env.HOME = FAKE_HOME;

  mkdirSync(FAKE_HOME, { recursive: true });
  mkdirSync(join(TMP, '.git'), { recursive: true });
  mkdirSync(join(TMP, '.claude-plugin'), { recursive: true });
  mkdirSync(join(TMP, '.claude'), { recursive: true });

  writeFileSync(
    join(TMP, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'test-market',
      plugins: [
        { name: 'alpha', source: './plugins/alpha', version: '1.0.0', description: 'Alpha plugin' },
        { name: 'beta', source: './plugins/beta', version: '2.0.0', description: 'Beta plugin' },
        { name: 'gamma', source: './plugins/gamma', version: '0.1.0', description: 'Gamma plugin' },
      ],
    })
  );

  writeFileSync(
    join(TMP, '.claude', 'settings.json'),
    JSON.stringify({
      enabledPlugins: {
        'alpha@test-market': true,
        'beta@test-market': true,
      },
    })
  );
});

after(() => {
  process.env.HOME = originalHome;
  rmSync(TMP, { recursive: true, force: true });
});

describe('getMarketplace', () => {
  it('reads marketplace.json', () => {
    const mp = getMarketplace(TMP);
    assert.equal(mp.name, 'test-market');
    assert.equal(mp.plugins.length, 3);
  });
});

describe('listPlugins', () => {
  it('lists all plugins with status', () => {
    const plugins = listPlugins(TMP);
    assert.equal(plugins.length, 3);
  });

  it('shows enabled plugins correctly', () => {
    const plugins = listPlugins(TMP);
    const alpha = plugins.find((p) => p.name === 'alpha');
    assert.equal(alpha.status, 'enabled');
    assert.equal(alpha.scope, 'project');
  });

  it('shows disabled plugins correctly', () => {
    const plugins = listPlugins(TMP);
    const gamma = plugins.find((p) => p.name === 'gamma');
    assert.equal(gamma.status, 'disabled');
    assert.equal(gamma.scope, '-');
  });
});

describe('findPlugin', () => {
  it('finds plugin by name', () => {
    const p = findPlugin('beta', TMP);
    assert.ok(p);
    assert.equal(p.version, '2.0.0');
  });

  it('returns null for unknown plugin', () => {
    const p = findPlugin('nonexistent', TMP);
    assert.equal(p, null);
  });
});
