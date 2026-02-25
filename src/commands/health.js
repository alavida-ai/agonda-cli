import { Command } from 'commander';
import { runHealthChecks } from '../lib/health.js';
import { output } from '../utils/output.js';
import { EXIT_CODES } from '../utils/errors.js';

export function healthCommand() {
  const cmd = new Command('health')
    .description('Run system health checks');

  cmd
    .command('run')
    .description('Scan all domains for compliance')
    .action((opts, command) => {
      const globalOpts = command.optsWithGlobals();
      const { results, summary } = runHealthChecks();

      if (globalOpts.json) {
        output.json({ results, summary });
        if (summary.errors > 0) process.exit(EXIT_CODES.VALIDATION);
        return;
      }

      if (results.length === 0) {
        output.write('No domains found.');
        return;
      }

      for (const r of results) {
        const icon = r.errors.length > 0 ? 'FAIL' : r.warnings.length > 0 ? 'WARN' : 'PASS';
        output.write(`\n[${icon}] ${r.domain}`);

        for (const e of r.errors) {
          output.write(`  ERROR [${e.check}] ${e.message}`);
          output.write(`    ${e.file}`);
        }
        for (const w of r.warnings) {
          output.write(`  WARN  [${w.check}] ${w.message}`);
          output.write(`    ${w.file}`);
        }

        if (r.errors.length === 0 && r.warnings.length === 0) {
          output.write('  All checks passed.');
        }
      }

      output.write(`\nSummary: ${summary.domains} domains, ${summary.errors} errors, ${summary.warnings} warnings`);

      if (summary.errors > 0) {
        process.exit(EXIT_CODES.VALIDATION);
      }
    });

  return cmd;
}
