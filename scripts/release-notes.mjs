#!/usr/bin/env node
// Checks a release tag against package.json and prints its section of CHANGELOG.md.
// Usage: node scripts/release-notes.mjs vX.Y.Z  (run from the repository root)
import { readFileSync } from 'node:fs';

const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const tag = process.argv[2] ?? '';
if (!TAG.test(tag)) {
  fail(`Tag "${tag}" is not a release tag: expected vX.Y.Z without leading zeros or suffixes.`);
}
const version = tag.slice(1);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (pkg.version !== version) {
  fail(`Tag ${tag} does not match version ${pkg.version} in package.json.`);
}

const lines = readFileSync('CHANGELOG.md', 'utf8').split(/\r?\n/);
const heading = (line) => /^## /.test(line);
const escaped = version.replaceAll('.', '\\.');
const start = lines.findIndex((line) => new RegExp(`^## \\[?${escaped}\\]?(\\s|$)`).test(line));
if (start === -1) {
  fail(`CHANGELOG.md has no section "## ${version}".`);
}
const end = lines.findIndex((line, i) => i > start && heading(line));
const notes = lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim();
if (notes === '') {
  fail(`The section "## ${version}" of CHANGELOG.md is empty.`);
}
process.stdout.write(`${notes}\n`);
