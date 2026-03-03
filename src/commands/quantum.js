import { Command } from 'commander';
import { initQuantum } from '../lib/quantum.js';
import { output } from '../utils/output.js';
import { AgondaError, EXIT_CODES } from '../utils/errors.js';

export function quantumCommand() {
  const cmd = new Command('quantum')
    .description('Scaffold and manage quantum repos');

  cmd
    .command('init <name>')
    .description('Scaffold a new quantum repo from the canonical template')
    .option('-t, --type <type>', 'Quantum type: data-product or agentic', 'data-product')
    .option('-s, --schema <schema>', 'PostgreSQL schema name (default: name with underscores)')
    .option('-n, --namespace <namespace>', 'Event namespace (default: quantum name)')
    .option('-d, --description <desc>', 'Short description')
    .option('--template <source>', 'Override template source (for testing)')
    .action((name, opts, command) => {
      const globalOpts = command.optsWithGlobals();

      try {
        const result = initQuantum({
          name,
          type: opts.type,
          schema: opts.schema,
          namespace: opts.namespace,
          description: opts.description,
          template: opts.template,
          dryRun: globalOpts.dryRun || false,
          cwd: process.cwd(),
        });

        if (globalOpts.json) {
          output.json(result);
          return;
        }

        if (result.dry_run) {
          output.write(`[dry-run] Would scaffold ${result.quantum} (${result.type}) at ${result.path}`);
          output.write(`\nFiles that would be created:`);
          for (const f of result.files) {
            output.write(`  ${f}`);
          }
          return;
        }

        output.write(`Scaffolded ${result.quantum} quantum (${result.type}) at ${result.path}`);
        output.write(`\nSchema: ${result.schema}`);
        output.write(`Namespace: ${result.namespace}`);
        output.write(`Files: ${result.files.length}`);
        output.write(`\nNext steps:`);
        output.write(`  cd ${result.quantum}`);
        output.write(`  uv sync`);
        output.write(`  # Add DATABASE_URL to .env`);
        output.write(`  alembic upgrade head`);
        output.write(`  uvicorn src.clients.api.server:app --reload`);
      } catch (err) {
        if (err instanceof AgondaError) {
          if (globalOpts.json) {
            output.json(err.toJSON());
          } else {
            output.error(`Error: ${err.message}`);
            if (err.suggestion) {
              output.error(`Suggestion: ${err.suggestion}`);
            }
          }
          process.exit(err.exitCode);
        }
        throw err;
      }
    });

  return cmd;
}
