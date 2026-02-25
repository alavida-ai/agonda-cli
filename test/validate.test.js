import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateWorkbench } from '../src/lib/validate.js';

const TMP = join(tmpdir(), `agonda-validate-test-${Date.now()}`);

before(() => {
  mkdirSync(join(TMP, '.git'), { recursive: true });

  // Good workbench
  const goodWb = join(TMP, 'good-wb');
  mkdirSync(join(goodWb, '.claude-plugin'), { recursive: true });
  mkdirSync(join(goodWb, 'skills', 'my-skill', 'references'), { recursive: true });
  mkdirSync(join(goodWb, 'hooks'), { recursive: true });
  writeFileSync(join(goodWb, 'workbench.json'), JSON.stringify({ primitives: {} }));
  writeFileSync(join(goodWb, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'good', description: 'Good plugin' }));
  writeFileSync(join(goodWb, 'skills', 'my-skill', 'SKILL.md'), '---\nname: my-skill\ndescription: A good skill\n---\n# My Skill\n');
  writeFileSync(join(goodWb, 'hooks', 'hooks.json'), JSON.stringify({}));

  // Bad workbench — missing SKILL.md, bad plugin.json, missing rationale
  const badWb = join(TMP, 'bad-wb');
  mkdirSync(join(badWb, '.claude-plugin'), { recursive: true });
  mkdirSync(join(badWb, 'skills', 'broken-skill'), { recursive: true });
  mkdirSync(join(badWb, 'skills', 'no-frontmatter'), { recursive: true });
  mkdirSync(join(badWb, 'hooks'), { recursive: true });
  writeFileSync(join(badWb, 'workbench.json'), JSON.stringify({ primitives: {} }));
  writeFileSync(join(badWb, '.claude-plugin', 'plugin.json'), JSON.stringify({})); // missing name
  // broken-skill has no SKILL.md
  writeFileSync(join(badWb, 'skills', 'no-frontmatter', 'SKILL.md'), '# No Frontmatter\nJust content.');
  writeFileSync(join(badWb, 'hooks', 'hooks.json'), JSON.stringify({
    PreToolUse: [{ hooks: [{ command: '/nonexistent/script.sh' }] }],
  }));

  // Cross-workbench path workbench
  const crossWb = join(TMP, 'cross-wb');
  mkdirSync(join(crossWb, 'skills', 'ref-skill'), { recursive: true });
  writeFileSync(join(crossWb, 'workbench.json'), JSON.stringify({ primitives: {} }));
  writeFileSync(join(crossWb, 'skills', 'ref-skill', 'SKILL.md'), '---\nname: ref-skill\ndescription: References other workbench\n---\nSee ../other-workbench/skills/foo for details.');
});

after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('validateWorkbench', () => {
  it('validates a clean workbench with no errors', () => {
    const result = validateWorkbench(join(TMP, 'good-wb'), TMP);
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 0);
  });

  it('detects missing plugin.json name', () => {
    const result = validateWorkbench(join(TMP, 'bad-wb'), TMP);
    assert.ok(result.errors.some((e) => e.includes('missing "name"')));
  });

  it('detects missing SKILL.md', () => {
    const result = validateWorkbench(join(TMP, 'bad-wb'), TMP);
    assert.ok(result.errors.some((e) => e.includes('missing SKILL.md')));
  });

  it('detects missing frontmatter', () => {
    const result = validateWorkbench(join(TMP, 'bad-wb'), TMP);
    assert.ok(result.errors.some((e) => e.includes('missing frontmatter')));
  });

  it('detects non-existent hook scripts', () => {
    const result = validateWorkbench(join(TMP, 'bad-wb'), TMP);
    assert.ok(result.errors.some((e) => e.includes('non-existent script')));
  });

  it('detects missing hook rationale', () => {
    const result = validateWorkbench(join(TMP, 'bad-wb'), TMP);
    assert.ok(result.warnings.some((w) => w.includes('missing "rationale"')));
  });

  it('detects cross-workbench path references', () => {
    const result = validateWorkbench(join(TMP, 'cross-wb'), TMP);
    assert.ok(result.warnings.some((w) => w.includes('cross-workbench path')));
  });
});
