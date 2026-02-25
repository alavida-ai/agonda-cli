import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findRepoRoot } from './context.js';
import { output } from '../utils/output.js';

/**
 * Parse a .workbench marker file (simple key: value YAML).
 * Returns an object with parsed fields, or null if malformed.
 */
function parseWorkbenchMarker(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const result = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;
      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();
      result[key] = value;
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Recursively find all .workbench marker files under a directory.
 */
function findMarkerFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    // Skip .claude/worktrees/ — temporary agent isolation, not canonical locations
    if (entry.name === 'worktrees' && dir.endsWith('.claude')) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMarkerFiles(fullPath));
    } else if (entry.name === '.workbench') {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Discover all active workspaces by scanning for .workbench markers.
 * Returns array of { name, path, workbench, domain, created, ... }.
 */
export function discoverWorkspaces(cwd = process.cwd()) {
  const repoRoot = findRepoRoot(cwd);
  const activeDir = join(repoRoot, 'workspace', 'active');

  if (!existsSync(activeDir)) {
    return [];
  }

  const markerFiles = findMarkerFiles(activeDir);
  const workspaces = [];

  for (const markerPath of markerFiles) {
    const wsDir = join(markerPath, '..');
    const parsed = parseWorkbenchMarker(markerPath);

    if (!parsed) {
      output.status(`Warning: Could not parse ${relative(repoRoot, markerPath)}`);
      continue;
    }

    // Derive name from directory path relative to workspace/active/
    const relPath = relative(activeDir, wsDir);
    const name = relPath.replace(/\//g, '/');

    workspaces.push({
      name,
      path: relative(repoRoot, wsDir),
      workbench: parsed.workbench || 'unknown',
      domain: parsed.domain || 'unknown',
      created: parsed.created || 'unknown',
      ...parsed,
    });
  }

  return workspaces.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Find workspaces matching a specific workbench name.
 * Returns ALL matches (solving the head -1 problem from learnings).
 */
export function findWorkspacesByWorkbench(workbenchName, cwd = process.cwd()) {
  const all = discoverWorkspaces(cwd);
  return all.filter((ws) => ws.workbench === workbenchName);
}

/**
 * Find directories under workspace/active/ that lack a .workbench marker.
 * These are invisible to workspace discovery and should be flagged.
 * Only checks immediate children of workspace/active/ subdirectories.
 */
export function findUnmarkedWorkspaces(cwd = process.cwd()) {
  const repoRoot = findRepoRoot(cwd);
  const activeDir = join(repoRoot, 'workspace', 'active');

  if (!existsSync(activeDir)) return [];

  const markedPaths = new Set(
    discoverWorkspaces(cwd).map((ws) => ws.path)
  );

  const unmarked = [];

  // Scan leaf directories under workspace/active/ (two levels: category/name)
  let categories;
  try {
    categories = readdirSync(activeDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const cat of categories) {
    if (!cat.isDirectory() || cat.name.startsWith('.')) continue;
    const catDir = join(activeDir, cat.name);
    let entries;
    try {
      entries = readdirSync(catDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const dirPath = relative(repoRoot, join(catDir, entry.name));
      if (!markedPaths.has(dirPath)) {
        unmarked.push({
          name: `${cat.name}/${entry.name}`,
          path: dirPath,
        });
      }
    }
  }

  return unmarked;
}
