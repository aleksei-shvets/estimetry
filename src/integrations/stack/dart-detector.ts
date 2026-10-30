import { parse } from 'yaml';
import type { StackDetector } from '../../application/contracts/stack-detector.js';

export const dartDetector: StackDetector = {
  manifests: ['pubspec.yaml'],
  detect(_name, content) {
    const manifest = parse(content) as Record<string, unknown> | null;
    const deps = new Set(
      ['dependencies', 'dev_dependencies'].flatMap((section) => {
        const value = manifest?.[section];
        return typeof value === 'object' && value !== null ? Object.keys(value) : [];
      }),
    );
    const has = (...names: string[]) => names.some((name) => deps.has(name));
    return [
      'dart',
      ...(has('flutter') ? ['flutter'] : []),
      ...(has('bloc', 'flutter_bloc') ? ['bloc'] : []),
      ...(has('riverpod', 'flutter_riverpod', 'hooks_riverpod') ? ['riverpod'] : []),
      ...(has('provider') ? ['provider'] : []),
      ...([...deps].some((name) => name.startsWith('firebase_')) ? ['firebase'] : []),
    ];
  },
};
