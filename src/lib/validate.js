import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { findRepoRoot, findWorkbenchContext, findAllWorkbenches } from './context.js';
import { getMarketplace } from './marketplace.js';

/**
 * Check if `claude` CLI is available on PATH.
 */
export function isClaudeAvailable() {
  try {
    execFileSync('claude', ['--version'], { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Delegate base plugin validation to `claude plugin validate <path>`.
 * Returns { passed: boolean, output: string }.
 */
export function delegateToClaude(pluginPath) {
  try {
    const result = execFileSync('claude', ['plugin', 'validate', pluginPath], {
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 15000,
    });
    return { passed: true, output: result };
  } catch (err) {
    return { passed: false, output: err.stdout || err.stderr || err.message };
  }
}

/**
 * Validate a single workbench/plugin directory.
 * Step 0: delegate to Claude for base checks (plugin.json, mcpServers inline validation).
 * Steps 1+: governance checks (skills, hooks, cross-refs, .mcp.json file refs).
 * Returns { path, errors[], warnings[] }.
 */
export function validateWorkbench(wbPath, repoRoot) {
  const errors = [];
  const warnings = [];
  const relPath = relative(repoRoot, wbPath);

  // Step 0: Delegate to Claude for base plugin checks
  if (isClaudeAvailable()) {
    const claude = delegateToClaude(wbPath);
    if (!claude.passed) {
      errors.push(`${relPath}: claude plugin validate failed — ${claude.output.trim()}`);
    }
  } else {
    warnings.push(`${relPath}: claude CLI not available — skipping base plugin validation`);
  }

  // .mcp.json file reference validation (string path in mcpServers — Claude rejects these)
  const pluginJsonPath = join(wbPath, '.claude-plugin', 'plugin.json');
  if (existsSync(pluginJsonPath)) {
    try {
      const pluginJson = JSON.parse(readFileSync(pluginJsonPath, 'utf-8'));

      if (typeof pluginJson.mcpServers === 'string') {
        const pluginDir = join(wbPath, '.claude-plugin');
        const mcpPath = resolve(pluginDir, pluginJson.mcpServers);
        if (!existsSync(mcpPath)) {
          errors.push(`${relPath}: mcpServers references non-existent file: ${pluginJson.mcpServers}`);
        } else {
          try {
            const mcpJson = JSON.parse(readFileSync(mcpPath, 'utf-8'));
            if (!mcpJson.mcpServers || typeof mcpJson.mcpServers !== 'object' || Array.isArray(mcpJson.mcpServers)) {
              errors.push(`${relPath}: ${pluginJson.mcpServers} must contain an "mcpServers" object`);
            }
          } catch (e) {
            errors.push(`${relPath}: ${pluginJson.mcpServers} is not valid JSON — ${e.message}`);
          }
        }
      }
    } catch {
      // plugin.json parse errors are caught by Claude's base validation
    }
  }

  // Skill directory integrity
  const skillsDir = join(wbPath, 'skills');
  if (existsSync(skillsDir)) {
    let skillEntries;
    try {
      skillEntries = readdirSync(skillsDir, { withFileTypes: true });
    } catch {
      skillEntries = [];
    }
    for (const entry of skillEntries) {
      if (!entry.isDirectory()) continue;
      const skillDir = join(skillsDir, entry.name);
      const skillMd = join(skillDir, 'SKILL.md');

      if (!existsSync(skillMd)) {
        errors.push(`${relPath}/skills/${entry.name}: missing SKILL.md`);
        continue;
      }

      // Check frontmatter
      const content = readFileSync(skillMd, 'utf-8');
      if (!content.startsWith('---')) {
        errors.push(`${relPath}/skills/${entry.name}/SKILL.md: missing frontmatter`);
      } else {
        const fmEnd = content.indexOf('---', 3);
        if (fmEnd === -1) {
          errors.push(`${relPath}/skills/${entry.name}/SKILL.md: unclosed frontmatter`);
        } else {
          const fm = content.slice(3, fmEnd);
          if (!fm.includes('name:')) errors.push(`${relPath}/skills/${entry.name}/SKILL.md: frontmatter missing "name"`);
          if (!fm.includes('description:')) errors.push(`${relPath}/skills/${entry.name}/SKILL.md: frontmatter missing "description"`);
        }
      }

      // Cross-workbench path scan
      if (content.includes('../') && content.match(/\.\.\/[^)]*workbench/i)) {
        warnings.push(`${relPath}/skills/${entry.name}/SKILL.md: contains cross-workbench path reference (../...workbench)`);
      }
    }
  }

  // Hook script existence + rationale
  const hooksJsonPath = join(wbPath, 'hooks', 'hooks.json');
  if (existsSync(hooksJsonPath)) {
    try {
      const hooksConfig = JSON.parse(readFileSync(hooksJsonPath, 'utf-8'));
      const hookEntries = Object.values(hooksConfig).flat();
      for (const hook of hookEntries) {
        if (!hook || typeof hook !== 'object') continue;
        const hookList = hook.hooks || [hook];
        for (const h of hookList) {
          if (!h.command) continue;
          // Resolve command path — replace ${CLAUDE_PLUGIN_ROOT}
          const cmd = h.command.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, wbPath);
          // Extract the script path (first word of command)
          const scriptPath = cmd.split(/\s+/)[0];
          if (scriptPath.startsWith('/') || scriptPath.startsWith('.')) {
            const resolved = resolve(wbPath, scriptPath);
            if (!existsSync(resolved)) {
              errors.push(`${relPath}: hook command references non-existent script: ${scriptPath}`);
            }
          }

          // Hook rationale check
          if (!h.rationale) {
            warnings.push(`${relPath}: hook missing "rationale" field — ${h.command?.slice(0, 50)}`);
          }
        }
      }
    } catch (e) {
      errors.push(`${relPath}: hooks/hooks.json is not valid JSON — ${e.message}`);
    }
  }

  return { path: relPath, errors, warnings };
}

/**
 * Validate workbenches. If cwd is inside a workbench, validate just that one.
 * If at repo root or --all, validate all.
 */
export function validateAll({ all = false, cwd = process.cwd() } = {}) {
  const repoRoot = findRepoRoot(cwd);
  let workbenches;

  if (all) {
    workbenches = findAllWorkbenches(cwd).map((wb) => wb.path);
  } else {
    const ctx = findWorkbenchContext(cwd);
    if (ctx) {
      workbenches = [ctx.path];
    } else {
      // At repo root — validate all
      workbenches = findAllWorkbenches(cwd).map((wb) => wb.path);
    }
  }

  return workbenches.map((wbPath) => validateWorkbench(wbPath, repoRoot));
}

/**
 * Cascade validate the marketplace:
 * 1. Resolve each marketplace plugin source path
 * 2. Run validateWorkbench() on each resolved source
 * Returns { errors[], workbenches[] }.
 */
export function validateMarketplace({ cwd = process.cwd() } = {}) {
  const repoRoot = findRepoRoot(cwd);
  const marketplaceErrors = [];
  const workbenchResults = [];

  let marketplace;
  try {
    marketplace = getMarketplace(cwd);
  } catch (err) {
    return { errors: [err.message], workbenches: [] };
  }

  const plugins = marketplace.plugins || [];
  if (plugins.length === 0) {
    marketplaceErrors.push('marketplace.json has no plugins listed');
  }

  for (const plugin of plugins) {
    if (!plugin.source) {
      marketplaceErrors.push(`Plugin "${plugin.name || '(unnamed)'}": missing "source" field`);
      continue;
    }

    const resolvedSource = resolve(repoRoot, plugin.source);
    if (!existsSync(resolvedSource)) {
      marketplaceErrors.push(`Plugin "${plugin.name}": source path does not exist: ${plugin.source}`);
      continue;
    }

    workbenchResults.push(validateWorkbench(resolvedSource, repoRoot));
  }

  return { errors: marketplaceErrors, workbenches: workbenchResults };
}
