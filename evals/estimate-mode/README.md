# Evals of estimate mode

Checks that an agent with the `emt-estimate` command follows the protocol of estimate mode: similar tasks and calibration before any number; the coefficient only when `emt calibrate` names one, with the optimistic and most likely hours multiplied by `coefficient.value` and the pessimistic hours by `coefficient.pessimistic`; the slice, tasks and weight named, and a cautious word below 50%; "without calibration" and its reason otherwise; the reserve only in the pessimistic hours; and `emt estimate revise` for a task in progress.

1. `npm run build`
2. `node evals/estimate-mode/make-store.mjs <dir>` — synthetic stores, one per amount of experience, each in `<dir>/<store>` with its own `home`, `project`, `user` and `bin/emt`:
   - `none` — no closed task: without calibration, "no closed task yet";
   - `one` — one closed `feature` task: ×1.119, pessimistic ×2.237, weight 33%;
   - `two` — two closed `feature` tasks: ×1.14, pessimistic ×1.861, weight 50%;
   - `many` — six closed `feature` tasks on typescript and node, two `research` tasks on python, and `feature` task T-9 in progress: ×1.234, pessimistic ×1.637 from the slice type feature, 6 tasks, weight 75%; `--revise` gives none ("no revised task counts yet").

   The skills go to `<dir>/<store>/user/.claude`, never to your own.
3. Run every eval of `evals.json` three times with skill-creator, each run on a fresh `make-store` (a run creates tasks), in `<dir>/<store>/project` of the eval's `store`, with `ESTIMETRY_HOME=<dir>/<store>/home`, `HOME=<dir>/<store>/user` and the skills of `<dir>/<store>/user/.claude`. An agent that cannot set the environment calls `<dir>/<store>/bin/emt`, which sets both. An agent that is asked to approve answers as the user would: it agrees on the type and stack, approves the shown estimate, and says the work so far counts.
4. An eval passes when 2 of 3 runs meet every expectation. Record the result of each round in `tasks.md` of the change.

Fixtures are synthetic only; real session logs are never committed.
