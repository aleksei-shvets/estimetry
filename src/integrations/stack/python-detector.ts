import type { StackDetector } from '../../application/contracts/stack-detector.js';

const FRAMEWORKS = ['django', 'fastapi', 'flask'];

/** Dependency names are all that matters, so the files are scanned, not fully parsed. */
export const pythonDetector: StackDetector = {
  manifests: ['pyproject.toml', 'requirements.txt'],
  detect(_name, content) {
    const text = content.toLowerCase();
    return ['python', ...FRAMEWORKS.filter((framework) => new RegExp(`(^|[\\s"'\\[,])${framework}([\\s"'=<>~!\\[,;]|$)`, 'm').test(text))];
  },
};
