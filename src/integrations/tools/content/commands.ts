import type { CommandContent } from '../../../application/contracts/command-content.js';

/**
 * Starter texts of the estimetry skill and its commands, independent of the AI tool.
 * The full protocol of both modes (similar tasks, calibration) comes with `emt similar`
 * and `emt calibrate`; `/emt-close` and `/emt-retro` come with `emt close` and `emt retro`.
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
`,
  },
];
