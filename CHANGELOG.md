# Changelog

All notable changes to estimetry. Versions follow [semantic versioning](https://semver.org); while at 0.x, a minor version may change commands or the storage format, and says so here.

## Unreleased

- **Calibration from the first closed task.** The coefficient an estimate applies is the median of fact over estimate shrunk towards 1 with the weight n / (n + k) (`calibration.shrink`, 2 by default), instead of nothing until a slice has 5 tasks. The slices form a chain — all your tasks, the technology of the query with the most tasks, the task type — each shrunk towards the one above by the tasks no deeper slice holds, so every task counts once; the deepest applies, and the overall slice now counts too. `emt calibrate` names the slice, the number of tasks and the weight.
- **Pessimistic coefficient.** `c · e^(ln 2 / √n)`, at most 1 while your estimates run high: the agent multiplies the pessimistic hours by it and the optimistic and most likely hours by the coefficient. The estimate file takes it as `calibration.pessimistic`; the base calibration compares with is still likely over the coefficient.
- **Without calibration** an estimate is now only when no task is closed yet, every closed task is left out or has no estimate, there are fewer tasks than your `calibration.minTasks`, or some cards come from a newer estimetry; `emt calibrate` says which.
- New defaults: `calibration.minTasks: 1`, `calibration.shrink: 2`. A `minTasks` you set without `shrink` means `shrink: 0`; `minTasks: 5` alone gives the coefficient of earlier versions wherever they gave one, and the median of all your tasks where neither the type nor a technology has 5; the pessimistic hours get the pessimistic coefficient there too, a reserve earlier versions did not give. The README shows what to expect from each setting.
- `calibration.json` has schema 3: `weight` instead of `applicable` in every slice, and `shrink`. It is rewritten by the next closing or `emt rebuild`.
- `emt calibrate --json` has `schemaVersion: 2`: `coefficient` is `{ value, pessimistic, slice: { kind, key? }, n, weight }`, slices carry `weight` instead of `applicable`, and `shrink` sits beside `minTasks`.
- `emt calibrate --help` names `calibration.minTasks` and `calibration.shrink` with their defaults, and `emt --help` says where `config.yaml` lives.
- Run `emt upgrade` once: the skills are written again.

## 0.2.0 — 2026-11-21

- **Codex.** `estimetry init --tools codex`, or picking Codex in `init`, sets up the hooks of Codex (in `~/.codex/hooks.json`, or `.codex/hooks.json` of the project with `--shared-hooks`) and the `emt-…` skills (in `~/.agents/skills`, or `.agents/skills`), called as `$emt-…`. Sessions of Codex are measured like those of Claude Code, and both tools may serve one task. Codex runs a hook only once you trust it, and the agent's commands in a sandbox: in a terminal `init` asks whether to trust the estimetry hooks and to let the task commands (`emt start`, `extra`, `close`…) out of the sandbox, and records both with yes or `--trust-hooks` (`~/.codex/config.toml`, `~/.codex/rules/estimetry.rules`). `emt upgrade` trusts again the hooks it changes when you trusted them before; `emt status` warns while they are not trusted. Requires Codex 0.145 or newer.
- The rollouts of Codex sessions are imported at the session end and before a task closes: turns, subagents and tokens by model. Codex records no cost, so its sessions count in tokens only, and the cost of a task says by how many sessions it is counted (`cost from 1 of 2 sessions`, or `not reported`). Cards get `usage.withCost`.
- `init` without `--tools` now sets up the tools found on this machine (`~/.claude`, `~/.codex`) when none is installed in the project yet, instead of every tool.
- The texts outside an agent name the skills without the slash of Claude Code (`skill emt-retro`); the context the hooks give an agent names them as its tool calls them.
- The journal: `log.session` records may carry `costReported: false` and a `cacheWrite` count; records of 0.1 read as before, and 0.1 reads the new ones, though it counts a Codex session as costing nothing.
- Run `emt upgrade` once: the skills are written again.

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
