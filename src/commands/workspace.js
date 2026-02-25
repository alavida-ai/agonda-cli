import { Command } from 'commander';
import { discoverWorkspaces, findWorkspacesByWorkbench, findUnmarkedWorkspaces } from '../lib/workspace.js';
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
      const unmarked = findUnmarkedWorkspaces();

      if (globalOpts.json) {
        output.json({
          workspaces: workspaces.map((ws) => ({
            name: ws.name,
            path: ws.path,
            workbench: ws.workbench,
            domain: ws.domain,
            created: ws.created,
          })),
          warnings: unmarked.map((u) => ({
            path: u.path,
            message: `Missing .workbench marker — invisible to CLI`,
          })),
        });
        return;
      }

      if (workspaces.length === 0) {
        output.write('No active workspaces found.');
      } else {
        output.table(
          ['Workspace', 'Workbench', 'Domain', 'Created'],
          workspaces.map((ws) => [ws.name, ws.workbench, ws.domain, ws.created])
        );
      }

      if (unmarked.length > 0) {
        output.write('');
        output.status(`${unmarked.length} workspace(s) without .workbench marker:`);
        for (const u of unmarked) {
          output.status(`  ${u.path}`);
        }
        output.status('Add a .workbench marker to make them discoverable.');
      }
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
        if (globalOpts.json) {
          output.json({ workspaces: [], workbench: workbenchName, suggestion: 'Create a workspace with a .workbench marker' });
        } else {
          output.write(`No workspace found for workbench "${workbenchName}".`);
          output.status('Tip: Create a workspace directory under workspace/active/ with a .workbench marker.');
        }
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
