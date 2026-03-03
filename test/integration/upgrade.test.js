/**
 * Integration tests for `agonda upgrade`.
 *
 * Tests the framework library functions directly (no npm calls)
 * and CLI integration where possible.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createTempRepo, runCLI, runCLIJson } from './fixtures.js';
import {
  readInstanceManifest,
  writeInstanceManifest,
  hashFile,
  detectDrift,
  planUpgrade,
  applyUpgrade,
} from '../../src/lib/framework.js';

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Create a fake framework package directory (simulates what fetchFrameworkPackage returns).
 */
function createFakePackage(tmpRoot, { version, files }) {
  const packageDir = join(tmpRoot, 'fake-package');
  const contentDir = join(packageDir, 'content');
  mkdirSync(contentDir, { recursive: true });

  const manifestFiles = {};
  for (const [filePath, content] of Object.entries(files)) {
    const destPath = join(contentDir, filePath);
    mkdirSync(join(destPath, '..'), { recursive: true });
    writeFileSync(destPath, content);
    manifestFiles[filePath] = { sha256: sha256(content) };
  }

  const manifest = { version, files: manifestFiles };
  writeFileSync(join(packageDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  return { packageDir, manifest };
}

describe('framework library — hashFile', () => {
  let repo;

  before(() => {
    repo = createTempRepo('fw-hash');
    writeFileSync(join(repo.root, 'test.txt'), 'hello world');
  });
  after(() => repo.cleanup());

  it('returns SHA256 hex string', () => {
    const hash = hashFile(join(repo.root, 'test.txt'));
    assert.equal(hash, sha256('hello world'));
    assert.equal(hash.length, 64);
  });
});

describe('framework library — readInstanceManifest / writeInstanceManifest', () => {
  let repo;

  before(() => {
    repo = createTempRepo('fw-manifest');
  });
  after(() => repo.cleanup());

  it('returns null when no manifest exists', () => {
    const result = readInstanceManifest(repo.root);
    assert.equal(result, null);
  });

  it('writes and reads back a manifest', () => {
    const manifest = {
      framework: { package: '@alavida-ai/agonda-framework', version: '1.0.0', installed: '2026-03-03T00:00:00Z' },
      files: { 'test.md': { sha256: 'abc123' } },
    };
    writeInstanceManifest(repo.root, manifest);

    assert.ok(existsSync(join(repo.root, '.agonda', 'manifest.json')));

    const result = readInstanceManifest(repo.root);
    assert.deepEqual(result.framework.version, '1.0.0');
    assert.deepEqual(result.files['test.md'].sha256, 'abc123');
  });
});

describe('framework library — detectDrift', () => {
  let repo;
  const fileContent = '# Branching Rules\nSome content here.';

  before(() => {
    repo = createTempRepo('fw-drift');
    // Create a managed file
    mkdirSync(join(repo.root, '.claude', 'rules'), { recursive: true });
    writeFileSync(join(repo.root, '.claude', 'rules', 'branching.md'), fileContent);
  });
  after(() => repo.cleanup());

  it('detects CURRENT when file matches manifest hash', () => {
    const manifest = {
      framework: { version: '1.0.0' },
      files: { '.claude/rules/branching.md': { sha256: sha256(fileContent) } },
    };

    const drift = detectDrift(repo.root, manifest);
    assert.equal(drift.get('.claude/rules/branching.md').status, 'CURRENT');
  });

  it('detects DRIFTED when file differs from manifest hash', () => {
    const manifest = {
      framework: { version: '1.0.0' },
      files: { '.claude/rules/branching.md': { sha256: 'stale-hash-value' } },
    };

    const drift = detectDrift(repo.root, manifest);
    assert.equal(drift.get('.claude/rules/branching.md').status, 'DRIFTED');
  });

  it('detects MISSING when file does not exist', () => {
    const manifest = {
      framework: { version: '1.0.0' },
      files: { 'nonexistent.md': { sha256: 'abc123' } },
    };

    const drift = detectDrift(repo.root, manifest);
    assert.equal(drift.get('nonexistent.md').status, 'MISSING');
    assert.equal(drift.get('nonexistent.md').actual, null);
  });
});

describe('framework library — planUpgrade', () => {
  it('detects added files (fresh install)', () => {
    const newManifest = {
      version: '1.0.0',
      files: {
        'a.md': { sha256: 'aaa' },
        'b.md': { sha256: 'bbb' },
      },
    };

    const plan = planUpgrade(null, newManifest, null);
    assert.deepEqual(plan.added.sort(), ['a.md', 'b.md']);
    assert.equal(plan.changed.length, 0);
    assert.equal(plan.removed.length, 0);
    assert.equal(plan.drifted.length, 0);
  });

  it('detects changed files between versions', () => {
    const oldManifest = {
      files: {
        'a.md': { sha256: 'old-a' },
        'b.md': { sha256: 'same-b' },
      },
    };
    const newManifest = {
      version: '1.1.0',
      files: {
        'a.md': { sha256: 'new-a' },
        'b.md': { sha256: 'same-b' },
      },
    };

    const drift = new Map();
    drift.set('a.md', { expected: 'old-a', actual: 'old-a', status: 'CURRENT' });
    drift.set('b.md', { expected: 'same-b', actual: 'same-b', status: 'CURRENT' });

    const plan = planUpgrade(oldManifest, newManifest, drift);
    assert.deepEqual(plan.changed, ['a.md']);
    assert.equal(plan.added.length, 0);
    assert.equal(plan.drifted.length, 0);
  });

  it('detects removed files', () => {
    const oldManifest = {
      files: {
        'a.md': { sha256: 'aaa' },
        'removed.md': { sha256: 'rrr' },
      },
    };
    const newManifest = {
      version: '1.1.0',
      files: {
        'a.md': { sha256: 'aaa' },
      },
    };

    const plan = planUpgrade(oldManifest, newManifest, new Map());
    assert.deepEqual(plan.removed, ['removed.md']);
  });

  it('flags drifted files that also changed in the package', () => {
    const oldManifest = {
      files: { 'a.md': { sha256: 'old-a' } },
    };
    const newManifest = {
      version: '1.1.0',
      files: { 'a.md': { sha256: 'new-a' } },
    };

    // User modified 'a.md' locally
    const drift = new Map();
    drift.set('a.md', { expected: 'old-a', actual: 'user-modified', status: 'DRIFTED' });

    const plan = planUpgrade(oldManifest, newManifest, drift);
    assert.deepEqual(plan.drifted, ['a.md']);
    assert.equal(plan.changed.length, 0);
  });
});

describe('framework library — applyUpgrade', () => {
  let repo;

  before(() => {
    repo = createTempRepo('fw-apply');
  });
  after(() => repo.cleanup());

  it('copies files and writes manifest', () => {
    const pkg = createFakePackage(repo.root, {
      version: '1.0.0',
      files: {
        '.claude/rules/branching.md': '# Branching\nContent.',
        'taxonomy/domain-concepts.md': '# Domain Concepts\nDefinitions.',
      },
    });

    const plan = {
      added: ['.claude/rules/branching.md', 'taxonomy/domain-concepts.md'],
      changed: [],
      removed: [],
      drifted: [],
    };

    applyUpgrade(repo.root, pkg.packageDir, plan, pkg.manifest);

    // Files should exist in repo
    assert.ok(existsSync(join(repo.root, '.claude', 'rules', 'branching.md')));
    assert.ok(existsSync(join(repo.root, 'taxonomy', 'domain-concepts.md')));

    // Manifest should be written
    const manifest = readInstanceManifest(repo.root);
    assert.equal(manifest.framework.version, '1.0.0');
    assert.equal(manifest.framework.package, '@alavida-ai/agonda-framework');
    assert.ok(manifest.files['.claude/rules/branching.md'].sha256);
    assert.ok(manifest.files['taxonomy/domain-concepts.md'].sha256);
  });

  it('overwrites existing files on upgrade', () => {
    // Write a file that will be overwritten
    writeFileSync(join(repo.root, '.claude', 'rules', 'branching.md'), 'old content');

    const pkg = createFakePackage(repo.root, {
      version: '1.1.0',
      files: {
        '.claude/rules/branching.md': '# Updated Branching\nNew content.',
        'taxonomy/domain-concepts.md': '# Domain Concepts\nDefinitions.',
      },
    });

    const plan = {
      added: [],
      changed: ['.claude/rules/branching.md'],
      removed: [],
      drifted: [],
    };

    applyUpgrade(repo.root, pkg.packageDir, plan, pkg.manifest);

    const content = readFileSync(join(repo.root, '.claude', 'rules', 'branching.md'), 'utf-8');
    assert.equal(content, '# Updated Branching\nNew content.');

    const manifest = readInstanceManifest(repo.root);
    assert.equal(manifest.framework.version, '1.1.0');
  });
});

describe('CLI — agonda upgrade (no network)', () => {
  it('shows help text with --help', () => {
    const result = runCLI(['upgrade', '--help'], { cwd: '/tmp' });
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('Install or update'));
  });
});
