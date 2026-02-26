import { Command } from 'commander';
import { createRequire } from 'node:module';
import { formatError, AgondaError, EXIT_CODES } from './utils/errors.js';
import { output } from './utils/output.js';
import { workspaceCommand } from './commands/workspace.js';
import { workbenchCommand } from './commands/workbench.js';
import { marketplaceCommand } from './commands/marketplace.js';
import { primitivesCommand } from './commands/primitives.js';
import { healthCommand } from './commands/health.js';
import { publishCommand } from './commands/publish.js';
import { statusCommand } from './commands/status.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

export function createProgram() {
  const program = new Command();

  program
    .name('agonda')
    .description('Agonda framework CLI — workspace discovery, workbench validation, marketplace listing, health checks')
    .version(pkg.version, '-V, --version', 'Show version number')
    .option('--json', 'Output as JSON (forced regardless of TTY)')
    .option('-q, --quiet', 'Suppress non-essential output')
    .option('-v, --verbose', 'Show detailed output including debug info')
    .option('--workbench <path>', 'Override workbench context (name or path)')
    .option('--all', 'Operate on all workbenches (repo-wide)')
    .option('--dry-run', 'Preview changes without executing')
    .option('--deep', 'Enable LLM-assisted analysis (uses tokens)');

  // Register subcommand groups
  program.addCommand(workspaceCommand());

  program.addCommand(workbenchCommand());

  program.addCommand(marketplaceCommand());

  program.addCommand(primitivesCommand());

  program.addCommand(healthCommand());

  program.addCommand(publishCommand());

  program.addCommand(statusCommand());

  // Custom help: show examples-first format
  program.addHelpText('after', `
Exit Codes:
  0  Success
  1  General error (bad args, unexpected failure)
  2  Validation failure (plugin invalid, health check failed)
  3  Network error (GitHub API unreachable, timeout)
  4  Not found (no workbench.json, missing primitive)

Run 'agonda <command> --help' for details on a specific command.`);

  // No subcommand → show help and exit 0
  program.action(() => {
    program.help();
  });

  return program;
}

export function run(argv) {
  const program = createProgram();

  // Global error handling
  process.on('uncaughtException', (err) => {
    const opts = program.opts?.() || {};
    if (opts.json) {
      output.json({ error: 'uncaught_exception', message: err.message });
    } else {
      output.error(formatError(err));
    }
    process.exit(EXIT_CODES.GENERAL);
  });

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    const opts = program.opts?.() || {};
    if (opts.json) {
      output.json({ error: 'unhandled_rejection', message: err.message });
    } else {
      output.error(formatError(err));
    }
    process.exit(EXIT_CODES.GENERAL);
  });

  // Parse and execute
  program.parseAsync(argv).catch((err) => {
    if (err instanceof AgondaError) {
      const opts = program.opts?.() || {};
      if (opts.json) {
        output.json({ error: err.code, message: err.message });
      } else {
        output.error(formatError(err));
      }
      process.exit(err.exitCode);
    }
    process.exit(EXIT_CODES.GENERAL);
  });
}
