import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import type { EstimateReader } from '../../application/ports/estimate-reader.js';
import { CodeVolume } from '../../domain/estimate/code-volume.js';
import { Estimate, ESTIMATE_SCHEMA_VERSION } from '../../domain/estimate/estimate.js';
import { EstimatePart } from '../../domain/estimate/estimate-part.js';
import { InvalidEstimate, type EstimateIssue } from '../../domain/estimate/invalid-estimate.js';
import { isPartKind, isPartPerformer, PART_KINDS, PART_PERFORMERS } from '../../domain/estimate/part-kind.js';
import { ThreePointEstimate } from '../../domain/estimate/three-point-estimate.js';
import { DomainError } from '../../domain/shared/domain-error.js';
import { isNotFound } from '../fs/jsonl.js';

type Json = Record<string, unknown>;

const ESTIMATE_FIELDS = ['schemaVersion', 'parts', 'type', 'stack', 'codeVolume', 'rationale', 'basedOn', 'calibrated', 'calibration'];
const PART_FIELDS = ['name', 'id', 'group', 'kind', 'who', 'hours'];
const HOURS_FIELDS = ['optimistic', 'likely', 'pessimistic'];
const CODE_VOLUME_FIELDS = ['production', 'tests'];

/**
 * Reads an estimate file (YAML). Checks the shape, rejects unknown fields and
 * collects every problem, including those the domain factories find, so the
 * user fixes the file in one pass.
 */
export class YamlEstimateReader implements EstimateReader {
  /** Relative paths are resolved against `cwd`, the directory the command runs in. */
  constructor(private readonly cwd: string) {}

  read(file: string): Estimate {
    const path = resolve(this.cwd, file);
    let content: string;
    try {
      content = readFileSync(path, 'utf8');
    } catch (error) {
      throw new InvalidEstimate([{ path: '', message: isNotFound(error) ? 'file not found' : String(error) }], file);
    }
    let document: unknown;
    try {
      document = parse(content) as unknown;
    } catch (error) {
      throw new InvalidEstimate([{ path: '', message: `not valid YAML: ${(error as Error).message}` }], file);
    }
    const issues: EstimateIssue[] = [];
    const estimate = new EstimateParser(issues).estimate(document);
    if (issues.length > 0 || !estimate) {
      throw new InvalidEstimate(issues, file);
    }
    return estimate;
  }
}

class EstimateParser {
  constructor(private readonly issues: EstimateIssue[]) {}

  estimate(value: unknown): Estimate | undefined {
    if (!isObject(value)) {
      this.issue('', 'expected a mapping with `schemaVersion` and `parts`');
      return undefined;
    }
    this.unknownFields(value, ESTIMATE_FIELDS, '');
    if (value['schemaVersion'] !== ESTIMATE_SCHEMA_VERSION) {
      this.issue('schemaVersion', `expected ${ESTIMATE_SCHEMA_VERSION}`);
    }
    const parts = Array.isArray(value['parts'])
      ? value['parts'].map((part, index) => this.part(part, `parts[${index}]`))
      : (this.issue('parts', 'expected a list of parts'), []);
    const type = this.optionalString(value, 'type', '');
    const stack = this.optionalStrings(value, 'stack');
    const basedOn = this.optionalStrings(value, 'basedOn');
    const rationale = this.optionalString(value, 'rationale', '');
    const calibrated = value['calibrated'];
    if (calibrated !== undefined && typeof calibrated !== 'boolean') {
      this.issue('calibrated', 'expected true or false');
    }
    const codeVolume = this.codeVolume(value['codeVolume']);
    const coefficient = this.coefficient(value['calibration']);
    if (this.issues.length > 0 || parts.some((part) => part === undefined)) {
      return undefined;
    }
    return this.domain('', () =>
      Estimate.of({
        parts: parts as EstimatePart[],
        ...(type === undefined ? {} : { type }),
        ...(stack === undefined ? {} : { stack }),
        ...(basedOn === undefined ? {} : { basedOn }),
        ...(rationale === undefined ? {} : { rationale }),
        ...(codeVolume === undefined ? {} : { codeVolume }),
        calibrated: calibrated === true,
        ...(coefficient === undefined ? {} : { coefficient }),
      }),
    );
  }

  private coefficient(value: unknown): number | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (!isObject(value)) {
      this.issue('calibration', 'expected a mapping with `coefficient`');
      return undefined;
    }
    this.unknownFields(value, ['coefficient'], 'calibration.');
    const coefficient = value['coefficient'];
    if (typeof coefficient !== 'number' || !(coefficient > 0)) {
      this.issue('calibration.coefficient', 'expected a number greater than 0');
      return undefined;
    }
    return coefficient;
  }

  private part(value: unknown, path: string): EstimatePart | undefined {
    if (!isObject(value)) {
      this.issue(path, 'expected a mapping with `name` and `hours`');
      return undefined;
    }
    this.unknownFields(value, PART_FIELDS, `${path}.`);
    const before = this.issues.length;
    const name = value['name'];
    if (typeof name !== 'string') {
      this.issue(`${path}.name`, 'expected a string');
    }
    const id = this.optionalString(value, 'id', `${path}.`);
    const group = this.optionalString(value, 'group', `${path}.`);
    const kind = value['kind'];
    if (kind !== undefined && !isPartKind(kind)) {
      this.issue(`${path}.kind`, `expected one of ${PART_KINDS.join(', ')}`);
    }
    const who = value['who'];
    if (who !== undefined && !isPartPerformer(who)) {
      this.issue(`${path}.who`, `expected one of ${PART_PERFORMERS.join(', ')}`);
    }
    const hours = this.hours(value['hours'], `${path}.hours`);
    if (this.issues.length > before || hours === undefined || typeof name !== 'string') {
      return undefined;
    }
    return this.domain(path, () =>
      EstimatePart.of({
        name,
        hours,
        ...(id === undefined ? {} : { id }),
        ...(group === undefined ? {} : { group }),
        ...(isPartKind(kind) ? { kind } : {}),
        ...(isPartPerformer(who) ? { who } : {}),
      }),
    );
  }

  private hours(value: unknown, path: string): ThreePointEstimate | undefined {
    if (!isObject(value)) {
      this.issue(path, 'expected { optimistic, likely, pessimistic } in hours');
      return undefined;
    }
    this.unknownFields(value, HOURS_FIELDS, `${path}.`);
    const before = this.issues.length;
    for (const key of HOURS_FIELDS) {
      const n = value[key];
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
        this.issue(`${path}.${key}`, 'expected a number of hours ≥ 0');
      }
    }
    if (this.issues.length > before) {
      return undefined;
    }
    return this.domain(path, () =>
      ThreePointEstimate.of({
        optimistic: value['optimistic'] as number,
        likely: value['likely'] as number,
        pessimistic: value['pessimistic'] as number,
      }),
    );
  }

  private codeVolume(value: unknown): CodeVolume | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (!isObject(value)) {
      this.issue('codeVolume', 'expected { production: [min, max], tests: [min, max] }');
      return undefined;
    }
    this.unknownFields(value, CODE_VOLUME_FIELDS, 'codeVolume.');
    const ranges: { production?: number[]; tests?: number[] } = {};
    for (const key of CODE_VOLUME_FIELDS as ('production' | 'tests')[]) {
      const range = value[key];
      if (range === undefined) {
        continue;
      }
      if (!Array.isArray(range) || !range.every((n) => typeof n === 'number')) {
        this.issue(`codeVolume.${key}`, 'expected [min, max] in lines');
        continue;
      }
      ranges[key] = range as number[];
    }
    return this.domain('codeVolume', () => CodeVolume.of(ranges));
  }

  /** Runs a domain factory and turns its error into an issue at `path`. */
  private domain<T>(path: string, build: () => T): T | undefined {
    try {
      return build();
    } catch (error) {
      if (error instanceof InvalidEstimate) {
        this.issues.push(...error.issues);
        return undefined;
      }
      if (error instanceof DomainError) {
        this.issue(path, error.message);
        return undefined;
      }
      throw error;
    }
  }

  private unknownFields(value: Json, known: readonly string[], prefix: string): void {
    for (const key of Object.keys(value)) {
      if (!known.includes(key)) {
        this.issue(`${prefix}${key}`, `unknown field, expected one of ${known.join(', ')}`);
      }
    }
  }

  private optionalString(value: Json, key: string, prefix: string): string | undefined {
    const field = value[key];
    if (field === undefined) {
      return undefined;
    }
    if (typeof field !== 'string') {
      this.issue(`${prefix}${key}`, 'expected a string');
      return undefined;
    }
    return field;
  }

  private optionalStrings(value: Json, key: string): string[] | undefined {
    const field = value[key];
    if (field === undefined) {
      return undefined;
    }
    if (!Array.isArray(field) || !field.every((item) => typeof item === 'string')) {
      this.issue(key, 'expected a list of strings');
      return undefined;
    }
    return field as string[];
  }

  private issue(path: string, message: string): void {
    this.issues.push({ path, message });
  }
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
