# estimetry

Compares work estimates with the actual effort in AI-agent development and reuses that experience in the next estimate.

The CLI is `estimetry`, with the short alias `emt`. It needs Node.js 20.19 or newer:

```sh
npm install -g estimetry
```

> estimetry is in early development. Measuring through hooks, closing tasks and calibration are still being built.

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
- **Hooks are only received for now.** `estimetry hook` accepts every call, exits 0 without output and logs problems to `errors.log`. Recording sessions from hooks comes in the next version.
- **Hooks need `estimetry` on `PATH`.** When run through `npx`, the hooks will not find it, and init warns about that.
