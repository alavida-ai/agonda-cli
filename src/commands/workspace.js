import { Command } from 'commander';
import { discoverWorkspaces, findWorkspacesByWorkbench } from '../lib/workspace.js';
import { output } from '../utils/output.js';

export function workspaceCommand() {
  const cmd = new Command('workspace')
    .description('Discover and manage workspaces');

  cmd
    .command('list')
    .description('Show all active workspaces')
    .action((opts, command) => {
      const globalOpts = command.optsWithGlobals();
      const workspaces = discoverWorkspaces();

      if (globalOpts.json) {
        output.json(workspaces.map((ws) => ({
          name: ws.name,
          path: ws.path,
          workbench: ws.workbench,
          domain: ws.domain,
          created: ws.created,
        })));
        return;
      }

      if (workspaces.length === 0) {
        output.write('No active workspaces found.');
        return;
      }

      output.table(
        ['Workspace', 'Workbench', 'Domain', 'Created'],
        workspaces.map((ws) => [ws.name, ws.workbench, ws.domain, ws.created])
      );
    });

  cmd
    .command('current')
    .description('Find workspace for a given workbench')
    .argument('[workbench]', 'Workbench name to find workspace for')
    .action((workbenchName, opts, command) => {
      const globalOpts = command.optsWithGlobals();

      if (!workbenchName) {
        // Try to detect from current directory context
        // For now, list all
        const workspaces = discoverWorkspaces();
        if (globalOpts.json) {
          output.json(workspaces);
        } else {
          output.error('Usage: agonda workspace current <workbench-name>');
        }
        return;
      }

      const matches = findWorkspacesByWorkbench(workbenchName);

      if (globalOpts.json) {
        output.json(matches.map((ws) => ({
          name: ws.name,
          path: ws.path,
          workbench: ws.workbench,
          domain: ws.domain,
          created: ws.created,
        })));
        return;
      }

      if (matches.length === 0) {
        output.write(`No workspace found for workbench "${workbenchName}".`);
        return;
      }

      if (matches.length === 1) {
        output.write(matches[0].path);
      } else {
        // Multiple matches — show all (solving head -1 problem)
        output.status(`Found ${matches.length} workspaces for "${workbenchName}":`);
        for (const ws of matches) {
          output.write(ws.path);
        }
      }
    });

  return cmd;
}
