import type { CommandContent } from '../../../application/contracts/command-content.js';

/**
 * Texts of the estimetry skill and its commands, independent of the AI tool.
 * The full protocol of estimating (similar tasks, calibration) comes with `emt similar`
 * and `emt calibrate`.
 */
export const ESTIMETRY_SKILL: CommandContent = {
  id: 'estimetry',
  description:
    'Estimate tasks and measure the actual effort with the estimetry CLI (emt). Use when the user asks how long a task will take, starts or finishes work on a task, or work goes beyond the plan.',
  body: `# estimetry

estimetry compares estimates with the actual effort of AI-agent development and reuses that experience in the next estimate. Everything goes through the \`emt\` CLI; never edit its files by hand.

## Estimating

Before you name a deadline or an effort for a task, run \`/emt-estimate\`. Give the estimate by parts of the plan, each with an optimistic, a most likely and a pessimistic number of hours, and save it only after the user approves it.

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

When an \`emt\` command fails, show its message to the user instead of retrying with guessed arguments.
`,
};

export const COMMANDS: readonly CommandContent[] = [
  {
    id: 'emt-estimate',
    description: 'Estimate a task by parts of the plan and save the approved estimate as its plan',
    argumentHint: '[task title]',
    body: `Estimate the task the user describes ($ARGUMENTS) and save the approved estimate with estimetry.

1. If the task does not exist yet, create it: \`emt task new "<title>"\` (add \`--type <type>\` when the type is clear). \`emt task list\` shows existing tasks.
2. Split the work into parts of the plan. For each part give hours as optimistic ≤ most likely ≤ pessimistic. Include manual testing and review when the work needs them.
3. Show the estimate as a table and wait for the user to approve or change it.
4. Write the approved estimate to a YAML file outside the repository, for example in a temporary directory:

   \`\`\`yaml
   schemaVersion: 1
   type: feature
   calibrated: false
   rationale: Why the numbers are what they are.
   parts:
     - name: implementation
       kind: implementation        # analysis, implementation, auto-tests, manual-testing, review, docs, other
       who: agents                 # agents, user or both
       hours: { optimistic: 2, likely: 3, pessimistic: 5 }
   \`\`\`

5. Save it: \`emt estimate save <file>\`. If it reports errors, fix every listed field and save again.
If the task is already in progress, \`emt estimate save\` refuses: revise the plan with \`emt estimate revise\` instead (see the estimetry skill), asking the user whether the work so far counts.

6. Tell the user that time is not measured until the task starts, and offer to start it now with \`/emt-start\` (\`emt start\`; \`--at "YYYY-MM-DD HH:MM"\` if work already began). Until then the work of sessions goes to no task.

Estimates are not calibrated by past tasks yet: say so when you give one.
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
