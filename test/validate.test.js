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

  // mcpServers — valid inline (command format)
  const mcpCommandWb = join(TMP, 'mcp-command-wb');
  mkdirSync(join(mcpCommandWb, '.claude-plugin'), { recursive: true });
  writeFileSync(join(mcpCommandWb, 'workbench.json'), JSON.stringify({ primitives: {} }));
  writeFileSync(join(mcpCommandWb, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: 'mcp-command', description: 'Valid command MCP',
    mcpServers: { context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp@latest'] } },
  }));

  // mcpServers — valid inline (url format)
  const mcpUrlWb = join(TMP, 'mcp-url-wb');
  mkdirSync(join(mcpUrlWb, '.claude-plugin'), { recursive: true });
  writeFileSync(join(mcpUrlWb, 'workbench.json'), JSON.stringify({ primitives: {} }));
  writeFileSync(join(mcpUrlWb, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: 'mcp-url', description: 'Valid URL MCP',
    mcpServers: { linear: { url: 'https://mcp.linear.app/mcp' } },
  }));

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

  // mcpServers — inline entry missing both command and url
  const mcpInvalidEntryWb = join(TMP, 'mcp-invalid-entry-wb');
  mkdirSync(join(mcpInvalidEntryWb, '.claude-plugin'), { recursive: true });
  writeFileSync(join(mcpInvalidEntryWb, 'workbench.json'), JSON.stringify({ primitives: {} }));
  writeFileSync(join(mcpInvalidEntryWb, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: 'mcp-invalid-entry', description: 'Bad entry',
    mcpServers: { broken: { type: 'http' } },
  }));

  // mcpServers — invalid type (array)
  const mcpArrayWb = join(TMP, 'mcp-array-wb');
  mkdirSync(join(mcpArrayWb, '.claude-plugin'), { recursive: true });
  writeFileSync(join(mcpArrayWb, 'workbench.json'), JSON.stringify({ primitives: {} }));
  writeFileSync(join(mcpArrayWb, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: 'mcp-array', description: 'Array format', mcpServers: ['bad'],
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

  // mcpServers validation (check 7)
  it('accepts valid inline mcpServers with command format', () => {
    const result = validateWorkbench(join(TMP, 'mcp-command-wb'), TMP);
    assert.equal(result.errors.length, 0);
  });

  it('accepts valid inline mcpServers with url format', () => {
    const result = validateWorkbench(join(TMP, 'mcp-url-wb'), TMP);
    assert.equal(result.errors.length, 0);
  });

  it('accepts valid string path mcpServers with existing .mcp.json', () => {
    const result = validateWorkbench(join(TMP, 'mcp-file-wb'), TMP);
    assert.equal(result.errors.length, 0);
  });

  it('detects mcpServers string path to missing file', () => {
    const result = validateWorkbench(join(TMP, 'mcp-missing-wb'), TMP);
    assert.ok(result.errors.some((e) => e.includes('non-existent file')));
  });

  it('detects mcpServer entry missing command and url', () => {
    const result = validateWorkbench(join(TMP, 'mcp-invalid-entry-wb'), TMP);
    assert.ok(result.errors.some((e) => e.includes('must have either "command"+"args" (stdio) or "url" (HTTP)')));
  });

  it('detects mcpServers with invalid type (array)', () => {
    const result = validateWorkbench(join(TMP, 'mcp-array-wb'), TMP);
    assert.ok(result.errors.some((e) => e.includes('must be an object or a string path')));
  });

  it('detects .mcp.json file missing mcpServers key', () => {
    const result = validateWorkbench(join(TMP, 'mcp-badfile-wb'), TMP);
    assert.ok(result.errors.some((e) => e.includes('must contain an "mcpServers" object')));
  });
});
