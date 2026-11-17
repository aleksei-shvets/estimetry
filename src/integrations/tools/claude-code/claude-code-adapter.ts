import { join } from 'node:path';
import type { CommandContent } from '../../../application/contracts/command-content.js';
import type { FileChange, InstallPlan } from '../../../application/ports/file-change.js';
import type { InstallContext, ToolAdapter, ToolState } from '../../../application/contracts/tool-adapter.js';
import type { ProjectFiles } from '../../../application/ports/project-files.js';
import { COMMANDS, ESTIMATE_REMINDER_BLOCK, ESTIMETRY_SKILL } from '../content/commands.js';
import { estimetryCommand } from '../../../application/contracts/estimetry-command.js';
import { hasOurHooks, isBrokenJson, withHooks, withoutHooks } from '../shared/hook-settings.js';
import { instructionsPlan } from '../shared/instructions-block.js';
import { nameSkills } from '../../../application/contracts/skill-mention.js';
import { skillsPlan } from '../shared/skills-plan.js';
import { CLAUDE_CODE_HOOK_EVENTS, SYNCHRONOUS_HOOK_EVENTS, claudeCodeSkillRef } from './hook-events.js';
import { renderSkill } from './skill-file.js';

export { CLAUDE_CODE_HOOK_EVENTS } from './hook-events.js';

const SHARED_SETTINGS = join('.claude', 'settings.json');
const LOCAL_SETTINGS = join('.claude', 'settings.local.json');
const SKILLS: readonly CommandContent[] = [ESTIMETRY_SKILL, ...COMMANDS];
/** Our hooks in the settings: `estimetry hook claude-code …`, in any form `estimetryCommand` gives. */
const OURS = 'hook claude-code';
const CLAUDE_MD_BLOCK = nameSkills(ESTIMATE_REMINDER_BLOCK, claudeCodeSkillRef);

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
    const sharedText = files.read(join(projectRoot, SHARED_SETTINGS));
    const localText = files.read(join(projectRoot, LOCAL_SETTINGS));
    const shared = hasOurHooks(sharedText, OURS);
    const broken = [
      ...(isBrokenJson(sharedText) ? [SHARED_SETTINGS] : []),
      ...(isBrokenJson(localText) ? [LOCAL_SETTINGS] : []),
    ];
    return {
      installed: shared || hasOurHooks(localText, OURS),
      shared,
      ...(broken.length === 0 ? {} : { unreadable: `${broken.join(' and ')} ${broken.length === 1 ? 'is' : 'are'} not valid JSON` }),
    };
  }

  present(files: ProjectFiles): boolean {
    return files.isDirectory(this.configDir);
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

  private hooks({ projectRoot, files, shared, runner }: InstallContext): InstallPlan {
    const [target, previous] = shared ? [SHARED_SETTINGS, LOCAL_SETTINGS] : [LOCAL_SETTINGS, SHARED_SETTINGS];
    // Personal settings run this installation by its paths; settings the team commits hold no paths of this machine.
    const command = (event: string) => estimetryCommand(shared ? undefined : runner, `${OURS} ${event}`);
    const changes: FileChange[] = [
      {
        path: join(projectRoot, target),
        content: withHooks(
          files.read(join(projectRoot, target)),
          { ours: OURS, events: this.hookEvents, synchronous: SYNCHRONOUS_HOOK_EVENTS, command },
          target,
        ),
      },
    ];
    const warnings: string[] = [];
    const old = files.read(join(projectRoot, previous));
    if (old !== undefined) {
      try {
        const cleaned = withoutHooks(old, OURS, previous);
        changes.push(
          cleaned === undefined
            ? { path: join(projectRoot, previous), remove: true }
            : { path: join(projectRoot, previous), content: cleaned },
        );
      } catch {
        // Claude Code cannot read it either, so the old hooks do not run.
        warnings.push(`${previous} is not valid JSON, so the estimetry hooks in it were left as they are`);
      }
    }
    return { changes, skipped: [], warnings };
  }

  private skills({ projectRoot, files, shared, force, version }: InstallContext): InstallPlan {
    return skillsPlan(SKILLS, {
      files,
      projectDir: join(projectRoot, '.claude', 'skills'),
      userDir: join(this.configDir, 'skills'),
      shared,
      force,
      render: (skill) => renderSkill(skill, version),
    });
  }

  /** The reminder goes to the committed CLAUDE.md only with a shared install. */
  private claudeMd({ projectRoot, files, shared }: InstallContext): InstallPlan {
    const path = join(projectRoot, 'CLAUDE.md');
    return instructionsPlan(path, files.read(path), shared, CLAUDE_MD_BLOCK);
  }
}
