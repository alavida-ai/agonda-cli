import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findRepoRoot } from './context.js';

const REQUIRED_CLAUDE_SECTIONS = ['Identity', 'Purpose', 'Boundaries', 'Knowledge This Domain Owns'];
const REQUIRED_FRONTMATTER = ['description', 'last-validated', 'validated-by', 'confidence', 'tags'];
const FRESHNESS_WARN_DAYS = 90;
const FRESHNESS_ERROR_DAYS = 180;

/**
 * Discover all domains in the repo.
 * Returns array of { name, path, claudeMdPath }.
 */
export function discoverDomains(cwd = process.cwd()) {
  const repoRoot = findRepoRoot(cwd);
  const domainsDir = join(repoRoot, 'domains');

  if (!existsSync(domainsDir)) return [];

  return readdirSync(domainsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({
      name: d.name,
      path: join(domainsDir, d.name),
      claudeMdPath: join(domainsDir, d.name, 'CLAUDE.md'),
    }))
    .filter((d) => existsSync(d.claudeMdPath));
}

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns { fields: {}, raw: string } or null if no frontmatter.
 */
export function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const raw = match[1];
  const fields = {};
  for (const line of raw.split('\n')) {
    const kv = line.match(/^(\S+):\s*(.+)/);
    if (kv) {
      fields[kv[1]] = kv[2].trim();
    }
  }
  return { fields, raw };
}

/**
 * Check CLAUDE.md structure — required sections present.
 */
function checkStructure(claudeMdPath) {
  const issues = [];
  if (!existsSync(claudeMdPath)) {
    issues.push({ level: 'error', check: 'structure', message: 'CLAUDE.md missing', file: claudeMdPath });
    return issues;
  }

  const content = readFileSync(claudeMdPath, 'utf-8');
  for (const section of REQUIRED_CLAUDE_SECTIONS) {
    if (!content.includes(`## ${section}`)) {
      issues.push({
        level: 'error',
        check: 'structure',
        message: `Missing required section: "## ${section}"`,
        file: claudeMdPath,
      });
    }
  }
  return issues;
}

/**
 * Check frontmatter on all knowledge files.
 */
function checkFrontmatter(domainPath) {
  const issues = [];
  const knowledgeDir = join(domainPath, 'knowledge');
  if (!existsSync(knowledgeDir)) return issues;

  const files = readdirSync(knowledgeDir).filter((f) => f.endsWith('.md'));
  for (const file of files) {
    const filePath = join(knowledgeDir, file);
    const content = readFileSync(filePath, 'utf-8');
    const fm = parseFrontmatter(content);

    if (!fm) {
      issues.push({ level: 'error', check: 'frontmatter', message: 'Missing frontmatter', file: filePath });
      continue;
    }

    for (const field of REQUIRED_FRONTMATTER) {
      if (!fm.fields[field]) {
        issues.push({
          level: 'error',
          check: 'frontmatter',
          message: `Missing frontmatter field: "${field}"`,
          file: filePath,
        });
      }
    }
  }
  return issues;
}

/**
 * Check freshness of knowledge files based on last-validated date.
 */
function checkFreshness(domainPath) {
  const issues = [];
  const knowledgeDir = join(domainPath, 'knowledge');
  if (!existsSync(knowledgeDir)) return issues;

  const now = new Date();
  const files = readdirSync(knowledgeDir).filter((f) => f.endsWith('.md'));

  for (const file of files) {
    const filePath = join(knowledgeDir, file);
    const content = readFileSync(filePath, 'utf-8');
    const fm = parseFrontmatter(content);
    if (!fm || !fm.fields['last-validated']) continue;

    const validated = new Date(fm.fields['last-validated']);
    if (isNaN(validated.getTime())) continue;

    const daysSince = Math.floor((now - validated) / (1000 * 60 * 60 * 24));

    if (daysSince > FRESHNESS_ERROR_DAYS) {
      issues.push({
        level: 'error',
        check: 'freshness',
        message: `Stale: last validated ${daysSince} days ago (>${FRESHNESS_ERROR_DAYS}d threshold)`,
        file: filePath,
      });
    } else if (daysSince > FRESHNESS_WARN_DAYS) {
      issues.push({
        level: 'warning',
        check: 'freshness',
        message: `Aging: last validated ${daysSince} days ago (>${FRESHNESS_WARN_DAYS}d threshold)`,
        file: filePath,
      });
    }
  }
  return issues;
}

/**
 * Check links using remark-validate-links.
 * Shells out to npx remark and parses the output.
 */
function checkLinks(domainPath) {
  const issues = [];

  const result = spawnSync('npx', [
    'remark', '--use', 'remark-validate-links',
    domainPath, '--no-stdout', '--no-color',
  ], {
    encoding: 'utf-8',
    timeout: 30000,
    cwd: domainPath,
  });

  const output = (result.stderr || '') + (result.stdout || '');
  // Parse lines like: "file.md\n  1:5-1:20 warning Cannot find file `foo.md`  missing-file ..."
  const lines = output.split('\n');
  let currentFile = null;

  for (const line of lines) {
    // File header line (no leading whitespace, ends with .md or similar)
    if (!line.startsWith(' ') && !line.startsWith('\t') && line.includes('.md')) {
      if (line.includes(': no issues found')) {
        currentFile = null;
        continue;
      }
      currentFile = line.trim();
      continue;
    }

    // Issue line
    const match = line.match(/^\s*(\d+:\d+-\d+:\d+)\s+(warning|error)\s+(.+?)\s{2,}\S+/);
    if (match && currentFile) {
      const [, location, level, message] = match;
      const lineNum = location.split(':')[0];
      issues.push({
        level: level === 'error' ? 'error' : 'warning',
        check: 'links',
        message: message.trim(),
        file: `${currentFile}:${lineNum}`,
      });
    }
  }
  return issues;
}

/**
 * Run all health checks for a single domain.
 * Returns { domain, errors: [], warnings: [] }.
 */
export function checkDomain(domainInfo) {
  const allIssues = [
    ...checkStructure(domainInfo.claudeMdPath),
    ...checkFrontmatter(domainInfo.path),
    ...checkFreshness(domainInfo.path),
    ...checkLinks(domainInfo.path),
  ];

  return {
    domain: domainInfo.name,
    errors: allIssues.filter((i) => i.level === 'error'),
    warnings: allIssues.filter((i) => i.level === 'warning'),
  };
}

/**
 * Run health checks across all domains.
 * Returns { results: [...], summary: { domains, errors, warnings } }.
 */
export function runHealthChecks(cwd = process.cwd()) {
  const domains = discoverDomains(cwd);
  const results = domains.map((d) => checkDomain(d));

  let totalErrors = 0;
  let totalWarnings = 0;
  for (const r of results) {
    totalErrors += r.errors.length;
    totalWarnings += r.warnings.length;
  }

  return {
    results,
    summary: { domains: domains.length, errors: totalErrors, warnings: totalWarnings },
  };
}
