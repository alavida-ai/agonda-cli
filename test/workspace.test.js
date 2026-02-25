import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverWorkspaces, findWorkspacesByWorkbench } from '../src/lib/workspace.js';

const TMP = join(tmpdir(), `agonda-ws-test-${Date.now()}`);

before(() => {
  // Build fake repo with workspace/active/ containing .workbench markers
  mkdirSync(join(TMP, '.git'), { recursive: true });
  mkdirSync(join(TMP, 'workspace', 'active', 'arch', 'my-project'), { recursive: true });
  mkdirSync(join(TMP, 'workspace', 'active', 'website'), { recursive: true });
  mkdirSync(join(TMP, 'workspace', 'active', 'arch', 'another'), { recursive: true });

  writeFileSync(
    join(TMP, 'workspace', 'active', 'arch', 'my-project', '.workbench'),
    'workbench: dev\ndomain: platform\ncreated: 2026-02-20\n'
  );

  writeFileSync(
    join(TMP, 'workspace', 'active', 'website', '.workbench'),
    'workbench: website-planning\ndomain: value\ncreated: 2026-02-18\n'
  );

  writeFileSync(
    join(TMP, 'workspace', 'active', 'arch', 'another', '.workbench'),
    'workbench: dev\ndomain: platform\ncreated: 2026-02-22\n'
  );
});

after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('discoverWorkspaces', () => {
  it('finds all .workbench markers', () => {
    const ws = discoverWorkspaces(TMP);
    assert.equal(ws.length, 3);
  });

  it('parses workbench, domain, created fields', () => {
    const ws = discoverWorkspaces(TMP);
    const website = ws.find((w) => w.name === 'website');
    assert.ok(website);
    assert.equal(website.workbench, 'website-planning');
    assert.equal(website.domain, 'value');
    assert.equal(website.created, '2026-02-18');
  });

  it('returns sorted by name', () => {
    const ws = discoverWorkspaces(TMP);
    const names = ws.map((w) => w.name);
    assert.deepEqual(names, [...names].sort());
  });

  it('returns empty array when no workspace/active/', () => {
    const emptyTmp = join(tmpdir(), `agonda-empty-${Date.now()}`);
    mkdirSync(join(emptyTmp, '.git'), { recursive: true });
    const ws = discoverWorkspaces(emptyTmp);
    assert.equal(ws.length, 0);
    rmSync(emptyTmp, { recursive: true, force: true });
  });
});

describe('findWorkspacesByWorkbench', () => {
  it('finds single match', () => {
    const matches = findWorkspacesByWorkbench('website-planning', TMP);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].name, 'website');
  });

  it('finds multiple matches (solves head -1 problem)', () => {
    const matches = findWorkspacesByWorkbench('dev', TMP);
    assert.equal(matches.length, 2);
  });

  it('returns empty for unknown workbench', () => {
    const matches = findWorkspacesByWorkbench('nonexistent', TMP);
    assert.equal(matches.length, 0);
  });
});
