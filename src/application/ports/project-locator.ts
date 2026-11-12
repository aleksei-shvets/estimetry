import type { ProjectId } from '../../domain/project/project-id.js';

/** A registered project found for a directory. */
export interface LocatedProject {
  readonly id: ProjectId;
  /** The registered path of the working copy that holds the directory. */
  readonly root: string;
}

/**
 * Maps a directory to a registered project: real path, worktrees, the longest
 * registered ancestor. Paths are compared as the disk keeps them (symlinks
 * resolved, the case of macOS), so `root` is the real path of the copy. On the
 * hot path of a hook: one read of the registry and a `realpath` of the directory; registered
 * paths are made real only when nothing matched as written (a registry from before 0.1.1).
 */
export interface ProjectLocator {
  locate(directory: string): LocatedProject | undefined;
}
