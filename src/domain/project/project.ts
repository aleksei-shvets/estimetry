import type { Author } from '../shared/author.js';
import type { Timestamp } from '../shared/timestamp.js';
import { InvalidValue } from '../shared/domain-error.js';
import { ProjectId } from './project-id.js';

export const PROJECT_SCHEMA_VERSION = 1;

export interface ProjectSnapshot {
  readonly schemaVersion: number;
  readonly id: string;
  readonly name: string;
  readonly paths: readonly string[];
  readonly stack: readonly string[];
  /** Smallest root commit of the repository: the same in every clone, absent outside git. */
  readonly fingerprint?: string;
  readonly author: string;
  readonly createdAt: string;
}

const STACK_TAG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FINGERPRINT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/**
 * A working copy (or several, across machines) that tasks belong to.
 * The stack is filled in by `init`; registration only records where it lives.
 */
export class Project {
  private constructor(private readonly snapshot: ProjectSnapshot) {}

  static register(
    input: { id: ProjectId; name: string; path: string; fingerprint?: string },
    author: Author,
    at: Timestamp,
  ): Project {
    return new Project({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: input.id.value,
      name: input.name,
      paths: [input.path],
      stack: [],
      ...(input.fingerprint === undefined ? {} : { fingerprint: checkFingerprint(input.fingerprint) }),
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

  get stack(): readonly string[] {
    return this.snapshot.stack;
  }

  get fingerprint(): string | undefined {
    return this.snapshot.fingerprint;
  }

  hasPath(path: string): boolean {
    return this.snapshot.paths.includes(path);
  }

  /** Another working copy of the same project: a second clone or another machine. */
  withPath(path: string): Project {
    return this.hasPath(path) ? this : new Project({ ...this.snapshot, paths: [...this.snapshot.paths, path] });
  }

  /** The stack detected from manifests replaces the previous one. */
  withStack(tags: readonly string[]): Project {
    const stack = [...new Set(tags)].sort();
    const invalid = stack.find((tag) => !STACK_TAG.test(tag));
    if (invalid !== undefined) {
      throw new InvalidValue(`invalid stack tag "${invalid}", expected kebab-case`);
    }
    return new Project({ ...this.snapshot, stack });
  }

  /** Projects registered before fingerprints, or before the first commit, get one later. */
  withFingerprint(fingerprint: string): Project {
    return new Project({ ...this.snapshot, fingerprint: checkFingerprint(fingerprint) });
  }

  /** Same repository: both have a fingerprint and they match. */
  sameRepository(fingerprint: string | undefined): boolean {
    return fingerprint !== undefined && this.snapshot.fingerprint === fingerprint;
  }

  toSnapshot(): ProjectSnapshot {
    return this.snapshot;
  }
}

function checkFingerprint(value: string): string {
  if (!FINGERPRINT.test(value)) {
    throw new InvalidValue(`invalid repository fingerprint "${value}", expected a commit hash`);
  }
  return value;
}
