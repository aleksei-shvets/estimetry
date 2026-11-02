import type { SessionId } from '../../domain/measurement/session-id.js';
import type { TaskSummary } from '../ports/task-status-reader.js';

/** The agent reads this; the tool shows it among system messages, so it stays short. */
export const MAX_CONTEXT_LENGTH = 1000;

export const EXTRA_REMINDER = 'estimetry: if the work has gone beyond the plan, record it with /emt-extra.';

export interface TaskFact {
  readonly minutes: number;
  /** "Most likely" of the estimate, in hours. */
  readonly likelyHours?: number;
  /** Percent of the plan done, when it can be counted. */
  readonly planDone?: number;
}

/** Status line at the start of a session (claude-code-hooks spec, "Контекст для агента"). */
export function sessionStartContext(input: {
  readonly session: SessionId;
  readonly task?: TaskSummary;
  readonly fact?: TaskFact;
  readonly candidates: readonly TaskSummary[];
}): string {
  if (input.task) {
    const fact = input.fact;
    const progress =
      fact === undefined
        ? ''
        : fact.likelyHours === undefined
          ? ` — ${duration(fact.minutes)} so far`
          : ` — ${duration(fact.minutes)} of ${duration(fact.likelyHours * 60)} (${Math.round((fact.minutes / (fact.likelyHours * 60)) * 100)}%)`;
    const plan = fact?.planDone === undefined ? '' : `, plan ${fact.planDone}% done`;
    return cut(`estimetry: task ${input.task.id} "${input.task.title}"${progress}${plan}. ${EXTRA_REMINDER.replace('estimetry: if', 'If')}`);
  }
  if (input.candidates.length > 1) {
    const list = input.candidates.map((task) => `${task.id} "${task.title}"`).join(', ');
    return cut(
      `estimetry: several tasks are in progress in this project: ${list}. ` +
        `Ask the user which one this session serves, then run: emt attach <task> --session ${input.session.value}`,
    );
  }
  return 'estimetry: no task is in progress in this project, so the time of this session is not counted. Start one with /emt-start.';
}

/**
 * A change of the task was completed (task-closing spec). The agent asks; the
 * text has no ready closing command, so an agent on autopilot cannot close the task by itself.
 */
export function closeProposalText(input: {
  readonly task: string;
  readonly change: string;
  readonly completedAt: string;
  readonly planDone?: number;
  readonly unfinished: readonly string[];
}): string {
  const when = `${input.completedAt.slice(0, 10)} ${input.completedAt.slice(11, 16)} UTC`;
  const plan = [
    ...(input.planDone === undefined ? [] : [`the plan is ${input.planDone}% done`]),
    ...(input.unfinished.length === 0 ? [] : [`unfinished: ${input.unfinished.join(', ')}`]),
  ];
  return cut(
    `estimetry: change ${input.change} of task ${input.task} was completed at ${when}` +
      (plan.length === 0 ? '' : `; ${plan.join(', ')}`) +
      `. If it was the last change of the task, ask the user whether to close it (/emt-close); close only after they agree.`,
  );
}

export function cut(text: string): string {
  return text.length <= MAX_CONTEXT_LENGTH ? text : `${text.slice(0, MAX_CONTEXT_LENGTH - 1)}…`;
}

function duration(minutes: number): string {
  const whole = Math.round(minutes);
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return hours === 0 ? `${rest}m` : rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
