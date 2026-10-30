import type { StackDetector } from '../../application/contracts/stack-detector.js';

export const goDetector: StackDetector = {
  manifests: ['go.mod'],
  detect(_name, content) {
    if (!/^\s*module\s+\S/m.test(content)) {
      throw new Error('expected a module line');
    }
    return ['go'];
  },
};
