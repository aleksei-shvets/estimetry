import { describe, expect, it } from 'vitest';
import { gitHooks } from '../../../src/integrations/tools/git/git-hooks.js';

describe('the git hook', () => {
  it('is a source of commits with the post-commit event only', () => {
    expect(gitHooks).toMatchObject({ kind: 'commit', id: 'git', aliases: [], hookEvents: ['post-commit'] });
  });

  it('names the commit the hook passes, else HEAD', () => {
    expect(gitHooks.commitOf('post-commit', 'c0ffee1')).toEqual({ sha: 'c0ffee1' });
    expect(gitHooks.commitOf('post-commit', `${'a'.repeat(40)}\n`)).toEqual({ sha: 'a'.repeat(40) });
    expect(gitHooks.commitOf('post-commit', '')).toEqual({});
    expect(gitHooks.commitOf('post-commit', 'HEAD; rm -rf /')).toEqual({});
    expect(gitHooks.commitOf('post-commit', 'abc')).toEqual({});
  });
});
