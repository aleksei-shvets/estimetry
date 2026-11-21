import { stackLabels } from './stack-labels.js';
import { CodeVolume, type CodeVolumeData } from './code-volume.js';
import { EstimatePart, type EstimatePartData } from './estimate-part.js';
import { InvalidEstimate, type EstimateIssue } from './invalid-estimate.js';
import type { PartKind } from './part-kind.js';
import { ThreePointEstimate } from './three-point-estimate.js';
import { groupsOf } from './plan-changes.js';

export const ESTIMATE_SCHEMA_VERSION = 1;

export interface EstimateData {
  readonly schemaVersion: number;
  readonly parts: readonly EstimatePartData[];
  readonly type?: string;
  readonly stack?: readonly string[];
  readonly codeVolume?: CodeVolumeData;
  readonly rationale?: string;
  readonly basedOn?: readonly string[];
  readonly calibrated: boolean;
  /** What calibration multiplied the optimistic and likely hours by, and the pessimistic ones by. */
  readonly calibration?: { readonly coefficient: number; readonly pessimistic?: number };
}

/**
 * The plan of a task: parts with three-point hours plus the context the
 * estimate was made in. Saved as a whole into `task.estimated`.
 * `type` is validated against the task type catalog by the caller.
 */
export class Estimate {
  private constructor(
    readonly parts: readonly EstimatePart[],
    readonly type: string | undefined,
    readonly stack: readonly string[],
    readonly codeVolume: CodeVolume | undefined,
    readonly rationale: string | undefined,
    readonly basedOn: readonly string[],
    readonly calibrated: boolean,
    /** What calibration multiplied the optimistic and likely hours by; undefined when it was not applied. */
    readonly coefficient: number | undefined,
    /** What calibration multiplied the pessimistic hours by; not part of the base of the estimate. */
    readonly pessimisticCoefficient: number | undefined,
  ) {}

  /** @throws InvalidEstimate when there are no parts or part ids repeat. */
  static of(input: {
    readonly parts: readonly EstimatePart[];
    readonly type?: string;
    readonly stack?: readonly string[];
    readonly codeVolume?: CodeVolume;
    readonly rationale?: string;
    readonly basedOn?: readonly string[];
    readonly calibrated?: boolean;
    readonly coefficient?: number;
    readonly pessimisticCoefficient?: number;
  }): Estimate {
    const issues: EstimateIssue[] = [];
    const positive = (value: number) => Number.isFinite(value) && value > 0;
    if (input.coefficient === undefined ? input.pessimisticCoefficient !== undefined : !positive(input.coefficient)) {
      issues.push({ path: 'calibration.coefficient', message: 'expected a number greater than 0' });
    }
    if (input.pessimisticCoefficient !== undefined && !positive(input.pessimisticCoefficient)) {
      issues.push({ path: 'calibration.pessimistic', message: 'expected a number greater than 0' });
    }
    if (input.parts.length === 0) {
      issues.push({ path: 'parts', message: 'the estimate needs at least one part' });
    }
    const seen = new Map<string, number>();
    input.parts.forEach((part, index) => {
      const first = seen.get(part.id);
      if (first === undefined) {
        seen.set(part.id, index);
      } else {
        issues.push({ path: `parts[${index}].id`, message: `duplicate id "${part.id}" (also parts[${first}])` });
      }
    });
    if (issues.length > 0) {
      throw new InvalidEstimate(issues);
    }
    const rationale = input.rationale?.trim() || undefined;
    return new Estimate(
      [...input.parts],
      input.type?.trim() || undefined,
      stackLabels(input.stack ?? []),
      input.codeVolume,
      rationale,
      [...(input.basedOn ?? [])],
      input.calibrated ?? false,
      input.coefficient,
      input.pessimisticCoefficient,
    );
  }

  static fromData(data: EstimateData): Estimate {
    return Estimate.of({
      parts: data.parts.map((part) => EstimatePart.fromData(part)),
      ...(data.type === undefined ? {} : { type: data.type }),
      ...(data.stack === undefined ? {} : { stack: data.stack }),
      ...(data.codeVolume === undefined ? {} : { codeVolume: CodeVolume.of(data.codeVolume) }),
      ...(data.rationale === undefined ? {} : { rationale: data.rationale }),
      ...(data.basedOn === undefined ? {} : { basedOn: data.basedOn }),
      calibrated: data.calibrated,
      ...(data.calibration === undefined ? {} : { coefficient: data.calibration.coefficient }),
      ...(data.calibration?.pessimistic === undefined ? {} : { pessimisticCoefficient: data.calibration.pessimistic }),
    });
  }

  /**
   * Most likely hours before calibration: what calibration compares the fact
   * with, so that a calibrated estimate does not pull the next coefficient to 1.
   */
  get baseLikely(): number {
    return this.total.likely / (this.coefficient ?? 1);
  }

  /** Sums of optimistic, likely and pessimistic hours over all parts. */
  get total(): ThreePointEstimate {
    return this.parts.reduce((sum, part) => sum.plus(part.hours), ThreePointEstimate.ZERO);
  }

  hasKind(kind: PartKind): boolean {
    return this.parts.some((part) => part.kind === kind);
  }

  hasPart(id: string): boolean {
    return this.parts.some((part) => part.id === id);
  }

  get partIds(): readonly string[] {
    return this.parts.map((part) => part.id);
  }

  /** The groups of the parts, each once in the order of the parts: the changes of the plan. */
  get groups(): readonly string[] {
    return groupsOf(this.parts);
  }

  private calibrationData(coefficient: number): NonNullable<EstimateData['calibration']> {
    return this.pessimisticCoefficient === undefined ? { coefficient } : { coefficient, pessimistic: this.pessimisticCoefficient };
  }

  toData(): EstimateData {
    return {
      schemaVersion: ESTIMATE_SCHEMA_VERSION,
      parts: this.parts.map((part) => part.toData()),
      ...(this.type === undefined ? {} : { type: this.type }),
      ...(this.stack.length === 0 ? {} : { stack: [...this.stack] }),
      ...(this.codeVolume === undefined ? {} : { codeVolume: this.codeVolume.toData() }),
      ...(this.rationale === undefined ? {} : { rationale: this.rationale }),
      ...(this.basedOn.length === 0 ? {} : { basedOn: [...this.basedOn] }),
      calibrated: this.calibrated,
      ...(this.coefficient === undefined ? {} : { calibration: this.calibrationData(this.coefficient) }),
    };
  }
}
