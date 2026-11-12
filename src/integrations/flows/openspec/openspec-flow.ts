import { join } from 'node:path';
import type { ChangesTouch, Flow } from '../../../application/contracts/flow.js';
import type { ProjectFiles } from '../../../application/ports/project-files.js';
import { openSpecArchived, openSpecPlan } from './openspec-plan.js';

/** OpenSpec: changes in `openspec/changes/<change>/`. Plan parsing and `openspec archive` come with the hooks. */
export const openSpecFlow: Flow = {
  id: 'openspec',
  title: 'OpenSpec',
  detect: (projectRoot: string, files: ProjectFiles) => files.isDirectory(join(projectRoot, 'openspec')),
  setupHint: (projectRoot: string, files: ProjectFiles) =>
    files.isDirectory(join(projectRoot, 'openspec'))
      ? undefined
      : 'the flow is OpenSpec, but the project has no openspec/ directory yet: run `openspec init` to set it up',
  plan: openSpecPlan,
  archived: openSpecArchived,
  touched: openSpecTouched,
};

/** A change is one directory under `openspec/changes`: no separators, not `.`, `..` or `archive`. */
const CHANGE_NAME = /^(?!(?:\.\.?|archive)$)[^/\\]+$/;

/**
 * The changes in this copy: the latest touch (the change of the `tasks.md` of
 * an active one — a checkbox ticked —, else of its directory; the move of an
 * archived one) and their state: which are active with what checkboxes, which
 * are archived. One listing of the archive for all of them.
 */
function openSpecTouched(projectRoot: string, files: ProjectFiles, changes: readonly string[]): ChangesTouch | undefined {
  const names = changes.filter((change) => CHANGE_NAME.test(change));
  if (names.length === 0) {
    return undefined;
  }
  const moments: number[] = [];
  const state: string[] = [];
  for (const name of names) {
    const dir = join(projectRoot, 'openspec', 'changes', name);
    if (files.isDirectory(dir)) {
      moments.push(files.changedAt(join(dir, 'tasks.md')) ?? files.changedAt(dir) ?? 0);
      state.push(`active ${name}\n${files.read(join(dir, 'tasks.md')) ?? ''}`);
    }
  }
  for (const archived of openSpecArchived(projectRoot, files)) {
    if (names.includes(archived.change)) {
      moments.push(files.changedAt(archived.path) ?? 0);
      state.push(`archived ${archived.directory}`);
    }
  }
  return moments.length === 0 ? undefined : { at: Math.max(...moments), state: state.sort().join('\n') };
}
