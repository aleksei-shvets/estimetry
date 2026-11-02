/*
 * Classes of changed files for the code volume of a task (task-cards spec):
 * built-in masks, checked in order; the first class that matches wins.
 */

export const CODE_CLASSES = ['generated', 'tests', 'docs', 'config', 'production'] as const;
export type CodeClass = (typeof CODE_CLASSES)[number];

const GENERATED_FILES = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|go\.sum)$|\.lock$|\.lockb$|\.g\.dart$|\.freezed\.dart$|\.pb\.go$|_pb2\.py$|\.min\.js$|\.map$|\.snap$/;
const GENERATED_DIRS = /(^|\/)(node_modules|__snapshots__|generated)\/|^\.(estimetry|claude)\//;
const GENERATED_ROOT_DIRS = /^(dist|build)\//;

const TEST_DIRS = /(^|\/)(test|tests|__tests__|spec|integration_test)\/|(^|\/)src\/test\//;
const TEST_FILES = /\.(test|spec)\.[^/]+$|_test\.[^/]+$|(^|\/)test_[^/]*\.py$/;

const DOC_FILES = /\.(md|mdx|rst|adoc)$|(^|\/)(README|CHANGELOG|LICENSE)[^/]*$/i;
const DOC_DIRS = /(^|\/)(docs|openspec)\//;

const CONFIG_FILES = /\.(json|ya?ml|toml|ini|xml|properties|gradle|sql|txt)$|(^|\/)(Dockerfile[^/]*|docker-compose[^/]*|Makefile)$|(^|\/)\.[^/]+$/;
const CONFIG_DIRS = /(^|\/)(\.github|migrations)\//;

/** The class of a path relative to the project root, with `/` separators. */
export function classify(path: string): CodeClass {
  const p = path.replace(/\\/g, '/');
  if (GENERATED_FILES.test(p) || GENERATED_DIRS.test(p) || GENERATED_ROOT_DIRS.test(p)) {
    return 'generated';
  }
  if (TEST_DIRS.test(p) || TEST_FILES.test(p)) {
    return 'tests';
  }
  if (DOC_FILES.test(p) || DOC_DIRS.test(p)) {
    return 'docs';
  }
  if (CONFIG_FILES.test(p) || CONFIG_DIRS.test(p)) {
    return 'config';
  }
  return 'production';
}
