import { InvalidValue } from '../shared/domain-error.js';
import { kebabCase } from '../shared/kebab-case.js';
import { DEFAULT_PART_KIND, type PartKind, type PartPerformer } from './part-kind.js';
import { ThreePointEstimate, type ThreePointData } from './three-point-estimate.js';

export interface EstimatePartData {
  readonly id: string;
  readonly name: string;
  readonly group?: string;
  readonly kind: PartKind;
  readonly who?: PartPerformer;
  readonly hours: ThreePointData;
}

/** One line of the plan. Its id defaults to the kebab-cased group and name, in any script. */
export class EstimatePart {
  private constructor(
    readonly id: string,
    readonly name: string,
    readonly group: string | undefined,
    readonly kind: PartKind,
    readonly who: PartPerformer | undefined,
    readonly hours: ThreePointEstimate,
  ) {}

  static of(input: {
    readonly id?: string;
    readonly name: string;
    readonly group?: string;
    readonly kind?: PartKind;
    readonly who?: PartPerformer;
    readonly hours: ThreePointEstimate;
  }): EstimatePart {
    const name = input.name.trim();
    if (name === '') {
      throw new InvalidValue('part name must not be empty');
    }
    const group = input.group?.trim() || undefined;
    const id = input.id === undefined ? kebabCase([group, name].filter(Boolean).join(' '), 'unicode') : input.id.trim();
    if (id === '') {
      throw new InvalidValue('part id must not be empty');
    }
    return new EstimatePart(id, name, group, input.kind ?? DEFAULT_PART_KIND, input.who, input.hours);
  }

  static fromData(data: EstimatePartData): EstimatePart {
    return EstimatePart.of({ ...data, hours: ThreePointEstimate.of(data.hours) });
  }

  toData(): EstimatePartData {
    return {
      id: this.id,
      name: this.name,
      ...(this.group === undefined ? {} : { group: this.group }),
      kind: this.kind,
      ...(this.who === undefined ? {} : { who: this.who }),
      hours: this.hours.toData(),
    };
  }
}
