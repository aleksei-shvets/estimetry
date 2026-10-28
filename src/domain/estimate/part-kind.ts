export const PART_KINDS = ['analysis', 'implementation', 'auto-tests', 'manual-testing', 'review', 'docs', 'other'] as const;
export type PartKind = (typeof PART_KINDS)[number];

export const DEFAULT_PART_KIND: PartKind = 'implementation';

export function isPartKind(value: unknown): value is PartKind {
  return typeof value === 'string' && (PART_KINDS as readonly string[]).includes(value);
}

export const PART_PERFORMERS = ['agents', 'user', 'both'] as const;
export type PartPerformer = (typeof PART_PERFORMERS)[number];

export function isPartPerformer(value: unknown): value is PartPerformer {
  return typeof value === 'string' && (PART_PERFORMERS as readonly string[]).includes(value);
}
