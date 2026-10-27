import type { Author } from '../shared/author.js';
import type { Timestamp } from '../shared/timestamp.js';
import { ProjectId } from './project-id.js';

export const PROJECT_SCHEMA_VERSION = 1;

export interface ProjectSnapshot {
  readonly schemaVersion: number;
  readonly id: string;
  readonly name: string;
  readonly paths: readonly string[];
  readonly stack: readonly string[];
  readonly author: string;
  readonly createdAt: string;
}

/**
 * A working copy (or several, across machines) that tasks belong to.
 * The stack is filled in by `init`; registration only records where it lives.
 */
export class Project {
  private constructor(private readonly snapshot: ProjectSnapshot) {}

  static register(input: { id: ProjectId; name: string; path: string }, author: Author, at: Timestamp): Project {
    return new Project({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: input.id.value,
      name: input.name,
      paths: [input.path],
      stack: [],
      author: author.id,
      createdAt: at.toISOString(),
    });
  }

  static rehydrate(snapshot: ProjectSnapshot): Project {
    ProjectId.parse(snapshot.id);
    return new Project(snapshot);
  }

  get id(): ProjectId {
    return ProjectId.parse(this.snapshot.id);
  }

  get name(): string {
    return this.snapshot.name;
  }

  get paths(): readonly string[] {
    return this.snapshot.paths;
  }

  hasPath(path: string): boolean {
    return this.snapshot.paths.includes(path);
  }

  toSnapshot(): ProjectSnapshot {
    return this.snapshot;
  }
}
