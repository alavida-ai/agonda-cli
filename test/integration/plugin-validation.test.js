/**
 * Integration tests for user story US-4.
 *
 * US-4: "I want to validate my plugin before shipping"
 *
 * These tests call the CLI binary and assert on stdout/exit codes.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTempRepo, addWorkbench, runCLI, runCLIJson } from './fixtures.js';

let repo;

before(() => {
  repo = createTempRepo('plugin-validate');

  // Good workbench — passes all checks
  addWorkbench(repo.root, 'domains/governance/plugins/governance-tools', {
    pluginJson: { name: 'governance-tools', description: 'Governance skills and hooks' },
    skills: [
      {
        name: 'health-check',
        content: '---\nname: health-check\ndescription: Scan domains for compliance\n---\n# Health Check\n',
      },
    ],
    hooksJson: {},
  });

  // Bad workbench — multiple violations
  addWorkbench(repo.root, 'domains/dev/plugins/broken-tools', {
    pluginJson: {}, // missing name
    skills: [
      { name: 'orphan-skill' }, // no SKILL.md content
      {
        name: 'bad-frontmatter',
        content: '# No Frontmatter\nJust content without YAML header.',
      },
    ],
    hooksJson: {
      PreToolUse: [{ hooks: [{ command: '/nonexistent/check.sh' }] }],
    },
  });
});

after(() => repo.cleanup());

describe('US-4: plugin validate', () => {
  it('reports valid workbench with exit code 0', () => {
    // Run from inside the good workbench
    const goodPath = 'domains/governance/plugins/governance-tools';
    const result = runCLI(['plugin', 'validate'], {
      cwd: `${repo.root}/${goodPath}`,
    });
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('valid'));
  });

  it('reports errors for broken workbench with exit code 2', () => {
    const badPath = 'domains/dev/plugins/broken-tools';
    const result = runCLI(['plugin', 'validate'], {
      cwd: `${repo.root}/${badPath}`,
    });
    assert.equal(result.exitCode, 2);
    assert.ok(result.stdout.includes('ERROR'));
  });

  it('detects missing plugin.json name', () => {
    const badPath = 'domains/dev/plugins/broken-tools';
    const result = runCLI(['plugin', 'validate'], {
      cwd: `${repo.root}/${badPath}`,
    });
    assert.ok(result.stdout.includes('missing "name"'));
  });

  it('detects missing SKILL.md', () => {
    const badPath = 'domains/dev/plugins/broken-tools';
    const result = runCLI(['plugin', 'validate'], {
      cwd: `${repo.root}/${badPath}`,
    });
    assert.ok(result.stdout.includes('missing SKILL.md'));
  });

  it('detects missing frontmatter', () => {
    const badPath = 'domains/dev/plugins/broken-tools';
    const result = runCLI(['plugin', 'validate'], {
      cwd: `${repo.root}/${badPath}`,
    });
    assert.ok(result.stdout.includes('missing frontmatter'));
  });

  it('detects non-existent hook scripts', () => {
    const badPath = 'domains/dev/plugins/broken-tools';
    const result = runCLI(['plugin', 'validate'], {
      cwd: `${repo.root}/${badPath}`,
    });
    assert.ok(result.stdout.includes('non-existent script'));
  });

  it('--json returns structured results with summary', () => {
    const badPath = 'domains/dev/plugins/broken-tools';
    const result = runCLIJson(['plugin', 'validate'], {
      cwd: `${repo.root}/${badPath}`,
    });
    // Exit code 2 for validation errors, but stdout still has JSON
    assert.ok(result.json);
    assert.ok(result.json.summary);
    assert.ok(result.json.summary.errors > 0);
    assert.ok(Array.isArray(result.json.results));
  });

  it('--all validates all workbenches in repo', () => {
    const result = runCLIJson(['--all', 'plugin', 'validate'], { cwd: repo.root });
    // Should find both workbenches
    assert.ok(result.json);
    assert.equal(result.json.results.length, 2);

    // One should have errors, one should be clean
    const clean = result.json.results.find((r) => r.errors.length === 0);
    const broken = result.json.results.find((r) => r.errors.length > 0);
    assert.ok(clean, 'Expected one clean workbench');
    assert.ok(broken, 'Expected one broken workbench');
  });
});
