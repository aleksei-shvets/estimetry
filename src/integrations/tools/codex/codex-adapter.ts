import { join } from 'node:path';
import type { CommandContent } from '../../../application/contracts/command-content.js';
import { estimetryCommand } from '../../../application/contracts/estimetry-command.js';
import type { InstallContext, ToolAdapter, ToolState } from '../../../application/contracts/tool-adapter.js';
import type { FileChange, InstallPlan } from '../../../application/ports/file-change.js';
import type { ProjectFiles } from '../../../application/ports/project-files.js';
import { COMMANDS, ESTIMATE_REMINDER_BLOCK, ESTIMETRY_SKILL } from '../content/commands.js';
import { HOOK_TIMEOUT_SECONDS, hasOurHooks, isBrokenJson, withHooks, withoutHooks } from '../shared/hook-settings.js';
import { instructionsPlan } from '../shared/instructions-block.js';
import { nameSkills } from '../../../application/contracts/skill-mention.js';
import { skillsPlan } from '../shared/skills-plan.js';
import {
  CODEX_HOOK_EVENTS,
  CODEX_SHORT_TIMEOUT_EVENTS,
  CODEX_SHORT_TIMEOUT_SECONDS,
  CODEX_SYNCHRONOUS_EVENTS,
  codexSkillRef,
} from './hook-events.js';
import { hookTrusts, trustedBefore, untrustedHooks, withTrusts } from './hook-trust.js';
import { SANDBOX_RULES, isOurRules } from './sandbox-rules.js';
import { renderSkill } from './skill-file.js';

const PROJECT_HOOKS = join('.codex', 'hooks.json');
const SKILLS: readonly CommandContent[] = [ESTIMETRY_SKILL, ...COMMANDS];
/** Our hooks in a hooks file: `estimetry hook codex …`, in any form `estimetryCommand` gives. */
const OURS = 'hook codex';
const AGENTS_MD_BLOCK = nameSkills(ESTIMATE_REMINDER_BLOCK, codexSkillRef);
const TRUST_HINT =
  'Codex runs no hook you have not trusted, so it does not measure your sessions yet: ' +
  'run `estimetry init --tools codex --trust-hooks`, or open /hooks in Codex and trust the estimetry hooks';
const UNTRUSTED =
  'Codex has no trust of the estimetry hooks in its config.toml, so it may not run them: ' +
  'run `estimetry init --tools codex --trust-hooks`, or open /hooks in Codex and trust them';

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
  /** Codex runs a hook only once the user trusts it, and runs commands of the agent in a sandbox. */
  readonly asksTrust = true;

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
      // The user's hooks file serves every project: such an install belongs to no copy of its own.
      ...(installed && !shared ? { machineWide: true } : {}),
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

  private config(): string {
    return join(this.dirs.home, 'config.toml');
  }

  private untrusted(files: ProjectFiles, hooksPath: string): boolean {
    return untrustedHooks(files.read(this.config()), hookTrusts(hooksPath, files.read(hooksPath), OURS));
  }

  private hooks(context: InstallContext): InstallPlan {
    const { projectRoot, files, shared, runner } = context;
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
    const trust = this.trustPlan(context, target, current, content);
    const changes: FileChange[] = [{ path: target, content }, ...trust.changes];
    const warnings: string[] = [...trust.warnings];
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
    return { changes, skipped: trust.skipped, warnings };
  }

  /**
   * The trust of the hooks and the rule for the task commands, with the user's consent: given now (`trust: true`), or
   * given before for these hooks and kept when the hooks change (an upgrade). Without it, a hint how to give it.
   */
  private trustPlan(context: InstallContext, target: string, current: string | undefined, content: string): InstallPlan {
    const { files, shared, projectRoot, version } = context;
    const config = files.read(this.config());
    const trust = context.trust ?? trustedBefore(config, hookTrusts(target, current, OURS));
    const wanted = hookTrusts(target, content, OURS);
    if (!trust) {
      return { changes: [], skipped: [], warnings: untrustedHooks(config, wanted) ? [TRUST_HINT] : [] };
    }
    const rules = shared ? join(projectRoot, '.codex', 'rules', 'estimetry.rules') : join(this.dirs.home, 'rules', 'estimetry.rules');
    const existing = files.read(rules);
    const ownRules = existing === undefined || isOurRules(existing);
    return {
      changes: [
        { path: this.config(), content: withTrusts(config, wanted) },
        ...(ownRules ? [{ path: rules, content: SANDBOX_RULES(version) }] : []),
      ],
      skipped: ownRules ? [] : [{ path: rules, reason: 'not created by estimetry, left as it is' }],
      warnings: [],
    };
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

  /** The reminder goes to the committed AGENTS.md only with a shared install. */
  private agentsMd({ projectRoot, files, shared }: InstallContext): InstallPlan {
    const path = join(projectRoot, 'AGENTS.md');
    return instructionsPlan(path, files.read(path), shared, AGENTS_MD_BLOCK);
  }
}
