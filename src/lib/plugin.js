import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
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
 * Returns array of { name, status, scope, version, description, path, category, tags, source }.
 * Includes both marketplace plugins and external (user/local-scoped) plugins.
 */
export function listPlugins(cwd = process.cwd()) {
  const marketplace = getMarketplace(cwd);
  const marketplaceName = marketplace.name || 'unknown';
  const enabledMap = getEnabledPluginsWithScope(cwd);

  // Track which enabled keys are accounted for by the marketplace
  const accountedKeys = new Set();

  const marketplacePlugins = (marketplace.plugins || []).map((plugin) => {
    const key = `${plugin.name}@${marketplaceName}`;
    accountedKeys.add(key);
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
      source: 'marketplace',
    };
  });

  // Find enabled plugins NOT in the marketplace (external/user-scoped)
  const externalPlugins = [];
  for (const [key, scope] of enabledMap) {
    if (accountedKeys.has(key)) continue;
    // Parse the key — format is "name@marketplace" or just a path
    const atIdx = key.lastIndexOf('@');
    const name = atIdx > 0 ? key.slice(0, atIdx) : key;

    externalPlugins.push({
      name,
      status: 'enabled',
      scope,
      version: '-',
      description: '',
      path: '',
      category: '',
      tags: [],
      source: 'external',
    });
  }

  return [...marketplacePlugins, ...externalPlugins];
}

/**
 * Find a plugin by name in the marketplace.
 */
export function findPlugin(name, cwd = process.cwd()) {
  const marketplace = getMarketplace(cwd);
  return (marketplace.plugins || []).find((p) => p.name === name) || null;
}

/**
 * Resolve the settings file path for a given scope.
 */
export function getSettingsPath(scope, cwd = process.cwd()) {
  const repoRoot = findRepoRoot(cwd);
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';

  switch (scope) {
    case 'project': return join(repoRoot, '.claude', 'settings.json');
    case 'local': return join(repoRoot, '.claude', 'settings.local.json');
    case 'user': return join(homeDir, '.claude', 'settings.json');
    default: return join(repoRoot, '.claude', 'settings.json');
  }
}

/**
 * Read a settings file, creating it if needed. Returns the parsed object.
 */
function readSettings(filePath) {
  const existing = readJsonSafe(filePath);
  return existing || {};
}

/**
 * Write settings back to file, preserving all existing keys.
 */
function writeSettings(filePath, settings) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(settings, null, 4) + '\n');
}

/**
 * Set a plugin's enabled state in the specified scope.
 * Returns { plugin, key, action, scope, file, alreadyInState }.
 */
export function setPluginState(name, enabled, { scope = 'project', cwd = process.cwd() } = {}) {
  const plugin = findPlugin(name, cwd);
  if (!plugin) {
    throw new NotFoundError(
      `Plugin "${name}" not found in marketplace.`,
      { code: 'plugin_not_found', suggestion: 'Run "agonda plugin list" to see available plugins' }
    );
  }

  const marketplaceName = getMarketplaceName(cwd);
  const key = `${name}@${marketplaceName}`;
  const filePath = getSettingsPath(scope, cwd);
  const settings = readSettings(filePath);

  if (!settings.enabledPlugins) settings.enabledPlugins = {};

  const currentState = settings.enabledPlugins[key] === true;
  const alreadyInState = currentState === enabled;

  settings.enabledPlugins[key] = enabled;
  writeSettings(filePath, settings);

  return {
    plugin: name,
    key,
    action: enabled ? 'enabled' : 'disabled',
    scope,
    file: filePath,
    alreadyInState,
  };
}

/**
 * Switch to a single plugin — disable all others, enable the target.
 * Optionally keep specific plugins enabled.
 *
 * Returns { enabled, disabled, kept }.
 */
export function switchPlugin(targetName, { keep = [], scope = 'project', cwd = process.cwd() } = {}) {
  const plugin = findPlugin(targetName, cwd);
  if (!plugin) {
    throw new NotFoundError(
      `Plugin "${targetName}" not found in marketplace.`,
      { code: 'plugin_not_found', suggestion: 'Run "agonda plugin list" to see available plugins' }
    );
  }

  // Validate --keep names exist
  for (const k of keep) {
    if (!findPlugin(k, cwd)) {
      throw new NotFoundError(
        `Keep plugin "${k}" not found in marketplace.`,
        { code: 'plugin_not_found', suggestion: 'Run "agonda plugin list" to see available plugins' }
      );
    }
  }

  const marketplace = getMarketplace(cwd);
  const marketplaceName = marketplace.name || 'unknown';
  const filePath = getSettingsPath(scope, cwd);
  const settings = readSettings(filePath);

  if (!settings.enabledPlugins) settings.enabledPlugins = {};

  const keepSet = new Set(keep);
  const enabled = [];
  const disabled = [];
  const kept = [];

  for (const p of marketplace.plugins) {
    const key = `${p.name}@${marketplaceName}`;
    const wasEnabled = settings.enabledPlugins[key] === true;

    if (p.name === targetName) {
      settings.enabledPlugins[key] = true;
      enabled.push(p.name);
    } else if (keepSet.has(p.name)) {
      // Preserve current state, or enable if not yet
      if (!wasEnabled) settings.enabledPlugins[key] = true;
      kept.push(p.name);
    } else if (wasEnabled) {
      settings.enabledPlugins[key] = false;
      disabled.push(p.name);
    }
  }

  writeSettings(filePath, settings);

  return { enabled, disabled, kept, scope, file: filePath };
}

/**
 * Clear Claude Code's plugin cache for specific plugins.
 *
 * Only clears the cache directory at ~/.claude/plugins/cache/{marketplace}/{plugin-name}/.
 * Does NOT modify installed_plugins.json — that registry tracks per-project associations
 * (including worktree paths) and modifying it can break cross-worktree plugin resolution.
 *
 * Claude Code will re-install from the marketplace source on next session start when
 * it finds the cache directory missing but the plugin still registered.
 *
 * Returns { cleared: string[], errors: string[] }.
 */
export function clearPluginCache(pluginNames, { cwd = process.cwd() } = {}) {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const marketplaceName = getMarketplaceName(cwd);
  const cacheBase = join(homeDir, '.claude', 'plugins', 'cache', marketplaceName);

  const cleared = [];
  const errors = [];

  for (const name of pluginNames) {
    const pluginCacheDir = join(cacheBase, name);
    if (existsSync(pluginCacheDir)) {
      try {
        rmSync(pluginCacheDir, { recursive: true, force: true });
        cleared.push(name);
      } catch (err) {
        errors.push(`${name}: ${err.message}`);
      }
    }
  }

  return { cleared, errors };
}
