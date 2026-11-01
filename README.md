# estimetry

Compares work estimates with the actual effort in AI-agent development and reuses that experience in the next estimate.

The CLI is `estimetry`, with the short alias `emt`. It needs Node.js 20.19 or newer:

```sh
npm install -g estimetry
```

> estimetry is in early development. Closing tasks and calibration are still being built.

## Setting up a project: `estimetry init`

Run it in the root of a repository:

```sh
estimetry init
```

In a terminal it asks a few questions:
- which AI tools to set up (Claude Code for now);
- the development process (OpenSpec or none);
- how to share data with your team;
- whether to install a git hook.

`estimetry init --no-interactive` uses flags and defaults instead, and so does any run in CI or without a terminal. Running init again is safe: it updates what it installed and leaves everything else alone.

### What it installs

| What | Where | Who gets it |
|---|---|---|
| Hooks for 12 Claude Code events, each running `estimetry hook claude-code <event>` | `.claude/settings.local.json` | you |
| Skills `estimetry`, `emt-estimate`, `emt-start`, `emt-extra`, `emt-parallel`, `emt-manual` (also the `/emt-…` commands) | `~/.claude/skills/` (or `$CLAUDE_CONFIG_DIR/skills/`) | you, in every project |
| Project id and development process | `.estimetry/config.yaml` | the team; commit it so clones of the repository are one project |

With `--shared-hooks` the hooks go to `.claude/settings.json` and the skills to `.claude/skills/` of the project. A reminder to run `/emt-estimate` before naming a deadline is added to `CLAUDE.md`, between `<!-- estimetry:start -->` and `<!-- estimetry:end -->`. These are files the project commits, so the whole team gets them.

With `--track-commits` a `post-commit` hook is installed into the repository's hooks directory. This respects `core.hooksPath`, worktrees and husky (`.husky/post-commit`). An existing hook keeps its content: estimetry adds its own block between `# >>> estimetry >>>` and `# <<< estimetry <<<`. The hook runs estimetry in the background, so commits never wait for it. Colleagues without estimetry see nothing.

No task data ever goes into the repository. Tasks, estimates and the event journal live in `~/.local/share/estimetry/`, or in `ESTIMETRY_HOME` if set.

### Flags

| Flag | Meaning |
|---|---|
| `--tools <ids>` | AI tools, comma-separated: `claude-code` (alias `claude`) |
| `--flow <id>` | `openspec` or `none`; detected by default (`openspec/` in the root means OpenSpec) |
| `--share <mode>` | `none`, `calibration` or `cards`; only saved for now |
| `--track-commits` / `--no-track-commits` | install or remove the git hook |
| `--shared-hooks` / `--no-shared-hooks` | install for the whole team or for yourself only |
| `--force` | overwrite generated skills you have edited |
| `--no-interactive` | do not ask questions |
| `--json` | print the report as JSON |

A repeated run keeps what is installed: once the git hook or the shared install is in place, `estimetry init` without flags leaves it so. To undo it, run `estimetry init --no-track-commits` or `estimetry init --no-shared-hooks`.

### Good to know

- **Your edits to generated skills are kept.** Every generated skill carries `metadata.generatedBy` and a hash of its content. If you edit one, init keeps your version and reports it as `skipped`; `--force` overwrites it. A file of the same name that estimetry did not create is never touched.
- **A rewritten hook is yours.** estimetry recognises its hooks by the command prefix `estimetry hook claude-code`. If you change that command, init treats the hook as yours and adds its own next to it.
- **`settings.local.json` may not be ignored by git.** Claude Code adds `**/.claude/settings.local.json` to your global git excludes only when it writes that file itself. If init creates it and git does not ignore it, init offers to add the same line. With `--no-interactive` it only warns.
- **Hooks need `estimetry` on `PATH`.** When run through `npx`, the hooks will not find it, and init warns about that.

## Measuring a task

Once a task is started (`emt start`), the Claude Code hooks record its sessions into the task's journal. `emt status` shows the fact measured so far: the time of the agents, your own time, and how certain the numbers are.

### What counts

- **Agent time** — while the main agent works on a turn or a subagent runs, including tools that take a while.
- **Your time** — while the session is yours: reviewing results and writing the next prompt. Pauses longer than the idle threshold do not count.
- **Not counted** — commands left running in the background after the agent finished its turn (`run_in_background`, or a subagent waiting for its own background job). The machine works then, not the agent.

### Which task a session serves

- **One task in progress** — a session binds to it by itself.
- **Several tasks in progress** — the agent gets the session id at the start of the session and asks you which task it is. It then runs `emt attach <task> --session <id>`. The same command switches a running session to another task; the time before and after the switch goes to the right task.
- **No task in progress** — the session's time is kept in a journal of the project and counts for no task. Start a task, even with `emt start --at "<when you began>"`, and the session's work since then moves into it.

### Checkpoints

Every 20 minutes of work a checkpoint records the state of the plan (the checkboxes of OpenSpec `tasks.md`), `HEAD` and the uncommitted changes of the repository. It runs only in background hooks. Set the interval in `~/.local/share/estimetry/config.yaml`:

```yaml
measurement:
  checkpointMinutes: 20   # 10 to 30
```

After a checkpoint, the agent is reminded with your next prompt to record work outside the plan with `/emt-extra`.

### Plan progress

`emt status` also shows how much of the plan is done:

```
plan            51% done by changes (58h 30m of 58h 30m in groups)
  not started   close-retro-cards, estimate-mode
changes         4 done, last hooks-and-flows 2026-11-01 (approx.)
```

- **Parts are linked by `group`.** A part of the estimate whose `group` is the name of an OpenSpec change is linked to that change, in any project of the task. An archived change counts as 100% done, an active one by its checked boxes, a change not created yet as 0%. The percent is weighted by the most likely hours of the linked parts.
- **The plan of a task** is its active changes plus the archived ones dated no earlier than the day before the task started. An older archive with the same name belongs to earlier work.
- **Groups without a change** are listed as `not started`, as `possible typo` when a change has a similar name, or as `archived before start`.
- **Without groups** (or without an estimate) the plan is counted by the checkboxes of all its changes and marked as not linked to the estimate.
- **Not tracked** when the project's flow is `none` or unknown, the project has no `.estimetry/config.yaml`, or it is not on this machine. For a task in several projects, the percent counts the projects estimetry can read and lists the others under `not tracked`: their groups may look not started although they are done.
- **Several working copies** of a project (worktrees, clones): the plan is read in the one you work in.

A change is completed when its directory appears in the archive, however it got there: `openspec archive`, a skill moving it, or you in a terminal. The next hook call of a session bound to the task records it, with the time of the move. Changes already archived when estimetry first looks at a task are recorded with their date only, marked `(approx.)`. A change moved back out of the archive no longer counts as completed. The start of a session shows the percent too (`plan 51% done`), and `emt parallel on` records it.

### What is never stored

The journal keeps when things happened, not what was said or done: no prompt texts, no tool inputs or outputs, no commands, no commit messages. Commits are recorded as their hash, parents, `patch-id` and lines per file.

### After upgrading estimetry

Run `estimetry init` again in each project. Most hooks then run in the background, so the agent does not wait for them. Before that they still work, just slower.

