import { describe, expect, it } from 'vitest';
import { NodeProjectFiles } from '../../src/infrastructure/fs/node-project-files.js';

const paths = new NodeProjectFiles();

describe('paths of project files', () => {
  it('inside: relative to the root only for a path under it', () => {
    expect(paths.inside('/work/app', '/work/app/src/a.ts')).toBe('src/a.ts');
    expect(paths.inside('/work/app', '/work/app')).toBeUndefined();
    expect(paths.inside('/work/app', '/work/apple/a.ts')).toBeUndefined();
    expect(paths.inside('/work/app', '/home/dev/.claude/settings.json')).toBeUndefined();
  });

  it('contains: the directory itself and what lies under it, with or without a trailing separator', () => {
    expect(paths.contains('/work/app', '/work/app')).toBe(true);
    expect(paths.contains('/work/app', '/work/app/src')).toBe(true);
    expect(paths.contains('/work/app/', '/work/app/src')).toBe(true);
    expect(paths.contains('/work/app', '/work/apple')).toBe(false);
    expect(paths.contains('/work/app/src', '/work/app')).toBe(false);
  });

  it('portable, dirname and basename', () => {
    expect(paths.portable('.claude/settings.local.json')).toBe('.claude/settings.local.json');
    expect(paths.dirname('/work/app/pubspec.yaml')).toBe('/work/app');
    expect(paths.basename('/work/app/pubspec.yaml')).toBe('pubspec.yaml');
  });
});
