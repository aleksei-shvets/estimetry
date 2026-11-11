import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      // Unit tests cover the layers without I/O; the other layers are tested through files, git and the built CLI.
      include: ['src/domain/**', 'src/application/**'],
      reporter: ['text-summary'],
      // The coverage of 11.11.2026, rounded down: it may grow, not fall.
      thresholds: {
        'src/domain/**': { statements: 94, branches: 88, functions: 95, lines: 94 },
        'src/application/**': { statements: 95, branches: 82, functions: 94, lines: 95 },
      },
    },
  },
});
