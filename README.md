# estimetry

Compares work estimates with the actual effort in AI-agent development and reuses that experience in the next estimate.

The CLI is `estimetry`, with the short alias `emt`. It needs Node.js 20.19 or newer:

```sh
npm install -g estimetry
```

> estimetry is in early development.

## Help

`emt --help` lists every command, nested ones included (`task new`, `estimate save`, `parallel on`), grouped by stage: setup, tasks and estimates, measuring, closing. Each comes with its options; required ones are marked. Examples of the usual order close the list.

`emt <command> --help` or `emt help <command>` shows one command in full, e.g. `emt help task new`.

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
| Skills `estimetry`, `emt-estimate`, `emt-start`, `emt-extra`, `emt-parallel`, `emt-manual`, `emt-close`, `emt-retro` (also the `/emt-…` commands) | `~/.claude/skills/` (or `$CLAUDE_CONFIG_DIR/skills/`) | you, in every project |
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

## Estimating a task

Ask the agent how long a task will take, or run `/emt-estimate`. Before it names any number, the agent:
1. agrees with you on the task type and the technologies the task really touches;
2. sketches the parts of the plan and runs `emt similar` — closed tasks like this one, with their estimates, fact, extra work and lessons;
3. runs `emt calibrate` — your coefficients and the one the estimate may apply;
4. shows the estimate by parts with what it rests on, and saves it with `emt estimate save` only after you approve it.

```sh
emt similar --type feature --stack typescript,node --hours 8
emt calibrate --type feature --stack typescript,node
emt calibrate --type feature --revise     # for a revision of a task in progress
```

- **Similarity** weighs the shared technologies (half), the type of the first estimate and, with `--hours`, the size. Each task shows what its similarity is made of. Without `--stack`, the stack of the project counts.
- **The coefficient** is the median of fact over estimate of the first slice with enough closed tasks: by type, then by technology. The overall slice mixes every kind of work and is shown for reference only. With fewer tasks than `calibration.minTasks` (5 by default) the estimate is **without calibration**, and the agent says so.
- **A calibrated estimate** multiplies all three numbers of every part by the coefficient and records it (`calibrated: true`, `calibration.coefficient`), so the next coefficient is computed from the estimate before it. A reserve goes only into the pessimistic hours: extra work you absorbed is already in the coefficient.
- **Nothing is written** by `emt similar` and `emt calibrate`; `calibration.json` is updated by closings and `emt rebuild`.
- **A changed email.** Calibration is personal, by `author.id` in `config.yaml`. List earlier ids so that their cards stay yours:

  ```yaml
  author:
    id: new@example.com
    aliases: [old@example.com]
  ```

## Measuring a task

Once a task is started (`emt start`), the Claude Code hooks record its sessions into the task's journal. `emt status` shows the fact measured so far: the time of the agents, your own time, and how certain the numbers are.

### What counts

- **Agent time** — while the main agent works on a turn or a subagent runs, including tools that take a while.
- **Your time** — while the session is yours: reviewing results and writing the next prompt. Pauses longer than the idle threshold do not count.
- **Not counted** — commands left running in the background after the agent finished its turn (`run_in_background`, or a subagent waiting for its own background job). The machine works then, not the agent.

### How certain the fact is

Some stretches are decided by a rule, not by an event: a silence of 20 minutes after the agent answered may be you reviewing the result, or you away. `emt status` shows the range the fact lies in:

```
fact         29h 43m of 58h 30m (51%)
uncertainty  27h 53m – 34h 0m (21% of the fact, above the 5% target)
```

- **The lower bound** leaves out the doubtful stretches the rules counted: silences between half the threshold and the threshold, tools that ran longer than twice the threshold, the start of a turn a session joined midway.
- **The upper bound** adds the doubtful stretches the rules left out: pauses up to twice the threshold, the tail of a turn or subagent that never reported its end, long waits that ended without a duration.

Estimates and calibration compare with the fact itself; the range only tells how far it could move. Most of it is usually your own silences after a finished turn: nothing records whether you worked then, so it stays open.

### Session logs, tokens and cost

Claude Code keeps a log of every session. estimetry reads it when a session ends (also on `/clear` and `/resume`) and before a task closes, and keeps in the task's journal only what it needs:
- when the agent's turns and subagents began and ended: a turn whose end the hooks missed ends where the log ends it, and a session that joined midway starts its turn where the log starts it;
- tokens by model, with their times, and the session's total cost.

The texts of the log — prompts, answers, tool inputs and outputs, descriptions and types of subagents — are never read into the journal.

`emt status` and the card show the tokens of the task and its cost, with how many of its sessions had a log. When only part of a session's tokens belongs to the task (the session began before `emt start`, or served another task too), the task gets the matching share of the session's cost, weighing each kind of token by its price relative to an input token, and the cost is marked approximate.

The cost is the total Claude Code itself records in the session log, at API prices. On a subscription it is not what you pay: read it as a measure for comparing tasks with each other, not as spending.

Sessions that ended before you installed this version are read when the task closes. Claude Code deletes logs after 30 days; for longer tasks raise `cleanupPeriodDays` in its settings.

### Which task a session serves

- **One task in progress** — a session binds to it by itself.
- **Several tasks in progress** — the agent gets the session id at the start of the session and asks you which task it is. It then runs `emt attach <task> --session <id>`. The same command switches a running session to another task; the time before and after the switch goes to the right task.
- **No task in progress** — the session's time is kept in a journal of the project and counts for no task. Start a task, even with `emt start --at "<when you began>"`, and the session's work since then moves into it.

### Restarts and parallel sessions

The hooks find the project by the directory Claude Code runs in, not by the session id.

- **After a restart** (VS Code, a crash, a reboot) the new session has a new id and binds again by the rules above: with one task in progress, time goes on into it without anything to do. With several, answer the agent which task it is. Work the new session did before `emt attach` stays in the project's journal and does not count.
- **A turn cut off by a crash** gets no end. Its tail is closed by the idle threshold and shows as uncertainty (`± …` in `emt status`). The time between the crash and the restart does not count.
- **Two sessions on one task** both write into its journal. Overlapping agent time counts once, so the fact is shorter than the work of both agents together. Switch on parallel mode (`emt parallel on --agents 2`): calibration then uses the sequential equivalent, the sum of the agents' work.
- **Two sessions on two tasks** each serve their own task after `emt attach`. A commit goes to the task of the session active last: the git hook does not know which session made it. When both commit at the same moment, one commit may land in the other task. This affects only the code volume of the card, not the time.

### Code in another working copy or repository

The agent may run in one repository, where the OpenSpec artifacts are, and write code elsewhere.

- **Time and plan progress** are not affected: time goes to the task of the session, and the plan is read where the artifacts are.
- **Another worktree of the same repository** shares the git hooks: with `init --track-commits`, its commits are recorded into the task. The code volume is measured at closing in the working copy `emt close` runs in. Commits not yet reachable from the branch checked out there are shown as unreachable and not counted, and uncommitted changes of the other worktree are not seen. Before closing, merge the worktree's branch into the branch of the working copy you close from. Run `emt` commands from the main working copy.
- **Another repository** belongs to the task only when you add it: run `estimetry init --track-commits` and `emt attach <task>` in it. Then its commits are recorded and its code is measured at closing.

The code volume is a self-check only: it never changes the fact or the coefficients.

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

## Revising the estimate

Once a task is started, its estimate is the plan the fact is compared with, and `emt estimate save` refuses to change it. When the plan turns out wrong but the scope and deadline stay — a design error, something the analysis missed — revise it:

```sh
emt estimate revise plan2.yaml --reason "design was wrong" --category missed-analysis --spent exclude --lost-from "2026-11-02 10:00"
```

`emt task show <task>` gives the parts of the estimate in force (with `--json`, in the format of an estimate file): start the new one from them.

- `--spent include` — the work so far counts toward the new estimate.
- `--spent exclude` — the work since `--lost-from` (by default since the start or the previous revision) up to the revision (`--at`, by default now) was thrown away. It is not deleted: `emt status` shows it apart as lost and compares only the counted fact with the new estimate.
- `--covers <id>` — extra work already recorded for the same loss, so the loss is not counted twice. Only with `--spent exclude`, and an extra work can be covered by one revision only. The command lists the extra work recorded in the window, with ids, so you can name it.
- Archived changes of the thrown-away work leave the plan: they give no percent, no completion and no proposal to close. A change archived again later counts as usual.

The first estimate stays in the journal and in the card: calibration compares the whole fact with it, so a late revision cannot make an estimate look right. The revised estimate is measured too, against the counted fact (see [Calibration](#calibration)). If the customer agreed to more scope or time, use `emt renegotiate` instead.

## Closing a task

A task closes only when you agree. When a change of the task moves into the archive, the agent gets a note on your next prompt and asks whether it was the last one and whether to close the task. It never closes the task by itself.

```sh
emt close            # shows the fact and the plan, then asks
emt close --yes      # without a terminal (an agent): only after you agreed
emt close --at "2026-11-02 18:00"   # the work ended earlier
emt close --abandoned               # the task was dropped; it is not used for calibration
```

Closing records the code volume and the plan, ends parallel mode, and lets the sessions of the task go: a session that closed a task does not move to another task by itself until it starts again or you run `emt attach <task> --session <id>`.

Then hold the retro with the agent (`/emt-retro`): why the fact differs from the estimate and one lesson for next time.

```sh
emt retro --reason "manual-testing: two devices instead of one" --reason "API docs were outdated" --lesson "plan manual testing per platform"
```

A reason that starts with the id of an estimate part (`manual-testing:`) is about that part. Running `emt retro` again replaces the retro.

- **More work agreed with the customer.** `emt renegotiate "Payments v2" --description "refunds added"` closes the task as it is and creates a new task for the rest, linked to it. Estimate and start the new task as usual.
- **Closed by mistake.** `emt reopen T-3` opens the task again; its card goes away until the next closing.
- **Manual time of a part.** `emt manual 40m "testing on device" --part manual-testing` counts the time toward that part of the estimate.
- **Closed tasks** are listed with `emt task list --closed`; `emt task show T-3` shows the card.

### The card

Every closed task gets a card in `~/.local/share/estimetry/cards/<task>.yaml`, about 50 lines. It holds:
- the estimate and the fact, also by parts of the estimate;
- extra work and parallel mode;
- the code volume, as lines of production code, tests, config and docs;
- the retro.

Time is split between parts by the checkboxes their changes closed between checkpoints. Time no part can claim is shown as `unattributed`.

A revised task keeps both estimates: `estimate` and `parts` are the first estimate, `currentEstimate` and `currentParts` the one in force at the closing. The card also lists every revision with the work its window lost and how much was counted when it was made, and gives the counted fact next to the whole one. Time is split between the parts of the current estimate from the moment of the last revision; what was counted before it is shown as `before revision`. Extra work named in `--covers` is listed apart, as covered by the revision.

The code volume counts the task's recorded commits still reachable from `HEAD`, plus what is not committed. Without recorded commits it counts your commits since the task started. Generated files (lock files, `*.g.dart`, `dist/` and the like) are left out. Lines are only a self-check: they never change the fact or the coefficients.

Names, descriptions and the retro sit in a separate `text` section of the card, apart from the numbers.

### Calibration

`calibration.json` holds your coefficients, computed from your cards:
- fact over estimate, overall, by task type and by technology (median, mean, number of tasks);
- the share of extra work by category, and how much scope renegotiations added;
- how well the code volume was forecast;
- which kinds of parts run over.

A coefficient based on fewer than 5 tasks is shown but not applied. Set the minimum in `config.yaml`:

```yaml
calibration:
  minTasks: 5
```

Tasks in parallel mode count with their sequential equivalent. Abandoned tasks and tasks with manual time only are left out.

Revised tasks give two accuracies:
- the main coefficient compares the whole fact with the **first** estimate, by the type of that estimate: that is the number the PM got;
- `revised` compares the counted fact with the **current** estimate: how good the estimate made at the revision was, and how far into the work revisions usually come;
- `revisions` shows, by task type, category and `--spent`, how much revisions grow the estimate and how much work they throw away.

The parts of a revised task count only if no more than 5% of its counted fact was spent before the revision. Tasks with `--spent exclude` stay out of the code volume and lines per hour: rolled back lines say nothing about the size of the task.

`emt rebuild` rebuilds task snapshots, cards and `calibration.json` from the journals, for example after an upgrade changed a formula.

### What is never stored

The journal keeps when things happened, not what was said or done: no prompt texts, no tool inputs or outputs, no commands, no commit messages. Commits are recorded as their hash, parents, `patch-id` and lines per file. From session logs it keeps times, token counts by model and the cost; a log that cannot be read leaves only a code in `errors.log`.

### After upgrading estimetry

Run `estimetry init` again in each project. Most hooks then run in the background, so the agent does not wait for them. Before that they still work, just slower.

Update every installed copy of estimetry at once. Cards written by an older version are rebuilt from the journals on the next closing, `emt task show` or `emt rebuild`. A newer card stops an older estimetry from rewriting `calibration.json` and is reported instead; versions before this check skip such cards silently, so close no task with them.

