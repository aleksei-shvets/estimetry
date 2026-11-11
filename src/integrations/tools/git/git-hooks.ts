import type { CommitHookAdapter, CommitNotice } from '../../../application/contracts/hook-adapter.js';

const SHA = /^[0-9a-f]{7,64}$/;

/**
 * The git `post-commit` hook `init --track-commits` installs. The hook passes
 * the sha of its commit; an older hook block passes nothing and `HEAD` is read.
 */
export const gitHooks: CommitHookAdapter = {
  kind: 'commit',
  id: 'git',
  aliases: [],
  hookEvents: ['post-commit'],
  commitOf(_event: string, payload: string): CommitNotice {
    const sha = payload.trim();
    return SHA.test(sha) ? { sha } : {};
  },
};
