/**
 * Integration tests for `agonda quantum init`.
 * Uses real Copier with the local quantum-template repo.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCLI, runCLIJson } from './fixtures.js';

const TMP = join(tmpdir(), `agonda-quantum-init-integration-${Date.now()}`);
const TEMPLATE_PATH = join(process.cwd(), '..', 'quantum-template');

before(() => {
  mkdirSync(TMP, { recursive: true });
});

after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('agonda quantum init', () => {
  it('generates data-product quantum', () => {
    const name = `int-dp-${Date.now()}`;
    const result = runCLI(
      ['quantum', 'init', name, '--type', 'data-product', '--template', TEMPLATE_PATH],
      { cwd: TMP }
    );
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('Scaffolded'), result.stdout);
    assert.ok(existsSync(join(TMP, name, 'src', 'clients', 'api', 'server.py')));
    assert.ok(existsSync(join(TMP, name, 'CLAUDE.md')));
    assert.ok(existsSync(join(TMP, name, '.claude', 'settings.json')));
    // No agentic files
    assert.ok(!existsSync(join(TMP, name, 'src', 'observability', 'langfuse_utils.py')));
  });

  it('generates agentic quantum with langfuse', () => {
    const name = `int-ag-${Date.now()}`;
    const result = runCLI(
      ['quantum', 'init', name, '--type', 'agentic', '--template', TEMPLATE_PATH],
      { cwd: TMP }
    );
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    assert.ok(existsSync(join(TMP, name, 'src', 'observability', 'langfuse_utils.py')));
    assert.ok(existsSync(join(TMP, name, 'src', 'observability', 'usage_metrics.py')));
    assert.ok(existsSync(join(TMP, name, 'src', 'observability', 'errors.py')));

    // Check pyproject.toml has langfuse dep
    const pyproject = readFileSync(join(TMP, name, 'pyproject.toml'), 'utf-8');
    assert.ok(pyproject.includes('langfuse'), 'pyproject.toml should include langfuse');
  });

  it('outputs JSON with --json flag', () => {
    const name = `int-json-${Date.now()}`;
    const { json, exitCode } = runCLIJson(
      ['quantum', 'init', name, '--template', TEMPLATE_PATH],
      { cwd: TMP }
    );
    assert.equal(exitCode, 0);
    assert.ok(json);
    assert.equal(json.quantum, name);
    assert.equal(json.type, 'data-product');
    assert.ok(json.path.endsWith(name));
    assert.ok(Array.isArray(json.files));
    assert.equal(json.dry_run, false);
  });

  it('dry-run does not create output directory', () => {
    const name = `int-dry-${Date.now()}`;
    const result = runCLI(
      ['--dry-run', 'quantum', 'init', name, '--template', TEMPLATE_PATH],
      { cwd: TMP }
    );
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('dry-run'), result.stdout);
    assert.ok(!existsSync(join(TMP, name)));
  });

  it('rejects invalid name', () => {
    const result = runCLI(
      ['quantum', 'init', 'BAD_NAME', '--template', TEMPLATE_PATH],
      { cwd: TMP }
    );
    assert.notEqual(result.exitCode, 0);
  });

  it('rejects existing directory', () => {
    const name = `int-exists-${Date.now()}`;
    mkdirSync(join(TMP, name), { recursive: true });
    const result = runCLI(
      ['quantum', 'init', name, '--template', TEMPLATE_PATH],
      { cwd: TMP }
    );
    assert.notEqual(result.exitCode, 0);
  });

  it('connection.py is identical to identity repo', () => {
    const name = `int-verbatim-${Date.now()}`;
    runCLI(
      ['quantum', 'init', name, '--template', TEMPLATE_PATH],
      { cwd: TMP }
    );
    const generated = readFileSync(join(TMP, name, 'src', 'database', 'connection.py'), 'utf-8');
    const identity = readFileSync(
      join(process.cwd(), '..', 'components', 'identity', 'src', 'database', 'connection.py'),
      'utf-8'
    );
    assert.equal(generated, identity, 'connection.py should be identical to identity repo');
  });

  it('CLAUDE.md includes type-aware content', () => {
    const name = `int-claude-${Date.now()}`;
    runCLI(
      ['quantum', 'init', name, '--type', 'agentic', '--template', TEMPLATE_PATH],
      { cwd: TMP }
    );
    const claude = readFileSync(join(TMP, name, 'CLAUDE.md'), 'utf-8');
    assert.ok(claude.includes('Agentic'), 'CLAUDE.md should mention agentic type');
    assert.ok(claude.includes('Langfuse'), 'CLAUDE.md should mention Langfuse for agentic');
    assert.ok(claude.includes('workspace/brief/'), 'CLAUDE.md should route to brief');
  });

  it('initializes git repo with commit', () => {
    const name = `int-git-${Date.now()}`;
    runCLI(
      ['quantum', 'init', name, '--template', TEMPLATE_PATH],
      { cwd: TMP }
    );
    assert.ok(existsSync(join(TMP, name, '.git')));
  });
});
