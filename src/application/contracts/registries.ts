import type { Flow } from './flow.js';
import type { StackDetector } from './stack-detector.js';
import type { ToolAdapter } from './tool-adapter.js';

export interface ToolAdapters {
  all(): readonly ToolAdapter[];
  /** By id or alias. */
  get(idOrAlias: string): ToolAdapter | undefined;
}

export interface Flows {
  all(): readonly Flow[];
  get(id: string): Flow | undefined;
}

export interface StackDetectors {
  all(): readonly StackDetector[];
}
