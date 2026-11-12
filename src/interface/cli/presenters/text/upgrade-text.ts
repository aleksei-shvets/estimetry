import type { PlannedFile } from '../../../../application/project/install-copy.js';
import type { UpgradePlanView } from '../../../../application/project/show-upgrade-plan.js';
import type { UpgradeReport } from '../../../../application/project/upgrade-projects.js';
import { table } from './format.js';

const VERB: Readonly<Record<PlannedFile['status'], string>> = {
  created: 'create',
  updated: 'update',
  removed: 'remove',
  unchanged: 'keep',
  skipped: 'skip',
};

const ONE_PROJECT = 'To update one project only, run `emt init` inside it instead.';

function fileRows(files: readonly PlannedFile[], verb: (file: PlannedFile) => string): string[][] {
  return files.map((file) => [`    ${verb(file)}`, file.reason === undefined ? file.path : `${file.path}: ${file.reason}`]);
}

function skippedLines(skipped: UpgradePlanView['skipped']): string[] {
  return skipped.length === 0 ? [] : ['Skipped:', ...skipped.map((copy) => `  ${copy.project}  ${copy.root}: ${copy.reason}`)];
}

/** What `emt upgrade` would change, shown before the user agrees. */
export function upgradePlanText(view: UpgradePlanView): string {
  const count = view.copies.length;
  if (count === 0) {
    return ['No working copy has estimetry set up on this machine.', ...skippedLines(view.skipped)].join('\n');
  }
  const copies = `${count} working cop${count === 1 ? 'y' : 'ies'}`;
  const lines = [`estimetry ${view.version} will be set up again in ${copies}, each with its own choices:`];
  for (const copy of view.copies) {
    const notes = [`set up by ${copy.installedBy ?? 'an older version'}`, ...(copy.shared ? ['shared install'] : [])];
    lines.push(`  ${copy.project}  ${copy.root}  (${notes.join(', ')})`);
    lines.push(copy.files.length === 0 ? '    nothing to change' : table(fileRows(copy.files, (file) => VERB[file.status])));
    if (copy.shared && copy.files.length > 0) {
      lines.push('    warning: these are files the project commits; your team gets them with your next commit');
    }
    lines.push(...copy.warnings.map((warning) => `    warning: ${warning}`));
  }
  return [...lines, ...skippedLines(view.skipped), ONE_PROJECT].join('\n');
}

/** What `emt upgrade` did. */
export function upgradeReportText(report: UpgradeReport): string {
  const count = report.upgraded.length;
  const lines = [`Set up estimetry ${report.version} again in ${count} working cop${count === 1 ? 'y' : 'ies'}.`];
  for (const copy of report.upgraded) {
    lines.push(`  ${copy.project}  ${copy.root}`);
    lines.push(copy.files.length === 0 ? '    unchanged' : table(fileRows(copy.files, (file) => file.status)));
    lines.push(...copy.warnings.map((warning) => `    warning: ${warning}`));
  }
  const failed = report.failed.map((copy) => `failed: ${copy.project}  ${copy.root}: ${copy.reason}`);
  return [...lines, ...skippedLines(report.skipped), ...failed].join('\n');
}
