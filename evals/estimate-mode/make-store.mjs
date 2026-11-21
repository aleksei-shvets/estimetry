#!/usr/bin/env node
// Builds synthetic estimetry stores for the evals of estimate mode: closed tasks with
// real journals, snapshots and cards, made by the built CLI (`npm run build` first).
//
//   node evals/estimate-mode/make-store.mjs <dir>
//
// One store per amount of experience, each in <dir>/<store>: `home` is its ESTIMETRY_HOME,
// `project` a git project on typescript and node, `user` the HOME of the evals, with the
// skills `emt init` installs in `user/.claude`, and `bin/emt` the built CLI with this store.
// - none: no closed task;
// - one: one closed `feature` task;
// - two: two closed `feature` tasks;
// - many: six closed `feature` tasks on typescript and node, two closed `research` tasks on
//   python, and one `feature` task in progress.
import { execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? '');
if (process.argv[2] === undefined) {
  console.error('usage: node evals/estimate-mode/make-store.mjs <dir>');
  process.exit(2);
}
const main = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'bootstrap', 'main.js');
const author = 'dev@example.com';

/** A store in <root>/<name>: its data directory, project and HOME, with `emt` run inside them. */
function store(name) {
  const dir = join(root, name);
  const home = join(dir, 'home');
  const project = join(dir, 'project');
  // HOME and CLAUDE_CONFIG_DIR inside the store: `emt init` must never touch the user's own skills.
  const user = join(dir, 'user');
  const env = { ...process.env, ESTIMETRY_HOME: home, HOME: user, CLAUDE_CONFIG_DIR: join(user, '.claude'), GIT_CONFIG_GLOBAL: join(user, '.gitconfig') };
  delete env.CI;
  mkdirSync(home, { recursive: true });
  mkdirSync(user, { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(join(home, 'config.yaml'), `schemaVersion: 1\nauthor:\n  id: ${author}\n`);
  const git = (...args) => execFileSync('git', args, { cwd: project, env, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', author);
  git('config', 'user.name', 'Dev');
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'demo', devDependencies: { typescript: '5.9' } }, null, 2));
  writeFileSync(join(project, 'tsconfig.json'), '{}\n');
  const emt = (...args) => execFileSync(process.execPath, [main, ...args], { cwd: project, env, encoding: 'utf8' });
  emt('init', '--no-interactive', '--flow', 'none', '--tools', 'claude-code');
  // `bin/emt`: the built CLI with this store, for an agent that cannot set the environment of its shell.
  const bin = join(dir, 'bin', 'emt');
  mkdirSync(dirname(bin), { recursive: true });
  writeFileSync(bin, `#!/bin/sh\nESTIMETRY_HOME='${home}' HOME='${user}' exec '${process.execPath}' '${main}' "$@"\n`);
  chmodSync(bin, 0o755);
  return { dir, home, project, emt };
}

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
let seq = 0;

/** Agent work from `from` for `hours`: a turn with a tool call every 5 minutes, so no gap counts as idle. */
function work(at, task, from, hours) {
  const file = join(at.home, 'events', `${task}.jsonl`);
  const event = (type, ms, data = {}) =>
    appendFileSync(
      file,
      `${JSON.stringify({ schemaVersion: 1, id: `eval-${++seq}`, ts: iso(ms), type, author, task, project: 'project', data: { source: 'eval', session: `s-${task}`, ...data } })}\n`,
    );
  const end = from + hours * 60 * 60 * 1000;
  event('turn.started', from, { origin: 'user' });
  for (let ms = from; ms < end; ms += 5 * 60 * 1000) {
    event('tool.started', ms, { toolUseId: `t${seq}` });
    event('tool.used', Math.min(ms + 4 * 60 * 1000, end), { toolUseId: `t${seq - 1}` });
  }
  event('turn.ended', end, { outcome: 'completed' });
}

function plan(file, type, likely, stack) {
  const parts = [
    { name: 'implementation', kind: 'implementation', likely: likely * 0.6 },
    { name: 'auto-tests', kind: 'auto-tests', likely: likely * 0.25 },
    { name: 'manual-testing', kind: 'manual-testing', likely: likely * 0.15 },
  ];
  const lines = parts.map(
    (p) => `  - { name: ${p.name}, kind: ${p.kind}, hours: { optimistic: ${(p.likely * 0.7).toFixed(2)}, likely: ${p.likely.toFixed(2)}, pessimistic: ${(p.likely * 1.6).toFixed(2)} } }`,
  );
  writeFileSync(file, `schemaVersion: 1\ntype: ${type}\nstack: [${stack.join(', ')}]\nparts:\n${lines.join('\n')}\n`);
}

/** A closed task of a store: estimated `likely` hours, worked `ratio` times that, started `daysAgo` days ago. */
function closedTask(at, [title, likely, ratio], daysAgo, type = 'feature', lesson = 'plan manual testing per platform', stack = ['typescript', 'node']) {
  const { emt } = at;
  const created = emt('task', 'new', title, '--type', type, '--json');
  const task = JSON.parse(created).id;
  const file = join(at.dir, `${task}.yaml`);
  plan(file, type, likely, stack);
  emt('estimate', 'save', file);
  const start = Date.now() - daysAgo * DAY;
  emt('start', task, '--at', iso(start));
  work(at, task, start + 60 * 1000, likely * ratio);
  // Closed now: the estimate was saved now, and a closing may not precede a record. The fact is the work above.
  emt('close', task, '--yes');
  emt('retro', task, '--reason', 'manual-testing: took longer than planned', '--lesson', lesson);
  return task;
}

const features = [
  ['Export orders to CSV', 6, 1.2],
  ['Webhook retries', 8, 1.4],
  ['User settings page API', 5, 1.1],
  ['Rate limiting middleware', 10, 1.3],
  ['Audit log', 7, 1.5],
  ['Search by tags', 4, 1.25],
];

store('none');
const one = store('one');
closedTask(one, features[1], 10);
const two = store('two');
features.slice(0, 2).forEach((spec, i) => closedTask(two, spec, 20 - i * 5));

const many = store('many');
features.forEach((spec, i) => closedTask(many, spec, 40 - i * 5));
closedTask(many, ['Evaluate queue libraries', 3, 0.9], 12, 'research', 'time-box research up front', ['python']);
closedTask(many, ['Spike: streaming parser', 4, 1.6], 8, 'research', 'prototype before estimating', ['python']);
const current = JSON.parse(many.emt('task', 'new', 'Bulk import of products', '--type', 'feature', '--json')).id;
const file = join(many.dir, `${current}.yaml`);
plan(file, 'feature', 6, ['typescript', 'node']);
many.emt('estimate', 'save', file);
many.emt('start', current, '--at', iso(Date.now() - 2 * 60 * 60 * 1000));

for (const name of ['none', 'one', 'two', 'many']) {
  console.log(`${name}: ESTIMETRY_HOME=${join(root, name, 'home')} HOME=${join(root, name, 'user')} project=${join(root, name, 'project')}`);
}
console.log(`in progress in many: ${current}`);
