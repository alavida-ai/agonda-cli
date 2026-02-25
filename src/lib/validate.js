import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { findRepoRoot, findWorkbenchContext, findAllWorkbenches } from './context.js';

/**
 * Validate individual mcpServer entries.
 * Each entry must have either command+args (stdio) or url (HTTP).
 */
function validateMcpServerEntries(servers, contextPath, errors) {
  for (const [name, config] of Object.entries(servers)) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      errors.push(`${contextPath}: mcpServer "${name}" must be an object`);
      continue;
    }
    const hasCommand = 'command' in config;
    const hasUrl = 'url' in config;
    if (!hasCommand && !hasUrl) {
      errors.push(`${contextPath}: mcpServer "${name}" must have either "command"+"args" (stdio) or "url" (HTTP)`);
    }
    if (hasCommand && hasUrl) {
      errors.push(`${contextPath}: mcpServer "${name}" has both "command" and "url" — use one format, not both`);
    }
  }
}

/**
 * Validate a single workbench/plugin directory.
 * Returns { path, errors[], warnings[] }.
 */
export function validateWorkbench(wbPath, repoRoot) {
  const errors = [];
  const warnings = [];
  const relPath = relative(repoRoot, wbPath);

  // 1. Check plugin.json structure
  const pluginJsonPath = join(wbPath, '.claude-plugin', 'plugin.json');
  if (existsSync(pluginJsonPath)) {
    try {
      const pluginJson = JSON.parse(readFileSync(pluginJsonPath, 'utf-8'));
      if (!pluginJson.name) errors.push(`${relPath}: plugin.json missing "name" field`);
      if (!pluginJson.description) warnings.push(`${relPath}: plugin.json missing "description" field`);

      // 2. Check for duplicate hook declarations
      const hooksJsonPath = join(wbPath, 'hooks', 'hooks.json');
      if (existsSync(hooksJsonPath) && pluginJson.hooks && pluginJson.hooks.length > 0) {
        warnings.push(`${relPath}: hooks declared in both plugin.json and hooks/hooks.json — hooks.json takes precedence, plugin.json hooks may be duplicates`);
      }

      // 7. Validate mcpServers format
      if (pluginJson.mcpServers !== undefined) {
        const pluginDir = join(wbPath, '.claude-plugin');
        if (typeof pluginJson.mcpServers === 'string') {
          // String path — resolve relative to .claude-plugin dir and check file exists
          const mcpPath = resolve(pluginDir, pluginJson.mcpServers);
          if (!existsSync(mcpPath)) {
            errors.push(`${relPath}: mcpServers references non-existent file: ${pluginJson.mcpServers}`);
          } else {
            try {
              const mcpJson = JSON.parse(readFileSync(mcpPath, 'utf-8'));
              if (!mcpJson.mcpServers || typeof mcpJson.mcpServers !== 'object' || Array.isArray(mcpJson.mcpServers)) {
                errors.push(`${relPath}: ${pluginJson.mcpServers} must contain an "mcpServers" object`);
              } else {
                validateMcpServerEntries(mcpJson.mcpServers, `${relPath}/${pluginJson.mcpServers}`, errors);
              }
            } catch (e) {
              errors.push(`${relPath}: ${pluginJson.mcpServers} is not valid JSON — ${e.message}`);
            }
          }
        } else if (typeof pluginJson.mcpServers === 'object' && !Array.isArray(pluginJson.mcpServers)) {
          validateMcpServerEntries(pluginJson.mcpServers, `${relPath}/plugin.json`, errors);
        } else {
          errors.push(`${relPath}: mcpServers must be an object or a string path to a .mcp.json file`);
        }
      }
    } catch (e) {
      errors.push(`${relPath}: plugin.json is not valid JSON — ${e.message}`);
    }
  }

  // 3. Skill directory integrity
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

      // 6. Cross-workbench path scan
      if (content.includes('../') && content.match(/\.\.\/[^)]*workbench/i)) {
        warnings.push(`${relPath}/skills/${entry.name}/SKILL.md: contains cross-workbench path reference (../...workbench)`);
      }
    }
  }

  // 4. Hook script existence
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

          // 5. Hook rationale check
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
