import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  findRepoRoot,
  findWorkbenchContext,
  findAllWorkbenches,
  resolveWorkbenchFlag,
} from '../src/lib/context.js';

const TMP = join(tmpdir(), `agonda-test-${Date.now()}`);

// Build a fake repo structure:
// tmp/
//   .git/
//   .claude-plugin/marketplace.json
//   domains/platform/workbenches/creator/dev/workbench.json
//   domains/governance/workbenches/creator/tools/workbench.json
//   some-dir/

before(() => {
  mkdirSync(join(TMP, '.git'), { recursive: true });
  mkdirSync(join(TMP, '.claude-plugin'), { recursive: true });
  mkdirSync(join(TMP, 'domains', 'platform', 'workbenches', 'creator', 'dev'), { recursive: true });
  mkdirSync(join(TMP, 'domains', 'governance', 'workbenches', 'creator', 'tools'), { recursive: true });
  mkdirSync(join(TMP, 'some-dir'), { recursive: true });

  writeFileSync(
    join(TMP, 'domains', 'platform', 'workbenches', 'creator', 'dev', 'workbench.json'),
    JSON.stringify({ primitives: { 'compound-learning': 'v1.1.0' } })
  );

  writeFileSync(
    join(TMP, 'domains', 'governance', 'workbenches', 'creator', 'tools', 'workbench.json'),
    JSON.stringify({ primitives: {} })
  );

  writeFileSync(
    join(TMP, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      plugins: [
        { name: 'dev', source: './domains/platform/workbenches/creator/dev' },
        { name: 'tools', source: './domains/governance/workbenches/creator/tools' },
      ],
    })
  );
});

after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('findRepoRoot', () => {
  it('finds .git from repo root', () => {
    assert.equal(findRepoRoot(TMP), TMP);
  });

  it('finds .git from nested dir', () => {
    assert.equal(findRepoRoot(join(TMP, 'some-dir')), TMP);
  });

  it('finds .git from deep workbench dir', () => {
    const deep = join(TMP, 'domains', 'platform', 'workbenches', 'creator', 'dev');
    assert.equal(findRepoRoot(deep), TMP);
  });

  it('throws NotFoundError outside a repo', () => {
    assert.throws(
      () => findRepoRoot(tmpdir()),
      (err) => err.code === 'repo_not_found' && err.exitCode === 4
    );
  });
});

describe('findWorkbenchContext', () => {
  it('returns workbench context from inside a workbench', () => {
    const deep = join(TMP, 'domains', 'platform', 'workbenches', 'creator', 'dev');
    const ctx = findWorkbenchContext(deep);
    assert.ok(ctx);
    assert.equal(ctx.path, deep);
    assert.deepEqual(ctx.config.primitives, { 'compound-learning': 'v1.1.0' });
  });

  it('returns null from repo root', () => {
    const ctx = findWorkbenchContext(TMP);
    assert.equal(ctx, null);
  });

  it('returns null from non-workbench subdir', () => {
    const ctx = findWorkbenchContext(join(TMP, 'some-dir'));
    assert.equal(ctx, null);
  });
});

describe('findAllWorkbenches', () => {
  it('discovers all workbench.json files', () => {
    const all = findAllWorkbenches(TMP);
    assert.equal(all.length, 2);
    const names = all.map((w) => w.name).sort();
    assert.deepEqual(names, ['dev', 'tools']);
  });
});

describe('resolveWorkbenchFlag', () => {
  it('resolves marketplace alias', () => {
    const result = resolveWorkbenchFlag('dev', TMP);
    assert.ok(result);
    assert.ok(result.path.endsWith('dev'));
    assert.deepEqual(result.config.primitives, { 'compound-learning': 'v1.1.0' });
  });

  it('resolves direct path', () => {
    const devPath = join(TMP, 'domains', 'platform', 'workbenches', 'creator', 'dev');
    const result = resolveWorkbenchFlag(devPath, TMP);
    assert.ok(result);
    assert.equal(result.path, devPath);
  });

  it('resolves relative-to-repo path', () => {
    const result = resolveWorkbenchFlag('domains/platform/workbenches/creator/dev', TMP);
    assert.ok(result);
    assert.ok(result.path.endsWith('dev'));
  });

  it('throws NotFoundError for unknown name', () => {
    assert.throws(
      () => resolveWorkbenchFlag('nonexistent', TMP),
      (err) => err.code === 'workbench_not_found' && err.exitCode === 4
    );
  });
});
