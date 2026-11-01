import { join } from 'node:path';
import type { Flow } from '../../../application/contracts/flow.js';
import type { ProjectFiles } from '../../../application/ports/project-files.js';
import { openSpecArchived, openSpecPlan } from './openspec-plan.js';

/** OpenSpec: changes in `openspec/changes/<change>/`. Plan parsing and `openspec archive` come with the hooks. */
export const openSpecFlow: Flow = {
  id: 'openspec',
  title: 'OpenSpec',
  detect: (projectRoot: string, files: ProjectFiles) => files.isDirectory(join(projectRoot, 'openspec')),
  setupHint: (projectRoot: string, files: ProjectFiles) =>
    files.isDirectory(join(projectRoot, 'openspec'))
      ? undefined
      : 'the flow is OpenSpec, but the project has no openspec/ directory yet: run `openspec init` to set it up',
  plan: openSpecPlan,
  archived: openSpecArchived,
};
