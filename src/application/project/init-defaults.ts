import type { ToolAdapter } from '../contracts/tool-adapter.js';
import type { ProjectConfigFile } from '../ports/project-config-file.js';
import type { InstallDependencies } from './install-dependencies.js';

/**
 * The tools installed in the copy now. An install of the user outside the copy (`machineWide`) is there for every
 * copy, so it counts only for a copy without a shared install: it must not make a team's copy install it for the team.
 */
export function installedTools(deps: Pick<InstallDependencies, 'registries' | 'files'>, root: string): ToolAdapter[] {
  const states = deps.registries.tools.all().map((tool) => ({ tool, state: tool.state(root, deps.files) }));
  const sharedHere = states.some(({ state }) => state.installed && state.shared);
  return states.filter(({ state }) => state.installed && !(state.machineWide === true && sharedHere)).map(({ tool }) => tool);
}

/**
 * The tools already installed in the project, else the tools found on this machine, else every tool. An install of
 * the user outside the copy alone does not make the copy's choice: then the tools found on the machine join it.
 */
export function defaultTools(deps: Pick<InstallDependencies, 'registries' | 'files'>, root: string): ToolAdapter[] {
  const installed = installedTools(deps, root);
  if (installed.some((tool) => tool.state(root, deps.files).machineWide !== true)) {
    return installed;
  }
  const all = deps.registries.tools.all();
  const found = all.filter((tool) => tool.present(deps.files) || installed.includes(tool));
  return found.length > 0 ? found : [...all];
}

/** Whether these tools have a shared install in the copy: then it stays shared. */
export function isSharedInstall(deps: Pick<InstallDependencies, 'files'>, root: string, tools: readonly ToolAdapter[]): boolean {
  return tools.some((tool) => tool.state(root, deps.files).shared);
}

/** The flow saved in the project config, else the first one detected, else the last one (`none`). */
export function defaultFlow(
  deps: Pick<InstallDependencies, 'registries' | 'files'>,
  projectConfig: ProjectConfigFile,
  root: string,
): string {
  const saved = projectConfig.read(root).config?.flow;
  if (saved !== undefined && deps.registries.flows.get(saved)) {
    return saved;
  }
  const all = deps.registries.flows.all();
  return (all.find((flow) => flow.detect(root, deps.files)) ?? all.at(-1))?.id ?? 'none';
}

/** Personal files of the tools that git does not ignore yet. */
export function unignoredPersonalFiles(deps: Pick<InstallDependencies, 'git'>, root: string, tools: readonly ToolAdapter[]): string[] {
  return tools.flatMap((tool) => tool.personalFiles()).filter((path) => deps.git.excludes.isIgnored(root, path) === false);
}
