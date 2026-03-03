/**
 * Core logic for quantum scaffolding via Copier.
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { AgondaError, ValidationError, NotFoundError, EXIT_CODES } from '../utils/errors.js';

const NAME_PATTERN = /^[a-z][a-z0-9-]+$/;
const SCHEMA_PATTERN = /^[a-z_][a-z0-9_]+$/;
const VALID_TYPES = ['data-product', 'agentic'];
const DEFAULT_TEMPLATE = 'gh:alavida-ai/quantum-template';

/**
 * Check that copier is available on PATH.
 * @throws {NotFoundError} if copier is not installed
 */
export function ensureCopier() {
  try {
    execSync('copier --version', { stdio: 'pipe', encoding: 'utf-8' });
  } catch {
    throw new NotFoundError(
      'copier is not installed or not on PATH',
      {
        code: 'copier_not_found',
        suggestion: 'Install Copier: pip install copier (or pipx install copier)',
      }
    );
  }
}

/**
 * Validate quantum init parameters.
 * @param {object} params
 * @param {string} params.name - Quantum name
 * @param {string} params.type - Quantum type
 * @param {string} params.schema - Schema name
 * @param {string} params.namespace - Event namespace
 * @param {string} params.outputDir - Output directory (absolute)
 * @throws {ValidationError} on invalid params
 */
export function validateParams({ name, type, schema, outputDir }) {
  if (!NAME_PATTERN.test(name)) {
    throw new ValidationError(
      `Invalid quantum name "${name}": must be lowercase, hyphenated, start with a letter (pattern: ${NAME_PATTERN})`,
      { code: 'invalid_name' }
    );
  }

  if (!VALID_TYPES.includes(type)) {
    throw new ValidationError(
      `Invalid quantum type "${type}": must be one of ${VALID_TYPES.join(', ')}`,
      { code: 'invalid_type' }
    );
  }

  if (!SCHEMA_PATTERN.test(schema)) {
    throw new ValidationError(
      `Invalid schema name "${schema}": must be lowercase with underscores (pattern: ${SCHEMA_PATTERN})`,
      { code: 'invalid_schema' }
    );
  }

  if (existsSync(outputDir)) {
    throw new ValidationError(
      `Directory already exists: ${outputDir}`,
      { code: 'directory_exists', suggestion: 'Choose a different name or remove the existing directory' }
    );
  }
}

/**
 * Run copier copy to generate a quantum repo.
 * @param {object} params
 * @param {string} params.name - Quantum name
 * @param {string} params.type - Quantum type
 * @param {string} params.schema - Schema name
 * @param {string} params.namespace - Event namespace
 * @param {string} params.description - Quantum description
 * @param {string} params.outputDir - Output directory (absolute)
 * @param {string} params.template - Template source
 * @param {boolean} params.dryRun - Preview only
 * @returns {{ files: string[] }} Generated file list
 */
export function runCopier({ name, type, schema, namespace, description, outputDir, template, dryRun }) {
  const args = [
    'copy',
    template,
    outputDir,
    '--data', `quantum_name=${name}`,
    '--data', `quantum_type=${type}`,
    '--data', `schema_name=${schema}`,
    '--data', `event_namespace=${namespace}`,
    '--data', `description=${description}`,
    '--defaults',
    '--trust',
  ];

  if (dryRun) {
    args.push('--pretend');
  }

  const result = spawnSync('copier', args, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 60000,
  });

  if (result.status !== 0) {
    const stderr = result.stderr || '';
    throw new AgondaError(
      `Copier failed: ${stderr.trim() || 'unknown error'}`,
      { code: 'copier_failed', exitCode: EXIT_CODES.GENERAL }
    );
  }

  // List generated files
  if (dryRun) {
    // Parse copier --pretend output for file names
    const lines = (result.stderr || '').split('\n');
    const files = lines
      .filter(line => line.includes('create'))
      .map(line => line.replace(/.*create\s+/, '').trim())
      .filter(Boolean);
    return { files };
  }

  // List actual files in the output directory
  const files = listFilesRecursive(outputDir);
  return { files };
}

/**
 * Initialize a git repo and make an initial commit.
 * @param {string} dir - Directory to init
 * @param {string} name - Quantum name for commit message
 */
export function gitInit(dir, name) {
  spawnSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  spawnSync('git', ['add', '-A'], { cwd: dir, stdio: 'pipe' });
  spawnSync('git', ['commit', '-m', `chore: scaffold ${name} quantum via agonda quantum init`], {
    cwd: dir,
    stdio: 'pipe',
  });
}

/**
 * Full quantum init pipeline.
 * @param {object} opts
 * @param {string} opts.name - Quantum name
 * @param {string} opts.type - Quantum type
 * @param {string} [opts.schema] - Schema name (defaults to name with underscores)
 * @param {string} [opts.namespace] - Event namespace (defaults to name)
 * @param {string} [opts.description] - Description
 * @param {string} [opts.template] - Template source override
 * @param {boolean} [opts.dryRun] - Preview only
 * @param {string} [opts.cwd] - Working directory
 * @returns {object} Result object
 */
export function initQuantum(opts) {
  const {
    name,
    type = 'data-product',
    cwd = process.cwd(),
    dryRun = false,
  } = opts;

  const schema = opts.schema || name.replace(/-/g, '_');
  const namespace = opts.namespace || name;
  const description = opts.description || `${name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} quantum for the Agonda mesh`;
  const template = opts.template || DEFAULT_TEMPLATE;
  const outputDir = resolve(cwd, name);

  // 1. Check copier
  ensureCopier();

  // 2. Validate
  validateParams({ name, type, schema, outputDir });

  // 3. Run copier
  const { files } = runCopier({
    name, type, schema, namespace, description,
    outputDir, template, dryRun,
  });

  // 4. Git init (skip for dry-run)
  if (!dryRun) {
    gitInit(outputDir, name);
  }

  return {
    quantum: name,
    type,
    path: outputDir,
    schema,
    namespace,
    files,
    dry_run: dryRun,
  };
}

/**
 * Recursively list files in a directory (relative paths).
 */
function listFilesRecursive(dir, base = '') {
  const results = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.name === '.git') continue;
      if (entry.isDirectory()) {
        results.push(...listFilesRecursive(`${dir}/${entry.name}`, rel));
      } else {
        results.push(rel);
      }
    }
  } catch {
    // Directory doesn't exist (dry-run)
  }
  return results;
}
