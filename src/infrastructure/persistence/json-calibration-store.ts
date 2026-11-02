import { readFileSync } from 'node:fs';
import type { CalibrationStore } from '../../application/ports/calibration-store.js';
import type { Calibration } from '../../domain/calibration/calibration.js';
import { writeTextAtomic } from '../fs/atomic-yaml.js';
import { withFileLock } from '../fs/file-lock.js';
import type { StorageLayout } from '../fs/storage-layout.js';

/** `calibration.json`, recomputed and written under `calibration.lock`. */
export class JsonCalibrationStore implements CalibrationStore {
  constructor(
    private readonly layout: StorageLayout,
    private readonly now: () => string,
  ) {}

  recalculate(compute: () => Calibration): Calibration {
    return withFileLock(this.layout.calibrationLock, () => {
      const calibration = compute();
      writeTextAtomic(this.layout.calibrationFile, `${JSON.stringify({ ...calibration, generatedAt: this.now() }, null, 2)}\n`);
      return calibration;
    });
  }

  read(): Calibration | undefined {
    try {
      return JSON.parse(readFileSync(this.layout.calibrationFile, 'utf8')) as Calibration;
    } catch {
      return undefined;
    }
  }
}
