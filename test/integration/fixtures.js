/**
 * Shared fixture helpers for integration tests.
 * Creates temp repos with the full Agonda directory structure.
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, '..', '..', 'bin', 'agonda.js');

/**
 * Create a temp repo with configurable Agonda structure.
 * Returns { root, cleanup }.
 */
export function createTempRepo(name = 'integration') {
  const root = join(tmpdir(), `agonda-${name}-${Date.now()}`);
  mkdirSync(join(root, '.git'), { recursive: true });
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Add workspaces with .workbench markers to a temp repo.
 */
export function addWorkspaces(root, workspaces) {
  for (const ws of workspaces) {
    const wsDir = join(root, 'workspace', 'active', ws.path);
    mkdirSync(wsDir, { recursive: true });
    const lines = [];
    if (ws.workbench) lines.push(`workbench: ${ws.workbench}`);
    if (ws.domain) lines.push(`domain: ${ws.domain}`);
    if (ws.created) lines.push(`created: ${ws.created}`);
    writeFileSync(join(wsDir, '.workbench'), lines.join('\n') + '\n');
  }
}

/**
 * Add a marketplace.json and settings to a temp repo.
 */
export function addMarketplace(root, { name, plugins }) {
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });

  writeFileSync(
    join(root, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({ name, plugins })
  );
}

/**
 * Add a workbench directory with plugin.json, skills, and hooks.
 */
export function addWorkbench(root, relPath, { pluginJson, skills = [], hooksJson } = {}) {
  const wbDir = join(root, relPath);
  mkdirSync(wbDir, { recursive: true });
  writeFileSync(join(wbDir, 'workbench.json'), JSON.stringify({ primitives: {} }));

  if (pluginJson) {
    mkdirSync(join(wbDir, '.claude-plugin'), { recursive: true });
    writeFileSync(join(wbDir, '.claude-plugin', 'plugin.json'), JSON.stringify(pluginJson));
  }

  for (const skill of skills) {
    mkdirSync(join(wbDir, 'skills', skill.name), { recursive: true });
    if (skill.content) {
      writeFileSync(join(wbDir, 'skills', skill.name, 'SKILL.md'), skill.content);
    }
  }

  if (hooksJson) {
    mkdirSync(join(wbDir, 'hooks'), { recursive: true });
    writeFileSync(join(wbDir, 'hooks', 'hooks.json'), JSON.stringify(hooksJson));
  }
}

/**
 * Run the agonda CLI with given args against a temp repo.
 * Returns { stdout, stderr, exitCode }.
 */
export function runCLI(args, { cwd, env = {} } = {}) {
  const result = spawnSync('node', [CLI_PATH, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf-8',
    timeout: 10000,
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.status ?? 1,
  };
}

/**
 * Run the CLI with --json and parse the output.
 */
export function runCLIJson(args, opts) {
  const result = runCLI(['--json', ...args], opts);
  if (result.exitCode !== 0 && !result.stdout.trim()) {
    return { ...result, json: null };
  }
  try {
    return { ...result, json: JSON.parse(result.stdout) };
  } catch {
    return { ...result, json: null };
  }
}
