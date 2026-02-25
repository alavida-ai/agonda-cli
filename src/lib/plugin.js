import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from './context.js';
import { NotFoundError } from '../utils/errors.js';

/**
 * Read and parse a JSON file, returning null if missing or malformed.
 */
function readJsonSafe(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Get the marketplace config from the repo.
 */
export function getMarketplace(cwd = process.cwd()) {
  const repoRoot = findRepoRoot(cwd);
  const marketplacePath = join(repoRoot, '.claude-plugin', 'marketplace.json');

  if (!existsSync(marketplacePath)) {
    throw new NotFoundError(
      'No marketplace.json found at .claude-plugin/marketplace.json',
      { code: 'marketplace_not_found', suggestion: 'Ensure you are in an Agonda repo with a marketplace configured' }
    );
  }

  return JSON.parse(readFileSync(marketplacePath, 'utf-8'));
}

/**
 * Get the marketplace name (used for enabledPlugins keys).
 */
export function getMarketplaceName(cwd = process.cwd()) {
  const marketplace = getMarketplace(cwd);
  return marketplace.name || 'unknown';
}

/**
 * Read enabledPlugins from a settings file.
 * Returns a Set of enabled plugin keys (e.g. "dev@alavida").
 */
function readEnabledPlugins(filePath) {
  const settings = readJsonSafe(filePath);
  if (!settings || !settings.enabledPlugins) return new Set();
  return new Set(
    Object.entries(settings.enabledPlugins)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key)
  );
}

/**
 * Get all enabled plugins across all three scopes.
 * Returns a Map of pluginKey → scope (project | local | user).
 * Project scope wins over local, local wins over user.
 */
export function getEnabledPluginsWithScope(cwd = process.cwd()) {
  const repoRoot = findRepoRoot(cwd);
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';

  // Check scopes in priority order (highest first)
  const scopes = [
    { name: 'project', path: join(repoRoot, '.claude', 'settings.json') },
    { name: 'local', path: join(repoRoot, '.claude', 'settings.local.json') },
    { name: 'user', path: join(homeDir, '.claude', 'settings.json') },
  ];

  const result = new Map();

  // Process in reverse priority so higher scopes overwrite
  for (const scope of [...scopes].reverse()) {
    const enabled = readEnabledPlugins(scope.path);
    for (const key of enabled) {
      result.set(key, scope.name);
    }
  }

  // Now process again in priority order to ensure highest scope wins
  for (const scope of scopes) {
    const enabled = readEnabledPlugins(scope.path);
    for (const key of enabled) {
      result.set(key, scope.name);
    }
  }

  return result;
}

/**
 * List all plugins with their enabled/disabled status.
 * Returns array of { name, status, scope, version, description, path, category, tags }.
 */
export function listPlugins(cwd = process.cwd()) {
  const marketplace = getMarketplace(cwd);
  const marketplaceName = marketplace.name || 'unknown';
  const enabledMap = getEnabledPluginsWithScope(cwd);

  return (marketplace.plugins || []).map((plugin) => {
    const key = `${plugin.name}@${marketplaceName}`;
    const isEnabled = enabledMap.has(key);
    const scope = isEnabled ? enabledMap.get(key) : null;

    return {
      name: plugin.name,
      status: isEnabled ? 'enabled' : 'disabled',
      scope: scope || '-',
      version: plugin.version || '0.0.0',
      description: plugin.description || '',
      path: plugin.source || '',
      category: plugin.category || '',
      tags: plugin.tags || [],
    };
  });
}

/**
 * Find a plugin by name in the marketplace.
 */
export function findPlugin(name, cwd = process.cwd()) {
  const marketplace = getMarketplace(cwd);
  return (marketplace.plugins || []).find((p) => p.name === name) || null;
}
