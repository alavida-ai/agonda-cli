import { Command } from 'commander';
import { checkAllPrimitives, installPrimitives, updatePrimitive } from '../lib/primitives.js';
import { findWorkbenchContext, findAllWorkbenches } from '../lib/context.js';
import { output } from '../utils/output.js';
import { EXIT_CODES } from '../utils/errors.js';

export function primitivesCommand() {
  const cmd = new Command('primitives')
    .description('Manage skill primitives');

  cmd
    .command('status')
    .description('Compare pinned versions against latest in registry')
    .action((opts, command) => {
      const globalOpts = command.optsWithGlobals();
      const { results, summary } = checkAllPrimitives({ all: !!globalOpts.all });

      if (globalOpts.json) {
        output.json({ results, summary });
        if (summary.behind > 0) process.exit(EXIT_CODES.VALIDATION);
        return;
      }

      if (results.length === 0) {
        output.write('No workbenches with primitives found.');
        return;
      }

      for (const r of results) {
        output.write(`\n${r.workbench} (${r.path})`);
        output.table(
          ['Primitive', 'Pinned', 'Latest', 'Status'],
          r.primitives.map((p) => [p.name, p.pinned, p.latest, p.status])
        );
      }

      output.write(`\nSummary: ${summary.current} current, ${summary.behind} behind, ${summary.unknown} unknown`);

      if (summary.behind > 0) {
        output.status('Some primitives are behind. Run "agonda primitives update <name>" to update.');
        process.exit(EXIT_CODES.VALIDATION);
      }
    });

  cmd
    .command('install')
    .description('Download primitives from registry at pinned versions')
    .option('--update', 'Bump pins to latest before installing')
    .action((opts, command) => {
      const globalOpts = command.optsWithGlobals();
      const update = !!opts.update;
      const dryRun = !!globalOpts.dryRun;

      let workbenches;
      if (globalOpts.all) {
        workbenches = findAllWorkbenches();
      } else {
        const ctx = findWorkbenchContext();
        if (ctx) {
          const name = ctx.relativePath.split('/').pop();
          workbenches = [{ name, relativePath: ctx.relativePath, path: ctx.path, config: ctx.config }];
        } else {
          workbenches = findAllWorkbenches();
        }
      }

      const allResults = [];
      for (const wb of workbenches) {
        if (!wb.config.primitives || Object.keys(wb.config.primitives).length === 0) continue;
        const result = installPrimitives(wb, { update, dryRun });
        allResults.push(result);
      }

      if (globalOpts.json) {
        output.json(allResults);
        return;
      }

      if (allResults.length === 0) {
        output.write('No workbenches with primitives found.');
        return;
      }

      if (dryRun) {
        output.write('Dry run — no changes written.\n');
      }

      for (const r of allResults) {
        if (r.actions.length === 0) continue;
        output.write(`\n${r.workbench} (${r.path})`);
        for (const a of r.actions) {
          const prefix = a.action.startsWith('would_') ? 'Would' : '';
          const verb = a.action.replace('would_', '');
          const from = a.from ? ` (from ${a.from})` : '';
          const reason = a.reason ? ` — ${a.reason}` : '';
          output.write(`  ${prefix ? prefix + ' ' : ''}${verb}: ${a.name}@${a.version}${from}${reason}`);
        }
      }
    });

  cmd
    .command('update')
    .description('Update a primitive to latest version')
    .argument('<name>', 'Primitive name to update')
    .action((name, opts, command) => {
      const globalOpts = command.optsWithGlobals();
      const dryRun = !!globalOpts.dryRun;

      let workbenches;
      if (globalOpts.all) {
        workbenches = findAllWorkbenches();
      } else {
        const ctx = findWorkbenchContext();
        if (ctx) {
          const wbName = ctx.relativePath.split('/').pop();
          workbenches = [{ name: wbName, relativePath: ctx.relativePath, path: ctx.path, config: ctx.config }];
        } else {
          workbenches = findAllWorkbenches();
        }
      }

      const result = updatePrimitive(name, workbenches, { dryRun });

      if (result.error === 'not_found') {
        output.error(`Primitive "${name}" not found in registry.`);
        process.exit(EXIT_CODES.NOT_FOUND);
        return;
      }

      if (globalOpts.json) {
        output.json(result);
        return;
      }

      if (result.results.length === 0) {
        output.write(`No workbenches pin "${name}".`);
        return;
      }

      if (dryRun) {
        output.write('Dry run — no changes written.\n');
      }

      for (const r of result.results) {
        const arrow = r.from === r.to ? '(current)' : `${r.from} → ${r.to}`;
        const prefix = r.action.startsWith('would_') ? '[dry-run] ' : '';
        output.write(`${prefix}${r.workbench}: ${name} ${arrow}`);
      }
    });

  return cmd;
}
