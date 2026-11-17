import { join } from 'node:path';
import type { CommandContent } from '../../../application/contracts/command-content.js';
import { estimetryCommand } from '../../../application/contracts/estimetry-command.js';
import type { InstallContext, ToolAdapter, ToolState } from '../../../application/contracts/tool-adapter.js';
import type { FileChange, InstallPlan } from '../../../application/ports/file-change.js';
import type { ProjectFiles } from '../../../application/ports/project-files.js';
import { COMMANDS, ESTIMETRY_SKILL } from '../content/commands.js';
import { HOOK_TIMEOUT_SECONDS, hasOurHooks, isBrokenJson, withHooks, withoutHooks } from '../shared/hook-settings.js';
import { withBlock, withoutBlock } from '../shared/instructions-block.js';
import { skillsPlan } from '../shared/skills-plan.js';
import {
  CODEX_HOOK_EVENTS,
  CODEX_SHORT_TIMEOUT_EVENTS,
  CODEX_SHORT_TIMEOUT_SECONDS,
  CODEX_SYNCHRONOUS_EVENTS,
  codexSkillRef,
} from './hook-events.js';
import { untrustedHooks } from './hook-trust.js';
import { renderSkill } from './skill-file.js';

const PROJECT_HOOKS = join('.codex', 'hooks.json');
const SKILLS: readonly CommandContent[] = [ESTIMETRY_SKILL, ...COMMANDS];
/** Our hooks in a hooks file: `estimetry hook codex …`, in any form `estimetryCommand` gives. */
const OURS = 'hook codex';
const AGENTS_MD_BLOCK =
  `Before you name a deadline or an effort for a task, run \`${codexSkillRef('emt-estimate')}\`: ` +
  'it bases the estimate on past tasks and saves it as the plan the actual effort is measured against.';
const TRUST_REMINDER = 'Codex runs the new hooks only after you trust them: open /hooks in Codex and trust the estimetry hooks.';
const UNTRUSTED = 'the estimetry hooks of Codex are not trusted yet, so Codex does not run them: open /hooks in Codex and trust them';

/** Where Codex keeps what estimetry installs for one user. */
export interface CodexDirs {
  /** `$CODEX_HOME`, else `~/.codex`: the user's hooks file and config. */
  readonly home: string;
  /** `~/.agents/skills`: the user's skills. */
  readonly userSkills: string;
}

/**
 * Codex: hooks in `hooks.json` (the user's one, which serves every project, or the project's one for the team),
 * skills in `.agents/skills`, the reminder in `AGENTS.md` with a shared install. Codex has no personal settings
 * inside a project, so a personal install writes nothing there (design.md of codex-adapter, D3).
 */
export class CodexAdapter implements ToolAdapter {
  readonly id = 'codex';
  readonly aliases = ['openai-codex'];
  readonly title = 'Codex';
  readonly hookEvents: readonly string[] = CODEX_HOOK_EVENTS;

  constructor(private readonly dirs: CodexDirs) {}

  state(projectRoot: string, files: ProjectFiles): ToolState {
    const userText = files.read(this.userHooks());
    const projectText = files.read(join(projectRoot, PROJECT_HOOKS));
    const shared = hasOurHooks(projectText, OURS);
    const installed = shared || hasOurHooks(userText, OURS);
    const broken = [
      ...(isBrokenJson(userText) ? [this.userHooks()] : []),
      ...(isBrokenJson(projectText) ? [PROJECT_HOOKS] : []),
    ];
    const untrusted = installed && this.untrusted(files, shared ? join(projectRoot, PROJECT_HOOKS) : this.userHooks());
    return {
      installed,
      shared,
      ...(broken.length === 0 ? {} : { unreadable: `${broken.join(' and ')} ${broken.length === 1 ? 'is' : 'are'} not valid JSON` }),
      ...(untrusted ? { notice: UNTRUSTED } : {}),
    };
  }

  present(files: ProjectFiles): boolean {
    return files.isDirectory(this.dirs.home);
  }

  personalFiles(): readonly string[] {
    return [];
  }

  plan(context: InstallContext): InstallPlan {
    const plans = [this.hooks(context), this.skills(context), this.agentsMd(context)];
    return {
      changes: plans.flatMap((plan) => plan.changes),
      skipped: plans.flatMap((plan) => plan.skipped),
      warnings: plans.flatMap((plan) => plan.warnings),
    };
  }

  private userHooks(): string {
    return join(this.dirs.home, 'hooks.json');
  }

  private untrusted(files: ProjectFiles, hooksPath: string): boolean {
    return untrustedHooks(files.read(join(this.dirs.home, 'config.toml')), hooksPath, files.read(hooksPath), OURS) === true;
  }

  private hooks({ projectRoot, files, shared, runner }: InstallContext): InstallPlan {
    const projectPath = join(projectRoot, PROJECT_HOOKS);
    const [target, display] = shared ? [projectPath, PROJECT_HOOKS] : [this.userHooks(), this.userHooks()];
    // The user's hooks run this installation by its paths; hooks the team commits hold no paths of this machine.
    const command = (event: string) => estimetryCommand(shared ? undefined : runner, `${OURS} ${event}`);
    const current = files.read(target);
    const content = withHooks(
      current,
      {
        ours: OURS,
        events: this.hookEvents,
        synchronous: CODEX_SYNCHRONOUS_EVENTS,
        command,
        timeout: (event) => (CODEX_SHORT_TIMEOUT_EVENTS.includes(event) ? CODEX_SHORT_TIMEOUT_SECONDS : HOOK_TIMEOUT_SECONDS),
      },
      display,
    );
    const changes: FileChange[] = [{ path: target, content }];
    const warnings: string[] = [];
    if (content !== current) {
      warnings.push(TRUST_REMINDER); // a new or changed hook waits for a trust in Codex
    } else if (this.untrusted(files, target)) {
      warnings.push(UNTRUSTED);
    }
    if (shared) {
      if (hasOurHooks(files.read(this.userHooks()), OURS)) {
        warnings.push(
          `the estimetry hooks are also in ${this.userHooks()}, which serves every project: Codex runs both, ` +
            'so each hook runs twice here (the fact stays right). Remove them from that file if this project is enough',
        );
      }
    } else {
      const old = files.read(projectPath);
      if (old !== undefined && hasOurHooks(old, OURS)) {
        const cleaned = withoutHooks(old, OURS, PROJECT_HOOKS);
        changes.push(cleaned === undefined ? { path: projectPath, remove: true } : { path: projectPath, content: cleaned });
      }
    }
    return { changes, skipped: [], warnings };
  }

  private skills({ projectRoot, files, shared, force, version }: InstallContext): InstallPlan {
    return skillsPlan(SKILLS, {
      files,
      projectDir: join(projectRoot, '.agents', 'skills'),
      userDir: this.dirs.userSkills,
      shared,
      force,
      render: (skill) => renderSkill(skill, version),
    });
  }

  /** The reminder goes to the committed AGENTS.md only with a shared install; a file left with nothing else goes. */
  private agentsMd({ projectRoot, files, shared }: InstallContext): InstallPlan {
    const path = join(projectRoot, 'AGENTS.md');
    const current = files.read(path);
    if (shared) {
      return { changes: [{ path, content: withBlock(current, AGENTS_MD_BLOCK) }], skipped: [], warnings: [] };
    }
    if (current === undefined) {
      return { changes: [], skipped: [], warnings: [] };
    }
    const rest = withoutBlock(current);
    if (rest === current) {
      return { changes: [], skipped: [], warnings: [] };
    }
    const change: FileChange = rest === '' ? { path, remove: true } : { path, content: rest };
    return { changes: [change], skipped: [], warnings: [] };
  }
}
