import { Estimate, type EstimateData } from '../estimate/estimate.js';
import { groupsOf } from '../estimate/plan-changes.js';
import type { ExcludedArchives, SpentPolicy } from '../estimate/estimate-revision.js';
import { Extra, type ExtraCategory, type ExtraData } from '../measurement/extra.js';
import { ManualTime, type ManualTimeData } from '../measurement/manual-time.js';
import { parallelPeriodData, parallelPeriodOf, type ParallelPeriodData } from '../measurement/parallel-mode.js';
import { ProjectId } from '../project/project-id.js';
import { Author } from '../shared/author.js';
import { Timestamp } from '../shared/timestamp.js';
import type { RetroReason, TaskOutcome } from './task-events.js';
import { TaskId } from './task-id.js';
import type { TaskClosure, TaskRetro, TaskRevision } from './task-records.js';
import type { TaskState } from './task-state.js';
import type { TaskStatus } from './task-status.js';
import { TaskType } from './task-type.js';

/** 2: revisions, the first estimate, ids of extra work; 3: task types of revisions. Older snapshots are rebuilt from the journal. */
export const TASK_SNAPSHOT_SCHEMA_VERSION = 4;

/** A closing as the snapshot stores it. */
export interface TaskClosureData {
  readonly at: string;
  readonly outcome: TaskOutcome;
  readonly spawned?: string;
  readonly reopenedAt?: string;
  readonly recordedAt?: string;
}

/** A revision as the snapshot stores it. */
export interface TaskRevisionData {
  readonly id: string;
  readonly at: string;
  readonly lostFrom?: string;
  readonly reason: string;
  readonly category?: ExtraCategory;
  readonly spent?: SpentPolicy;
  readonly baseLikelyBefore?: number;
  readonly baseLikelyAfter: number;
  readonly typeBefore?: string;
  readonly typeAfter?: string;
  readonly covers: readonly string[];
  readonly excluded?: readonly ExcludedArchives[];
}

/** Id and time of the event that recorded an extra work, in the order of `extras`. */
export interface ExtraRecordData {
  readonly id: string;
  readonly at: string;
}

/** The retro as the snapshot stores it. */
export interface TaskRetroData {
  readonly reasons: readonly RetroReason[];
  readonly lesson: string;
  readonly recordedAt: string;
}

/** Persisted state of the aggregate; `version` counts applied events. */
export interface TaskSnapshot {
  readonly schemaVersion: number;
  readonly id: string;
  readonly title: string;
  readonly type: string;
  readonly ticket?: string;
  readonly status: TaskStatus;
  readonly estimated: boolean;
  readonly projects: readonly string[];
  readonly author: string;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly estimate?: EstimateData;
  readonly manualTime: readonly ManualTimeData[];
  readonly extras: readonly ExtraData[];
  readonly parallelMode: readonly ParallelPeriodData[];
  readonly spawnedFrom?: string;
  readonly closures?: readonly TaskClosureData[];
  readonly retro?: TaskRetroData;
  /** Latest moment the aggregate knows of: event times and ends of manual time. */
  readonly lastEventAt?: string;
  readonly firstEstimate?: EstimateData;
  readonly estimatedAfterStart?: boolean;
  readonly revisions?: readonly TaskRevisionData[];
  readonly extraRecords?: readonly ExtraRecordData[];
  /** When each manual record was made, in the order of `manualTime`. */
  readonly manualRecordedAt?: readonly string[];
  /** When manual time of an estimate part was last recorded: a revision cannot start before it. */
  readonly lastPartRecordAt?: string;
  /** Since schema 4; a snapshot of an older schema is rebuilt from the journal. */
  readonly changes?: readonly string[];
  readonly version: number;
  readonly lastEventId: string;
}

const time = (value: string | undefined): Timestamp | undefined => (value === undefined ? undefined : Timestamp.parse(value));
const iso = (value: Timestamp | undefined): string | undefined => value?.toISOString();
/** `{ key: value }` when the value is there, `{}` otherwise: the snapshot leaves absent fields out. */
const field = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };

export function closureOf(data: TaskClosureData): TaskClosure {
  return {
    at: Timestamp.parse(data.at),
    outcome: data.outcome,
    ...field('spawned', data.spawned === undefined ? undefined : TaskId.parse(data.spawned)),
    ...field('reopenedAt', time(data.reopenedAt)),
    ...field('recordedAt', time(data.recordedAt)),
  };
}

function closureData(closure: TaskClosure): TaskClosureData {
  return {
    at: closure.at.toISOString(),
    outcome: closure.outcome,
    ...field('spawned', closure.spawned?.toString()),
    ...field('recordedAt', iso(closure.recordedAt)),
    ...field('reopenedAt', iso(closure.reopenedAt)),
  };
}

export function revisionOf(data: TaskRevisionData): TaskRevision {
  const { at, lostFrom, typeBefore, typeAfter, ...rest } = data;
  return {
    ...rest,
    at: Timestamp.parse(at),
    ...field('lostFrom', time(lostFrom)),
    ...field('typeBefore', typeBefore === undefined ? undefined : TaskType.restore(typeBefore)),
    ...field('typeAfter', typeAfter === undefined ? undefined : TaskType.restore(typeAfter)),
  };
}

/** A revision in the form the snapshot stores, also for functions over stored revisions (`exclusionsOf`). */
export function revisionData(revision: TaskRevision): TaskRevisionData {
  return {
    id: revision.id,
    at: revision.at.toISOString(),
    ...field('lostFrom', iso(revision.lostFrom)),
    reason: revision.reason,
    ...field('category', revision.category),
    ...field('spent', revision.spent),
    ...field('baseLikelyBefore', revision.baseLikelyBefore),
    baseLikelyAfter: revision.baseLikelyAfter,
    ...field('typeBefore', revision.typeBefore?.value),
    ...field('typeAfter', revision.typeAfter?.value),
    covers: [...revision.covers],
    ...field('excluded', revision.excluded),
  };
}

function retroOf(data: TaskRetroData): TaskRetro {
  return { reasons: data.reasons, lesson: data.lesson, recordedAt: Timestamp.parse(data.recordedAt) };
}

export function stateFromSnapshot(snapshot: TaskSnapshot): TaskState {
  const estimate = (data: EstimateData | undefined) => (data === undefined ? undefined : Estimate.fromData(data));
  return {
    id: TaskId.parse(snapshot.id),
    title: snapshot.title,
    type: TaskType.restore(snapshot.type),
    ticket: snapshot.ticket,
    status: snapshot.status,
    estimated: snapshot.estimated,
    projects: snapshot.projects.map((project) => ProjectId.parse(project)),
    author: Author.of(snapshot.author),
    createdAt: Timestamp.parse(snapshot.createdAt),
    startedAt: time(snapshot.startedAt),
    estimate: estimate(snapshot.estimate),
    manual: snapshot.manualTime.map((data, i) => ({
      manual: ManualTime.fromData(data),
      ...field('recordedAt', time(snapshot.manualRecordedAt?.[i])),
    })),
    extras: snapshot.extras.map((data, i) => {
      const record = snapshot.extraRecords?.[i];
      return { extra: Extra.fromData(data), ...field('id', record?.id), ...field('at', time(record?.at)) };
    }),
    parallelMode: snapshot.parallelMode.map(parallelPeriodOf),
    spawnedFrom: snapshot.spawnedFrom === undefined ? undefined : TaskId.parse(snapshot.spawnedFrom),
    closures: (snapshot.closures ?? []).map(closureOf),
    retro: snapshot.retro === undefined ? undefined : retroOf(snapshot.retro),
    lastEventAt: Timestamp.parse(snapshot.lastEventAt ?? snapshot.startedAt ?? snapshot.createdAt),
    firstEstimate: estimate(snapshot.firstEstimate),
    estimatedAfterStart: snapshot.estimatedAfterStart ?? false,
    revisions: (snapshot.revisions ?? []).map(revisionOf),
    lastPartRecordAt: time(snapshot.lastPartRecordAt),
    changes: [...snapshotChanges(snapshot)],
  };
}

export function snapshotOf(s: TaskState, version: { readonly count: number; readonly lastEventId: string }): TaskSnapshot {
  const extraRecords = s.extras.flatMap(({ id, at }) => (id === undefined || at === undefined ? [] : [{ id, at: at.toISOString() }]));
  const manualRecordedAt = s.manual.flatMap(({ recordedAt }) => (recordedAt === undefined ? [] : [recordedAt.toISOString()]));
  return {
    schemaVersion: TASK_SNAPSHOT_SCHEMA_VERSION,
    id: s.id.toString(),
    title: s.title,
    type: s.type.value,
    ...field('ticket', s.ticket),
    status: s.status,
    estimated: s.estimated,
    projects: s.projects.map((project) => project.value),
    author: s.author.id,
    createdAt: s.createdAt.toISOString(),
    ...field('startedAt', iso(s.startedAt)),
    ...field('estimate', s.estimate?.toData()),
    manualTime: s.manual.map(({ manual }) => manual.toData()),
    extras: s.extras.map(({ extra }) => extra.toData()),
    parallelMode: s.parallelMode.map(parallelPeriodData),
    ...field('spawnedFrom', s.spawnedFrom?.toString()),
    ...(s.closures.length === 0 ? {} : { closures: s.closures.map(closureData) }),
    ...(s.retro === undefined
      ? {}
      : { retro: { reasons: s.retro.reasons, lesson: s.retro.lesson, recordedAt: s.retro.recordedAt.toISOString() } }),
    lastEventAt: s.lastEventAt.toISOString(),
    ...field('firstEstimate', s.firstEstimate?.toData()),
    ...(s.estimatedAfterStart ? { estimatedAfterStart: true } : {}),
    ...(s.revisions.length === 0 ? {} : { revisions: s.revisions.map(revisionData) }),
    ...(extraRecords.length === 0 ? {} : { extraRecords }),
    ...(manualRecordedAt.length === 0 ? {} : { manualRecordedAt }),
    ...field('lastPartRecordAt', iso(s.lastPartRecordAt)),
    ...(s.changes.length === 0 ? {} : { changes: [...s.changes] }),
    version: version.count,
    lastEventId: version.lastEventId,
  };
}

/** The schema that keeps the changes of a task. */
const CHANGES_SINCE_SCHEMA = 4;

/**
 * The changes of a task as its snapshot keeps them (`Task.changes`), for readers
 * without the aggregate. A snapshot of an older schema has no list until the CLI
 * rebuilds it: the groups of its current and first estimate, the rule before it.
 */
export function snapshotChanges(snapshot: TaskSnapshot): readonly string[] {
  if (snapshot.changes !== undefined || snapshot.schemaVersion >= CHANGES_SINCE_SCHEMA) {
    return snapshot.changes ?? [];
  }
  return groupsOf([...(snapshot.estimate?.parts ?? []), ...(snapshot.firstEstimate?.parts ?? [])]);
}
