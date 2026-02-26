/**
 * Integration tests for marketplace list.
 *
 * Tests the `agonda marketplace list` command via CLI binary.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTempRepo, addMarketplace, runCLI, runCLIJson } from './fixtures.js';

let repo;

const PLUGINS = [
  { name: 'governance-tools', source: './governance-tools', version: '1.0.0', description: 'Governance skills' },
  { name: 'dev-tools', source: './dev-tools', version: '2.0.0', description: 'Developer tools' },
  { name: 'website-tools', source: './website-tools', version: '1.1.0', description: 'Website planning' },
];

before(() => {
  repo = createTempRepo('marketplace-list');
  addMarketplace(repo.root, {
    name: 'test-mp',
    plugins: PLUGINS,
  });
});

after(() => repo.cleanup());

describe('marketplace list', () => {
  it('lists all workbenches with exit code 0', () => {
    const result = runCLI(['marketplace', 'list'], { cwd: repo.root });
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('governance-tools'));
    assert.ok(result.stdout.includes('dev-tools'));
    assert.ok(result.stdout.includes('website-tools'));
  });

  it('does not include enabled/disabled status columns', () => {
    const result = runCLI(['marketplace', 'list'], { cwd: repo.root });
    assert.equal(result.exitCode, 0);
    // The table should NOT have Status or Scope headers
    assert.ok(!result.stdout.includes('Status'));
    assert.ok(!result.stdout.includes('Scope'));
  });

  it('--json returns structured array without status/scope', () => {
    const result = runCLIJson(['marketplace', 'list'], { cwd: repo.root });
    assert.equal(result.exitCode, 0);
    assert.ok(Array.isArray(result.json));
    assert.equal(result.json.length, 3);

    const gov = result.json.find((w) => w.name === 'governance-tools');
    assert.equal(gov.version, '1.0.0');
    assert.equal(gov.source, './governance-tools');
    assert.equal('status' in gov, false);
    assert.equal('scope' in gov, false);
  });
});
