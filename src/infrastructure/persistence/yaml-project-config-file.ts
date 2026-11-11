import { join } from 'node:path';
import { stringify } from 'yaml';
import type { FileChange } from '../../application/ports/file-change.js';
import type { ProjectConfig, ProjectConfigFile } from '../../application/ports/project-config-file.js';
import { readYaml } from '../fs/atomic-yaml.js';

export const PROJECT_CONFIG_SCHEMA_VERSION = 1;
export const PROJECT_CONFIG_PATH = join('.estimetry', 'config.yaml');

/** `.estimetry/config.yaml`: team settings meant to be committed, so personal choices never go here. */
export class YamlProjectConfigFile implements ProjectConfigFile {
  read(projectRoot: string): { config?: ProjectConfig; warning?: string } {
    const document = this.document(projectRoot);
    if (document === 'broken') {
      return { warning: `${PROJECT_CONFIG_PATH} is not valid YAML; it is ignored` };
    }
    if (document === undefined) {
      return {};
    }
    const { project, flow } = document;
    return {
      config: {
        ...(typeof project === 'string' ? { project } : {}),
        ...(typeof flow === 'string' ? { flow } : {}),
      },
    };
  }

  plan(projectRoot: string, config: Required<ProjectConfig>): FileChange {
    const current = this.document(projectRoot);
    const known = current === 'broken' || current === undefined ? {} : current;
    return {
      path: join(projectRoot, PROJECT_CONFIG_PATH),
      // Keys this version does not know stay; the ones it owns are refreshed.
      content: stringify({ ...known, schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION, ...config }),
    };
  }

  private document(projectRoot: string): Record<string, unknown> | 'broken' | undefined {
    try {
      const value = readYaml(join(projectRoot, PROJECT_CONFIG_PATH));
      if (value === undefined || value === null) {
        return undefined;
      }
      return typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : 'broken';
    } catch {
      return 'broken';
    }
  }
}
