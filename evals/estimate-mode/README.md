# Evals of estimate mode

Checks that an agent with the `emt-estimate` command follows the protocol of estimate mode: similar tasks and calibration before any number, the coefficient only when `emt calibrate` names one, "without calibration" otherwise, the reserve only in the pessimistic hours, and `emt estimate revise` for a task in progress.

1. `npm run build`
2. `node evals/estimate-mode/make-store.mjs <dir>` — a synthetic store: six closed `feature` tasks on typescript and node (coefficient ×1.275 by type), two closed `research` tasks on python (too few), one `feature` task in progress. The skills go to `<dir>/user/.claude`, never to your own.
3. Run every eval of `evals.json` three times with skill-creator, in `<dir>/project`, with `ESTIMETRY_HOME=<dir>/home`, `HOME=<dir>/user` and the skills of `<dir>/user/.claude`. An agent that is asked to approve answers as the user would: it approves the shown estimate.
4. An eval passes when 2 of 3 runs meet every expectation. Record the result of each round in `tasks.md` of the change.

Fixtures are synthetic only; real session logs are never committed.
