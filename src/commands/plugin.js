import { Command } from 'commander';
import { listPlugins } from '../lib/plugin.js';
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
        })));
        return;
      }

      if (plugins.length === 0) {
        output.write('No plugins found in marketplace.json.');
        return;
      }

      output.table(
        ['Name', 'Status', 'Scope', 'Version'],
        plugins.map((p) => [
          p.name,
          p.status === 'enabled' ? 'enabled' : 'disabled',
          p.scope,
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
    .action(() => {
      output.error('Not implemented yet. See ALA-364.');
      process.exit(1);
    });

  cmd
    .command('disable <name>')
    .description('Disable a plugin')
    .action(() => {
      output.error('Not implemented yet. See ALA-364.');
      process.exit(1);
    });

  cmd
    .command('switch <name>')
    .description('Switch to a single active plugin')
    .action(() => {
      output.error('Not implemented yet. See ALA-365.');
      process.exit(1);
    });

  return cmd;
}
