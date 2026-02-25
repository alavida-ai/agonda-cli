import { existsSync, readFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { NetworkError, ValidationError, NotFoundError } from '../utils/errors.js';

const SKILLS_REPO = 'alavida-ai/skills';

/**
 * Parse SKILL.md frontmatter and return { name, description, version }.
 * version may come from a `last-updated` or `version` field.
 */
export function parseSkillFrontmatter(skillMdPath) {
  if (!existsSync(skillMdPath)) {
    throw new ValidationError(
      `SKILL.md not found at ${skillMdPath}`,
      { code: 'skill_not_found' }
    );
  }

  const content = readFileSync(skillMdPath, 'utf-8');
  if (!content.startsWith('---')) {
    throw new ValidationError(
      'SKILL.md missing frontmatter',
      { code: 'missing_frontmatter' }
    );
  }

  const fmEnd = content.indexOf('---', 3);
  if (fmEnd === -1) {
    throw new ValidationError(
      'SKILL.md has unclosed frontmatter',
      { code: 'unclosed_frontmatter' }
    );
  }

  const fm = content.slice(3, fmEnd);
  const fields = {};
  for (const line of fm.split('\n')) {
    const match = line.match(/^(\w[\w-]*):\s*(.+)/);
    if (match) {
      let value = match[2].trim();
      // Strip quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      fields[match[1]] = value;
    }
  }

  if (!fields.name) {
    throw new ValidationError(
      'SKILL.md frontmatter missing "name" field',
      { code: 'missing_name' }
    );
  }
  if (!fields.description) {
    throw new ValidationError(
      'SKILL.md frontmatter missing "description" field',
      { code: 'missing_description' }
    );
  }

  return {
    name: fields.name,
    description: fields.description,
    version: fields.version || null,
  };
}

/**
 * Validate a skill directory for publishing.
 * Returns { name, version, path, files }.
 */
export function validateSkillForPublish(skillPath, { version: overrideVersion } = {}) {
  const resolved = resolve(skillPath);

  if (!existsSync(resolved)) {
    throw new NotFoundError(
      `Skill directory not found: ${skillPath}`,
      { code: 'skill_dir_not_found' }
    );
  }

  const skillMdPath = join(resolved, 'SKILL.md');
  const meta = parseSkillFrontmatter(skillMdPath);

  const version = overrideVersion || meta.version;
  if (!version) {
    throw new ValidationError(
      `No version found in SKILL.md frontmatter and no --version flag provided`,
      { code: 'no_version', suggestion: 'Add a "version" field to SKILL.md frontmatter or use --version' }
    );
  }

  // Validate semver format
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    throw new ValidationError(
      `Invalid version "${version}" — must be semver (e.g. 1.0.0)`,
      { code: 'invalid_version' }
    );
  }

  return {
    name: meta.name,
    description: meta.description,
    version,
    path: resolved,
  };
}

/**
 * Check that gh CLI is installed and authenticated.
 */
export function checkGhAuth() {
  try {
    execFileSync('gh', ['auth', 'status'], {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new NetworkError(
        'GitHub CLI (gh) is not installed.',
        { code: 'gh_not_installed', suggestion: 'Install gh: https://cli.github.com/' }
      );
    }
    const stderr = (err.stderr || '').toString();
    if (stderr.includes('not logged') || stderr.includes('no accounts')) {
      throw new NetworkError(
        'GitHub CLI is not authenticated.',
        { code: 'gh_not_authenticated', suggestion: 'Run "gh auth login" to authenticate' }
      );
    }
    // gh auth status exits non-zero but may still be fine — check stdout
    const stdout = (err.stdout || '').toString();
    if (stdout.includes('Logged in')) return;

    throw new NetworkError(
      `gh auth check failed: ${stderr.trim() || err.message}`,
      { code: 'gh_auth_error', suggestion: 'Run "gh auth status" to check your authentication' }
    );
  }
}

/**
 * Execute the publish workflow.
 * Returns { skill, branch, prUrl } on success.
 */
export function publishSkill(skill, { dryRun = false } = {}) {
  const { name, version, path: skillPath } = skill;
  const branch = `publish/${name}/v${version}`;

  if (dryRun) {
    return {
      skill: { name, version },
      branch,
      prUrl: null,
      dryRun: true,
      actions: [
        `Would clone ${SKILLS_REPO}`,
        `Would create branch ${branch}`,
        `Would copy ${skillPath} → ${name}/`,
        `Would commit "Publish ${name}@v${version}"`,
        `Would create PR to main`,
      ],
    };
  }

  // Clone skills repo to temp directory
  const tmpDir = mkdtempSync(join(tmpdir(), 'agonda-publish-'));

  try {
    execFileSync('gh', ['repo', 'clone', SKILLS_REPO, tmpDir, '--', '--depth=1'], {
      encoding: 'utf-8',
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Create branch
    execFileSync('git', ['checkout', '-b', branch], {
      cwd: tmpDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Copy skill directory
    const targetDir = join(tmpDir, name);
    cpSync(skillPath, targetDir, { recursive: true });

    // Commit
    execFileSync('git', ['add', '-A'], {
      cwd: tmpDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    execFileSync('git', ['commit', '-m', `Publish ${name}@v${version}`], {
      cwd: tmpDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Push
    execFileSync('git', ['push', '-u', 'origin', branch], {
      cwd: tmpDir,
      encoding: 'utf-8',
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Create PR
    const prOutput = execFileSync('gh', [
      'pr', 'create',
      '--repo', SKILLS_REPO,
      '--head', branch,
      '--title', `Publish ${name}@v${version}`,
      '--body', `Publishes \`${name}\` at version \`${version}\`.\n\nTag \`${name}/v${version}\` will be created automatically on merge.`,
    ], {
      cwd: tmpDir,
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const prUrl = prOutput.trim();

    return {
      skill: { name, version },
      branch,
      prUrl,
      dryRun: false,
    };
  } catch (err) {
    throw new NetworkError(
      `Publish failed: ${(err.stderr || err.message || '').toString().trim()}`,
      { code: 'publish_failed', suggestion: 'Check your network connection and gh auth status' }
    );
  } finally {
    // Clean up temp directory
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
