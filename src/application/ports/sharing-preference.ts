export const SHARE_MODES = ['none', 'calibration', 'cards'] as const;
export type ShareMode = (typeof SHARE_MODES)[number];

export function isShareMode(value: string): value is ShareMode {
  return (SHARE_MODES as readonly string[]).includes(value);
}

/** How the author shares data with the team; global, saved only in v1. */
export interface SharingPreference {
  mode(): ShareMode | undefined;
  save(mode: ShareMode): void;
}
