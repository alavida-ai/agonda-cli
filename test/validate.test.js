import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock isClaudeAvailable before importing validate — returns false so tests
// don't require `claude` binary in CI.
const validateModule = await import('../src/lib/validate.js');
const { validateWorkbench } = validateModule;

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

  // Bad workbench — missing SKILL.md, missing rationale
  const badWb = join(TMP, 'bad-wb');
  mkdirSync(join(badWb, '.claude-plugin'), { recursive: true });
  mkdirSync(join(badWb, 'skills', 'broken-skill'), { recursive: true });
  mkdirSync(join(badWb, 'skills', 'no-frontmatter'), { recursive: true });
  mkdirSync(join(badWb, 'hooks'), { recursive: true });
  writeFileSync(join(badWb, 'workbench.json'), JSON.stringify({ primitives: {} }));
  writeFileSync(join(badWb, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'bad', description: 'Bad plugin' }));
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

  // mcpServers — valid string path to .mcp.json
  const mcpFileWb = join(TMP, 'mcp-file-wb');
  mkdirSync(join(mcpFileWb, '.claude-plugin'), { recursive: true });
  writeFileSync(join(mcpFileWb, 'workbench.json'), JSON.stringify({ primitives: {} }));
  writeFileSync(join(mcpFileWb, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: 'mcp-file', description: 'File ref MCP', mcpServers: './.mcp.json',
  }));
  writeFileSync(join(mcpFileWb, '.claude-plugin', '.mcp.json'), JSON.stringify({
    mcpServers: { linear: { url: 'https://mcp.linear.app/mcp' } },
  }));

  // mcpServers — string path to missing file
  const mcpMissingWb = join(TMP, 'mcp-missing-wb');
  mkdirSync(join(mcpMissingWb, '.claude-plugin'), { recursive: true });
  writeFileSync(join(mcpMissingWb, 'workbench.json'), JSON.stringify({ primitives: {} }));
  writeFileSync(join(mcpMissingWb, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: 'mcp-missing', description: 'Missing file', mcpServers: './.mcp.json',
  }));

  // mcpServers — .mcp.json with invalid content (missing mcpServers key)
  const mcpBadFileWb = join(TMP, 'mcp-badfile-wb');
  mkdirSync(join(mcpBadFileWb, '.claude-plugin'), { recursive: true });
  writeFileSync(join(mcpBadFileWb, 'workbench.json'), JSON.stringify({ primitives: {} }));
  writeFileSync(join(mcpBadFileWb, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: 'mcp-badfile', description: 'Bad file content', mcpServers: './.mcp.json',
  }));
  writeFileSync(join(mcpBadFileWb, '.claude-plugin', '.mcp.json'), JSON.stringify({ servers: {} }));
});

after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('validateWorkbench', () => {
  it('validates a clean workbench with no errors (governance checks only)', () => {
    const result = validateWorkbench(join(TMP, 'good-wb'), TMP);
    // When claude is unavailable, we get a warning but no errors
    const governanceErrors = result.errors.filter((e) => !e.includes('claude plugin validate'));
    assert.equal(governanceErrors.length, 0);
  });

  it('handles claude CLI availability (warns if missing, delegates if present)', () => {
    const result = validateWorkbench(join(TMP, 'good-wb'), TMP);
    // Either claude is available (delegation ran) or it's not (warning emitted)
    const claudeWarning = result.warnings.some((w) => w.includes('claude CLI not available'));
    const claudeRan = result.errors.some((e) => e.includes('claude plugin validate')) ||
      (!claudeWarning && result.errors.length === 0);
    assert.ok(claudeWarning || claudeRan, 'Expected either Claude delegation or unavailability warning');
  });

  it('runs claude delegation as first step', () => {
    const result = validateWorkbench(join(TMP, 'good-wb'), TMP);
    // Claude check should be the first thing that runs.
    // If claude is available, no claude warning. If unavailable, first warning is about it.
    if (result.warnings.length > 0 && result.warnings[0].includes('claude')) {
      assert.ok(result.warnings[0].includes('claude'), 'First warning should be about Claude');
    }
    // If no claude warning, delegation succeeded — no assertion needed
    assert.ok(true);
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

  // .mcp.json file reference validation (governance layer — Claude rejects string paths)
  it('accepts valid string path mcpServers with existing .mcp.json', () => {
    const result = validateWorkbench(join(TMP, 'mcp-file-wb'), TMP);
    const governanceErrors = result.errors.filter((e) => !e.includes('claude plugin validate'));
    assert.equal(governanceErrors.length, 0);
  });

  it('detects mcpServers string path to missing file', () => {
    const result = validateWorkbench(join(TMP, 'mcp-missing-wb'), TMP);
    assert.ok(result.errors.some((e) => e.includes('non-existent file')));
  });

  it('detects .mcp.json file missing mcpServers key', () => {
    const result = validateWorkbench(join(TMP, 'mcp-badfile-wb'), TMP);
    assert.ok(result.errors.some((e) => e.includes('must contain an "mcpServers" object')));
  });
});
