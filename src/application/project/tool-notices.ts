import type { InstallDependencies } from './install-dependencies.js';

/** What the tools installed in the copy still need from the user for their hooks to run (trust them in Codex). */
export function toolNotices(deps: Pick<InstallDependencies, 'registries' | 'files'>, root: string): string[] {
  return deps.registries.tools.all().flatMap((tool) => {
    const state = tool.state(root, deps.files);
    return state.installed && state.notice !== undefined ? [state.notice] : [];
  });
}
