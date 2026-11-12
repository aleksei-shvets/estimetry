import type { CommandContent } from '../../../application/contracts/command-content.js';

/** Texts of the estimetry skill and its commands, independent of the AI tool. */
export const ESTIMETRY_SKILL: CommandContent = {
  id: 'estimetry',
  description:
    'Estimate tasks and measure the actual effort with the estimetry CLI (emt). Use when the user asks how long a task will take, starts or finishes work on a task, or work goes beyond the plan.',
  body: `# estimetry

estimetry compares estimates with the actual effort of AI-agent development and reuses that experience in the next estimate. Everything goes through the \`emt\` CLI; never edit its files by hand.

## Estimating

Never name an effort or a deadline for a task before \`/emt-estimate\` is done, even when asked casually. The estimate rests on the user's own past tasks, not on a general sense of how long things take:
- agree with the user on the task type and the technologies the task really touches;
- \`emt similar\` shows closed tasks like it, \`emt calibrate\` the user's coefficients and the one the estimate may apply;
- with a coefficient, multiply the hours of every part by it; without one, say plainly that the estimate is without calibration;
- give the estimate by parts of the plan, each with optimistic, most likely and pessimistic hours, and save it only after the user approves it.

## Measuring

- \`emt start\` starts the measurement of a task (\`/emt-start\`).
- Work outside the plan is recorded with \`emt extra\` (\`/emt-extra\`).
- Several agents on one task: \`emt parallel on\` and \`emt parallel off\` (\`/emt-parallel\`).
- Time outside agent sessions, such as manual testing: \`emt manual\` (\`/emt-manual\`).
- \`emt status\` shows the fact so far against the estimate.

## Revising the estimate

When the plan of a task in progress turns out wrong (a design error, something the analysis missed) but its scope and deadline stay, revise the estimate: \`emt estimate revise <file> --reason "<why>" --category <category> --spent include|exclude\`. If the customer agreed to more scope or time, use \`emt renegotiate\` instead.

Ask the user, do not decide for them:
- whether the work so far counts (\`--spent include\`) or some of it was thrown away (\`--spent exclude\`);
- with \`exclude\`, since when the work went the wrong way (\`--lost-from "YYYY-MM-DD HH:MM"\`) and when it was rolled back (\`--at\`, if earlier than now);
- which extra work the command lists describes the same loss (\`--covers <id>\`); then no separate \`emt extra --time\` for it is needed.

Write the reason as a short summary agreed with the user, never a quote of the conversation.

## Closing and retro

- When estimetry says a change of the task was completed, ask the user whether it was the last one and whether to close the task. Never close a task on your own.
- Close only after the user agrees in the conversation: \`emt close --yes\` (\`/emt-close\`). If the task was dropped, add \`--abandoned\`.
- Right after closing, hold the retro with the user (\`/emt-retro\`): compare the estimate with the fact by parts, agree on the reasons and on one lesson. Write down what the user agrees with, not your own guesses.
- When the customer agrees to more work than estimated, the task closes as it is and the rest becomes a new task: \`emt renegotiate "<new title>" --yes\`, again only after the user agrees.
- A task closed by mistake: \`emt reopen <task>\`.

## After estimetry is updated

When estimetry says this project was set up by an older version, suggest \`emt upgrade\` to the user: it sets estimetry up again in every project on this machine. Never run it on your own; run \`emt upgrade --yes\` only after the user agrees in the conversation.

When an \`emt\` command fails, show its message to the user instead of retrying with guessed arguments.
`,
};

export const COMMANDS: readonly CommandContent[] = [
  {
    id: 'emt-estimate',
    description: 'Estimate a task by parts of the plan from past tasks and calibration, and save the approved estimate as its plan',
    argumentHint: '[task title]',
    body: `Estimate the task the user describes ($ARGUMENTS) from the user's own past tasks, and save the approved estimate with estimetry. Do not name an effort or a deadline before step 7.

1. **Type and stack.** Agree with the user on the task type (feature, integration, bugfix, refactor, infra, migration, research) and on the technologies the task really touches — not every technology of the project. They go into the estimate as \`type\` and \`stack\`.
2. **The task.** \`emt task list\` shows existing tasks. A new one: \`emt task new "<title>" --type <type>\`, after the type is agreed. A task already in progress is a revision: \`emt task show <task>\` gives the parts of the estimate in force — start from them, keep the parts that stay and add or change the rest; use \`--revise\` in step 5 and \`emt estimate revise\` in step 8.
3. **Parts.** Split the work into parts of the plan with hours as optimistic ≤ most likely ≤ pessimistic. Include manual testing and review when the work needs them. Add up a preliminary most likely total.
   With a development flow (OpenSpec), link every part to its change: \`group\` is the name of the change. When the change does not exist yet, agree its kebab-case name with the user now, put it into \`group\`, and create the change under exactly that name later — otherwise progress, completion of changes and the fact by parts cannot follow the estimate. Several changes give several groups.
4. **Similar tasks.** \`emt similar --type <type> --stack <a,b> --hours <preliminary total> --json\`. Compare the parts with the facts of the similar tasks, their extra work and lessons; adjust the parts. Name the tasks you rely on — they go into \`basedOn\`. If there are none, say so.
5. **Calibration.** \`emt calibrate --type <type> --stack <a,b> --json\`.
   - If \`coefficient\` is not null, multiply the optimistic, most likely and pessimistic hours of every part by \`coefficient.value\` and write \`calibrated: true\` and \`calibration: { coefficient: <value> }\`. Say which slice it comes from and how many tasks.
   - If \`coefficient\` is null, say plainly that the estimate is **without calibration** and why (too few closed tasks), and write \`calibrated: false\`. Never apply the overall slice or a coefficient of your own.
6. **Reserve.** Put a reserve only into the pessimistic hours, never into the most likely hours or a part of its own, and name its source in \`rationale\`:
   - with calibration, only for missed scope (\`missedScope\`): extra work absorbed by tasks is already in the coefficient;
   - without calibration, for extra work (\`extras\`, absorbed) and missed scope.
   Cross-check with lines per hour (\`linesPerHour\`, \`codeVolume\`) only as a self-check: if it disagrees strongly, say so and explain, but do not recompute the estimate from lines.
7. **Approval.** Show the estimate as a table: parts, hours, what it rests on (similar tasks, coefficient or "without calibration", reserve). Wait for the user to approve or change it.
8. **Save.** Write the approved estimate to a YAML file outside the repository, for example in a temporary directory, and save it: \`emt estimate save <file>\` (for a task in progress: \`emt estimate revise <file> ...\`, see the estimetry skill). If it reports errors, fix every listed field and save again.

   \`\`\`yaml
   schemaVersion: 1
   type: feature
   stack: [typescript, node]
   basedOn: [T-12, T-17]
   calibrated: true
   calibration: { coefficient: 1.3 }
   rationale: Why the numbers are what they are, what they rest on, where the reserve is.
   parts:
     - name: implementation
       kind: implementation        # analysis, implementation, auto-tests, manual-testing, review, docs, other
       who: agents                 # agents, user or both
       group: export-invoices-pdf  # the change of the part, with a development flow
       hours: { optimistic: 2.6, likely: 3.9, pessimistic: 6.5 }
   \`\`\`

9. Tell the user that time is not measured until the task starts, and offer to start it now with \`/emt-start\` (\`emt start\`; \`--at "YYYY-MM-DD HH:MM"\` if work already began).
`,
  },
  {
    id: 'emt-start',
    description: 'Start measuring the effort of a task',
    argumentHint: '[task id] [--at <time>]',
    body: `Start the measurement of a task with \`emt start $ARGUMENTS\`.

- Without a task id it starts the only task of this project that can be started; if there are several, ask the user which one and pass its id.
- \`--at "YYYY-MM-DD HH:MM"\` backdates the start when work began before it was recorded.
- If the task has no estimate, estimetry warns that it will not be used for calibration; offer \`/emt-estimate\` first.

Show the user the command output.
`,
  },
  {
    id: 'emt-extra',
    description: 'Record work outside the estimated plan',
    argumentHint: '"<description>" --category <category>',
    body: `Record work that was not in the plan: \`emt extra "<description>" --category <category>\`.

Categories:
- \`new-requirement\` — the user asked for something new;
- \`missed-analysis\` — the plan missed something that was needed all along;
- \`rework\` — redoing work that was done already;
- \`environment\` — tooling, dependencies, CI, the machine.

Optional: \`--time <duration>\` (a guess, e.g. \`30m\`; it does not change the measured fact), \`--lines <n>\`, \`--change <name>\`, \`--task <id>\`.

Use the user's words for the description: $ARGUMENTS
`,
  },
  {
    id: 'emt-parallel',
    description: 'Switch parallel mode of a task on or off',
    argumentHint: 'on|off [--agents <n>] [--reason <text>]',
    body: `Switch parallel mode, when several agents work on one task at once: \`emt parallel $ARGUMENTS\`.

- \`emt parallel on --reason "<why>" --agents <n> --parts <ids>\` — \`--parts\` are comma-separated ids of the estimate parts done in parallel.
- \`emt parallel off\` when the work is sequential again.

estimetry records which share of the budget was spent when the mode was switched on. Show the user the command output.
`,
  },
  {
    id: 'emt-manual',
    description: 'Record time spent outside agent sessions',
    argumentHint: '<duration> "<description>" [--at <time>] [--agent]',
    body: `Record time the hooks could not see: \`emt manual $ARGUMENTS\`.

- Duration: \`40m\`, \`1h30m\` or \`1.5h\`.
- \`--at "YYYY-MM-DD HH:MM"\` is when the work ended; with it the record merges with measured time instead of adding to it.
- \`--agent\` records agent time, e.g. work done before estimetry was installed; without it the time is the user's.

If estimetry warns that the time is already partly measured, ask the user whether to record it again with \`--at\`.

\`--part <id>\` links the time to a part of the estimate, e.g. manual testing; \`emt task show\` lists the parts.
`,
  },
  {
    id: 'emt-close',
    description: 'Close a task after the user agrees, then hold the retro',
    argumentHint: '[task id] [--at <time>] [--abandoned]',
    body: `Close a task only with the user's consent.

1. Run \`emt status $ARGUMENTS\` and show the user the fact, the share of the estimate and the plan.
2. Ask the user whether to close the task now. If the work ended earlier, ask when and use \`--at "YYYY-MM-DD HH:MM"\`. If the task was dropped, use \`--abandoned\`.
3. Only after the user says yes, run \`emt close $ARGUMENTS --yes\`. If they say no, the task stays open and nothing is recorded.
4. Then go on with \`/emt-retro\`.

Never pass \`--yes\` without the user's explicit agreement in this conversation.
`,
  },
  {
    id: 'emt-retro',
    description: 'Record why the fact differs from the estimate, and one lesson',
    argumentHint: '[task id]',
    body: `Hold the retro of a closed task with the user.

1. Run \`emt task show <task>\` (the task closed last if $ARGUMENTS is empty: \`emt task list --closed\`) and compare the estimate with the fact, part by part, and the extra work.
2. Suggest the main reasons for the differences and ask the user to confirm or correct them. A reason about one part starts with its id: \`"manual-testing: two devices instead of one"\`.
3. Agree with the user on one lesson for the next estimate.
4. Record what the user agreed with: \`emt retro $ARGUMENTS --reason "<reason>" --reason "<reason>" --lesson "<lesson>"\`.

Running it again replaces the retro.
`,
  },
];
