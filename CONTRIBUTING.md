# Contributing

## Development

You need Node.js 22.12 or newer and git.

```sh
npm ci
npm run lint
npm run typecheck
npm test          # builds dist, then runs every test
```

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
