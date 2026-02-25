import { existsSync, readFileSync, writeFileSync, rmSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { findRepoRoot, findWorkbenchContext, findAllWorkbenches } from './context.js';
import { getLatestVersion, compareSemver, downloadPrimitive } from './registry.js';

/**
 * Check primitive status for a single workbench.
 * Returns { workbench, path, primitives: [{ name, pinned, latest, status }] }.
 *
 * status is one of: CURRENT, BEHIND, UNKNOWN
 */
export function checkWorkbenchPrimitives(workbenchInfo) {
  const { config, name, relativePath } = workbenchInfo;
  const pinned = config.primitives || {};
  const primitives = [];

  for (const [primName, pinnedVersion] of Object.entries(pinned)) {
    // Strip leading 'v' if present (workbench.json stores "v1.0.0")
    const cleanPinned = pinnedVersion.replace(/^v/, '');

    let latest = null;
    let status = 'UNKNOWN';

    try {
      latest = getLatestVersion(primName);
      if (latest) {
        const cmp = compareSemver(cleanPinned, latest);
        status = cmp >= 0 ? 'CURRENT' : 'BEHIND';
      }
    } catch {
      // Registry failure — mark as UNKNOWN, continue
      status = 'UNKNOWN';
    }

    primitives.push({
      name: primName,
      pinned: cleanPinned,
      latest: latest || 'unknown',
      status,
    });
  }

  return {
    workbench: name,
    path: relativePath,
    primitives,
  };
}

/**
 * Check primitive status across workbenches.
 *
 * If `all` is true, scans all workbenches in the repo.
 * Otherwise, checks only the current workbench context.
 *
 * Returns { results: [...], summary: { total, current, behind, unknown } }.
 */
export function checkAllPrimitives({ all = false, cwd = process.cwd() } = {}) {
  let workbenches;

  if (all) {
    workbenches = findAllWorkbenches(cwd);
  } else {
    const ctx = findWorkbenchContext(cwd);
    if (ctx) {
      const name = ctx.relativePath.split('/').pop();
      workbenches = [{ name, relativePath: ctx.relativePath, config: ctx.config }];
    } else {
      // Not inside a workbench — fall back to all
      workbenches = findAllWorkbenches(cwd);
    }
  }

  // Filter to workbenches that have primitives
  const withPrimitives = workbenches.filter(
    (wb) => wb.config.primitives && Object.keys(wb.config.primitives).length > 0
  );

  const results = withPrimitives.map((wb) => checkWorkbenchPrimitives(wb));

  // Summary
  let total = 0, current = 0, behind = 0, unknown = 0;
  for (const r of results) {
    for (const p of r.primitives) {
      total++;
      if (p.status === 'CURRENT') current++;
      else if (p.status === 'BEHIND') behind++;
      else unknown++;
    }
  }

  return { results, summary: { total, current, behind, unknown } };
}

/**
 * Detect the installed version of a primitive by reading its SKILL.md frontmatter
 * or checking a .version marker file. Returns version string or null.
 */
function detectInstalledVersion(skillDir) {
  // Check .primitive-version marker (written by install)
  const markerPath = join(skillDir, '.primitive-version');
  if (existsSync(markerPath)) {
    return readFileSync(markerPath, 'utf-8').trim();
  }
  return null;
}

/**
 * Install primitives for a workbench.
 *
 * Options:
 *   update: bump workbench.json pins to latest before installing
 *   dryRun: preview without writing
 *
 * Returns { workbench, actions: [{ name, action, version, ... }] }
 */
export function installPrimitives(workbenchInfo, { update = false, dryRun = false } = {}) {
  const { config, name, relativePath, path: wbPath } = workbenchInfo;
  const primitives = config.primitives || {};
  const actions = [];

  if (Object.keys(primitives).length === 0) {
    return { workbench: name, path: relativePath, actions };
  }

  // If --update, bump pins to latest
  const pins = { ...primitives };
  if (update) {
    for (const primName of Object.keys(pins)) {
      try {
        const latest = getLatestVersion(primName);
        if (latest) {
          pins[primName] = `v${latest}`;
        }
      } catch {
        // Can't resolve latest — keep current pin
      }
    }
  }

  for (const [primName, pinnedVersion] of Object.entries(pins)) {
    const cleanVersion = pinnedVersion.replace(/^v/, '');
    const skillDir = join(wbPath, 'skills', primName);
    const installed = existsSync(skillDir) ? detectInstalledVersion(skillDir) : null;

    if (installed === cleanVersion) {
      actions.push({ name: primName, action: 'skipped', version: cleanVersion, reason: 'already installed' });
      continue;
    }

    if (dryRun) {
      const action = installed ? 'would_update' : 'would_install';
      actions.push({ name: primName, action, version: cleanVersion, from: installed });
      continue;
    }

    // Download to temp dir first (atomic)
    const tmpDir = join(tmpdir(), `agonda-install-${primName}-${Date.now()}`);
    try {
      downloadPrimitive(primName, cleanVersion, tmpDir);

      const downloadedDir = join(tmpDir, primName);
      if (!existsSync(downloadedDir)) {
        actions.push({ name: primName, action: 'failed', version: cleanVersion, reason: 'download produced no files' });
        continue;
      }

      // Remove existing and move new into place
      if (existsSync(skillDir)) {
        rmSync(skillDir, { recursive: true, force: true });
      }
      mkdirSync(dirname(skillDir), { recursive: true });
      renameSync(downloadedDir, skillDir);

      // Write version marker
      writeFileSync(join(skillDir, '.primitive-version'), cleanVersion);

      const action = installed ? 'updated' : 'installed';
      actions.push({ name: primName, action, version: cleanVersion, from: installed });
    } catch (err) {
      actions.push({ name: primName, action: 'failed', version: cleanVersion, reason: err.message });
    } finally {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  }

  // If --update, write back updated pins to workbench.json
  if (update && !dryRun) {
    const wbJsonPath = join(wbPath, 'workbench.json');
    const wbJson = JSON.parse(readFileSync(wbJsonPath, 'utf-8'));
    wbJson.primitives = pins;
    writeFileSync(wbJsonPath, JSON.stringify(wbJson, null, 2) + '\n');
  }

  return { workbench: name, path: relativePath, actions };
}

/**
 * Update a specific primitive to latest in one or more workbenches.
 *
 * Returns array of { workbench, path, action, name, from, to }.
 */
export function updatePrimitive(primitiveName, workbenches, { dryRun = false } = {}) {
  const latest = getLatestVersion(primitiveName);
  if (!latest) {
    return { primitive: primitiveName, error: 'not_found', results: [] };
  }

  const results = [];

  for (const wb of workbenches) {
    const pins = wb.config.primitives || {};
    if (!(primitiveName in pins)) continue;

    const currentPin = pins[primitiveName].replace(/^v/, '');

    if (compareSemver(currentPin, latest) >= 0) {
      results.push({
        workbench: wb.name,
        path: wb.relativePath,
        action: 'current',
        name: primitiveName,
        from: currentPin,
        to: latest,
      });
      continue;
    }

    if (dryRun) {
      results.push({
        workbench: wb.name,
        path: wb.relativePath,
        action: 'would_update',
        name: primitiveName,
        from: currentPin,
        to: latest,
      });
      continue;
    }

    // Update pin in workbench.json
    const wbJsonPath = join(wb.path, 'workbench.json');
    const wbJson = JSON.parse(readFileSync(wbJsonPath, 'utf-8'));
    wbJson.primitives[primitiveName] = `v${latest}`;
    writeFileSync(wbJsonPath, JSON.stringify(wbJson, null, 2) + '\n');

    // Re-install at new version
    const installResult = installPrimitives(
      { ...wb, config: wbJson },
      { dryRun: false }
    );

    const installAction = installResult.actions.find((a) => a.name === primitiveName);
    results.push({
      workbench: wb.name,
      path: wb.relativePath,
      action: installAction?.action || 'updated',
      name: primitiveName,
      from: currentPin,
      to: latest,
    });
  }

  return { primitive: primitiveName, latest, results };
}
