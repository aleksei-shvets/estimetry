import type { ProjectId } from '../../domain/project/project-id.js';

/** A registered project found for a directory. */
export interface LocatedProject {
  readonly id: ProjectId;
  /** The registered path of the working copy that holds the directory. */
  readonly root: string;
}

/** Maps a directory to a registered project: real path, worktrees, the longest registered ancestor. */
export interface ProjectLocator {
  locate(directory: string): LocatedProject | undefined;
}
