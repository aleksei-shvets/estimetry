import { describe, expect, it } from 'vitest';
import { Project } from '../../../src/domain/project/project.js';
import { ProjectId } from '../../../src/domain/project/project-id.js';
import { Author } from '../../../src/domain/shared/author.js';
import { InvalidValue } from '../../../src/domain/shared/domain-error.js';
import { Timestamp } from '../../../src/domain/shared/timestamp.js';

const ROOT_COMMIT = 'a'.repeat(40);
const project = (fingerprint?: string) =>
  Project.register(
    { id: ProjectId.parse('my-app'), name: 'my-app', path: '/home/u/my-app', ...(fingerprint ? { fingerprint } : {}) },
    Author.of('dev@example.com'),
    Timestamp.fromMillis(0),
  );

describe('Project', () => {
  it('adds a working copy once', () => {
    const twice = project().withPath('/home/u/review/my-app').withPath('/home/u/review/my-app');
    expect(twice.paths).toEqual(['/home/u/my-app', '/home/u/review/my-app']);
    expect(project().withPath('/home/u/my-app').paths).toEqual(['/home/u/my-app']);
  });

  it('keeps the stack sorted and unique, and rejects a tag that is not kebab-case', () => {
    expect(project().withStack(['flutter', 'dart', 'flutter', 'bloc']).stack).toEqual(['bloc', 'dart', 'flutter']);
    expect(() => project().withStack(['Spring Boot'])).toThrow(InvalidValue);
  });

  it('is the same repository only when both fingerprints are known and equal', () => {
    expect(project(ROOT_COMMIT).sameRepository(ROOT_COMMIT)).toBe(true);
    expect(project(ROOT_COMMIT).sameRepository('b'.repeat(40))).toBe(false);
    expect(project().sameRepository(ROOT_COMMIT)).toBe(false);
    expect(project(ROOT_COMMIT).sameRepository(undefined)).toBe(false);
    expect(project().withFingerprint(ROOT_COMMIT).fingerprint).toBe(ROOT_COMMIT);
    expect(() => project('not-a-hash')).toThrow(InvalidValue);
  });

  it('leaves the original untouched', () => {
    const original = project();
    original.withStack(['go']);
    original.withPath('/elsewhere');
    expect(original.toSnapshot()).toMatchObject({ stack: [], paths: ['/home/u/my-app'] });
    expect(original.toSnapshot()).not.toHaveProperty('fingerprint');
  });
});
