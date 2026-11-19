/*
 * The rule that lets the agent of Codex run the task commands of estimetry outside its sandbox, without asking
 * (`prefix_rule` with `decision = "allow"`, the rules of Codex in `<config layer>/rules/`). They write to the store
 * of estimetry, outside the workspace the sandbox allows. `init`, `upgrade`, `rebuild` and `hook` are left out: they
 * write the files of projects and of the tools, so Codex still asks for them.
 */

const MARK = '# Written by estimetry';

/** Commands of `emt` that work with tasks: the store of estimetry only. */
const TASK_COMMANDS = [
  'task',
  'start',
  'attach',
  'estimate',
  'extra',
  'manual',
  'parallel',
  'status',
  'close',
  'reopen',
  'retro',
  'renegotiate',
  'similar',
  'calibrate',
];

export function SANDBOX_RULES(version: string): string {
  const alternatives = JSON.stringify(TASK_COMMANDS);
  return [
    `${MARK} ${version}: its task commands write to its own store, outside the sandbox of Codex.`,
    '# `init`, `upgrade` and `rebuild` are not here: Codex still asks before them.',
    ...['emt', 'estimetry'].map(
      (bin) =>
        `prefix_rule(pattern=["${bin}", ${alternatives}], decision="allow", justification="estimetry writes its own store")`,
    ),
    '',
  ].join('\n');
}

/** Whether a rules file is ours to rewrite. */
export function isOurRules(text: string): boolean {
  return text.startsWith(MARK);
}
