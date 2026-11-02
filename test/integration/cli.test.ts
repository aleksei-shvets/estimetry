import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { cliSandbox, ROOT, type CliSandbox } from '../support/cli.js';

let cli: CliSandbox;
let api: string;
let web: string;

function gitRepo(name: string): string {
  const dir = cli.repo(name);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'dev@example.com'], { cwd: dir });
  return dir;
}

beforeEach(() => {
  cli = cliSandbox();
  api = gitRepo('api');
  web = gitRepo('web');
});

describe('binaries', () => {
  it('emt and estimetry print the same version from package.json', async () => {
    const version = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
    const emt = await cli.run(['--version'], api, 'emt');
    const estimetry = await cli.run(['--version'], api, 'estimetry');
    expect(emt).toMatchObject({ code: 0, stdout: `${version}\n` });
    expect(estimetry).toMatchObject({ code: 0, stdout: `${version}\n` });
  });

  it('prints help with the commands', async () => {
    const help = await cli.run(['--help'], api);
    expect(help.code).toBe(0);
    for (const command of ['task', 'start', 'attach', 'estimate', 'manual', 'extra', 'parallel', 'status']) {
      expect(help.stdout).toContain(command);
    }
  });

  it('fails with code 1 on an unknown command', async () => {
    const result = await cli.run(['frobnicate'], api);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^estimetry: unknown command 'frobnicate'/);
  });

  it('reports a missing argument with the same prefix', async () => {
    const result = await cli.run(['attach'], api);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^estimetry: missing required argument 'task'/);
  });

  it('fails with code 1 and a one-line message on an unknown task', async () => {
    const result = await cli.run(['start', 'T-999'], api);
    expect(result).toMatchObject({ code: 1, stdout: '', stderr: 'estimetry: task T-999 not found\n' });
  });

  it('fails with code 2 and logs the stack on an unexpected error', async () => {
    await cli.run(['task', 'new', 'X'], api);
    // A directory where the snapshot should be makes the write fail for a reason the domain knows nothing about.
    rmSync(join(cli.home, 'tasks', 'T-1.yaml'));
    mkdirSync(join(cli.home, 'tasks', 'T-1.yaml'));
    const result = await cli.run(['start', 'T-1'], api);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/^estimetry: unexpected error: .+ \(details in errors\.log\)\n$/);
    expect(readFileSync(join(cli.home, 'errors.log'), 'utf8')).toMatch(/\[cli:start T-1\] \w*Error/);
  });
});

describe('task lifecycle', () => {
  it('creates a task with type and ticket and prints JSON', async () => {
    const result = await cli.run(['task', 'new', 'Payment webhook', '--type', 'integration', '--ticket', 'PAY-42', '--json'], api);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      id: 'T-1',
      title: 'Payment webhook',
      type: 'integration',
      ticket: 'PAY-42',
      status: 'new',
      projects: ['api'],
      author: 'dev@example.com',
    });
  });

  it('writes the snapshot, the journal and the project registry, and nothing into the repository', async () => {
    await cli.run(['task', 'new', 'X'], api);
    const [created] = readFileSync(join(cli.home, 'events', 'T-1.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(created).toMatchObject({ schemaVersion: 1, type: 'task.created', author: 'dev@example.com', task: 'T-1', project: 'api' });
    expect(created?.['id']).toEqual(expect.any(String));
    expect(created?.['ts']).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(readFileSync(join(cli.home, 'tasks', 'T-1.yaml'), 'utf8')).toMatch(/version: 1/);
    expect(readFileSync(join(cli.home, 'projects.yaml'), 'utf8')).toMatch(/id: api/);
    expect(readFileSync(join(cli.home, 'config.yaml'), 'utf8')).toMatch(/id: dev@example.com/);
    expect(readdirSync(api)).toEqual(['.git']);
  });

  it('rejects an unknown type and lists the allowed ones', async () => {
    const result = await cli.run(['task', 'new', 'X', '--type', 'banana'], api);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/feature, integration, bugfix, refactor, infra, migration, research/);
    expect(existsSync(join(cli.home, 'tasks'))).toBe(false);
  });

  it('starts an unestimated task with a calibration warning, once', async () => {
    await cli.run(['task', 'new', 'X'], api);
    const started = await cli.run(['start', 'T-1'], api);
    expect(started.code).toBe(0);
    expect(started.stderr).toMatch(/no estimate.*calibration/);
    expect(JSON.parse((await cli.run(['task', 'show', 'T-1', '--json'], api)).stdout)).toMatchObject({
      status: 'in-progress',
      estimated: false,
    });
    const again = await cli.run(['start', 'T-1'], api);
    expect(again.code).toBe(1);
    const types = readFileSync(join(cli.home, 'events', 'T-1.jsonl'), 'utf8').trim().split('\n').map((l) => (JSON.parse(l) as { type: string }).type);
    expect(types.filter((type) => type.startsWith('task.'))).toEqual(['task.created', 'task.started']);
  });

  it('refuses an ambiguous start and lists the candidates', async () => {
    await cli.run(['task', 'new', 'A'], api);
    await cli.run(['task', 'new', 'B'], api);
    const result = await cli.run(['start'], api);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/T-1, T-2/);
  });

  it('starts the only task of the project without an argument', async () => {
    await cli.run(['task', 'new', 'A'], api);
    await cli.run(['task', 'new', 'B'], web);
    expect((await cli.run(['start', '--json'], api)).stdout).toMatch(/"id": "T-1"/);
  });

  it('attaches a task to a second repository, idempotently', async () => {
    await cli.run(['task', 'new', 'Shared'], api);
    const first = await cli.run(['attach', 'T-1'], web);
    expect(first).toMatchObject({ code: 0, stdout: 'Attached T-1 to project web\n' });
    const second = await cli.run(['attach', 'T-1'], web);
    expect(second.code).toBe(0);
    const journal = readFileSync(join(cli.home, 'events', 'T-1.jsonl'), 'utf8').trim().split('\n');
    expect(journal.map((l) => (JSON.parse(l) as { type: string }).type)).toEqual(['task.created', 'task.attached']);
    expect(JSON.parse((await cli.run(['task', 'show', 'T-1', '--json'], web)).stdout)).toMatchObject({ projects: ['api', 'web'] });
  });

  it('lists tasks of the current project, or all with --all', async () => {
    await cli.run(['task', 'new', 'A'], api);
    await cli.run(['task', 'new', 'B'], api);
    await cli.run(['task', 'new', 'C'], web);
    const own = JSON.parse((await cli.run(['task', 'list', '--json'], api)).stdout) as { id: string }[];
    const all = JSON.parse((await cli.run(['task', 'list', '--all', '--json'], api)).stdout) as { id: string }[];
    expect(own.map((t) => t.id)).toEqual(['T-1', 'T-2']);
    expect(all.map((t) => t.id)).toEqual(['T-1', 'T-2', 'T-3']);
  });

  it('lists nothing and creates no storage when there is none', async () => {
    const result = await cli.run(['task', 'list'], api);
    expect(result.code).toBe(0);
    expect(existsSync(cli.home)).toBe(false);
  });
});
