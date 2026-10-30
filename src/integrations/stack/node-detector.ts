import type { StackDetector } from '../../application/contracts/stack-detector.js';

const FRAMEWORKS: Readonly<Record<string, string>> = {
  react: 'react',
  'react-native': 'react-native',
  next: 'next',
  vue: 'vue',
  nuxt: 'nuxt',
  '@angular/core': 'angular',
  svelte: 'svelte',
  '@nestjs/core': 'nestjs',
  express: 'express',
  fastify: 'fastify',
  electron: 'electron',
};

export const nodeDetector: StackDetector = {
  manifests: ['package.json'],
  companions: ['tsconfig.json'],
  detect(_name, content, siblings) {
    const manifest = JSON.parse(content) as Record<string, unknown>;
    if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
      throw new Error('expected a JSON object');
    }
    const deps = new Set(
      ['dependencies', 'devDependencies', 'peerDependencies'].flatMap((section) => {
        const value = manifest[section];
        return typeof value === 'object' && value !== null ? Object.keys(value) : [];
      }),
    );
    return [
      'javascript',
      ...(deps.has('typescript') || siblings.has('tsconfig.json') ? ['typescript'] : []),
      ...Object.entries(FRAMEWORKS).filter(([dep]) => deps.has(dep)).map(([, tag]) => tag),
    ];
  },
};
