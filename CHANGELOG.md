# Changelog

All notable changes to estimetry. Versions follow [semantic versioning](https://semver.org); while at 0.x, a minor version may change commands or the storage format, and says so here.

## Unreleased

## 0.1.0 — 2026-11-11

The first public version: estimates of AI-agent development work compared with the actual effort, and that experience reused in the next estimate. Claude Code is the only supported AI tool.

- `estimetry init` sets up a project: Claude Code hooks, the `/emt-…` skills, the development process (OpenSpec or none) and an optional `post-commit` hook.
- Tasks and estimates by parts of the plan: `emt task`, `emt estimate save`, `emt estimate revise` for a task in progress.
- The fact of a task measured from the hooks: the time of the agents and your own, manual time, extra work, parallel sessions, and a range of how certain the fact is. Session logs of Claude Code narrow the range and add tokens and cost.
- Plan progress by archived OpenSpec changes and checkpoints.
- Closing, retro, the card of a closed task and personal calibration: `emt close`, `emt retro`, `emt reopen`, `emt rebuild`.
- Estimates from past tasks: `emt similar` and `emt calibrate`, used by `/emt-estimate`.
- Requires Node.js 22.12 or newer.
