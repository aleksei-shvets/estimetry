import type { AuthorProvider } from '../../src/application/ports/author-provider.js';
import type { Clock } from '../../src/application/ports/clock.js';
import type { ErrorReporter } from '../../src/application/ports/error-reporter.js';
import type { EstimateReader } from '../../src/application/ports/estimate-reader.js';
import type { IdGenerator } from '../../src/application/ports/id-generator.js';
import type { MeasurementSettings } from '../../src/application/ports/measurement-settings.js';
import type { TaskTypeCatalog } from '../../src/application/ports/task-type-catalog.js';
import type { WorkspaceLocator } from '../../src/application/ports/workspace-locator.js';
import type { Estimate } from '../../src/domain/estimate/estimate.js';
import { InvalidEstimate } from '../../src/domain/estimate/invalid-estimate.js';
import { IdlePolicy } from '../../src/domain/measurement/idle-policy.js';
import { Author } from '../../src/domain/shared/author.js';
import { Timestamp } from '../../src/domain/shared/timestamp.js';
import { DEFAULT_TASK_TYPES } from '../../src/domain/task/task-type.js';

export class FixedClock implements Clock {
  private millis: number;

  constructor(iso = '2026-10-27T10:00:00.000Z') {
    this.millis = Date.parse(iso);
  }

  now(): Timestamp {
    return Timestamp.fromMillis(this.millis);
  }

  advanceMinutes(minutes: number): void {
    this.millis += minutes * 60_000;
  }

  set(iso: string): void {
    this.millis = Date.parse(iso);
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private n = 0;

  next(): string {
    this.n += 1;
    return `id-${this.n}`;
  }
}

export class FakeWorkspaceLocator implements WorkspaceLocator {
  constructor(
    public root = '/work/api',
    public repository: string | undefined = undefined,
  ) {}

  currentRoot(): string {
    return this.root;
  }

  fingerprint(): string | undefined {
    return this.repository;
  }
}

export class FakeAuthorProvider implements AuthorProvider {
  calls = 0;

  constructor(private readonly id = 'dev@example.com') {}

  current(): Author {
    this.calls += 1;
    return Author.of(this.id);
  }
}

export class InMemoryTaskTypeCatalog implements TaskTypeCatalog {
  constructor(private readonly types: readonly string[] = DEFAULT_TASK_TYPES) {}

  allowed(): readonly string[] {
    return this.types;
  }
}

export class RecordingErrorReporter implements ErrorReporter {
  readonly reports: { context: string; error: unknown }[] = [];

  report(context: string, error: unknown): void {
    this.reports.push({ context, error });
  }
}

export class FixedMeasurementSettings implements MeasurementSettings {
  constructor(
    public minutes = 30,
    public checkpoint: { minutes: number; problem?: string } = { minutes: 20 },
  ) {}

  idlePolicy(): IdlePolicy {
    return IdlePolicy.ofMinutes(this.minutes);
  }

  checkpointInterval(): { minutes: number; problem?: string } {
    return this.checkpoint;
  }
}

/** Estimates by file name; a missing file is reported like the real reader does. */
export class InMemoryEstimateReader implements EstimateReader {
  readonly files = new Map<string, Estimate>();

  read(file: string): Estimate {
    const estimate = this.files.get(file);
    if (!estimate) {
      throw new InvalidEstimate([{ path: '', message: 'file not found' }], file);
    }
    return estimate;
  }
}
