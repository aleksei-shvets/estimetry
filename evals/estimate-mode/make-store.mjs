#!/usr/bin/env node
// Builds a synthetic estimetry store for the evals of estimate mode: closed tasks with
// real journals, snapshots and cards, made by the built CLI (`npm run build` first).
//
//   node evals/estimate-mode/make-store.mjs <dir>
//
// <dir>/home is ESTIMETRY_HOME, <dir>/project a git project on typescript and node, <dir>/user
// the HOME of the evals, with the skills `emt init` installs in <dir>/user/.claude.
// Six closed `feature` tasks on typescript and node (enough for a coefficient), two
// closed `research` tasks on python (too few by type and by stack), and one `feature` task in progress.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = resolve(process.argv[2] ?? '');
if (process.argv[2] === undefined) {
  console.error('usage: node evals/estimate-mode/make-store.mjs <dir>');
  process.exit(2);
}
const main = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'bootstrap', 'main.js');
const home = join(dir, 'home');
const project = join(dir, 'project');
const author = 'dev@example.com';
// HOME and CLAUDE_CONFIG_DIR inside <dir>: `emt init` must never touch the user's own skills.
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

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
let seq = 0;

/** Agent work from `from` for `hours`: a turn with a tool call every 5 minutes, so no gap counts as idle. */
function work(task, from, hours) {
  const file = join(home, 'events', `${task}.jsonl`);
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

/** A closed task: estimated `likely` hours, worked `ratio` times that, started `daysAgo` days ago. */
function closedTask(title, type, likely, ratio, daysAgo, lesson, stack = ['typescript', 'node']) {
  const created = emt('task', 'new', title, '--type', type, '--json');
  const task = JSON.parse(created).id;
  const file = join(dir, `${task}.yaml`);
  plan(file, type, likely, stack);
  emt('estimate', 'save', file);
  const start = Date.now() - daysAgo * DAY;
  emt('start', task, '--at', iso(start));
  work(task, start + 60 * 1000, likely * ratio);
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
features.forEach(([title, likely, ratio], i) => closedTask(title, 'feature', likely, ratio, 40 - i * 5, 'plan manual testing per platform'));
closedTask('Evaluate queue libraries', 'research', 3, 0.9, 12, 'time-box research up front', ['python']);
closedTask('Spike: streaming parser', 'research', 4, 1.6, 8, 'prototype before estimating', ['python']);

const current = JSON.parse(emt('task', 'new', 'Bulk import of products', '--type', 'feature', '--json')).id;
const file = join(dir, `${current}.yaml`);
plan(file, 'feature', 6, ['typescript', 'node']);
emt('estimate', 'save', file);
emt('start', current, '--at', iso(Date.now() - 2 * 60 * 60 * 1000));

console.log(`ESTIMETRY_HOME=${home}`);
console.log(`project: ${project}`);
console.log(`in progress: ${current}`);
