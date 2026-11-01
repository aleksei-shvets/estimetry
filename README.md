# estimetry

Compares work estimates with the actual effort in AI-agent development and reuses that experience in the next estimate.

The CLI is `estimetry`, with the short alias `emt`. It needs Node.js 20.19 or newer:

```sh
npm install -g estimetry
```

> estimetry is in early development. Closing tasks, plan progress and calibration are still being built.

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

### What is never stored

The journal keeps when things happened, not what was said or done: no prompt texts, no tool inputs or outputs, no commands, no commit messages. Commits are recorded as their hash, parents, `patch-id` and lines per file.

### After upgrading estimetry

Run `estimetry init` again in each project. Most hooks then run in the background, so the agent does not wait for them. Before that they still work, just slower.

