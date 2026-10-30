import { basename, dirname, relative } from 'node:path';
import type { StackDetector } from '../contracts/stack-detector.js';
import type { ProjectFiles } from '../ports/project-files.js';

/** Root and two levels below it: enough for `packages/app/pubspec.yaml` in a monorepo. */
export const MANIFEST_DEPTH = 2;
export const MANIFEST_LIMIT = 200;

/** Stack tags from the manifests of the project; a manifest that cannot be read becomes a warning. */
export function detectStack(
  root: string,
  files: ProjectFiles,
  detectors: readonly StackDetector[],
): { readonly tags: readonly string[]; readonly warnings: readonly string[] } {
  const manifests = new Set(detectors.flatMap((detector) => detector.manifests));
  const names = [...new Set([...manifests, ...detectors.flatMap((detector) => detector.companions ?? [])])];
  const found = files.find(root, names, { depth: MANIFEST_DEPTH, limit: MANIFEST_LIMIT });
  const byDirectory = new Map<string, Set<string>>();
  for (const path of found) {
    const dir = dirname(path);
    byDirectory.set(dir, (byDirectory.get(dir) ?? new Set()).add(basename(path)));
  }

  const tags = new Set<string>();
  const warnings: string[] = [];
  for (const path of found) {
    const name = basename(path);
    if (!manifests.has(name)) {
      continue;
    }
    const content = files.read(path);
    if (content === undefined) {
      continue;
    }
    const siblings = byDirectory.get(dirname(path)) ?? new Set<string>();
    for (const detector of detectors.filter((d) => d.manifests.includes(name))) {
      try {
        for (const tag of detector.detect(name, content, siblings)) {
          tags.add(tag);
        }
      } catch (error) {
        warnings.push(`${relative(root, path)}: ${error instanceof Error ? error.message : String(error)}; skipped when detecting the stack`);
      }
    }
  }
  return { tags: [...tags].sort(), warnings };
}
