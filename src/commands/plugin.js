import { Command } from 'commander';
import { listPlugins, setPluginState, switchPlugin, clearPluginCache } from '../lib/plugin.js';
import { validateAll } from '../lib/validate.js';
import { output } from '../utils/output.js';
import { EXIT_CODES } from '../utils/errors.js';

export function pluginCommand() {
  const cmd = new Command('plugin')
    .description('Validate and manage plugins');

  cmd
    .command('list')
    .description('Show all plugins and their enabled/disabled status')
    .action((opts, command) => {
      const globalOpts = command.optsWithGlobals();
      const plugins = listPlugins();

      if (globalOpts.json) {
        output.json(plugins.map((p) => ({
          name: p.name,
          status: p.status,
          scope: p.scope,
          version: p.version,
          description: p.description,
          path: p.path,
          source: p.source,
        })));
        return;
      }

      if (plugins.length === 0) {
        output.write('No plugins found.');
        return;
      }

      output.table(
        ['Name', 'Status', 'Scope', 'Source', 'Version'],
        plugins.map((p) => [
          p.name,
          p.status === 'enabled' ? 'enabled' : 'disabled',
          p.scope,
          p.source,
          p.version,
        ])
      );
    });

  cmd
    .command('validate')
    .description('Validate plugin/workbench structure')
    .action((opts, command) => {
      const globalOpts = command.optsWithGlobals();
      const results = validateAll({ all: globalOpts.all });

      const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
      const totalWarnings = results.reduce((sum, r) => sum + r.warnings.length, 0);

      if (globalOpts.json) {
        output.json({
          results: results.map((r) => ({
            path: r.path,
            errors: r.errors,
            warnings: r.warnings,
          })),
          summary: { workbenches: results.length, errors: totalErrors, warnings: totalWarnings },
        });
        process.exit(totalErrors > 0 ? EXIT_CODES.VALIDATION : EXIT_CODES.SUCCESS);
        return;
      }

      for (const result of results) {
        if (result.errors.length === 0 && result.warnings.length === 0) {
          output.write(`${result.path}: valid`);
          continue;
        }
        for (const err of result.errors) {
          output.write(`  ERROR: ${err}`);
        }
        for (const warn of result.warnings) {
          output.write(`  WARN:  ${warn}`);
        }
      }

      output.status(`\n${results.length} workbench(es) scanned. ${totalErrors} error(s), ${totalWarnings} warning(s).`);
      process.exit(totalErrors > 0 ? EXIT_CODES.VALIDATION : EXIT_CODES.SUCCESS);
    });

  cmd
    .command('enable <name>')
    .description('Enable a plugin')
    .option('--scope <scope>', 'Settings scope: project, local, or user', 'project')
    .option('--no-cache-clear', 'Skip clearing the plugin cache')
    .action((name, opts, command) => {
      const globalOpts = command.optsWithGlobals();
      const result = setPluginState(name, true, { scope: opts.scope });

      // Clear cache unless --no-cache-clear
      let cacheResult = null;
      if (opts.cacheClear !== false) {
        cacheResult = clearPluginCache([name]);
      }

      if (globalOpts.json) {
        output.json({ ...result, cache: cacheResult });
        return;
      }

      if (result.alreadyInState) {
        output.write(`${result.key} is already enabled (${result.scope} scope).`);
      } else {
        output.write(`Enabled ${result.key} in ${result.scope} scope.`);
      }
      if (cacheResult && cacheResult.cleared.length > 0) {
        output.write(`Cleared cache for: ${cacheResult.cleared.join(', ')}`);
      }
      output.status('Restart Claude Code for changes to take effect.');
    });

  cmd
    .command('disable <name>')
    .description('Disable a plugin')
    .option('--scope <scope>', 'Settings scope: project, local, or user', 'project')
    .option('--no-cache-clear', 'Skip clearing the plugin cache')
    .action((name, opts, command) => {
      const globalOpts = command.optsWithGlobals();
      const result = setPluginState(name, false, { scope: opts.scope });

      // Clear cache unless --no-cache-clear
      let cacheResult = null;
      if (opts.cacheClear !== false) {
        cacheResult = clearPluginCache([name]);
      }

      if (globalOpts.json) {
        output.json({ ...result, cache: cacheResult });
        return;
      }

      if (result.alreadyInState) {
        output.write(`${result.key} is already disabled (${result.scope} scope).`);
      } else {
        output.write(`Disabled ${result.key} in ${result.scope} scope.`);
      }
      if (cacheResult && cacheResult.cleared.length > 0) {
        output.write(`Cleared cache for: ${cacheResult.cleared.join(', ')}`);
      }
      output.status('Restart Claude Code for changes to take effect.');
    });

  cmd
    .command('switch <name>')
    .description('Disable all plugins, enable target. Use --keep to preserve specific plugins.')
    .option('--keep <names...>', 'Plugins to keep enabled during switch')
    .option('--scope <scope>', 'Settings scope: project, local, or user', 'project')
    .option('--no-cache-clear', 'Skip clearing the plugin cache')
    .action((name, opts, command) => {
      const globalOpts = command.optsWithGlobals();
      const keep = opts.keep || [];

      if (globalOpts.dryRun) {
        // Dry run — show what would happen without writing
        const plugins = listPlugins();
        const keepSet = new Set(keep);

        if (globalOpts.json) {
          output.json({
            dryRun: true,
            wouldEnable: [name],
            wouldDisable: plugins
              .filter((p) => p.status === 'enabled' && p.name !== name && !keepSet.has(p.name))
              .map((p) => p.name),
            wouldKeep: keep,
            wouldClearCache: opts.cacheClear !== false,
          });
          return;
        }

        output.write('Dry run — no changes written:');
        output.write(`  Enable: ${name}`);
        for (const p of plugins) {
          if (p.status === 'enabled' && p.name !== name && !keepSet.has(p.name)) {
            output.write(`  Disable: ${p.name}`);
          }
        }
        for (const k of keep) {
          output.write(`  Keep: ${k}`);
        }
        if (opts.cacheClear !== false) {
          output.write('  Would clear plugin cache');
        }
        return;
      }

      const result = switchPlugin(name, { keep, scope: opts.scope });

      // Clear cache for the enabled plugin unless --no-cache-clear
      let cacheResult = null;
      if (opts.cacheClear !== false) {
        cacheResult = clearPluginCache([name]);
      }

      if (globalOpts.json) {
        output.json({ ...result, cache: cacheResult });
        return;
      }

      for (const d of result.disabled) output.write(`Disabled: ${d}`);
      for (const e of result.enabled) output.write(`Enabled: ${e}`);
      for (const k of result.kept) output.write(`Kept: ${k}`);
      if (cacheResult && cacheResult.cleared.length > 0) {
        output.write(`Cleared cache for: ${cacheResult.cleared.join(', ')}`);
      }
      output.status('Restart Claude Code for changes to take effect.');
    });

  return cmd;
}
