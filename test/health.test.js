import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverDomains, parseFrontmatter, checkDomain, runHealthChecks } from '../src/lib/health.js';

const TMP = join(tmpdir(), `agonda-health-test-${Date.now()}`);

before(() => {
  mkdirSync(join(TMP, '.git'), { recursive: true });

  // Good domain — passes all checks
  const govDir = join(TMP, 'domains', 'governance');
  mkdirSync(join(govDir, 'knowledge'), { recursive: true });
  writeFileSync(join(govDir, 'CLAUDE.md'), `---
tags: [router]
---
# Governance Domain

## Identity
| Attribute | Value |
| Type | Platform |

## Purpose
System management.

## Boundaries
Starts and ends here.

## Knowledge This Domain Owns
| Knowledge | Location |
| Constitution | [knowledge/constitution.md](knowledge/constitution.md) |
`);

  writeFileSync(join(govDir, 'knowledge', 'constitution.md'), `---
description: The constitution
last-validated: ${new Date().toISOString().split('T')[0]}
validated-by: alex
confidence: high
tags: [knowledge]
---
# Constitution
`);

  // Bad domain — missing sections, bad frontmatter, stale file
  const badDir = join(TMP, 'domains', 'broken');
  mkdirSync(join(badDir, 'knowledge'), { recursive: true });
  writeFileSync(join(badDir, 'CLAUDE.md'), `# Broken Domain
## Identity
Just identity, missing other sections.
`);

  writeFileSync(join(badDir, 'knowledge', 'no-frontmatter.md'), `# No Frontmatter
Just content.
`);

  writeFileSync(join(badDir, 'knowledge', 'missing-fields.md'), `---
description: Has description only
---
# Missing Fields
`);

  writeFileSync(join(badDir, 'knowledge', 'stale.md'), `---
description: Very old file
last-validated: 2025-01-01
validated-by: someone
confidence: low
tags: [knowledge]
---
# Stale Content
`);

  // Domain without CLAUDE.md — should not be discovered
  mkdirSync(join(TMP, 'domains', 'no-claude'), { recursive: true });
});

after(() => rmSync(TMP, { recursive: true, force: true }));

describe('discoverDomains', () => {
  it('finds domains with CLAUDE.md', () => {
    const domains = discoverDomains(TMP);
    const names = domains.map((d) => d.name).sort();
    assert.deepEqual(names, ['broken', 'governance']);
  });

  it('skips directories without CLAUDE.md', () => {
    const domains = discoverDomains(TMP);
    const names = domains.map((d) => d.name);
    assert.ok(!names.includes('no-claude'));
  });
});

describe('parseFrontmatter', () => {
  it('parses valid frontmatter', () => {
    const fm = parseFrontmatter(`---
description: Test
confidence: high
---
# Content`);
    assert.equal(fm.fields.description, 'Test');
    assert.equal(fm.fields.confidence, 'high');
  });

  it('returns null for missing frontmatter', () => {
    assert.equal(parseFrontmatter('# No frontmatter'), null);
  });

  it('returns null for empty content', () => {
    assert.equal(parseFrontmatter(''), null);
  });
});

describe('checkDomain', () => {
  it('clean domain has no errors', () => {
    const domains = discoverDomains(TMP);
    const gov = domains.find((d) => d.name === 'governance');
    const result = checkDomain(gov);

    assert.equal(result.domain, 'governance');
    assert.equal(result.errors.length, 0);
  });

  it('detects missing CLAUDE.md sections', () => {
    const domains = discoverDomains(TMP);
    const broken = domains.find((d) => d.name === 'broken');
    const result = checkDomain(broken);

    const structErrors = result.errors.filter((e) => e.check === 'structure');
    assert.ok(structErrors.length >= 3); // Purpose, Boundaries, Knowledge This Domain Owns
  });

  it('detects missing frontmatter', () => {
    const domains = discoverDomains(TMP);
    const broken = domains.find((d) => d.name === 'broken');
    const result = checkDomain(broken);

    const fmErrors = result.errors.filter((e) => e.check === 'frontmatter');
    assert.ok(fmErrors.some((e) => e.message === 'Missing frontmatter'));
  });

  it('detects missing frontmatter fields', () => {
    const domains = discoverDomains(TMP);
    const broken = domains.find((d) => d.name === 'broken');
    const result = checkDomain(broken);

    const fieldErrors = result.errors.filter((e) => e.message.includes('Missing frontmatter field'));
    assert.ok(fieldErrors.length > 0);
  });

  it('detects stale files as warnings or errors', () => {
    const domains = discoverDomains(TMP);
    const broken = domains.find((d) => d.name === 'broken');
    const result = checkDomain(broken);

    const freshIssues = [...result.errors, ...result.warnings].filter((i) => i.check === 'freshness');
    assert.ok(freshIssues.length > 0);
  });
});

describe('runHealthChecks', () => {
  it('returns results for all domains', () => {
    const { results, summary } = runHealthChecks(TMP);
    assert.equal(results.length, 2);
    assert.equal(summary.domains, 2);
  });

  it('summary counts errors and warnings', () => {
    const { summary } = runHealthChecks(TMP);
    assert.ok(summary.errors > 0);
  });
});
