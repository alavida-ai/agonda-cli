import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from './context.js';
import { NotFoundError } from '../utils/errors.js';

/**
 * Read and parse a JSON file, returning null if missing or malformed.
 */
export function readJsonSafe(filePath) {
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
 * Get the marketplace name.
 */
export function getMarketplaceName(cwd = process.cwd()) {
  const marketplace = getMarketplace(cwd);
  return marketplace.name || 'unknown';
}

/**
 * List all workbenches from the marketplace.
 * Returns array of { name, version, description, source, category, tags }.
 * No enabled/disabled state — that's Claude's domain now.
 */
export function listWorkbenches(cwd = process.cwd()) {
  const marketplace = getMarketplace(cwd);

  return (marketplace.plugins || []).map((plugin) => ({
    name: plugin.name,
    version: plugin.version || '0.0.0',
    description: plugin.description || '',
    source: plugin.source || '',
    category: plugin.category || '',
    tags: plugin.tags || [],
  }));
}

/**
 * Find a workbench by name in the marketplace.
 */
export function findWorkbench(name, cwd = process.cwd()) {
  const marketplace = getMarketplace(cwd);
  return (marketplace.plugins || []).find((p) => p.name === name) || null;
}
