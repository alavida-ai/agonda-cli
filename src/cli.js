import { Command } from 'commander';
import { createRequire } from 'node:module';
import { formatError, AgondaError, EXIT_CODES } from './utils/errors.js';
import { output } from './utils/output.js';
import { workspaceCommand } from './commands/workspace.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

export function createProgram() {
  const program = new Command();

  program
    .name('agonda')
    .description('Agonda framework CLI — workspace discovery, primitive management, plugin management, health checks')
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

  program
    .command('plugin')
    .description('Validate and manage plugins')
    .addHelpText('after', `
Examples:
  agonda plugin list                   Show all plugins and their status
  agonda plugin validate               Validate current plugin structure
  agonda plugin enable <name>          Enable a plugin
  agonda plugin switch <name>          Switch to a single plugin`);

  program
    .command('primitives')
    .description('Manage skill primitives')
    .addHelpText('after', `
Examples:
  agonda primitives status             Check pinned vs latest versions
  agonda primitives install            Install primitives from workbench.json
  agonda primitives update <name>      Update a primitive to latest`);

  program
    .command('health')
    .description('Run system health checks')
    .addHelpText('after', `
Examples:
  agonda health run                    Scan all domains for compliance
  agonda health run --json             Machine-readable results
  agonda health run --deep             Include LLM-assisted checks`);

  program
    .command('publish')
    .description('Publish a skill to the registry')
    .addHelpText('after', `
Examples:
  agonda publish <skill-path>          Publish a skill via PR
  agonda publish <path> --confirm      Skip interactive confirmation
  agonda publish <path> --dry-run      Preview without publishing`);

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
