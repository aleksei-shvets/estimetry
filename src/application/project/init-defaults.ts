import type { ToolAdapter } from '../contracts/tool-adapter.js';
import type { ProjectConfigFile } from '../ports/project-config-file.js';
import type { InstallDependencies } from './init-project.js';

/** The tools already installed in the project, else every tool. */
export function defaultTools(deps: Pick<InstallDependencies, 'tools' | 'files'>, root: string): ToolAdapter[] {
  const all = deps.tools.all();
  const installed = all.filter((tool) => tool.state(root, deps.files).installed);
  return installed.length > 0 ? installed : [...all];
}

/** The flow saved in the project config, else the first one detected, else the last one (`none`). */
export function defaultFlow(deps: Pick<InstallDependencies, 'flows' | 'files'>, projectConfig: ProjectConfigFile, root: string): string {
  const saved = projectConfig.read(root).config?.flow;
  if (saved !== undefined && deps.flows.get(saved)) {
    return saved;
  }
  const all = deps.flows.all();
  return (all.find((flow) => flow.detect(root, deps.files)) ?? all.at(-1))?.id ?? 'none';
}

/** Personal files of the tools that git does not ignore yet. */
export function unignoredPersonalFiles(deps: Pick<InstallDependencies, 'excludes'>, root: string, tools: readonly ToolAdapter[]): string[] {
  return tools.flatMap((tool) => tool.personalFiles()).filter((path) => deps.excludes.isIgnored(root, path) === false);
}
