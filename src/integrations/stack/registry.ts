import type { StackDetectors } from '../../application/contracts/registries.js';
import type { StackDetector } from '../../application/contracts/stack-detector.js';

export class StackDetectorRegistry implements StackDetectors {
  private readonly detectors: StackDetector[] = [];

  register(detector: StackDetector): this {
    this.detectors.push(detector);
    return this;
  }

  all(): readonly StackDetector[] {
    return this.detectors;
  }
}
