import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../support/cli.js';

/*
 * Cycles of imports (architecture-checks spec): none between files of src,
 * none between directories of domain and application. Type-only imports count:
 * a cycle of types is a sign of a split by size, not by concepts.
 */

const SRC = join(ROOT, 'src');
const IMPORT = /(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
  });
}

/** Files of src and the files of src each one imports, by relative specifiers. */
export function importGraph(files: readonly string[], read: (file: string) => string): Map<string, string[]> {
  const known = new Set(files);
  return new Map(
    files.map((file) => {
      const targets = [...read(file).matchAll(IMPORT)].map((m) => resolve(dirname(file), (m[1] ?? m[2]) as string).replace(/\.js$/, '.ts'));
      return [file, [...new Set(targets)].filter((target) => known.has(target))];
    }),
  );
}

/** Strongly connected components of more than one node (Tarjan). */
export function cycles<T>(graph: ReadonlyMap<T, readonly T[]>): T[][] {
  let next = 0;
  const index = new Map<T, number>();
  const low = new Map<T, number>();
  const stack: T[] = [];
  const onStack = new Set<T>();
  const found: T[][] = [];
  const visit = (v: T): void => {
    index.set(v, next);
    low.set(v, next);
    next += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v) as number, low.get(w) as number));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) as number, index.get(w) as number));
      }
    }
    if (low.get(v) === index.get(v)) {
      const component: T[] = [];
      let w: T;
      do {
        w = stack.pop() as T;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      if (component.length > 1) {
        found.push(component);
      }
    }
  };
  for (const v of graph.keys()) {
    if (!index.has(v)) {
      visit(v);
    }
  }
  return found;
}

/** Directories of the given layers and the other directories of those layers their files import. */
function directoryGraph(graph: ReadonlyMap<string, readonly string[]>, layers: readonly string[]): Map<string, string[]> {
  const inLayers = (file: string) => layers.some((layer) => relative(SRC, file).startsWith(`${layer}/`));
  const dirs = new Map<string, Set<string>>();
  for (const [file, targets] of graph) {
    if (!inLayers(file)) {
      continue;
    }
    const from = relative(SRC, dirname(file));
    const to = dirs.get(from) ?? new Set<string>();
    targets.filter(inLayers).forEach((target) => to.add(relative(SRC, dirname(target))));
    to.delete(from);
    dirs.set(from, to);
  }
  return new Map([...dirs].map(([dir, to]) => [dir, [...to]]));
}

describe('cycles of imports', () => {
  const graph = importGraph(sources(SRC), (file) => readFileSync(file, 'utf8'));

  it('none between files of src', () => {
    expect(cycles(graph).map((component) => component.map((file) => relative(SRC, file)).sort())).toEqual([]);
  });

  it('none between directories of domain and application', () => {
    expect(cycles(directoryGraph(graph, ['domain', 'application'])).map((component) => component.sort())).toEqual([]);
  });

  it('a cycle of types alone is found as well', () => {
    const files = ['/s/a.ts', '/s/b.ts', '/s/c.ts'];
    const code: Record<string, string> = {
      '/s/a.ts': "import type { B } from './b.js';",
      '/s/b.ts': "export type { C } from './c.js';",
      '/s/c.ts': "const a = await import('./a.js');",
    };
    expect(cycles(importGraph(files, (file) => code[file] ?? '')).map((c) => c.sort())).toEqual([files]);
    expect(cycles(importGraph(files, (file) => (file === '/s/c.ts' ? '' : (code[file] ?? ''))))).toEqual([]);
  });
});
