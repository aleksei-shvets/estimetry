import { join } from 'node:path';
import type { CommandContent } from '../../../application/contracts/command-content.js';
import type { FileChange, InstallPlan, SkippedFile } from '../../../application/contracts/file-change.js';
import type { InstallContext, ToolAdapter, ToolState } from '../../../application/contracts/tool-adapter.js';
import type { ProjectFiles } from '../../../application/ports/project-files.js';
import { COMMANDS, ESTIMETRY_SKILL } from '../content/commands.js';
import { withBlock, withoutBlock } from './claude-md.js';
import { hasOurHooks, withHooks, withoutHooks } from './hook-settings.js';
import { CLAUDE_CODE_HOOK_EVENTS, SYNCHRONOUS_HOOK_EVENTS } from './hook-events.js';
import { ownership, renderSkill } from './skill-file.js';

export { CLAUDE_CODE_HOOK_EVENTS } from './hook-events.js';

const SHARED_SETTINGS = join('.claude', 'settings.json');
const LOCAL_SETTINGS = join('.claude', 'settings.local.json');
const SKILLS: readonly CommandContent[] = [ESTIMETRY_SKILL, ...COMMANDS];

/**
 * Claude Code: hooks in the project settings, skills (which are also its slash
 * commands) in the user's directory or, for a shared install, in the project.
 */
export class ClaudeCodeAdapter implements ToolAdapter {
  readonly id = 'claude-code';
  readonly aliases = ['claude'];
  readonly title = 'Claude Code';
  readonly hookEvents: readonly string[] = CLAUDE_CODE_HOOK_EVENTS;

  /** `configDir` is the user's Claude Code directory: `$CLAUDE_CONFIG_DIR` or `~/.claude`. */
  constructor(private readonly configDir: string) {}

  state(projectRoot: string, files: ProjectFiles): ToolState {
    const shared = hasOurHooks(files.read(join(projectRoot, SHARED_SETTINGS)));
    return { installed: shared || hasOurHooks(files.read(join(projectRoot, LOCAL_SETTINGS))), shared };
  }

  personalFiles(): readonly string[] {
    return [LOCAL_SETTINGS];
  }

  plan(context: InstallContext): InstallPlan {
    const plans = [this.hooks(context), this.skills(context), this.claudeMd(context)];
    return {
      changes: plans.flatMap((plan) => plan.changes),
      skipped: plans.flatMap((plan) => plan.skipped),
      warnings: plans.flatMap((plan) => plan.warnings),
    };
  }

  private hooks({ projectRoot, files, shared }: InstallContext): InstallPlan {
    const [target, previous] = shared ? [SHARED_SETTINGS, LOCAL_SETTINGS] : [LOCAL_SETTINGS, SHARED_SETTINGS];
    const changes: FileChange[] = [
      { path: join(projectRoot, target), content: withHooks(files.read(join(projectRoot, target)), this.hookEvents, target, SYNCHRONOUS_HOOK_EVENTS) },
    ];
    const warnings: string[] = [];
    const old = files.read(join(projectRoot, previous));
    if (old !== undefined) {
      try {
        const cleaned = withoutHooks(old, previous);
        changes.push(cleaned === undefined ? { path: join(projectRoot, previous), remove: true } : { path: join(projectRoot, previous), content: cleaned });
      } catch {
        // Claude Code cannot read it either, so the old hooks do not run.
        warnings.push(`${previous} is not valid JSON, so the estimetry hooks in it were left as they are`);
      }
    }
    return { changes, skipped: [], warnings };
  }

  private skills({ projectRoot, files, shared, force, version }: InstallContext): InstallPlan {
    const changes: FileChange[] = [];
    const skipped: SkippedFile[] = [];
    const projectSkills = join(projectRoot, '.claude', 'skills');
    const target = shared ? projectSkills : join(this.configDir, 'skills');
    for (const skill of SKILLS) {
      const path = join(target, skill.id, 'SKILL.md');
      const current = files.read(path);
      const owner = current === undefined ? 'ours' : ownership(current);
      if (owner === 'foreign') {
        skipped.push({ path, reason: 'not created by estimetry, left as it is' });
      } else if (owner === 'edited' && !force) {
        skipped.push({ path, reason: 'edited after install; run init --force to overwrite it' });
      } else {
        changes.push({ path, content: renderSkill(skill, version) });
      }
      // A personal install takes the skills out of the project; a shared one keeps the personal ones for other projects.
      if (!shared) {
        const inProject = join(projectSkills, skill.id, 'SKILL.md');
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

  /** The reminder goes to the committed CLAUDE.md only with a shared install. */
  private claudeMd({ projectRoot, files, shared }: InstallContext): InstallPlan {
    const path = join(projectRoot, 'CLAUDE.md');
    const current = files.read(path);
    if (shared) {
      return { changes: [{ path, content: withBlock(current) }], skipped: [], warnings: [] };
    }
    if (current === undefined) {
      return { changes: [], skipped: [], warnings: [] };
    }
    return { changes: [{ path, content: withoutBlock(current) }], skipped: [], warnings: [] };
  }
}
