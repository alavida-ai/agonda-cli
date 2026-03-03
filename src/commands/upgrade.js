import { Command } from 'commander';
import {
  readInstanceManifest,
  fetchFrameworkPackage,
  detectDrift,
  planUpgrade,
  applyUpgrade,
} from '../lib/framework.js';
import { runHealthChecks } from '../lib/health.js';
import { findRepoRoot } from '../lib/context.js';
import { output } from '../utils/output.js';
import { AgondaError, EXIT_CODES } from '../utils/errors.js';
import { rmSync, existsSync } from 'node:fs';

export function upgradeCommand() {
  const cmd = new Command('upgrade')
    .description('Install or update the Agonda framework files in this repo')
    .option('--target <ver>', 'Install a specific version (default: latest)')
    .option('--force', 'Overwrite locally modified files without prompting')
    .action(async (opts, command) => {
      const globalOpts = command.optsWithGlobals();
      let tmpDir = null;

      try {
        // 1. Find repo root
        const repoRoot = findRepoRoot();

        // 2. Read current manifest
        const oldManifest = readInstanceManifest(repoRoot);
        const isFreshInstall = !oldManifest;

        // 3. Fetch framework package
        const versionLabel = opts.target || 'latest';
        if (!globalOpts.json) {
          output.status(isFreshInstall
            ? `Installing @alavida-ai/agonda-framework${opts.target ? `@${opts.target}` : ''}...`
            : `Checking for framework updates...`
          );
        }

        const pkg = fetchFrameworkPackage(opts.target);
        tmpDir = pkg.tmpDir;
        const newManifest = pkg.manifest;
        const newVersion = newManifest.version;

        // 4. Detect drift on current files (if upgrading)
        let drift = null;
        if (oldManifest) {
          drift = detectDrift(repoRoot, oldManifest);
        }

        // 5. Compute plan
        const plan = planUpgrade(oldManifest, newManifest, drift);
        const totalChanges = plan.added.length + plan.changed.length + plan.removed.length + plan.drifted.length;

        // Check for local drift (files modified since install)
        let localDrift = [];
        if (drift) {
          for (const [filePath, info] of drift) {
            if (info.status === 'DRIFTED' || info.status === 'MISSING') {
              localDrift.push(filePath);
            }
          }
        }

        // No package changes needed — but check for local drift
        if (!isFreshInstall && totalChanges === 0) {
          const fileCount = Object.keys(newManifest.files).length;

          if (localDrift.length === 0) {
            if (globalOpts.json) {
              output.json({ action: 'up_to_date', version: newVersion, files: fileCount });
            } else {
              output.write(`Framework v${newVersion} — already up to date (${fileCount} files).`);
            }
            return;
          }

          // Drift exists on same version
          if (globalOpts.dryRun) {
            if (globalOpts.json) {
              output.json({ action: 'drift_detected', version: newVersion, files: fileCount, drifted: localDrift, dryRun: true });
            } else {
              output.write(`Framework v${newVersion} — up to date, but ${localDrift.length} file(s) drifted locally:\n`);
              for (const f of localDrift) { output.write(`  ⚠ ${f}`); }
              output.write('\nDry run — no changes applied. Use --force to restore.');
            }
            return;
          }

          if (!opts.force) {
            if (globalOpts.json) {
              output.json({ action: 'drift_detected', version: newVersion, files: fileCount, drifted: localDrift, message: 'Use --force to restore drifted files.' });
            } else {
              output.write(`Framework v${newVersion} — up to date, but ${localDrift.length} file(s) drifted locally:\n`);
              for (const f of localDrift) { output.write(`  ⚠ ${f}`); }
              output.write('\nUse --force to restore drifted files to framework state.');
            }
            process.exit(EXIT_CODES.VALIDATION);
            return;
          }

          // --force: restore drifted files
          plan.drifted = localDrift;
        }

        // 6. Display plan
        if (globalOpts.json) {
          const planResult = {
            action: isFreshInstall ? 'install' : 'upgrade',
            from: oldManifest?.framework?.version || null,
            to: newVersion,
            plan: {
              added: plan.added,
              changed: plan.changed,
              removed: plan.removed,
              drifted: plan.drifted,
            },
            dryRun: !!globalOpts.dryRun,
          };

          if (globalOpts.dryRun) {
            output.json(planResult);
            return;
          }

          // Check for drift conflicts
          if (plan.drifted.length > 0 && !opts.force) {
            output.json({
              ...planResult,
              error: 'drift_conflict',
              message: `${plan.drifted.length} file(s) modified locally and changed in new version. Use --force to overwrite.`,
            });
            process.exit(EXIT_CODES.VALIDATION);
            return;
          }
        } else {
          // Human output
          if (isFreshInstall) {
            output.write(`Installing @alavida-ai/agonda-framework v${newVersion}...\n`);
          } else {
            output.write(`Framework: ${oldManifest.framework.version} → ${newVersion}\n`);
          }

          if (plan.added.length > 0) {
            output.write(`  Added:    ${plan.added[0]}`);
            for (let i = 1; i < plan.added.length; i++) {
              output.write(`            ${plan.added[i]}`);
            }
          }
          if (plan.changed.length > 0) {
            output.write(`  Changed:  ${plan.changed[0]}`);
            for (let i = 1; i < plan.changed.length; i++) {
              output.write(`            ${plan.changed[i]}`);
            }
          }
          if (plan.removed.length > 0) {
            output.write(`  Removed:  ${plan.removed[0]}`);
            for (let i = 1; i < plan.removed.length; i++) {
              output.write(`            ${plan.removed[i]}`);
            }
          }
          if (plan.drifted.length > 0) {
            for (const f of plan.drifted) {
              output.write(`  ⚠ Drift:  ${f} (modified locally)`);
            }
          }

          // 7. Dry run — exit
          if (globalOpts.dryRun) {
            output.write('\nDry run — no changes applied.');
            return;
          }

          // 8. Drift conflict check
          if (plan.drifted.length > 0 && !opts.force) {
            output.write(`\n${plan.drifted.length} file(s) modified locally and changed in the new version.`);
            output.write('Use --force to overwrite, or resolve manually.');
            process.exit(EXIT_CODES.VALIDATION);
            return;
          }
        }

        // 9. Apply
        applyUpgrade(repoRoot, pkg.packageDir, plan, newManifest);
        const fileCount = Object.keys(newManifest.files).length;

        // 10. Run health check
        let healthResult = null;
        try {
          healthResult = runHealthChecks(repoRoot);
        } catch {
          // Health check failure is non-blocking for upgrade
        }

        // 11. Display result
        if (globalOpts.json) {
          output.json({
            action: isFreshInstall ? 'installed' : 'upgraded',
            from: oldManifest?.framework?.version || null,
            to: newVersion,
            files: fileCount,
            plan: {
              added: plan.added.length,
              changed: plan.changed.length,
              removed: plan.removed.length,
              drifted: plan.drifted.length,
            },
            health: healthResult ? {
              domains: healthResult.summary.domains,
              errors: healthResult.summary.errors,
            } : null,
          });
        } else {
          if (isFreshInstall) {
            output.write(`\n  ${fileCount} files installed.`);
            output.write('  .agonda/manifest.json created.');
          } else {
            output.write(`\nApplied. ${fileCount} files installed.`);
          }

          if (healthResult) {
            output.write(`Health check: ${healthResult.summary.domains} domains, ${healthResult.summary.errors} errors.`);
          }
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
      } finally {
        // Clean up temp directory
        if (tmpDir && existsSync(tmpDir)) {
          rmSync(tmpDir, { recursive: true, force: true });
        }
      }
    });

  return cmd;
}
