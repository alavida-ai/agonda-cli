import { Command } from 'commander';
import { listWorkbenches } from '../lib/marketplace.js';
import { validateMarketplace } from '../lib/validate.js';
import { output } from '../utils/output.js';
import { EXIT_CODES } from '../utils/errors.js';

export function marketplaceCommand() {
  const cmd = new Command('marketplace')
    .description('List and validate marketplace workbenches');

  cmd
    .command('list')
    .description('List workbenches registered in marketplace.json')
    .action((opts, command) => {
      const globalOpts = command.optsWithGlobals();
      const workbenches = listWorkbenches();

      if (globalOpts.json) {
        output.json(workbenches.map((w) => ({
          name: w.name,
          version: w.version,
          description: w.description,
          source: w.source,
        })));
        return;
      }

      if (workbenches.length === 0) {
        output.write('No workbenches found in marketplace.');
        return;
      }

      output.table(
        ['Name', 'Source', 'Version'],
        workbenches.map((w) => [w.name, w.source, w.version])
      );
    });

  cmd
    .command('validate')
    .description('Cascade validate: marketplace schema → source paths → per-workbench checks')
    .action((opts, command) => {
      const globalOpts = command.optsWithGlobals();
      const result = validateMarketplace();

      const totalErrors = result.errors.length + result.workbenches.reduce((sum, w) => sum + w.errors.length, 0);
      const totalWarnings = result.workbenches.reduce((sum, w) => sum + w.warnings.length, 0);

      if (globalOpts.json) {
        output.json({
          marketplaceErrors: result.errors,
          workbenches: result.workbenches.map((w) => ({
            path: w.path,
            errors: w.errors,
            warnings: w.warnings,
          })),
          summary: { workbenches: result.workbenches.length, errors: totalErrors, warnings: totalWarnings },
        });
        process.exit(totalErrors > 0 ? EXIT_CODES.VALIDATION : EXIT_CODES.SUCCESS);
        return;
      }

      if (result.errors.length > 0) {
        for (const err of result.errors) {
          output.write(`  MARKETPLACE ERROR: ${err}`);
        }
      }

      for (const wb of result.workbenches) {
        if (wb.errors.length === 0 && wb.warnings.length === 0) {
          output.write(`${wb.path}: valid`);
          continue;
        }
        for (const err of wb.errors) {
          output.write(`  ERROR: ${err}`);
        }
        for (const warn of wb.warnings) {
          output.write(`  WARN:  ${warn}`);
        }
      }

      output.status(`\nMarketplace validated. ${result.workbenches.length} workbench(es), ${totalErrors} error(s), ${totalWarnings} warning(s).`);
      process.exit(totalErrors > 0 ? EXIT_CODES.VALIDATION : EXIT_CODES.SUCCESS);
    });

  return cmd;
}
