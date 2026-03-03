/**
 * Integration tests for the framework section of `agonda status`.
 *
 * Tests that `agonda status` displays framework info correctly
 * in both human and JSON modes.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createTempRepo, addMarketplace, runCLI, runCLIJson } from './fixtures.js';

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function addMinimalStructure(root) {
  addMarketplace(root, { name: 'test', plugins: [] });
}

describe('agonda status — framework section (no manifest)', () => {
  let repo;

  before(() => {
    repo = createTempRepo('status-fw-none');
    addMinimalStructure(repo.root);
  });
  after(() => repo.cleanup());

  it('human output shows "not installed"', () => {
    const result = runCLI(['status'], { cwd: repo.root });
    assert.ok(result.stdout.includes('Framework: not installed'));
  });

  it('JSON output shows NOT_INSTALLED status', () => {
    const result = runCLIJson(['status'], { cwd: repo.root });
    assert.ok(result.json);
    assert.equal(result.json.framework.status, 'NOT_INSTALLED');
    assert.equal(result.json.framework.version, null);
    assert.equal(result.json.framework.files, 0);
  });
});

describe('agonda status — framework section (with manifest, no drift)', () => {
  let repo;
  const fileContent = '# Branching\nRules here.';

  before(() => {
    repo = createTempRepo('status-fw-current');
    addMinimalStructure(repo.root);
    // Create managed file
    mkdirSync(join(repo.root, '.claude', 'rules'), { recursive: true });
    writeFileSync(join(repo.root, '.claude', 'rules', 'branching.md'), fileContent);

    // Create manifest matching the file
    mkdirSync(join(repo.root, '.agonda'), { recursive: true });
    writeFileSync(join(repo.root, '.agonda', 'manifest.json'), JSON.stringify({
      framework: {
        package: '@alavida-ai/agonda-framework',
        version: '1.0.0',
        installed: '2026-03-03T00:00:00Z',
      },
      files: {
        '.claude/rules/branching.md': { sha256: sha256(fileContent) },
      },
    }, null, 2));
  });
  after(() => repo.cleanup());

  it('human output shows version and CURRENT', () => {
    const result = runCLI(['status'], { cwd: repo.root });
    assert.ok(result.stdout.includes('Framework: v1.0.0 (CURRENT)'));
  });

  it('JSON output shows CURRENT status with correct counts', () => {
    const result = runCLIJson(['status'], { cwd: repo.root });
    assert.ok(result.json);
    assert.equal(result.json.framework.version, '1.0.0');
    assert.equal(result.json.framework.files, 1);
    assert.equal(result.json.framework.drifted, 0);
    assert.equal(result.json.framework.missing, 0);
    assert.equal(result.json.framework.status, 'CURRENT');
  });
});

describe('agonda status — framework section (with drift)', () => {
  let repo;

  before(() => {
    repo = createTempRepo('status-fw-drifted');
    addMinimalStructure(repo.root);
    // Create managed file with DIFFERENT content than manifest
    mkdirSync(join(repo.root, '.claude', 'rules'), { recursive: true });
    writeFileSync(join(repo.root, '.claude', 'rules', 'branching.md'), 'modified content');

    // Create manifest with different hash
    mkdirSync(join(repo.root, '.agonda'), { recursive: true });
    writeFileSync(join(repo.root, '.agonda', 'manifest.json'), JSON.stringify({
      framework: {
        package: '@alavida-ai/agonda-framework',
        version: '1.0.0',
        installed: '2026-03-03T00:00:00Z',
      },
      files: {
        '.claude/rules/branching.md': { sha256: 'original-hash-different-from-actual' },
      },
    }, null, 2));
  });
  after(() => repo.cleanup());

  it('human output shows drift count', () => {
    const result = runCLI(['status'], { cwd: repo.root });
    assert.ok(result.stdout.includes('Framework: v1.0.0 (1 files drifted)'));
  });

  it('JSON output shows DRIFTED status', () => {
    const result = runCLIJson(['status'], { cwd: repo.root });
    assert.ok(result.json);
    assert.equal(result.json.framework.status, 'DRIFTED');
    assert.equal(result.json.framework.drifted, 1);
  });
});

describe('agonda status — framework section (missing file)', () => {
  let repo;

  before(() => {
    repo = createTempRepo('status-fw-missing');
    addMinimalStructure(repo.root);
    // Manifest references a file that doesn't exist
    mkdirSync(join(repo.root, '.agonda'), { recursive: true });
    writeFileSync(join(repo.root, '.agonda', 'manifest.json'), JSON.stringify({
      framework: {
        package: '@alavida-ai/agonda-framework',
        version: '1.0.0',
        installed: '2026-03-03T00:00:00Z',
      },
      files: {
        'taxonomy/missing-file.md': { sha256: 'abc123' },
      },
    }, null, 2));
  });
  after(() => repo.cleanup());

  it('counts missing files in drift total', () => {
    const result = runCLIJson(['status'], { cwd: repo.root });
    assert.ok(result.json);
    assert.equal(result.json.framework.missing, 1);
    assert.equal(result.json.framework.status, 'DRIFTED');
  });

  it('human output shows drift count including missing', () => {
    const result = runCLI(['status'], { cwd: repo.root });
    assert.ok(result.stdout.includes('1 files drifted'));
  });
});
