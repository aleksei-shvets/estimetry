import { describe, expect, it } from 'vitest';
import { hookTrusts, untrustedHooks, withTrusts } from '../../../src/integrations/tools/codex/hook-trust.js';

const K = '/home/u/.codex/hooks.json:stop:0:0';
const trusts = [{ key: K, hash: 'sha256:new' }];
/** Our tables in a config, comments left out. */
const ours = (config: string) =>
  config
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('#'))
    .filter((line) => /\[\s*hooks\s*\.\s*state\s*\.\s*["'][^"']*stop:0:0["']\s*\]/.test(line));

describe('a trust written into the config of Codex by lines', () => {
  it('replaces our table and keeps everything else, comments included', () => {
    const config = `# my settings\nmodel = "gpt-5"\n\n[hooks.state."${K}"]\nenabled = false # off for now\ntrusted_hash = "sha256:old"\n\n[profiles.a]\nmodel = "y"\n`;
    const out = withTrusts(config, trusts);
    expect(out).toBe(`# my settings\nmodel = "gpt-5"\n\n[profiles.a]\nmodel = "y"\n\n[hooks.state."${K}"]\nenabled = false # off for now\ntrusted_hash = "sha256:new"\n`);
    expect(withTrusts(out ?? '', trusts)).toBe(out);
  });

  it('a commented-out header is no table: nothing of the user moves or goes', () => {
    const config = `# [hooks.state."${K}"]\n# enabled = false\nmodel = "gpt-5"\napproval_policy = "never"\n[profiles.a]\nmodel = "y"\n`;
    const out = withTrusts(config, trusts) ?? '';
    expect(out.startsWith(config)).toBe(true);
    expect(ours(out)).toHaveLength(1);
  });

  it('finds our table in every form of its header: spaces, a comment after it, a literal key', () => {
    for (const head of [`[hooks.state."${K}"]  `, `[hooks.state."${K}"] # mine`, `[ hooks . state . "${K}" ]`, `[hooks.state.'${K}']`]) {
      const out = withTrusts(`${head}\ntrusted_hash = "sha256:old"\n`, trusts) ?? '';
      expect(ours(out)).toHaveLength(1);
      expect(out).toContain('sha256:new');
      expect(out).not.toContain('sha256:old');
    }
  });

  it('keeps the line endings of a file written with CRLF', () => {
    const out = withTrusts(`model = "x"\r\n[hooks.state."${K}"]\r\ntrusted_hash = "sha256:old"\r\n`, trusts) ?? '';
    expect(ours(out)).toHaveLength(1);
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('refuses a config it cannot change safely: the trust is left to /hooks', () => {
    for (const config of [
      `[hooks]\nstate = { "other" = { trusted_hash = "x" } }\n`,
      `hooks = { state = {} }\n`,
      `[hooks]\nstate."${K}".trusted_hash = "sha256:old"\n`,
      `hooks.state."${K}".trusted_hash = "sha256:old"\n`,
      `developer_instructions = """\n[hooks.state."${K}"]\n"""\n`,
      `[hooks.state."${K}"]\ntrusted_hash = "a"\n[hooks.state."${K}"]\ntrusted_hash = "b"\n`,
    ]) {
      expect(withTrusts(config, trusts)).toBeUndefined();
    }
  });

  it('writes into no config and into one without a final newline', () => {
    expect(withTrusts(undefined, trusts)).toBe(`[hooks.state."${K}"]\ntrusted_hash = "sha256:new"\n`);
    expect(withTrusts('model = "x"', trusts)).toBe(`model = "x"\n\n[hooks.state."${K}"]\ntrusted_hash = "sha256:new"\n`);
  });
});

describe('the trust hash as Codex normalizes a hook', () => {
  const file = (handler: Record<string, unknown>, event = 'SessionEnd', matcher?: string) =>
    JSON.stringify({ hooks: { [event]: [{ ...(matcher === undefined ? {} : { matcher }), hooks: [{ type: 'command', command: 'estimetry hook codex X', ...handler }] }] } });
  const hashOf = (text: string) => hookTrusts('/h.json', text, 'hook codex')[0]?.hash;

  it('the session end without a timeout waits 1 second, and at most 3', () => {
    expect(hashOf(file({}))).toBe(hashOf(file({ timeout: 1 })));
    expect(hashOf(file({ timeout: 10 }))).toBe(hashOf(file({ timeout: 3 })));
    expect(hashOf(file({}, 'Stop'))).toBe(hashOf(file({ timeout: 600 }, 'Stop')));
  });

  it('a matcher counts only for the events that match, and commandWindows not at all', () => {
    expect(hashOf(file({}, 'Stop', 'x'))).toBe(hashOf(file({}, 'Stop')));
    expect(hashOf(file({}, 'PreToolUse', 'Bash'))).not.toBe(hashOf(file({}, 'PreToolUse')));
    expect(hashOf(file({ commandWindows: 'x' }))).toBe(hashOf(file({})));
  });

  it('a config with the right hash is trusted, one with another is not', () => {
    const text = file({ timeout: 3 });
    const [trust] = hookTrusts('/h.json', text, 'hook codex');
    expect(untrustedHooks(`[hooks.state."${trust?.key ?? ''}"]\ntrusted_hash = "${trust?.hash ?? ''}"\n`, hookTrusts('/h.json', text, 'hook codex'))).toBe(false);
    expect(untrustedHooks(`[hooks.state."${trust?.key ?? ''}"]\ntrusted_hash = "sha256:other"\n`, hookTrusts('/h.json', text, 'hook codex'))).toBe(true);
  });
});
