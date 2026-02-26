import { Command } from 'commander';
import { validateAll } from '../lib/validate.js';
import { output } from '../utils/output.js';
import { EXIT_CODES } from '../utils/errors.js';

export function workbenchCommand() {
  const cmd = new Command('workbench')
    .description('Validate workbench structure (governance + Claude base checks)');

  cmd
    .command('validate')
    .description('Validate workbench structure — delegates to Claude for base checks, then runs governance checks')
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

  return cmd;
}
