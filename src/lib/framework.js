import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { findRepoRoot } from './context.js';
import { NetworkError, NotFoundError } from '../utils/errors.js';

const PACKAGE_NAME = '@alavida-ai/agonda-framework';
const MANIFEST_DIR = '.agonda';
const MANIFEST_FILE = 'manifest.json';
const STATUS_FILE = 'status.json';

/**
 * Read .agonda/manifest.json from an instance repo.
 * Returns parsed manifest or null if missing.
 */
export function readInstanceManifest(repoRoot) {
  const manifestPath = join(repoRoot, MANIFEST_DIR, MANIFEST_FILE);
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, 'utf-8'));
}

/**
 * Write .agonda/manifest.json to an instance repo.
 * Creates .agonda/ directory if needed.
 */
export function writeInstanceManifest(repoRoot, manifest) {
  const dir = join(repoRoot, MANIFEST_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(
    join(dir, MANIFEST_FILE),
    JSON.stringify(manifest, null, 2) + '\n'
  );
}

/**
 * Fetch the framework package via npm install into a temp directory.
 * Returns { packageDir, manifest } where packageDir is the installed package root
 * and manifest is the parsed manifest.json from the package.
 *
 * Throws NetworkError on npm failure, NotFoundError if package not found.
 */
export function fetchFrameworkPackage(version) {
  const tmpDir = join(tmpdir(), `agonda-framework-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  const spec = version ? `${PACKAGE_NAME}@${version}` : PACKAGE_NAME;

  try {
    execFileSync('npm', [
      'install', '--prefix', tmpDir,
      '--registry', 'https://npm.pkg.github.com',
      spec,
    ], {
      encoding: 'utf-8',
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    // Clean up on failure
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    const stderr = err.stderr || '';
    if (stderr.includes('404') || stderr.includes('not found') || stderr.includes('No matching version')) {
      throw new NotFoundError(
        `Package ${spec} not found in GitHub Packages registry.`,
        { code: 'package_not_found', suggestion: 'Check the version exists: npm view @alavida-ai/agonda-framework versions --registry https://npm.pkg.github.com' }
      );
    }
    throw new NetworkError(
      `Failed to fetch ${spec}: ${stderr.trim() || err.message}`,
      { code: 'npm_fetch_failed', suggestion: 'Check your network connection and .npmrc auth for GitHub Packages' }
    );
  }

  const packageDir = join(tmpDir, 'node_modules', PACKAGE_NAME);
  if (!existsSync(packageDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
    throw new NotFoundError(
      `Package installed but directory not found at expected path.`,
      { code: 'package_dir_missing' }
    );
  }

  const manifestPath = join(packageDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    rmSync(tmpDir, { recursive: true, force: true });
    throw new NotFoundError(
      `Package missing manifest.json — not a valid Agonda framework package.`,
      { code: 'invalid_package' }
    );
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  return { packageDir, manifest, tmpDir };
}

/**
 * SHA256 hash of file content. Returns hex string.
 */
export function hashFile(absPath) {
  const content = readFileSync(absPath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Detect drift between on-disk files and the instance manifest.
 * Returns a Map<path, { expected, actual, status }>.
 *
 * Status: CURRENT | DRIFTED | MISSING
 */
export function detectDrift(repoRoot, instanceManifest) {
  const drift = new Map();
  const files = instanceManifest.files || {};

  for (const [filePath, meta] of Object.entries(files)) {
    const absPath = join(repoRoot, filePath);
    if (!existsSync(absPath)) {
      drift.set(filePath, { expected: meta.sha256, actual: null, status: 'MISSING' });
      continue;
    }
    const actual = hashFile(absPath);
    const status = actual === meta.sha256 ? 'CURRENT' : 'DRIFTED';
    drift.set(filePath, { expected: meta.sha256, actual, status });
  }

  return drift;
}

/**
 * Plan an upgrade by comparing old and new manifests plus drift info.
 * Returns { added[], changed[], removed[], drifted[] }.
 *
 * - added: files in new but not old
 * - changed: files in both but with different hashes in the package
 * - removed: files in old but not new
 * - drifted: files that are both changed in the package AND modified locally
 */
export function planUpgrade(oldManifest, newManifest, drift) {
  const oldFiles = oldManifest ? (oldManifest.files || {}) : {};
  const newFiles = newManifest.files || {};

  const added = [];
  const changed = [];
  const removed = [];
  const drifted = [];

  // Files in new manifest
  for (const filePath of Object.keys(newFiles)) {
    if (!(filePath in oldFiles)) {
      added.push(filePath);
    } else if (newFiles[filePath].sha256 !== oldFiles[filePath].sha256) {
      // Framework changed this file
      if (drift && drift.has(filePath) && drift.get(filePath).status === 'DRIFTED') {
        drifted.push(filePath);
      } else {
        changed.push(filePath);
      }
    }
  }

  // Files in old but not new — check if user modified before flagging for removal
  for (const filePath of Object.keys(oldFiles)) {
    if (!(filePath in newFiles)) {
      if (drift && drift.has(filePath) && drift.get(filePath).status === 'DRIFTED') {
        drifted.push(filePath);
      } else {
        removed.push(filePath);
      }
    }
  }

  return { added, changed, removed, drifted };
}

/**
 * Apply an upgrade: copy files from package content dir to repo root.
 * Writes updated .agonda/manifest.json with new version + fresh hashes.
 */
export function applyUpgrade(repoRoot, packageDir, plan, newManifest) {
  const contentDir = join(packageDir, 'content');
  const newFiles = newManifest.files || {};

  // Copy added, changed, and drifted files that exist in the new package
  const toCopy = [...plan.added, ...plan.changed, ...plan.drifted].filter(
    (f) => f in newFiles
  );

  for (const filePath of toCopy) {
    const src = join(contentDir, filePath);
    const dest = join(repoRoot, filePath);

    const destDir = dirname(dest);
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    cpSync(src, dest);
  }

  // Delete files removed from the framework (including drifted removals forced through)
  const toDelete = [...plan.removed, ...plan.drifted.filter((f) => !(f in newFiles))];

  for (const filePath of toDelete) {
    const dest = join(repoRoot, filePath);
    if (existsSync(dest)) {
      unlinkSync(dest);
    }
  }

  // Build instance manifest with fresh on-disk hashes
  const files = {};
  for (const [filePath, meta] of Object.entries(newManifest.files || {})) {
    const absPath = join(repoRoot, filePath);
    if (existsSync(absPath)) {
      files[filePath] = { sha256: hashFile(absPath) };
    } else {
      // File was removed from package — skip
      files[filePath] = { sha256: meta.sha256 };
    }
  }

  const instanceManifest = {
    framework: {
      package: PACKAGE_NAME,
      version: newManifest.version,
      installed: new Date().toISOString(),
    },
    files,
  };

  writeInstanceManifest(repoRoot, instanceManifest);
  return instanceManifest;
}

/**
 * Get framework status for an instance repo.
 * Returns { installed, version, files, drifted, missing, status, lastHealthCheck }.
 */
export function frameworkStatus(cwd = process.cwd()) {
  const repoRoot = findRepoRoot(cwd);
  const manifest = readInstanceManifest(repoRoot);
  if (!manifest) {
    return { installed: false, version: null, files: 0, drifted: 0, missing: 0, status: 'NOT_INSTALLED', lastHealthCheck: null };
  }

  const drift = detectDrift(repoRoot, manifest);
  let driftedCount = 0;
  let missingCount = 0;
  for (const info of drift.values()) {
    if (info.status === 'DRIFTED') driftedCount++;
    if (info.status === 'MISSING') missingCount++;
  }

  // Read cached health check status if available
  let lastHealthCheck = null;
  const statusPath = join(repoRoot, MANIFEST_DIR, STATUS_FILE);
  if (existsSync(statusPath)) {
    try {
      lastHealthCheck = JSON.parse(readFileSync(statusPath, 'utf-8'));
    } catch {
      // Corrupt status file — ignore
    }
  }

  let status = 'CURRENT';
  if (driftedCount > 0 || missingCount > 0) {
    status = 'DRIFTED';
  }

  return {
    installed: true,
    version: manifest.framework.version,
    files: Object.keys(manifest.files).length,
    drifted: driftedCount,
    missing: missingCount,
    status,
    lastHealthCheck,
  };
}
