import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { NetworkError, NotFoundError } from '../utils/errors.js';

const REPO = 'alavida-ai/skills';

/**
 * Session-level tag cache. Populated on first API call, reused for
 * all subsequent calls within the same process.
 */
let tagCache = null;

/**
 * Run `gh api` and return parsed JSON.
 * Throws NetworkError on failure or if gh is not installed.
 */
function ghApi(endpoint) {
  try {
    const result = execFileSync('gh', ['api', endpoint], {
      encoding: 'utf-8',
      timeout: 30000,
    });
    return JSON.parse(result);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new NetworkError(
        'GitHub CLI (gh) is not installed.',
        { code: 'gh_not_installed', suggestion: 'Install gh: https://cli.github.com/' }
      );
    }
    const stderr = err.stderr || '';
    if (stderr.includes('HTTP 404') || stderr.includes('Not Found')) {
      throw new NotFoundError(
        `GitHub API returned 404 for ${endpoint}`,
        { code: 'github_not_found' }
      );
    }
    throw new NetworkError(
      `GitHub API call failed: ${stderr.trim() || err.message}`,
      { code: 'github_api_error', suggestion: 'Check your network connection and gh auth status' }
    );
  }
}

/**
 * Parse a prefixed tag into { primitive, version }.
 * e.g. "visual-explainer/v1.0.0" → { primitive: "visual-explainer", version: "1.0.0" }
 * Returns null if the tag doesn't match the expected format.
 */
export function parseTag(tagName) {
  const match = tagName.match(/^(.+)\/v(\d+\.\d+\.\d+.*)$/);
  if (!match) return null;
  return { primitive: match[1], version: match[2] };
}

/**
 * Compare two semver strings. Returns negative if a < b, positive if a > b, 0 if equal.
 */
export function compareSemver(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

/**
 * Fetch all tags from the skills repo (cached per session).
 * Returns array of { name, sha }.
 */
function fetchTags() {
  if (tagCache) return tagCache;

  const tags = [];
  let page = 1;
  while (true) {
    const batch = ghApi(`repos/${REPO}/tags?per_page=100&page=${page}`);
    if (!batch.length) break;
    tags.push(...batch.map((t) => ({ name: t.name, sha: t.commit.sha })));
    if (batch.length < 100) break;
    page++;
  }

  tagCache = tags;
  return tags;
}

/**
 * Get all versions available for a primitive, sorted descending (newest first).
 */
export function getAllVersions(primitiveName) {
  const tags = fetchTags();
  return tags
    .map((t) => parseTag(t.name))
    .filter((p) => p && p.primitive === primitiveName)
    .map((p) => p.version)
    .sort((a, b) => compareSemver(b, a));
}

/**
 * Get the latest (highest semver) version for a primitive.
 * Returns the version string (e.g. "2.0.0") or null if not found.
 */
export function getLatestVersion(primitiveName) {
  const versions = getAllVersions(primitiveName);
  return versions.length > 0 ? versions[0] : null;
}

/**
 * List all unique primitive names from tags.
 * Returns sorted array of names.
 */
export function listPrimitives() {
  const tags = fetchTags();
  const names = new Set();
  for (const tag of tags) {
    const parsed = parseTag(tag.name);
    if (parsed) names.add(parsed.primitive);
  }
  return [...names].sort();
}

/**
 * Download a primitive's skill directory at a specific version into targetDir.
 * Uses the tarball API and extracts only the skills/{name}/ subtree.
 */
export function downloadPrimitive(primitiveName, version, targetDir) {
  const tagRef = `${primitiveName}/v${version}`;

  const tags = fetchTags();
  const exists = tags.some((t) => t.name === tagRef);
  if (!exists) {
    throw new NotFoundError(
      `Tag "${tagRef}" not found in ${REPO}.`,
      { code: 'tag_not_found', suggestion: `Run "agonda primitives status" to see available versions` }
    );
  }

  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  try {
    execFileSync('sh', [
      '-c',
      `gh api "repos/${REPO}/tarball/refs/tags/${tagRef}" | tar xz --strip-components=2 -C "${targetDir}" "*/skills/${primitiveName}/"`,
    ], {
      encoding: 'utf-8',
      timeout: 60000,
    });
  } catch (err) {
    throw new NetworkError(
      `Failed to download ${primitiveName}@${version}: ${err.message}`,
      { code: 'download_failed', suggestion: 'Check your network connection and gh auth status' }
    );
  }

  return { primitive: primitiveName, version, targetDir };
}

/**
 * Seed the tag cache with pre-fetched data (for testing).
 */
export function seedCache(tags) {
  tagCache = tags;
}

/**
 * Clear the session tag cache.
 */
export function clearCache() {
  tagCache = null;
}
