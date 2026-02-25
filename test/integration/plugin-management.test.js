/**
 * Integration tests for user stories US-3, US-5, and US-6.
 *
 * US-3: "I want to see which plugins are available and their status"
 * US-5: "I want to switch to working on the website"
 * US-6: "I want to enable governance-tools without affecting other plugins"
 *
 * These tests call the CLI binary and assert on stdout/exit codes.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempRepo, addMarketplace, runCLI, runCLIJson } from './fixtures.js';

let repo;

const PLUGINS = [
  { name: 'governance-tools', source: './governance-tools', version: '1.0.0', description: 'Governance skills' },
  { name: 'dev-tools', source: './dev-tools', version: '2.0.0', description: 'Developer tools' },
  { name: 'website-tools', source: './website-tools', version: '1.1.0', description: 'Website planning' },
  { name: 'content-tools', source: './content-tools', version: '0.5.0', description: 'Content creation' },
];

function resetSettings() {
  writeFileSync(
    join(repo.root, '.claude', 'settings.json'),
    JSON.stringify({
      enableAllProjectMcpServers: true,
      enabledPlugins: {
        'governance-tools@test-mp': true,
        'dev-tools@test-mp': true,
      },
    })
  );
}

function readSettings() {
  return JSON.parse(readFileSync(join(repo.root, '.claude', 'settings.json'), 'utf-8'));
}

before(() => {
  repo = createTempRepo('plugin-mgmt');
  addMarketplace(repo.root, {
    name: 'test-mp',
    plugins: PLUGINS,
    enabledPlugins: {
      'governance-tools@test-mp': true,
      'dev-tools@test-mp': true,
    },
  });
});

after(() => repo.cleanup());

describe('US-3: plugin list', () => {
  before(() => resetSettings());

  it('lists all plugins with exit code 0', () => {
    const result = runCLI(['plugin', 'list'], { cwd: repo.root });
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('governance-tools'));
    assert.ok(result.stdout.includes('dev-tools'));
    assert.ok(result.stdout.includes('website-tools'));
    assert.ok(result.stdout.includes('content-tools'));
  });

  it('shows enabled/disabled status', () => {
    const result = runCLI(['plugin', 'list'], { cwd: repo.root });
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('enabled'));
    assert.ok(result.stdout.includes('disabled'));
  });

  it('--json returns structured array with status', () => {
    const result = runCLIJson(['plugin', 'list'], { cwd: repo.root });
    assert.equal(result.exitCode, 0);
    assert.ok(Array.isArray(result.json));
    assert.equal(result.json.length, 4);

    const gov = result.json.find((p) => p.name === 'governance-tools');
    assert.equal(gov.status, 'enabled');
    assert.equal(gov.version, '1.0.0');

    const website = result.json.find((p) => p.name === 'website-tools');
    assert.equal(website.status, 'disabled');
  });
});

describe('US-5: plugin switch', () => {
  beforeEach(() => resetSettings());

  it('disables others and enables target', () => {
    const result = runCLI(['plugin', 'switch', 'website-tools'], { cwd: repo.root });
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('Enabled: website-tools'));
    assert.ok(result.stdout.includes('Disabled: governance-tools'));
    assert.ok(result.stdout.includes('Disabled: dev-tools'));

    // Verify settings file
    const settings = readSettings();
    assert.equal(settings.enabledPlugins['website-tools@test-mp'], true);
    assert.equal(settings.enabledPlugins['governance-tools@test-mp'], false);
    assert.equal(settings.enabledPlugins['dev-tools@test-mp'], false);
  });

  it('respects --keep flag', () => {
    const result = runCLI(['plugin', 'switch', 'website-tools', '--keep', 'governance-tools'], { cwd: repo.root });
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('Enabled: website-tools'));
    assert.ok(result.stdout.includes('Kept: governance-tools'));
    assert.ok(result.stdout.includes('Disabled: dev-tools'));

    const settings = readSettings();
    assert.equal(settings.enabledPlugins['website-tools@test-mp'], true);
    assert.equal(settings.enabledPlugins['governance-tools@test-mp'], true);
    assert.equal(settings.enabledPlugins['dev-tools@test-mp'], false);
  });

  it('--json returns structured result', () => {
    const result = runCLIJson(['plugin', 'switch', 'website-tools', '--keep', 'governance-tools'], { cwd: repo.root });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.json.enabled, ['website-tools']);
    assert.ok(result.json.disabled.includes('dev-tools'));
    assert.ok(result.json.kept.includes('governance-tools'));
  });

  it('--dry-run previews without writing', () => {
    const result = runCLI(['--dry-run', 'plugin', 'switch', 'website-tools'], { cwd: repo.root });
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('Dry run'));
    assert.ok(result.stdout.includes('Enable: website-tools'));

    // Settings should be unchanged
    const settings = readSettings();
    assert.equal(settings.enabledPlugins['governance-tools@test-mp'], true);
    assert.equal(settings.enabledPlugins['dev-tools@test-mp'], true);
  });

  it('warns about restart', () => {
    const result = runCLI(['plugin', 'switch', 'website-tools'], { cwd: repo.root });
    // "Restart" message goes via output.status() which writes to stderr
    assert.ok(result.stdout.includes('Restart') || result.stderr.includes('Restart'));
  });

  it('fails for unknown plugin', () => {
    const result = runCLI(['plugin', 'switch', 'nonexistent'], { cwd: repo.root });
    assert.notEqual(result.exitCode, 0);
  });
});

describe('US-6: plugin enable', () => {
  beforeEach(() => resetSettings());

  it('enables a disabled plugin', () => {
    const result = runCLI(['plugin', 'enable', 'website-tools'], { cwd: repo.root });
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('Enabled'));

    const settings = readSettings();
    assert.equal(settings.enabledPlugins['website-tools@test-mp'], true);
    // Others unchanged
    assert.equal(settings.enabledPlugins['governance-tools@test-mp'], true);
    assert.equal(settings.enabledPlugins['dev-tools@test-mp'], true);
  });

  it('reports already-enabled plugin', () => {
    const result = runCLI(['plugin', 'enable', 'governance-tools'], { cwd: repo.root });
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('already enabled'));
  });

  it('--json returns structured result', () => {
    const result = runCLIJson(['plugin', 'enable', 'content-tools'], { cwd: repo.root });
    assert.equal(result.exitCode, 0);
    assert.equal(result.json.plugin, 'content-tools');
    assert.equal(result.json.action, 'enabled');
    assert.equal(result.json.alreadyInState, false);
  });

  it('preserves existing settings keys', () => {
    runCLI(['plugin', 'enable', 'website-tools'], { cwd: repo.root });
    const settings = readSettings();
    assert.equal(settings.enableAllProjectMcpServers, true);
  });

  it('fails for unknown plugin', () => {
    const result = runCLI(['plugin', 'enable', 'nonexistent'], { cwd: repo.root });
    assert.notEqual(result.exitCode, 0);
  });

  it('--dry-run previews enable without writing', () => {
    const result = runCLI(['--dry-run', 'plugin', 'enable', 'website-tools'], { cwd: repo.root });
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('Dry run'));
    assert.ok(result.stdout.includes('website-tools'));

    // Settings should be unchanged
    const settings = readSettings();
    assert.equal(settings.enabledPlugins['website-tools@test-mp'], undefined);
  });

  it('--dry-run previews disable without writing', () => {
    const result = runCLI(['--dry-run', 'plugin', 'disable', 'governance-tools'], { cwd: repo.root });
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('Dry run'));
    assert.ok(result.stdout.includes('governance-tools'));

    // Settings should be unchanged — governance-tools still enabled
    const settings = readSettings();
    assert.equal(settings.enabledPlugins['governance-tools@test-mp'], true);
  });
});
