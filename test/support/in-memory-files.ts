import { stringify, parse } from 'yaml';
import type { FileChange, InstallPlan } from '../../src/application/contracts/file-change.js';
import type { Flow } from '../../src/application/contracts/flow.js';
import { InstallBlocked } from '../../src/application/contracts/install-blocked.js';
import type { StackDetector } from '../../src/application/contracts/stack-detector.js';
import type { InstallContext, ToolAdapter, ToolState } from '../../src/application/contracts/tool-adapter.js';
import type { InstallDependencies } from '../../src/application/project/init-project.js';
import type { CommandLocator } from '../../src/application/ports/command-locator.js';
import type { CommitHookInstaller } from '../../src/application/ports/commit-hook-installer.js';
import type { GitExcludes } from '../../src/application/ports/git-excludes.js';
import type { ProjectConfig, ProjectConfigFile } from '../../src/application/ports/project-config-file.js';
import type { ProjectFiles } from '../../src/application/ports/project-files.js';
import type { ShareMode, SharingPreference } from '../../src/application/ports/sharing-preference.js';

/** Files by absolute POSIX path; directories exist implicitly. */
export class InMemoryProjectFiles implements ProjectFiles {
  readonly files = new Map<string, { content: string; executable: boolean }>();
  readonly writes: string[] = [];

  constructor(initial: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(initial)) {
      this.files.set(path, { content, executable: false });
    }
  }

  read(path: string): string | undefined {
    return this.files.get(path)?.content;
  }

  isDirectory(path: string): boolean {
    return [...this.files.keys()].some((file) => file.startsWith(`${path}/`));
  }

  write(path: string, content: string, options: { readonly executable?: boolean } = {}): void {
    this.writes.push(path);
    this.files.set(path, { content, executable: options.executable ?? false });
  }

  remove(path: string): void {
    this.writes.push(path);
    this.files.delete(path);
  }

  find(root: string, names: readonly string[], options: { readonly depth: number; readonly limit: number }): string[] {
    return [...this.files.keys()]
      .filter((path) => path.startsWith(`${root}/`))
      .filter((path) => names.includes(path.slice(path.lastIndexOf('/') + 1)))
      .filter((path) => path.slice(root.length + 1).split('/').length - 1 <= options.depth)
      .sort()
      .slice(0, options.limit);
  }
}

/** `.estimetry/config.yaml` on top of in-memory files, keeping unknown keys like the YAML store. */
export class InMemoryProjectConfigFile implements ProjectConfigFile {
  constructor(private readonly files: ProjectFiles) {}

  read(projectRoot: string): { config?: ProjectConfig; warning?: string } {
    const text = this.files.read(`${projectRoot}/.estimetry/config.yaml`);
    if (text === undefined) {
      return {};
    }
    try {
      const value = parse(text) as Record<string, unknown>;
      return {
        config: {
          ...(typeof value['project'] === 'string' ? { project: value['project'] } : {}),
          ...(typeof value['flow'] === 'string' ? { flow: value['flow'] } : {}),
        },
      };
    } catch {
      return { warning: '.estimetry/config.yaml is not valid YAML' };
    }
  }

  plan(projectRoot: string, config: Required<ProjectConfig>): FileChange {
    const path = `${projectRoot}/.estimetry/config.yaml`;
    let current: Record<string, unknown>;
    try {
      current = (parse(this.files.read(path) ?? '') as Record<string, unknown> | null) ?? {};
    } catch {
      current = {};
    }
    return { path, content: stringify({ schemaVersion: 1, ...current, ...config }) };
  }
}

export class FakeCommitHookInstaller implements CommitHookInstaller {
  isInstalled = false;
  readonly plans: boolean[] = [];

  constructor(private readonly hook = '/work/api/.git/hooks/post-commit') {}

  installed(): boolean {
    return this.isInstalled;
  }

  plan(_projectRoot: string, enabled: boolean): InstallPlan {
    this.plans.push(enabled);
    if (enabled === this.isInstalled) {
      return { changes: [], skipped: [], warnings: [] };
    }
    return enabled
      ? { changes: [{ path: this.hook, content: '#!/bin/sh\n# >>> estimetry >>>\n', executable: true }], skipped: [], warnings: [] }
      : { changes: [{ path: this.hook, remove: true }], skipped: [], warnings: [] };
  }
}

export class InMemorySharingPreference implements SharingPreference {
  constructor(public saved: ShareMode | undefined = undefined) {}

  mode(): ShareMode | undefined {
    return this.saved;
  }

  save(mode: ShareMode): void {
    this.saved = mode;
  }
}

export class FakeCommandLocator implements CommandLocator {
  constructor(private readonly available: readonly string[] = ['estimetry']) {}

  has(name: string): boolean {
    return this.available.includes(name);
  }
}

export class FakeGitExcludes implements GitExcludes {
  constructor(
    public ignored: boolean | undefined = true,
    readonly file = '/home/u/.config/git/ignore',
  ) {}

  isIgnored(): boolean | undefined {
    return this.ignored;
  }

  globalFile(): string {
    return this.file;
  }
}

/** A tool whose install is one settings file; enough to test `init` without Claude Code specifics. */
export class FakeToolAdapter implements ToolAdapter {
  readonly aliases: readonly string[] = ['fake'];
  readonly title = 'Fake Tool';
  readonly hookEvents: readonly string[] = ['Stop'];
  blocked: string | undefined;

  constructor(readonly id = 'fake-tool') {}

  private settings(root: string, shared: boolean): string {
    return `${root}/.fake/${shared ? 'settings.json' : 'settings.local.json'}`;
  }

  state(root: string, files: ProjectFiles): ToolState {
    const shared = files.read(this.settings(root, true)) !== undefined;
    return { installed: shared || files.read(this.settings(root, false)) !== undefined, shared };
  }

  personalFiles(): readonly string[] {
    return ['.fake/settings.local.json'];
  }

  plan(context: InstallContext): InstallPlan {
    if (this.blocked !== undefined) {
      throw new InstallBlocked(this.blocked);
    }
    return {
      changes: [
        { path: this.settings(context.projectRoot, context.shared), content: `hooks ${context.version}\n` },
        { path: this.settings(context.projectRoot, !context.shared), remove: true },
      ],
      skipped: [],
      warnings: [],
    };
  }
}

export class ListRegistry<T extends { readonly id: string; readonly aliases?: readonly string[] }> {
  constructor(private readonly items: readonly T[]) {}

  all(): readonly T[] {
    return this.items;
  }

  get(id: string): T | undefined {
    return this.items.find((item) => item.id === id || (item.aliases ?? []).includes(id));
  }
}

export function fakeInstallDependencies(files: InMemoryProjectFiles, overrides: Partial<InstallDependencies> = {}): InstallDependencies {
  return {
    files,
    tools: new ListRegistry<ToolAdapter>([new FakeToolAdapter()]),
    flows: new ListRegistry<Flow>([
      {
        id: 'openspec',
        title: 'OpenSpec',
        detect: (root, f) => f.isDirectory(`${root}/openspec`),
        setupHint: (root, f) => (f.isDirectory(`${root}/openspec`) ? undefined : 'run `openspec init`'),
        plan: () => [],
      },
      { id: 'none', title: 'No SDD', detect: () => true, plan: () => [] },
    ]),
    detectors: new ListRegistry<StackDetector & { id: string }>([
      { id: 'go', manifests: ['go.mod'], detect: (_name, content) => { if (!content.startsWith('module')) throw new Error('not a go.mod'); return ['go']; } },
    ]),
    commitHook: new FakeCommitHookInstaller(),
    sharing: new InMemorySharingPreference(),
    commands: new FakeCommandLocator(),
    excludes: new FakeGitExcludes(),
    version: '1.2.3',
    ...overrides,
  };
}
