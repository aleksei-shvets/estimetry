# Contributing

## Development

You need Node.js 22.12 or newer and git.

```sh
npm ci
npm run lint
npm run typecheck
npm test               # builds dist, runs every test, then the hook budgets on their own
npm run test:coverage  # unit tests with the coverage of src/domain and src/application
```

The hook budgets measure wall time, so `npm test` runs them after the other tests, not beside them. The coverage of `src/domain` and `src/application` must not fall below the thresholds in `vitest.config.ts`; CI checks both.

The README comes in two languages, `README.md` and `README-ru.md`, each with a switch to the other. Change both in the same pull request, keeping their sections the same. The command reference at the end of `README.md` is generated from the CLI: after adding or changing a command or a flag, run `npm run docs:commands` and translate the same lines in `README-ru.md`. A test fails while `README.md` is behind or `README-ru.md` lacks a command or a flag; the translated descriptions are checked in review.

Tests never touch your own data: they run on temporary `ESTIMETRY_HOME`, `HOME` and `CLAUDE_CONFIG_DIR`. Fixtures are synthetic; never commit real Claude Code logs.

## Changes

`main` is protected: nobody pushes to it directly, the maintainer included.

1. Branch off a fresh `main`.
2. Open a pull request into `main`.
3. CI runs lint, typecheck and the tests on Linux and macOS with Node 22 and 24. The pull request can be merged once the `checks` status is green on its latest commit, rebased onto the current `main` if needed.

Add a line to the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md) for anything a user would notice.

## Releases

npm gets a new version only from a `vX.Y.Z` tag on `main`:

1. In a pull request, set `version` in `package.json` (`npm version X.Y.Z --no-git-tag-version`) and rename `Unreleased` in `CHANGELOG.md` to `## X.Y.Z — YYYY-MM-DD`. Merge it.
2. Tag the merge commit and push the tag:

   ```sh
   git switch main && git pull
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

3. The `Release` workflow checks that the tag matches `package.json`, is on `main` and has a section in `CHANGELOG.md`, runs the checks again, publishes to npm with provenance and creates the GitHub Release from that section.

Tags `v*` cannot be moved or deleted. If a release fails before publishing, fix it in a new pull request and release the next patch version. If it fails after publishing, push nothing: re-run the failed job; a version already on npm is not published twice.

npm trusts `.github/workflows/release.yml` by its file name (trusted publishing, no tokens): do not rename it.
