import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureCopier, validateParams, initQuantum } from '../src/lib/quantum.js';

const TMP = join(tmpdir(), `agonda-quantum-test-${Date.now()}`);

before(() => {
  mkdirSync(TMP, { recursive: true });
});

after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('ensureCopier', () => {
  it('does not throw when copier is installed', () => {
    // This test depends on copier being installed in the test environment
    assert.doesNotThrow(() => ensureCopier());
  });
});

describe('validateParams', () => {
  it('accepts valid data-product params', () => {
    assert.doesNotThrow(() =>
      validateParams({
        name: 'my-quantum',
        type: 'data-product',
        schema: 'my_quantum',
        outputDir: join(TMP, 'nonexistent'),
      })
    );
  });

  it('accepts valid agentic params', () => {
    assert.doesNotThrow(() =>
      validateParams({
        name: 'buying-signals',
        type: 'agentic',
        schema: 'buying_signals',
        outputDir: join(TMP, 'nonexistent2'),
      })
    );
  });

  it('rejects name starting with number', () => {
    assert.throws(
      () => validateParams({
        name: '1bad',
        type: 'data-product',
        schema: 'bad',
        outputDir: join(TMP, 'x'),
      }),
      { name: 'ValidationError' }
    );
  });

  it('rejects name with uppercase', () => {
    assert.throws(
      () => validateParams({
        name: 'MyQuantum',
        type: 'data-product',
        schema: 'my_quantum',
        outputDir: join(TMP, 'x'),
      }),
      { name: 'ValidationError' }
    );
  });

  it('rejects name with underscores', () => {
    assert.throws(
      () => validateParams({
        name: 'my_quantum',
        type: 'data-product',
        schema: 'my_quantum',
        outputDir: join(TMP, 'x'),
      }),
      { name: 'ValidationError' }
    );
  });

  it('rejects invalid type', () => {
    assert.throws(
      () => validateParams({
        name: 'valid',
        type: 'connector',
        schema: 'valid',
        outputDir: join(TMP, 'x'),
      }),
      { name: 'ValidationError' }
    );
  });

  it('rejects schema with hyphens', () => {
    assert.throws(
      () => validateParams({
        name: 'valid',
        type: 'data-product',
        schema: 'my-schema',
        outputDir: join(TMP, 'x'),
      }),
      { name: 'ValidationError' }
    );
  });

  it('rejects existing directory', () => {
    assert.throws(
      () => validateParams({
        name: 'valid',
        type: 'data-product',
        schema: 'valid',
        outputDir: TMP,  // TMP exists
      }),
      { name: 'ValidationError' }
    );
  });
});

describe('initQuantum', () => {
  it('generates data-product quantum from local template', () => {
    const outputName = `dp-${Date.now()}`;
    const result = initQuantum({
      name: outputName,
      type: 'data-product',
      template: join(process.cwd(), '..', 'quantum-template'),
      cwd: TMP,
    });

    assert.equal(result.quantum, outputName);
    assert.equal(result.type, 'data-product');
    assert.equal(result.dry_run, false);
    assert.ok(result.files.length > 0);
    assert.ok(result.files.includes('src/clients/api/server.py'));
    assert.ok(result.files.includes('src/database/connection.py'));
    assert.ok(result.files.includes('CLAUDE.md'));
    // No agentic files
    assert.ok(!result.files.includes('src/observability/langfuse_utils.py'));
    assert.ok(!result.files.includes('src/observability/errors.py'));
    // Git repo was initialized
    assert.ok(existsSync(join(TMP, outputName, '.git')));
  });

  it('generates agentic quantum with extra files', () => {
    const outputName = `ag-${Date.now()}`;
    const result = initQuantum({
      name: outputName,
      type: 'agentic',
      template: join(process.cwd(), '..', 'quantum-template'),
      cwd: TMP,
    });

    assert.equal(result.type, 'agentic');
    assert.ok(result.files.includes('src/observability/langfuse_utils.py'));
    assert.ok(result.files.includes('src/observability/usage_metrics.py'));
    assert.ok(result.files.includes('src/observability/errors.py'));
  });

  it('derives schema and namespace from name', () => {
    const outputName = `my-test-quantum-${Date.now()}`;
    const result = initQuantum({
      name: outputName,
      type: 'data-product',
      template: join(process.cwd(), '..', 'quantum-template'),
      cwd: TMP,
    });

    assert.equal(result.schema, outputName.replace(/-/g, '_'));
    assert.equal(result.namespace, outputName);
  });

  it('respects explicit schema and namespace', () => {
    const outputName = `custom-${Date.now()}`;
    const result = initQuantum({
      name: outputName,
      type: 'data-product',
      schema: 'custom_schema',
      namespace: 'custom-ns',
      template: join(process.cwd(), '..', 'quantum-template'),
      cwd: TMP,
    });

    assert.equal(result.schema, 'custom_schema');
    assert.equal(result.namespace, 'custom-ns');
  });

  it('dry-run does not create directory', () => {
    const outputName = `dry-${Date.now()}`;
    const result = initQuantum({
      name: outputName,
      type: 'data-product',
      template: join(process.cwd(), '..', 'quantum-template'),
      cwd: TMP,
      dryRun: true,
    });

    assert.equal(result.dry_run, true);
    assert.ok(!existsSync(join(TMP, outputName)));
  });
});
