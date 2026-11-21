import { beforeEach, describe, expect, it } from 'vitest';
import { InstallBlocked } from '../../../src/application/contracts/install-blocked.js';
import type { EstimetryRunner } from '../../../src/application/ports/estimetry-runner.js';
import type { InstallPlan } from '../../../src/application/ports/file-change.js';
import { isRemoval } from '../../../src/application/ports/file-change.js';
import { CodexAdapter } from '../../../src/integrations/tools/codex/codex-adapter.js';
import { renderSkill } from '../../../src/integrations/tools/codex/skill-file.js';
import { COMMANDS, ESTIMETRY_SKILL } from '../../../src/integrations/tools/content/commands.js';
import { ownership } from '../../../src/integrations/tools/shared/generated-file.js';
import { InMemoryProjectFiles } from '../../support/in-memory-files.js';

const ROOT = '/work/app';
const HOME = '/home/u/.codex';
const USER_SKILLS = '/home/u/.agents/skills';
const USER_HOOKS = `${HOME}/hooks.json`;
const PROJECT_HOOKS = `${ROOT}/.codex/hooks.json`;
const AGENTS_MD = `${ROOT}/AGENTS.md`;
const RUNNER: EstimetryRunner = { node: '/opt/node/bin/node', main: '/opt/lib/estimetry/main.js', home: '/data/estimetry' };

let files: InMemoryProjectFiles;
const adapter = new CodexAdapter({ home: HOME, userSkills: USER_SKILLS });

function install(options: { shared?: boolean; force?: boolean; runner?: EstimetryRunner; trust?: boolean } = {}): InstallPlan {
  const context = {
    projectRoot: ROOT,
    files,
    shared: options.shared ?? false,
    force: options.force ?? false,
    version: '1.0.0',
    ...(options.trust === undefined ? {} : { trust: options.trust }),
  };
  const plan = adapter.plan(options.runner === undefined ? context : { ...context, runner: options.runner });
  for (const change of plan.changes) {
    if (isRemoval(change)) {
      files.remove(change.path);
    } else {
      files.write(change.path, change.content);
    }
  }
  return plan;
}

type Handler = { type: string; command: string; timeout?: number; async?: boolean };
const json = (path: string) => JSON.parse(files.read(path) ?? 'null') as { hooks: Record<string, { hooks: Handler[] }[]>; [key: string]: unknown };
const ours = (path: string) => Object.values(json(path).hooks).flatMap((groups) => groups.flatMap((g) => g.hooks)).filter((h) => h.command.includes('hook codex'));

beforeEach(() => {
  files = new InMemoryProjectFiles();
});

describe('Codex hooks', () => {
  it('a personal install writes one hook per event into the user hooks file, nothing into the project', () => {
    install();
    const hooks = json(USER_HOOKS).hooks;
    expect(Object.keys(hooks)).toEqual(adapter.hookEvents);
    expect(hooks['Stop']).toEqual([{ hooks: [{ type: 'command', command: 'estimetry hook codex Stop', timeout: 10, async: true }] }]);
    for (const event of ['SessionStart', 'UserPromptSubmit', 'SessionEnd']) {
      expect(hooks[event]?.[0]?.hooks[0]).not.toHaveProperty('async');
    }
    expect(hooks['SessionEnd']?.[0]?.hooks[0]?.timeout).toBe(3);
    expect(hooks['Interrupt']?.[0]?.hooks[0]?.timeout).toBe(3);
    expect(files.read(PROJECT_HOOKS)).toBeUndefined();
    expect(adapter.state(ROOT, files)).toMatchObject({ installed: true, shared: false, notice: expect.stringContaining('/hooks') });
    expect(adapter.personalFiles()).toEqual([]);
  });

  it('a personal install runs this installation by its paths; a shared one runs estimetry from PATH', () => {
    install({ runner: RUNNER });
    expect(ours(USER_HOOKS)[0]?.command).toContain("'/opt/node/bin/node' '/opt/lib/estimetry/main.js' hook codex");
    install({ shared: true, runner: RUNNER });
    expect(ours(PROJECT_HOOKS).every((h) => h.command.startsWith('estimetry hook codex '))).toBe(true);
    expect(adapter.state(ROOT, files)).toMatchObject({ installed: true, shared: true });
  });

  it('keeps hooks of others and does not duplicate its own', () => {
    files.write(USER_HOOKS, JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'cat notes.md' }] }] } }, null, 4));
    install();
    const second = install();
    expect(json(USER_HOOKS).hooks['UserPromptSubmit']?.[0]?.hooks[0]?.command).toBe('cat notes.md');
    expect(ours(USER_HOOKS)).toHaveLength(adapter.hookEvents.length);
    expect(files.read(USER_HOOKS)).toMatch(/^ {4}"hooks"/m);
    expect(second.warnings).not.toContain(expect.stringContaining('trust them'));
  });

  it('reminds to trust the hooks when the hooks file changes', () => {
    expect(install().warnings.join('\n')).toContain('open /hooks in Codex and trust the estimetry hooks');
  });

  it('a hooks file that is not JSON blocks the install and is unreadable', () => {
    files.write(USER_HOOKS, '{ broken');
    expect(() => install()).toThrow(InstallBlocked);
    expect(adapter.state(ROOT, files)).toEqual({ installed: false, shared: false, unreadable: `${USER_HOOKS} is not valid JSON` });
  });

  it('a personal install takes our hooks out of the project; a shared one warns about the hooks of the user', () => {
    install({ shared: true });
    install();
    expect(files.read(PROJECT_HOOKS)).toBeUndefined();
    const shared = install({ shared: true });
    expect(shared.warnings.join('\n')).toMatch(/also in .*hooks\.json.*runs twice/);
    expect(ours(USER_HOOKS)).toHaveLength(adapter.hookEvents.length); // the user's file serves other projects
  });

  it('is present when its user directory exists', () => {
    expect(adapter.present(files)).toBe(false);
    files.write(`${HOME}/config.toml`, 'model = "x"\n');
    expect(adapter.present(files)).toBe(true);
  });
});

describe('trust of the Codex hooks', () => {
  const CONFIG = `${HOME}/config.toml`;
  const RULES = `${HOME}/rules/estimetry.rules`;

  it('computes the trust hash Codex itself computes: one Codex 0.162.1 wrote for this hook', () => {
    install({ shared: true, trust: true });
    const key = `[hooks.state."${ROOT}/.codex/hooks.json:pre_tool_use:0:0"]`;
    const config = files.read(CONFIG) ?? '';
    expect(config).toContain(`${key}\ntrusted_hash = "sha256:46dcd7f0c41071dc48c3bda925abe51e63586bc4aeb628cc27fe822d3a4254b3"`);
    expect(config.match(/trusted_hash/g)).toHaveLength(10);
    expect(adapter.state(ROOT, files)).not.toHaveProperty('notice');
  });

  it('with consent writes the trusts and the rule for the task commands, and keeps the rest of the config', () => {
    files.write(CONFIG, `model = "x"\n\n[hooks.state."${USER_HOOKS}:stop:0:0"]\nenabled = false\ntrusted_hash = "sha256:old"\n`);
    const plan = install({ trust: true });
    const config = files.read(CONFIG) ?? '';
    expect(config.startsWith('model = "x"\n')).toBe(true);
    expect(config.match(/hooks\.json:stop:0:0/g)).toHaveLength(1);
    expect(config).toMatch(/json:stop:0:0"\]\nenabled = false\ntrusted_hash = "sha256:[0-9a-f]{64}"/);
    expect(files.read(RULES)).toMatch(/^# Written by estimetry 1\.0\.0/);
    expect(files.read(RULES)).toContain('prefix_rule(pattern=["emt", ["task","start"');
    expect(files.read(RULES)).not.toMatch(/"init"|"upgrade"|"rebuild"/);
    expect(plan.warnings.join('\n')).not.toContain('--trust-hooks');
    expect(install({ trust: true }).changes.every((change) => !('content' in change) || files.read(change.path) === change.content)).toBe(true);
  });

  it('without consent writes no trust and says how to give it', () => {
    const plan = install({ trust: false });
    expect(files.read(CONFIG)).toBeUndefined();
    expect(files.read(RULES)).toBeUndefined();
    expect(plan.warnings.join('\n')).toContain('estimetry init --tools codex --trust-hooks');
    expect(adapter.state(ROOT, files).notice).toMatch(/no trust of the estimetry hooks/);
  });

  it('an upgrade that changes the hooks trusts them again while our rule says the user agreed, and only then', () => {
    install({ trust: true, runner: { node: '/old/node', main: '/old/main.js', home: '/data' } });
    install({ runner: { node: '/new/node', main: '/new/main.js', home: '/data' } });
    expect(adapter.state(ROOT, files)).not.toHaveProperty('notice');
    // A trust given in /hooks alone is no consent to the rule: without our rule the upgrade trusts nothing.
    files.remove(RULES);
    install({ runner: { node: '/newer/node', main: '/newer/main.js', home: '/data' } });
    expect(adapter.state(ROOT, files).notice).toMatch(/no trust of the estimetry hooks/);
    expect(files.read(RULES)).toBeUndefined();
  });

  it('--no-trust-hooks takes our rule away; the trusts Codex keeps stay', () => {
    install({ trust: true });
    install({ trust: false });
    expect(files.read(RULES)).toBeUndefined();
    expect(files.read(CONFIG)).toContain('trusted_hash');
  });

  it('a shared install keeps the rule with the user: one consent does not go into the team repository', () => {
    install({ shared: true, trust: true });
    expect(files.read(RULES)).toBeDefined();
    expect(files.read(`${ROOT}/.codex/rules/estimetry.rules`)).toBeUndefined();
  });

  it('a config estimetry cannot change safely is left alone, with a hint to trust in /hooks', () => {
    files.write(CONFIG, '[hooks]\nstate = {}\n');
    const plan = install({ trust: true });
    expect(files.read(CONFIG)).toBe('[hooks]\nstate = {}\n');
    expect(plan.warnings.join('\n')).toMatch(/open \/hooks in Codex/);
  });

  it('a hook changed after its trust is not trusted: the hash is of the old form', () => {
    install({ trust: true });
    install({ trust: false, runner: { node: '/other/node', main: '/other/main.js', home: '/data' } });
    expect(adapter.state(ROOT, files).notice).toMatch(/no trust of the estimetry hooks/);
  });

  it('leaves a rules file of the user alone', () => {
    files.write(RULES, 'prefix_rule(pattern=["emt"], decision="forbidden")\n');
    const plan = install({ trust: true });
    expect(files.read(RULES)).toBe('prefix_rule(pattern=["emt"], decision="forbidden")\n');
    expect(plan.skipped.map((skip) => skip.path)).toContain(RULES);
  });

  it('warns a first user too: a config with no trusts at all, or no config', () => {
    install();
    expect(adapter.state(ROOT, files).notice).toMatch(/no trust of the estimetry hooks/);
    files.write(CONFIG, 'model = "x"\n');
    expect(adapter.state(ROOT, files).notice).toMatch(/no trust of the estimetry hooks/);
  });
});

describe('Codex skills', () => {
  it('go to the skills of the user by default and to the project with a shared install', () => {
    install();
    expect(files.read(`${USER_SKILLS}/emt-start/SKILL.md`)).toBeDefined();
    expect(files.read(`${USER_SKILLS}/estimetry/SKILL.md`)).toBeDefined();
    expect(files.read(`${ROOT}/.agents/skills/emt-start/SKILL.md`)).toBeUndefined();
    install({ shared: true });
    expect(files.read(`${ROOT}/.agents/skills/emt-start/SKILL.md`)).toBeDefined();
    install();
    expect(files.read(`${ROOT}/.agents/skills/emt-start/SKILL.md`)).toBeUndefined();
  });

  it('call other skills with $ and take the arguments from the message; no mark of the core is left', () => {
    const texts = [ESTIMETRY_SKILL, ...COMMANDS].map((skill) => renderSkill(skill, '1.0.0'));
    expect(texts.join('\n')).not.toMatch(/\{\{|\$ARGUMENTS|`\/emt-/);
    const close = renderSkill(COMMANDS.find((c) => c.id === 'emt-close')!, '1.0.0');
    expect(close).toContain('`$emt-retro`');
    expect(close).toContain('emt close <arguments> --yes');
    expect(close).toContain('`<arguments>` below stands for what the user wrote after `$emt-close`');
    expect(close).toMatch(/^---\nname: emt-close\ndescription: ".*"\nmetadata:\n {2}generatedBy: "estimetry 1\.0\.0"\n {2}contentHash: "[0-9a-f]{12}"\n---\n/);
    expect(close).not.toMatch(/allowed-tools|argument-hint/);
    expect(ownership(close)).toBe('ours');
  });

  it('a skill the user edited stays without --force', () => {
    install();
    const path = `${USER_SKILLS}/emt-start/SKILL.md`;
    files.write(path, `${files.read(path) ?? ''}\nMy own line.\n`);
    expect(install().skipped.map((s) => s.path)).toContain(path);
    expect(install({ force: true }).skipped.map((s) => s.path)).not.toContain(path);
  });
});

describe('AGENTS.md', () => {
  it('gets the block only with a shared install and loses it again; a file left empty goes', () => {
    install();
    expect(files.read(AGENTS_MD)).toBeUndefined();
    install({ shared: true });
    expect(files.read(AGENTS_MD)).toContain('run `$emt-estimate`');
    install();
    expect(files.read(AGENTS_MD)).toBeUndefined();
  });

  it('keeps the text of the user around the block', () => {
    files.write(AGENTS_MD, '# Rules\n\nBe brief.\n');
    install({ shared: true });
    expect(files.read(AGENTS_MD)?.startsWith('# Rules\n\nBe brief.\n\n<!-- estimetry:start -->')).toBe(true);
    install();
    expect(files.read(AGENTS_MD)).toBe('# Rules\n\nBe brief.\n');
  });
});
