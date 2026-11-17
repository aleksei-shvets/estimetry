import { join } from 'node:path';
import type { CommandContent } from '../../../application/contracts/command-content.js';
import type { FileChange, InstallPlan, SkippedFile } from '../../../application/ports/file-change.js';
import type { ProjectFiles } from '../../../application/ports/project-files.js';
import { ownership } from './generated-file.js';

/** Where a tool keeps the skills of estimetry, and how it renders one. */
export interface SkillsTarget {
  readonly files: ProjectFiles;
  /** The skills directory of the project (shared install). */
  readonly projectDir: string;
  /** The skills directory of the user (personal install). */
  readonly userDir: string;
  readonly shared: boolean;
  readonly force: boolean;
  readonly render: (skill: CommandContent) => string;
}

/**
 * Writes every skill to its directory, unless the file there is the user's or was edited after install (then only
 * with `force`). A personal install takes untouched copies out of the project; a shared one keeps the personal ones,
 * which serve other projects.
 */
export function skillsPlan(skills: readonly CommandContent[], target: SkillsTarget): InstallPlan {
  const { files, shared, force } = target;
  const changes: FileChange[] = [];
  const skipped: SkippedFile[] = [];
  const dir = shared ? target.projectDir : target.userDir;
  for (const skill of skills) {
    const path = join(dir, skill.id, 'SKILL.md');
    const current = files.read(path);
    const owner = current === undefined ? 'ours' : ownership(current);
    if (owner === 'foreign') {
      skipped.push({ path, reason: 'not created by estimetry, left as it is' });
    } else if (owner === 'edited' && !force) {
      skipped.push({ path, reason: 'edited after install; run init --force to overwrite it' });
    } else {
      changes.push({ path, content: target.render(skill) });
    }
    if (!shared) {
      const inProject = join(target.projectDir, skill.id, 'SKILL.md');
      const text = files.read(inProject);
      if (text !== undefined && ownership(text) === 'ours') {
        changes.push({ path: inProject, remove: true });
      } else if (text !== undefined && ownership(text) === 'edited') {
        skipped.push({ path: inProject, reason: 'edited after install, so it stays in the project' });
      }
    }
  }
  return { changes, skipped, warnings: [] };
}
