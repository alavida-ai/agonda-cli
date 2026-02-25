import { Command } from 'commander';
import { listPlugins } from '../lib/plugin.js';
import { runHealthChecks } from '../lib/health.js';
import { checkWorkbenchPrimitives } from '../lib/primitives.js';
import { findAllWorkbenches } from '../lib/context.js';
import { discoverWorkspaces, findUnmarkedWorkspaces } from '../lib/workspace.js';
import { output } from '../utils/output.js';
import { EXIT_CODES } from '../utils/errors.js';

export function statusCommand() {
  const cmd = new Command('status')
    .description('System-wide overview — plugins, domains, primitives, workspaces')
    .action((opts, command) => {
      const globalOpts = command.optsWithGlobals();
      let hasErrors = false;

      // 1. Plugins
      const plugins = listPlugins();
      const enabledPlugins = plugins.filter((p) => p.status === 'enabled');
      const disabledPlugins = plugins.filter((p) => p.status === 'disabled');

      // 2. Domains
      const health = runHealthChecks();
      if (health.summary.errors > 0) hasErrors = true;

      // 3. Primitives
      const workbenches = findAllWorkbenches();
      const withPrimitives = workbenches.filter(
        (wb) => wb.config.primitives && Object.keys(wb.config.primitives).length > 0
      );
      const primResults = withPrimitives.map((wb) => checkWorkbenchPrimitives(wb));
      let primTotal = 0, primCurrent = 0, primBehind = 0, primUnknown = 0;
      for (const r of primResults) {
        for (const p of r.primitives) {
          primTotal++;
          if (p.status === 'CURRENT') primCurrent++;
          else if (p.status === 'BEHIND') primBehind++;
          else primUnknown++;
        }
      }
      if (primBehind > 0) hasErrors = true;

      // 4. Workspaces
      const workspaces = discoverWorkspaces();
      const unmarked = findUnmarkedWorkspaces();

      // 5. Collect warnings
      const warnings = [];
      for (const r of primResults) {
        for (const p of r.primitives) {
          if (p.status === 'BEHIND') {
            warnings.push(`${p.name} BEHIND in ${r.workbench} (${p.pinned} → ${p.latest})`);
          } else if (p.status === 'UNKNOWN') {
            warnings.push(`${p.name} UNKNOWN in ${r.workbench}`);
          }
        }
      }
      for (const r of health.results) {
        for (const e of r.errors) {
          warnings.push(`[${r.domain}] ${e.check}: ${e.message}`);
        }
      }

      if (globalOpts.json) {
        output.json({
          plugins: {
            enabled: enabledPlugins.map((p) => p.name),
            disabled: disabledPlugins.map((p) => p.name),
          },
          domains: {
            results: health.results.map((r) => ({
              domain: r.domain,
              errors: r.errors.length,
              warnings: r.warnings.length,
            })),
            summary: health.summary,
          },
          primitives: {
            results: primResults,
            summary: { total: primTotal, current: primCurrent, behind: primBehind, unknown: primUnknown },
          },
          workspaces: {
            active: workspaces.length,
            unmarked: unmarked.length,
          },
          warnings,
          hasErrors,
        });
        if (hasErrors) process.exit(EXIT_CODES.VALIDATION);
        return;
      }

      // Human output
      output.write(`Plugins: ${enabledPlugins.length} enabled, ${disabledPlugins.length} disabled (${enabledPlugins.map((p) => p.name).join(', ')})`);

      const healthyDomains = health.results.filter((r) => r.errors.length === 0);
      const unhealthyDomains = health.results.filter((r) => r.errors.length > 0);
      if (unhealthyDomains.length === 0) {
        output.write(`Domains: ${health.summary.domains} healthy (${health.results.map((r) => r.domain).join(', ')})`);
      } else {
        output.write(`Domains: ${healthyDomains.length} healthy, ${unhealthyDomains.length} with errors`);
      }

      output.write(`Primitives: ${primCurrent} current, ${primBehind} behind, ${primUnknown} unknown`);
      output.write(`Workspaces: ${workspaces.length} active, ${unmarked.length} without .workbench markers`);

      if (warnings.length > 0) {
        output.write(`\nWarnings (${warnings.length}):`);
        for (const w of warnings) {
          output.write(`  ${w}`);
        }
      }

      if (hasErrors) {
        process.exit(EXIT_CODES.VALIDATION);
      }
    });

  return cmd;
}
