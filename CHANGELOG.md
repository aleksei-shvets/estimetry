# Changelog

All notable changes to estimetry. Versions follow [semantic versioning](https://semver.org); while at 0.x, a minor version may change commands or the storage format, and says so here.

## Unreleased

## 0.1.2 — 2026-11-12

- The hooks `init` writes run the installation of estimetry that ran it, by the paths of its Node.js and entry point, and fall back to `estimetry` on `PATH`. A version manager (asdf, nvm) that picks another Node.js for a project, or one without estimetry, no longer stops the Claude Code hooks or the `post-commit` hook. Settings and hooks the project commits keep the plain `estimetry hook …`. Run `emt upgrade` once to rewrite the hooks.

## 0.1.1 — 2026-11-12

- The npm page shows the English README: the Russian one is now `README-ru.md`, which npm does not pack.
- macOS: a directory spelled in another case than at `init` is the same project, for the CLI and the hooks; paths are compared as the disk keeps them, and paths registered before are matched too.
- A commit from a program without your shell's `PATH` (an IDE started from the Dock on macOS) is recorded: the personal `post-commit` hook falls back to the Node.js and estimetry `init` ran with. Run `emt upgrade` once to update the hook.

## 0.1.0 — 2026-11-12

The first public version: estimates of AI-agent development work compared with the actual effort, and that experience reused in the next estimate. Claude Code is the only supported AI tool.

- `estimetry init` sets up a project: Claude Code hooks, the `/emt-…` skills, the development process (OpenSpec or none) and an optional `post-commit` hook.
- Tasks and estimates by parts of the plan: `emt task`, `emt estimate save`, `emt estimate revise` for a task in progress.
- The fact of a task measured from the hooks: the time of the agents and your own, manual time, extra work, parallel sessions, and a range of how certain the fact is. Session logs of Claude Code narrow the range and add tokens and cost.
- Plan progress by archived OpenSpec changes and checkpoints.
- Closing, retro, the card of a closed task and personal calibration: `emt close`, `emt retro`, `emt reopen`, `emt rebuild`.
- Estimates from past tasks: `emt similar` and `emt calibrate`, used by `/emt-estimate`.
- Work in git worktrees: a worktree belongs to the project of its main working copy, and the plan, checkpoints and code volume of a task are read in the working copy that holds its changes, also when the session runs in the main working copy. `emt attach --session` counts the first task of a session from the start of the task.
- `emt upgrade`: after updating estimetry, sets it up again in every project on this machine with one command, after showing the plan and asking. The session start tells the agent to suggest it when a project was set up by an older version.
- The README in English and Russian, with a reference of every command and flag ([README-ru.md](https://github.com/aleksei-shvets/estimetry/blob/main/README-ru.md)).
- Requires Node.js 22.12 or newer.
