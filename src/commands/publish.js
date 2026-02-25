import { Command } from 'commander';
import { validateSkillForPublish, checkGhAuth, publishSkill } from '../lib/publish.js';
import { output } from '../utils/output.js';
import { EXIT_CODES, AgondaError } from '../utils/errors.js';
import { createInterface } from 'node:readline';

async function confirm(message) {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

export function publishCommand() {
  const cmd = new Command('publish')
    .description('Publish a skill to the registry via PR')
    .argument('<skill-path>', 'Path to the skill directory to publish')
    .option('--confirm', 'Skip interactive confirmation')
    .option('--skill-version <version>', 'Override version (instead of reading from SKILL.md)')
    .action(async (skillPath, opts, command) => {
      const globalOpts = command.optsWithGlobals();

      try {
        // 1. Validate skill
        const skill = validateSkillForPublish(skillPath, { version: opts.skillVersion });

        // 2. Check gh auth
        checkGhAuth();

        // 3. Dry run
        if (globalOpts.dryRun) {
          const result = publishSkill(skill, { dryRun: true });
          if (globalOpts.json) {
            output.json(result);
          } else {
            output.write(`Dry run — would publish ${skill.name}@v${skill.version}\n`);
            for (const action of result.actions) {
              output.write(`  ${action}`);
            }
          }
          return;
        }

        // 4. Confirm
        if (!opts.confirm) {
          if (globalOpts.json) {
            output.json({ error: 'confirmation_required', message: 'Use --confirm for non-interactive mode' });
            process.exit(EXIT_CODES.GENERAL);
            return;
          }
          output.write(`Publishing ${skill.name}@v${skill.version} to ${skill.name}/`);
          const yes = await confirm('Proceed?');
          if (!yes) {
            output.write('Aborted.');
            return;
          }
        }

        // 5. Publish
        output.status(`Publishing ${skill.name}@v${skill.version}...`);
        const result = publishSkill(skill);

        if (globalOpts.json) {
          output.json(result);
        } else {
          output.write(`Published ${skill.name}@v${skill.version}`);
          output.write(`  Branch: ${result.branch}`);
          output.write(`  PR: ${result.prUrl}`);
          output.write('Tag will be created automatically on merge.');
        }
      } catch (err) {
        if (err instanceof AgondaError) {
          if (globalOpts.json) {
            output.json(err.toJSON());
          } else {
            output.error(`Error: ${err.message}`);
            if (err.suggestion) output.error(`Suggestion: ${err.suggestion}`);
          }
          process.exit(err.exitCode);
        }
        throw err;
      }
    });

  return cmd;
}
