import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseSkillFrontmatter,
  validateSkillForPublish,
  publishSkill,
} from '../src/lib/publish.js';

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'publish-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function createSkillDir(name, frontmatter) {
  const skillDir = join(tmpDir, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), frontmatter);
  return skillDir;
}

describe('parseSkillFrontmatter', () => {
  it('parses valid frontmatter', () => {
    const dir = createSkillDir('test-skill', `---
name: test-skill
description: A test skill
version: 1.0.0
---
# Test Skill
`);
    const result = parseSkillFrontmatter(join(dir, 'SKILL.md'));
    assert.equal(result.name, 'test-skill');
    assert.equal(result.description, 'A test skill');
    assert.equal(result.version, '1.0.0');
  });

  it('returns null version when not present', () => {
    const dir = createSkillDir('no-version', `---
name: no-version
description: No version field
---
# No Version
`);
    const result = parseSkillFrontmatter(join(dir, 'SKILL.md'));
    assert.equal(result.name, 'no-version');
    assert.equal(result.version, null);
  });

  it('throws for missing SKILL.md', () => {
    assert.throws(
      () => parseSkillFrontmatter(join(tmpDir, 'nonexistent', 'SKILL.md')),
      (err) => err.code === 'skill_not_found'
    );
  });

  it('throws for missing frontmatter', () => {
    const dir = createSkillDir('no-fm', '# Just a heading\n');
    assert.throws(
      () => parseSkillFrontmatter(join(dir, 'SKILL.md')),
      (err) => err.code === 'missing_frontmatter'
    );
  });

  it('throws for unclosed frontmatter', () => {
    const dir = createSkillDir('unclosed', '---\nname: foo\n');
    assert.throws(
      () => parseSkillFrontmatter(join(dir, 'SKILL.md')),
      (err) => err.code === 'unclosed_frontmatter'
    );
  });

  it('throws for missing name field', () => {
    const dir = createSkillDir('no-name', `---
description: Has description but no name
---
`);
    assert.throws(
      () => parseSkillFrontmatter(join(dir, 'SKILL.md')),
      (err) => err.code === 'missing_name'
    );
  });

  it('throws for missing description field', () => {
    const dir = createSkillDir('no-desc', `---
name: has-name
---
`);
    assert.throws(
      () => parseSkillFrontmatter(join(dir, 'SKILL.md')),
      (err) => err.code === 'missing_description'
    );
  });

  it('strips quotes from values', () => {
    const dir = createSkillDir('quoted', `---
name: "quoted-skill"
description: 'A quoted description'
version: "2.0.0"
---
`);
    const result = parseSkillFrontmatter(join(dir, 'SKILL.md'));
    assert.equal(result.name, 'quoted-skill');
    assert.equal(result.description, 'A quoted description');
    assert.equal(result.version, '2.0.0');
  });
});

describe('validateSkillForPublish', () => {
  it('validates a complete skill directory', () => {
    const dir = createSkillDir('valid-skill', `---
name: valid-skill
description: A valid skill
version: 1.2.0
---
# Valid Skill
`);
    const result = validateSkillForPublish(dir);
    assert.equal(result.name, 'valid-skill');
    assert.equal(result.version, '1.2.0');
    assert.equal(result.path, dir);
  });

  it('uses --version override', () => {
    const dir = createSkillDir('override', `---
name: override-skill
description: Override test
version: 1.0.0
---
`);
    const result = validateSkillForPublish(dir, { version: '3.0.0' });
    assert.equal(result.version, '3.0.0');
  });

  it('throws for non-existent directory', () => {
    assert.throws(
      () => validateSkillForPublish(join(tmpDir, 'ghost')),
      (err) => err.code === 'skill_dir_not_found'
    );
  });

  it('throws when no version available', () => {
    const dir = createSkillDir('no-ver', `---
name: no-ver
description: No version
---
`);
    assert.throws(
      () => validateSkillForPublish(dir),
      (err) => err.code === 'no_version'
    );
  });

  it('throws for invalid semver', () => {
    const dir = createSkillDir('bad-ver', `---
name: bad-ver
description: Bad version
version: abc
---
`);
    assert.throws(
      () => validateSkillForPublish(dir),
      (err) => err.code === 'invalid_version'
    );
  });
});

describe('publishSkill dry run', () => {
  it('returns planned actions without executing', () => {
    const dir = createSkillDir('dry-run-skill', `---
name: dry-run-skill
description: Dry run test
version: 1.0.0
---
`);
    const skill = validateSkillForPublish(dir);
    const result = publishSkill(skill, { dryRun: true });

    assert.equal(result.dryRun, true);
    assert.equal(result.prUrl, null);
    assert.equal(result.branch, 'publish/dry-run-skill/v1.0.0');
    assert.equal(result.skill.name, 'dry-run-skill');
    assert.equal(result.skill.version, '1.0.0');
    assert.ok(result.actions.length > 0);
  });
});
