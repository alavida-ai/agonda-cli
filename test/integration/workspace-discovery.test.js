/**
 * Integration tests for user stories US-1 and US-2.
 *
 * US-1: "I want to see what workspaces exist and which workbench they belong to"
 * US-2: "I want to find the workspace for the architect workbench"
 *
 * These tests call the CLI binary and assert on stdout/exit codes.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTempRepo, addWorkspaces, runCLI, runCLIJson } from './fixtures.js';

let repo;

before(() => {
  repo = createTempRepo('ws-discovery');

  addWorkspaces(repo.root, [
    { path: 'architecture/agonda-cli', workbench: 'agonda-architect', domain: 'platform', created: '2026-02-25' },
    { path: 'website-redesign', workbench: 'website-planning', domain: 'value', created: '2026-02-20' },
    { path: 'architecture/mesh-design', workbench: 'agonda-architect', domain: 'platform', created: '2026-02-22' },
  ]);
});

after(() => repo.cleanup());

describe('US-1: workspace list', () => {
  it('lists all workspaces with exit code 0', () => {
    const result = runCLI(['workspace', 'list'], { cwd: repo.root });
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('agonda-architect'));
    assert.ok(result.stdout.includes('website-planning'));
  });

  it('--json returns structured object with workspaces and warnings', () => {
    const result = runCLIJson(['workspace', 'list'], { cwd: repo.root });
    assert.equal(result.exitCode, 0);
    assert.ok(Array.isArray(result.json.workspaces));
    assert.equal(result.json.workspaces.length, 3);
    assert.ok(Array.isArray(result.json.warnings));

    const names = result.json.workspaces.map((ws) => ws.workbench).sort();
    assert.deepEqual(names, ['agonda-architect', 'agonda-architect', 'website-planning']);
  });

  it('--json includes all expected fields', () => {
    const result = runCLIJson(['workspace', 'list'], { cwd: repo.root });
    const ws = result.json.workspaces[0];
    assert.ok('name' in ws);
    assert.ok('path' in ws);
    assert.ok('workbench' in ws);
    assert.ok('domain' in ws);
    assert.ok('created' in ws);
  });

  it('shows empty message when no workspaces exist', () => {
    const empty = createTempRepo('ws-empty');
    const result = runCLI(['workspace', 'list'], { cwd: empty.root });
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('No active workspaces'));
    empty.cleanup();
  });
});

describe('US-2: workspace current', () => {
  it('finds single workspace by workbench name', () => {
    const result = runCLI(['workspace', 'current', 'website-planning'], { cwd: repo.root });
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('website-redesign'));
  });

  it('finds multiple workspaces for same workbench', () => {
    const result = runCLI(['workspace', 'current', 'agonda-architect'], { cwd: repo.root });
    assert.equal(result.exitCode, 0);
    // Should show both matches (solving head -1 problem)
    assert.ok(result.stdout.includes('agonda-cli'));
    assert.ok(result.stdout.includes('mesh-design'));
  });

  it('--json returns array of matches', () => {
    const result = runCLIJson(['workspace', 'current', 'agonda-architect'], { cwd: repo.root });
    assert.equal(result.exitCode, 0);
    assert.ok(Array.isArray(result.json));
    assert.equal(result.json.length, 2);
  });

  it('reports no match for unknown workbench', () => {
    const result = runCLI(['workspace', 'current', 'nonexistent'], { cwd: repo.root });
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('No workspace found'));
  });
});
