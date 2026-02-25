import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { seedCache, clearCache } from '../src/lib/registry.js';
import { checkWorkbenchPrimitives, checkAllPrimitives, installPrimitives, updatePrimitive } from '../src/lib/primitives.js';

const FAKE_TAGS = [
  { name: 'visual-explainer/v2.0.0', sha: 'aaa' },
  { name: 'visual-explainer/v1.1.0', sha: 'bbb' },
  { name: 'visual-explainer/v1.0.0', sha: 'ccc' },
  { name: 'compound-learning/v1.1.0', sha: 'ddd' },
  { name: 'compound-learning/v1.0.0', sha: 'eee' },
  { name: 'agentic-mesh/v1.0.0', sha: 'fff' },
];

const TMP = join(tmpdir(), `agonda-prim-test-${Date.now()}`);

before(() => {
  // Build a repo with two workbenches
  mkdirSync(join(TMP, '.git'), { recursive: true });

  // Workbench 1: has two primitives, one behind and one current
  const wb1 = join(TMP, 'domains', 'platform', 'workbenches', 'creator', 'architect');
  mkdirSync(wb1, { recursive: true });
  writeFileSync(join(wb1, 'workbench.json'), JSON.stringify({
    primitives: {
      'visual-explainer': 'v1.1.0',
      'compound-learning': 'v1.1.0',
    },
  }));

  // Workbench 2: has one primitive that's behind
  const wb2 = join(TMP, 'domains', 'governance', 'workbenches', 'creator', 'tools');
  mkdirSync(wb2, { recursive: true });
  writeFileSync(join(wb2, 'workbench.json'), JSON.stringify({
    primitives: {
      'visual-explainer': 'v2.0.0',
    },
  }));

  // Workbench 3: no primitives
  const wb3 = join(TMP, 'domains', 'value', 'workbenches', 'creator', 'sales');
  mkdirSync(wb3, { recursive: true });
  writeFileSync(join(wb3, 'workbench.json'), JSON.stringify({
    primitives: {},
  }));
});

after(() => {
  clearCache();
  rmSync(TMP, { recursive: true, force: true });
});

afterEach(() => clearCache());

describe('checkWorkbenchPrimitives', () => {
  it('reports BEHIND for outdated primitive', () => {
    seedCache(FAKE_TAGS);
    const result = checkWorkbenchPrimitives({
      name: 'architect',
      relativePath: 'domains/platform/workbenches/creator/architect',
      config: { primitives: { 'visual-explainer': 'v1.1.0' } },
    });

    assert.equal(result.workbench, 'architect');
    assert.equal(result.primitives.length, 1);
    assert.equal(result.primitives[0].status, 'BEHIND');
    assert.equal(result.primitives[0].pinned, '1.1.0');
    assert.equal(result.primitives[0].latest, '2.0.0');
  });

  it('reports CURRENT for up-to-date primitive', () => {
    seedCache(FAKE_TAGS);
    const result = checkWorkbenchPrimitives({
      name: 'tools',
      relativePath: 'domains/governance/workbenches/creator/tools',
      config: { primitives: { 'compound-learning': 'v1.1.0' } },
    });

    assert.equal(result.primitives[0].status, 'CURRENT');
  });

  it('reports UNKNOWN for unrecognized primitive', () => {
    seedCache(FAKE_TAGS);
    const result = checkWorkbenchPrimitives({
      name: 'test',
      relativePath: 'test',
      config: { primitives: { 'nonexistent-skill': 'v1.0.0' } },
    });

    assert.equal(result.primitives[0].status, 'UNKNOWN');
    assert.equal(result.primitives[0].latest, 'unknown');
  });

  it('strips v prefix from pinned version', () => {
    seedCache(FAKE_TAGS);
    const result = checkWorkbenchPrimitives({
      name: 'test',
      relativePath: 'test',
      config: { primitives: { 'agentic-mesh': 'v1.0.0' } },
    });

    assert.equal(result.primitives[0].pinned, '1.0.0');
    assert.equal(result.primitives[0].status, 'CURRENT');
  });

  it('handles empty primitives map', () => {
    seedCache(FAKE_TAGS);
    const result = checkWorkbenchPrimitives({
      name: 'empty',
      relativePath: 'empty',
      config: { primitives: {} },
    });

    assert.equal(result.primitives.length, 0);
  });
});

describe('checkAllPrimitives', () => {
  it('scans all workbenches and returns summary', () => {
    seedCache(FAKE_TAGS);
    const { results, summary } = checkAllPrimitives({ all: true, cwd: TMP });

    // Should find 2 workbenches with primitives (not the empty one)
    assert.equal(results.length, 2);
    assert.ok(summary.total >= 3);
  });

  it('skips workbenches with empty primitives', () => {
    seedCache(FAKE_TAGS);
    const { results } = checkAllPrimitives({ all: true, cwd: TMP });

    const names = results.map((r) => r.workbench);
    assert.ok(!names.includes('sales'));
  });

  it('summary counts are correct', () => {
    seedCache(FAKE_TAGS);
    const { summary } = checkAllPrimitives({ all: true, cwd: TMP });

    // architect: visual-explainer BEHIND, compound-learning CURRENT
    // tools: visual-explainer CURRENT
    assert.equal(summary.total, 3);
    assert.equal(summary.current, 2);
    assert.equal(summary.behind, 1);
    assert.equal(summary.unknown, 0);
  });

  it('falls back to all when not inside a workbench', () => {
    seedCache(FAKE_TAGS);
    // TMP root is not inside a workbench, so should fall back to scanning all
    const { results } = checkAllPrimitives({ all: false, cwd: TMP });
    assert.equal(results.length, 2);
  });
});

describe('installPrimitives', () => {
  const INSTALL_TMP = join(tmpdir(), `agonda-install-test-${Date.now()}`);

  before(() => {
    // Build a workbench for install tests
    const wb = join(INSTALL_TMP, 'wb');
    mkdirSync(wb, { recursive: true });
    writeFileSync(join(wb, 'workbench.json'), JSON.stringify({
      primitives: {
        'visual-explainer': 'v1.1.0',
        'compound-learning': 'v1.1.0',
      },
    }));

    // Pre-install compound-learning with matching version
    const clDir = join(wb, 'skills', 'compound-learning');
    mkdirSync(clDir, { recursive: true });
    writeFileSync(join(clDir, '.primitive-version'), '1.1.0');
    writeFileSync(join(clDir, 'SKILL.md'), '# Compound Learning');
  });

  after(() => rmSync(INSTALL_TMP, { recursive: true, force: true }));

  it('dry-run reports would_install for missing primitives', () => {
    seedCache(FAKE_TAGS);
    const result = installPrimitives({
      name: 'test-wb',
      relativePath: 'wb',
      path: join(INSTALL_TMP, 'wb'),
      config: { primitives: { 'visual-explainer': 'v1.1.0', 'compound-learning': 'v1.1.0' } },
    }, { dryRun: true });

    const ve = result.actions.find((a) => a.name === 'visual-explainer');
    assert.equal(ve.action, 'would_install');
    assert.equal(ve.version, '1.1.0');
  });

  it('dry-run skips already-installed primitives', () => {
    seedCache(FAKE_TAGS);
    const result = installPrimitives({
      name: 'test-wb',
      relativePath: 'wb',
      path: join(INSTALL_TMP, 'wb'),
      config: { primitives: { 'compound-learning': 'v1.1.0' } },
    }, { dryRun: true });

    assert.equal(result.actions[0].action, 'skipped');
    assert.equal(result.actions[0].reason, 'already installed');
  });

  it('dry-run with --update shows would_update for behind primitives', () => {
    seedCache(FAKE_TAGS);
    const result = installPrimitives({
      name: 'test-wb',
      relativePath: 'wb',
      path: join(INSTALL_TMP, 'wb'),
      config: { primitives: { 'compound-learning': 'v1.0.0' } },
    }, { dryRun: true, update: true });

    // --update bumps pin to v1.1.0, installed is 1.1.0, so should skip
    assert.equal(result.actions[0].action, 'skipped');
  });

  it('returns empty actions for workbench with no primitives', () => {
    seedCache(FAKE_TAGS);
    const result = installPrimitives({
      name: 'empty',
      relativePath: 'empty',
      path: join(INSTALL_TMP, 'wb'),
      config: { primitives: {} },
    }, { dryRun: true });

    assert.equal(result.actions.length, 0);
  });

  it('dry-run does not write any files', () => {
    seedCache(FAKE_TAGS);
    const wbPath = join(INSTALL_TMP, 'wb');
    const veBefore = existsSync(join(wbPath, 'skills', 'visual-explainer'));

    installPrimitives({
      name: 'test-wb',
      relativePath: 'wb',
      path: wbPath,
      config: { primitives: { 'visual-explainer': 'v1.1.0' } },
    }, { dryRun: true });

    const veAfter = existsSync(join(wbPath, 'skills', 'visual-explainer'));
    assert.equal(veBefore, veAfter);
  });
});

describe('updatePrimitive', () => {
  const UPDATE_TMP = join(tmpdir(), `agonda-update-test-${Date.now()}`);

  before(() => {
    const wb = join(UPDATE_TMP, 'wb');
    mkdirSync(wb, { recursive: true });
    writeFileSync(join(wb, 'workbench.json'), JSON.stringify({
      primitives: {
        'visual-explainer': 'v1.1.0',
        'compound-learning': 'v1.1.0',
      },
    }));
  });

  after(() => rmSync(UPDATE_TMP, { recursive: true, force: true }));

  it('returns not_found for unknown primitive', () => {
    seedCache(FAKE_TAGS);
    const result = updatePrimitive('nonexistent', []);
    assert.equal(result.error, 'not_found');
  });

  it('dry-run shows would_update for behind primitive', () => {
    seedCache(FAKE_TAGS);
    const wb = {
      name: 'test-wb',
      relativePath: 'wb',
      path: join(UPDATE_TMP, 'wb'),
      config: { primitives: { 'visual-explainer': 'v1.1.0' } },
    };
    const result = updatePrimitive('visual-explainer', [wb], { dryRun: true });

    assert.equal(result.latest, '2.0.0');
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].action, 'would_update');
    assert.equal(result.results[0].from, '1.1.0');
    assert.equal(result.results[0].to, '2.0.0');
  });

  it('reports current for already up-to-date primitive', () => {
    seedCache(FAKE_TAGS);
    const wb = {
      name: 'test-wb',
      relativePath: 'wb',
      path: join(UPDATE_TMP, 'wb'),
      config: { primitives: { 'compound-learning': 'v1.1.0' } },
    };
    const result = updatePrimitive('compound-learning', [wb], { dryRun: true });

    assert.equal(result.results[0].action, 'current');
  });

  it('skips workbenches that dont pin the primitive', () => {
    seedCache(FAKE_TAGS);
    const wb = {
      name: 'test-wb',
      relativePath: 'wb',
      path: join(UPDATE_TMP, 'wb'),
      config: { primitives: { 'compound-learning': 'v1.1.0' } },
    };
    const result = updatePrimitive('agentic-mesh', [wb], { dryRun: true });

    assert.equal(result.results.length, 0);
  });

  it('dry-run does not modify workbench.json', () => {
    seedCache(FAKE_TAGS);
    const wbPath = join(UPDATE_TMP, 'wb');
    const before = readFileSync(join(wbPath, 'workbench.json'), 'utf-8');

    const wb = {
      name: 'test-wb',
      relativePath: 'wb',
      path: wbPath,
      config: JSON.parse(before),
    };
    updatePrimitive('visual-explainer', [wb], { dryRun: true });

    const afterContent = readFileSync(join(wbPath, 'workbench.json'), 'utf-8');
    assert.equal(before, afterContent);
  });
});
