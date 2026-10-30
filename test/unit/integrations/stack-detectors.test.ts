import { describe, expect, it } from 'vitest';
import { detectStack } from '../../../src/application/project/stack.js';
import { composeDetector } from '../../../src/integrations/stack/compose-detector.js';
import { dartDetector } from '../../../src/integrations/stack/dart-detector.js';
import { goDetector } from '../../../src/integrations/stack/go-detector.js';
import { gradleDetector, mavenDetector } from '../../../src/integrations/stack/jvm-detector.js';
import { nodeDetector } from '../../../src/integrations/stack/node-detector.js';
import { pythonDetector } from '../../../src/integrations/stack/python-detector.js';
import { openSpecFlow } from '../../../src/integrations/flows/openspec/openspec-flow.js';
import { noneFlow } from '../../../src/integrations/flows/none/none-flow.js';
import { InMemoryProjectFiles } from '../../support/in-memory-files.js';

const ALL = [nodeDetector, dartDetector, mavenDetector, gradleDetector, pythonDetector, goDetector, composeDetector];
const ROOT = '/p';
const stackOf = (layout: Record<string, string>) => detectStack(ROOT, new InMemoryProjectFiles(Object.fromEntries(Object.entries(layout).map(([p, c]) => [`${ROOT}/${p}`, c]))), ALL);

describe('stack detectors', () => {
  it('package.json: javascript, typescript by dependency or tsconfig, frameworks from every dependency section', () => {
    expect(stackOf({ 'package.json': '{"dependencies":{"react":"18"},"devDependencies":{"typescript":"5"},"peerDependencies":{"@angular/core":"1"}}' }).tags)
      .toEqual(['angular', 'javascript', 'react', 'typescript']);
    expect(stackOf({ 'package.json': '{}', 'tsconfig.json': '{}' }).tags).toEqual(['javascript', 'typescript']);
    expect(stackOf({ 'package.json': '{"dependencies":{"@nestjs/core":"1","express":"4","next":"1","vue":"3","nuxt":"3","svelte":"4","fastify":"4","electron":"1","react-native":"1"}}' }).tags)
      .toEqual(['electron', 'express', 'fastify', 'javascript', 'nestjs', 'next', 'nuxt', 'react-native', 'svelte', 'vue']);
  });

  it('pubspec.yaml: dart, flutter, state management and firebase', () => {
    expect(stackOf({ 'packages/app/pubspec.yaml': 'name: app\ndependencies:\n  flutter:\n    sdk: flutter\n  flutter_bloc: ^8.0.0\n  firebase_core: ^2.0.0\ndev_dependencies:\n  hooks_riverpod: ^2.0.0\n  provider: ^6.0.0\n' }).tags)
      .toEqual(['bloc', 'dart', 'firebase', 'flutter', 'provider', 'riverpod']);
  });

  it('pom.xml and build.gradle: jvm languages, build tools, spring boot and android', () => {
    expect(stackOf({ 'pom.xml': '<project><parent><groupId>org.springframework.boot</groupId></parent><build><plugin>kotlin-maven-plugin</plugin></build></project>' }).tags)
      .toEqual(['java', 'kotlin', 'maven', 'spring-boot']);
    expect(stackOf({ 'build.gradle.kts': 'plugins { id("com.android.application") }' }).tags).toEqual(['android', 'gradle', 'kotlin']);
    expect(stackOf({ 'build.gradle': "plugins { id 'org.springframework.boot' version '3' }" }).tags).toEqual(['gradle', 'java', 'spring-boot']);
  });

  it('pyproject.toml and requirements.txt: python and web frameworks', () => {
    expect(stackOf({ 'pyproject.toml': '[project]\ndependencies = ["fastapi>=0.100", "uvicorn"]\n' }).tags).toEqual(['fastapi', 'python']);
    expect(stackOf({ 'requirements.txt': 'Django==5.0\nflask-cors\n' }).tags).toEqual(['django', 'python']);
  });

  it('go.mod and compose files: go, docker and services by image name', () => {
    expect(stackOf({ 'go.mod': 'module example.com/x\n\ngo 1.22\n' }).tags).toEqual(['go']);
    expect(stackOf({ 'docker-compose.yml': 'services:\n  db:\n    image: bitnami/postgresql:16\n  cache:\n    image: redis\n  q:\n    image: confluentinc/cp-kafka:7.5\n  m:\n    image: mariadb:11\n  build-only:\n    build: .\n' }).tags)
      .toEqual(['docker', 'kafka', 'mysql', 'postgres', 'redis']);
    expect(stackOf({ 'compose.yaml': 'services:\n  s:\n    image: mongo:7\n  r:\n    image: rabbitmq:3\n  e:\n    image: elasticsearch:8\n  c:\n    image: clickhouse/clickhouse-server\n' }).tags)
      .toEqual(['clickhouse', 'docker', 'elasticsearch', 'mongodb', 'rabbitmq']);
  });

  it('turns a broken manifest into a warning and keeps the rest', () => {
    const result = stackOf({ 'package.json': '{ broken', 'go.mod': 'module x\n' });
    expect(result.tags).toEqual(['go']);
    expect(result.warnings).toEqual([expect.stringMatching(/^package\.json: .*skipped when detecting the stack$/)]);
    expect(stackOf({ 'go.mod': 'nonsense' }).warnings).toHaveLength(1);
  });

  it('looks two levels deep only', () => {
    expect(stackOf({ 'a/b/c/go.mod': 'module x\n' }).tags).toEqual([]);
  });
});

describe('flows', () => {
  it('OpenSpec is detected by its directory; none never claims a project', () => {
    const files = new InMemoryProjectFiles({ '/p/openspec/project.md': '' });
    expect(openSpecFlow.detect('/p', files)).toBe(true);
    expect(openSpecFlow.detect('/q', files)).toBe(false);
    expect(noneFlow.detect('/p', files)).toBe(false);
  });

  it('OpenSpec reminds to run openspec init when it is chosen for a project without it', () => {
    const files = new InMemoryProjectFiles({ '/p/openspec/project.md': '' });
    expect(openSpecFlow.setupHint?.('/p', files)).toBeUndefined();
    expect(openSpecFlow.setupHint?.('/q', files)).toContain('run `openspec init`');
  });
});
