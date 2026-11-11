import type { FileChange } from './file-change.js';

/** Team settings of the project: `.estimetry/config.yaml`, meant to be committed. */
export interface ProjectConfig {
  readonly project?: string;
  readonly flow?: string;
}

export interface ProjectConfigFile {
  /** Undefined when the file is missing or broken; `warning` explains a broken one. */
  read(projectRoot: string): { readonly config?: ProjectConfig; readonly warning?: string };
  /** The file with these settings; keys this version does not know are kept. */
  plan(projectRoot: string, config: Required<ProjectConfig>): FileChange;
}
