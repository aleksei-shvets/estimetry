import type { SessionId } from '../../domain/measurement/session-id.js';
import type { TaskSummary } from '../ports/task-status-reader.js';
import { cut, MAX_CONTEXT_LENGTH } from './context-limit.js';

export const EXTRA_REMINDER = 'estimetry: if the work has gone beyond the plan, record it with /emt-extra.';

/** First line of every session start: estimates go through the protocol, never a guess (estimate mode, design §5.1). */
export const ESTIMATE_REMINDER = 'estimetry: before you name an effort or a deadline for a task, run /emt-estimate.';

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
  /** Characters left for this text when other lines go before it. */
  readonly budget?: number;
}): string {
  const budget = input.budget ?? MAX_CONTEXT_LENGTH;
  if (input.task) {
    const fact = input.fact;
    const progress = fact === undefined ? '' : progressText(fact.minutes, fact.likelyHours);
    const plan = fact?.planDone === undefined ? '' : `, plan ${fact.planDone}% done`;
    return cut(
      `estimetry: task ${input.task.id} "${input.task.title}"${progress}${plan}. ${EXTRA_REMINDER.replace('estimetry: if', 'If')}`,
      budget,
    );
  }
  if (input.candidates.length > 1) {
    // The command goes last and must survive the limit: the list of tasks is shortened instead.
    const ask = `. Ask the user which one this session serves, then run: emt attach <task> --session ${input.session.value}`;
    const head = 'estimetry: several tasks are in progress in this project: ';
    const all = input.candidates.map((task) => `${task.id} "${task.title}"`);
    let shown = all.length;
    const list = () => `${all.slice(0, shown).join(', ')}${shown < all.length ? ` and ${all.length - shown} more (emt task list)` : ''}`;
    while (shown > 1 && head.length + list().length + ask.length > budget) {
      shown -= 1;
    }
    return cut(`${head}${list()}${ask}`, budget);
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

function duration(minutes: number): string {
  const whole = Math.round(minutes);
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return hours === 0 ? `${rest}m` : rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** The fact so far, and against the estimate when there is one. */
function progressText(minutes: number, likelyHours: number | undefined): string {
  if (likelyHours === undefined) {
    return ` — ${duration(minutes)} so far`;
  }
  const share = Math.round((minutes / (likelyHours * 60)) * 100);
  return ` — ${duration(minutes)} of ${duration(likelyHours * 60)} (${share}%)`;
}
