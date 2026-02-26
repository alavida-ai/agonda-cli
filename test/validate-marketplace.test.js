import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateMarketplace } from '../src/lib/validate.js';

const TMP = join(tmpdir(), `agonda-validate-mp-test-${Date.now()}`);

before(() => {
  mkdirSync(join(TMP, '.git'), { recursive: true });
  mkdirSync(join(TMP, '.claude-plugin'), { recursive: true });

  // Create two workbench directories — one good, one with issues
  const goodWb = join(TMP, 'plugins', 'good');
  mkdirSync(join(goodWb, '.claude-plugin'), { recursive: true });
  mkdirSync(join(goodWb, 'skills', 'my-skill'), { recursive: true });
  writeFileSync(join(goodWb, 'workbench.json'), JSON.stringify({ primitives: {} }));
  writeFileSync(join(goodWb, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'good', description: 'Good' }));
  writeFileSync(join(goodWb, 'skills', 'my-skill', 'SKILL.md'), '---\nname: my-skill\ndescription: A skill\n---\n# Skill\n');

  const badWb = join(TMP, 'plugins', 'bad');
  mkdirSync(join(badWb, 'skills', 'broken'), { recursive: true });
  writeFileSync(join(badWb, 'workbench.json'), JSON.stringify({ primitives: {} }));
  // broken skill has no SKILL.md

  writeFileSync(
    join(TMP, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'test-mp',
      plugins: [
        { name: 'good', source: './plugins/good', version: '1.0.0' },
        { name: 'bad', source: './plugins/bad', version: '0.1.0' },
        { name: 'missing', source: './plugins/nonexistent', version: '0.0.1' },
        { name: 'no-source' },
      ],
    })
  );
});

after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('validateMarketplace', () => {
  it('validates all workbenches from marketplace', () => {
    const result = validateMarketplace({ cwd: TMP });
    // 2 resolved workbenches (good + bad), 2 marketplace errors (missing source, no-source)
    assert.equal(result.workbenches.length, 2);
  });

  it('reports missing source paths', () => {
    const result = validateMarketplace({ cwd: TMP });
    assert.ok(result.errors.some((e) => e.includes('does not exist') && e.includes('nonexistent')));
  });

  it('reports plugins without source field', () => {
    const result = validateMarketplace({ cwd: TMP });
    assert.ok(result.errors.some((e) => e.includes('missing "source"')));
  });

  it('collects errors from per-workbench validation', () => {
    const result = validateMarketplace({ cwd: TMP });
    const badResult = result.workbenches.find((w) => w.path.includes('bad'));
    assert.ok(badResult);
    assert.ok(badResult.errors.some((e) => e.includes('missing SKILL.md')));
  });
});
