import { beforeEach, describe, expect, it } from 'vitest';
import type { InstallPlan } from '../../../src/application/contracts/file-change.js';
import { isRemoval } from '../../../src/application/contracts/file-change.js';
import { InstallBlocked } from '../../../src/application/contracts/install-blocked.js';
import { ClaudeCodeAdapter } from '../../../src/integrations/tools/claude-code/claude-code-adapter.js';
import { withBlock, withoutBlock } from '../../../src/integrations/tools/claude-code/claude-md.js';
import { ownership, renderSkill } from '../../../src/integrations/tools/claude-code/skill-file.js';
import { COMMANDS } from '../../../src/integrations/tools/content/commands.js';
import { InMemoryProjectFiles } from '../../support/in-memory-files.js';

const ROOT = '/work/app';
const HOME = '/home/u/.claude';
const LOCAL = `${ROOT}/.claude/settings.local.json`;
const SHARED = `${ROOT}/.claude/settings.json`;

let files: InMemoryProjectFiles;
const adapter = new ClaudeCodeAdapter(HOME);

/** Plans and applies like init does. */
function install(options: { shared?: boolean; force?: boolean } = {}): InstallPlan {
  const plan = adapter.plan({ projectRoot: ROOT, files, shared: options.shared ?? false, force: options.force ?? false, version: '1.0.0' });
  for (const change of plan.changes) {
    if (isRemoval(change)) {
      files.remove(change.path);
    } else {
      files.write(change.path, change.content);
    }
  }
  return plan;
}

const json = (path: string) => JSON.parse(files.read(path) ?? 'null') as { hooks: Record<string, { matcher?: string; hooks: { command: string; timeout?: number }[] }[]>; [key: string]: unknown };
const ours = (path: string) =>
  Object.values(json(path).hooks).flatMap((groups) => groups.flatMap((g) => g.hooks)).filter((h) => h.command.startsWith('estimetry hook claude-code'));

beforeEach(() => {
  files = new InMemoryProjectFiles();
});

describe('Claude Code hooks', () => {
  it('installs one hook per event into the local settings of a clean project', () => {
    install();
    const settings = json(LOCAL);
    expect(Object.keys(settings.hooks)).toEqual(adapter.hookEvents);
    expect(settings.hooks['Stop']).toEqual([{ hooks: [{ type: 'command', command: 'estimetry hook claude-code Stop', timeout: 10, async: true }] }]);
    expect(settings.hooks['SessionStart']?.[0]?.hooks[0]).not.toHaveProperty('async');
    expect(files.read(SHARED)).toBeUndefined();
    expect(adapter.state(ROOT, files)).toEqual({ installed: true, shared: false });
  });

  it('keeps the user’s keys and hooks and does not duplicate on a repeated install', () => {
    files.write(
      LOCAL,
      JSON.stringify({ permissions: { allow: ['Bash(npm test)'] }, hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'npm run lint' }] }] } }, null, 2),
    );
    install();
    const before = files.read(LOCAL);
    install();
    expect(files.read(LOCAL)).toBe(before);
    const settings = json(LOCAL);
    expect(settings['permissions']).toEqual({ allow: ['Bash(npm test)'] });
    expect(settings.hooks['PostToolUse']?.map((g) => g.hooks[0]?.command)).toEqual(['npm run lint', 'estimetry hook claude-code PostToolUse']);
    expect(ours(LOCAL)).toHaveLength(adapter.hookEvents.length);
  });

  it('moves the hooks to the shared settings and back, leaving the other entries', () => {
    files.write(LOCAL, JSON.stringify({ permissions: { allow: [] } }));
    install();
    install({ shared: true });
    expect(ours(SHARED)).toHaveLength(12);
    expect(json(LOCAL)).toEqual({ permissions: { allow: [] } });
    expect(adapter.state(ROOT, files)).toEqual({ installed: true, shared: true });
    install({ shared: false });
    expect(files.read(SHARED)).toBeUndefined(); // nothing else was in it
    expect(ours(LOCAL)).toHaveLength(12);
  });

  it('keeps the indentation of the file', () => {
    files.write(LOCAL, '{\n    "model": "opus"\n}\n');
    install();
    expect(files.read(LOCAL)).toMatch(/^\{\n {4}"model": "opus",\n {4}"hooks"/);
  });

  it('refuses a broken target file or hooks that are not an object', () => {
    files.write(LOCAL, '{ "hooks": [');
    expect(() => install()).toThrow(new InstallBlocked('.claude/settings.local.json: not valid JSON; fix the file, then run init again'));
    files.write(LOCAL, '{ "hooks": [] }');
    expect(() => install()).toThrow(/"hooks" must be an object/);
  });

  it('only warns about a broken previous file', () => {
    files.write(LOCAL, '{ broken');
    const plan = install({ shared: true });
    expect(plan.warnings).toEqual(['.claude/settings.local.json is not valid JSON, so the estimetry hooks in it were left as they are']);
    expect(files.read(LOCAL)).toBe('{ broken');
  });

  it('treats a hook the user rewrote as the user’s', () => {
    files.write(LOCAL, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'emt hook claude-code Stop' }] }] } }));
    install();
    expect(json(LOCAL).hooks['Stop']).toHaveLength(2);
  });
});

describe('Claude Code skills', () => {
  const skill = (dir: string, id: string) => `${dir}/skills/${id}/SKILL.md`;

  it('installs the skill and the commands for the user, not into the project', () => {
    install();
    for (const id of ['estimetry', 'emt-estimate', 'emt-start', 'emt-extra', 'emt-parallel', 'emt-manual']) {
      expect(files.read(skill(HOME, id))).toContain('generatedBy: "estimetry 1.0.0"');
    }
    expect([...files.files.keys()].some((path) => path.startsWith(`${ROOT}/.claude/skills`))).toBe(false);
    expect(files.read(skill(HOME, 'emt-start'))).toContain('allowed-tools: Bash(emt *) Bash(estimetry *)');
  });

  it('a shared install puts them into the project; a personal one takes them out again', () => {
    install({ shared: true });
    expect(files.read(skill(`${ROOT}/.claude`, 'emt-start'))).toBeDefined();
    install({ shared: false });
    expect(files.read(skill(`${ROOT}/.claude`, 'emt-start'))).toBeUndefined();
    expect(files.read(skill(HOME, 'emt-start'))).toBeDefined();
  });

  it('leaves a foreign file alone, even with --force', () => {
    files.write(skill(HOME, 'emt-start'), '# my own command\n');
    const plan = install({ force: true });
    expect(files.read(skill(HOME, 'emt-start'))).toBe('# my own command\n');
    expect(plan.skipped).toContainEqual({ path: skill(HOME, 'emt-start'), reason: 'not created by estimetry, left as it is' });
  });

  it('keeps a file the user edited unless --force', () => {
    install();
    const path = skill(HOME, 'emt-manual');
    files.write(path, `${files.read(path)}\nAlways record manual testing.\n`);
    expect(install().skipped.map((s) => s.path)).toEqual([path]);
    expect(files.read(path)).toContain('Always record manual testing.');
    install({ force: true });
    expect(files.read(path)).not.toContain('Always record manual testing.');
  });

  it('the hash covers the text without its own line', () => {
    const text = renderSkill(COMMANDS[0]!, '2.0.0');
    expect(ownership(text)).toBe('ours');
    expect(ownership(text.replace('optimistic', 'optimistic!'))).toBe('edited');
    expect(ownership('---\nname: x\n---\n')).toBe('foreign');
  });
});

describe('CLAUDE.md', () => {
  const CLAUDE_MD = `${ROOT}/CLAUDE.md`;

  it('is not touched without a shared install', () => {
    install();
    expect(files.read(CLAUDE_MD)).toBeUndefined();
  });

  it('gets one block with a shared install, keeps the user’s text and loses the block again', () => {
    files.write(CLAUDE_MD, '# My project\n\nRules.\n');
    install({ shared: true });
    install({ shared: true });
    const text = files.read(CLAUDE_MD) ?? '';
    expect(text.startsWith('# My project\n\nRules.\n\n<!-- estimetry:start -->')).toBe(true);
    expect(text.match(/estimetry:start/g)).toHaveLength(1);
    install({ shared: false });
    expect(files.read(CLAUDE_MD)).toBe('# My project\n\nRules.\n');
  });

  it('block helpers keep text around a block in the middle', () => {
    const middle = `a\n\n${withBlock(undefined)}\nb\n`;
    expect(withoutBlock(middle)).toBe('a\n\nb\n');
    expect(withoutBlock('no block\n')).toBe('no block\n');
  });
});
