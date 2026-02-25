import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setPluginState, switchPlugin } from '../src/lib/plugin.js';

const TMP = join(tmpdir(), `agonda-manage-test-${Date.now()}`);

before(() => {
  mkdirSync(join(TMP, '.git'), { recursive: true });
  mkdirSync(join(TMP, '.claude-plugin'), { recursive: true });
  mkdirSync(join(TMP, '.claude'), { recursive: true });

  writeFileSync(
    join(TMP, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'test-mp',
      plugins: [
        { name: 'alpha', source: './alpha', version: '1.0.0' },
        { name: 'beta', source: './beta', version: '2.0.0' },
        { name: 'gamma', source: './gamma', version: '0.1.0' },
        { name: 'delta', source: './delta', version: '0.2.0' },
      ],
    })
  );

  writeFileSync(
    join(TMP, '.claude', 'settings.json'),
    JSON.stringify({
      enableAllProjectMcpServers: true,
      enabledPlugins: {
        'alpha@test-mp': true,
        'beta@test-mp': true,
      },
    })
  );
});

after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function readSettingsFile() {
  return JSON.parse(readFileSync(join(TMP, '.claude', 'settings.json'), 'utf-8'));
}

describe('setPluginState', () => {
  it('enables a disabled plugin', () => {
    const result = setPluginState('gamma', true, { scope: 'project', cwd: TMP });
    assert.equal(result.action, 'enabled');
    assert.equal(result.alreadyInState, false);
    const settings = readSettingsFile();
    assert.equal(settings.enabledPlugins['gamma@test-mp'], true);
  });

  it('reports already-enabled plugin', () => {
    const result = setPluginState('gamma', true, { scope: 'project', cwd: TMP });
    assert.equal(result.alreadyInState, true);
  });

  it('disables an enabled plugin', () => {
    const result = setPluginState('alpha', false, { scope: 'project', cwd: TMP });
    assert.equal(result.action, 'disabled');
    const settings = readSettingsFile();
    assert.equal(settings.enabledPlugins['alpha@test-mp'], false);
  });

  it('preserves existing settings keys', () => {
    const settings = readSettingsFile();
    assert.equal(settings.enableAllProjectMcpServers, true);
  });

  it('throws NotFoundError for unknown plugin', () => {
    assert.throws(
      () => setPluginState('nonexistent', true, { cwd: TMP }),
      (err) => err.code === 'plugin_not_found'
    );
  });
});

describe('switchPlugin', () => {
  before(() => {
    // Reset state: alpha and beta enabled
    writeFileSync(
      join(TMP, '.claude', 'settings.json'),
      JSON.stringify({
        enableAllProjectMcpServers: true,
        enabledPlugins: {
          'alpha@test-mp': true,
          'beta@test-mp': true,
        },
      })
    );
  });

  it('disables all and enables target', () => {
    const result = switchPlugin('gamma', { scope: 'project', cwd: TMP });
    assert.deepEqual(result.enabled, ['gamma']);
    assert.ok(result.disabled.includes('alpha'));
    assert.ok(result.disabled.includes('beta'));
    const settings = readSettingsFile();
    assert.equal(settings.enabledPlugins['gamma@test-mp'], true);
    assert.equal(settings.enabledPlugins['alpha@test-mp'], false);
    assert.equal(settings.enabledPlugins['beta@test-mp'], false);
  });

  it('respects --keep', () => {
    // Reset: gamma enabled from previous test
    writeFileSync(
      join(TMP, '.claude', 'settings.json'),
      JSON.stringify({
        enabledPlugins: {
          'alpha@test-mp': true,
          'beta@test-mp': true,
        },
      })
    );

    const result = switchPlugin('gamma', { keep: ['alpha'], scope: 'project', cwd: TMP });
    assert.deepEqual(result.enabled, ['gamma']);
    assert.ok(result.kept.includes('alpha'));
    assert.ok(result.disabled.includes('beta'));
    const settings = readSettingsFile();
    assert.equal(settings.enabledPlugins['gamma@test-mp'], true);
    assert.equal(settings.enabledPlugins['alpha@test-mp'], true);
    assert.equal(settings.enabledPlugins['beta@test-mp'], false);
  });

  it('throws for unknown target', () => {
    assert.throws(
      () => switchPlugin('nonexistent', { cwd: TMP }),
      (err) => err.code === 'plugin_not_found'
    );
  });

  it('throws for unknown keep plugin', () => {
    assert.throws(
      () => switchPlugin('gamma', { keep: ['nonexistent'], cwd: TMP }),
      (err) => err.code === 'plugin_not_found'
    );
  });
});
