import { InvalidValue } from '../shared/domain-error.js';

const PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Kebab-case project id derived from the directory name, e.g. `my-app`, `my-app-2`. */
export class ProjectId {
  private constructor(readonly value: string) {}

  static parse(value: string): ProjectId {
    if (!PATTERN.test(value)) {
      throw new InvalidValue(`invalid project id "${value}", expected kebab-case`);
    }
    return new ProjectId(value);
  }

  /** Builds an id from an arbitrary directory name. */
  static fromName(name: string): ProjectId {
    const slug = name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return new ProjectId(slug === '' ? 'project' : slug);
  }

  /** The first of `base`, `base-2`, `base-3`, … that is not taken. */
  static firstFree(base: ProjectId, taken: ReadonlySet<string>): ProjectId {
    if (!taken.has(base.value)) {
      return base;
    }
    for (let n = 2; ; n++) {
      const candidate = `${base.value}-${n}`;
      if (!taken.has(candidate)) {
        return new ProjectId(candidate);
      }
    }
  }

  equals(other: ProjectId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
