import type { AuthorProvider } from '../../application/ports/author-provider.js';
import type { MeasurementSettings } from '../../application/ports/measurement-settings.js';
import { isShareMode, type ShareMode, type SharingPreference } from '../../application/ports/sharing-preference.js';
import type { TaskTypeCatalog } from '../../application/ports/task-type-catalog.js';
import { IdlePolicy } from '../../domain/measurement/idle-policy.js';
import { Author } from '../../domain/shared/author.js';
import { InvalidValue } from '../../domain/shared/domain-error.js';
import { DEFAULT_TASK_TYPES } from '../../domain/task/task-type.js';
import { readYaml, writeYamlAtomic } from '../fs/atomic-yaml.js';
import { withFileLock } from '../fs/file-lock.js';
import type { StorageLayout } from '../fs/storage-layout.js';
import { parseConfig, type ConfigDocument } from './records.js';

export const CONFIG_SCHEMA_VERSION = 1;

/**
 * `config.yaml`: the author profile, user-defined task types and measurement settings.
 * The profile is detected once and then kept, so it stays stable across machines
 * even if the detection source changes.
 */
export class YamlConfigStore implements AuthorProvider, TaskTypeCatalog, MeasurementSettings, SharingPreference {
  private author: Author | undefined;

  constructor(
    private readonly layout: StorageLayout,
    /** Fallback used only when the profile does not exist yet. */
    private readonly detectAuthorId: () => string,
  ) {}

  current(): Author {
    this.author ??= this.loadOrCreateAuthor();
    return this.author;
  }

  allowed(): readonly string[] {
    const extra = (this.read().taskTypes ?? []).map((type) => type.trim().toLowerCase()).filter((type) => type !== '');
    return [...new Set([...DEFAULT_TASK_TYPES, ...extra])];
  }

  /** `measurement.idleMinutes`, 30 by default. */
  idlePolicy(): IdlePolicy {
    const minutes = this.read().measurement?.idleMinutes;
    if (minutes === undefined) {
      return IdlePolicy.DEFAULT;
    }
    try {
      return IdlePolicy.ofMinutes(typeof minutes === 'number' ? minutes : Number.NaN);
    } catch (error) {
      throw new InvalidValue(`${this.layout.configFile}: measurement.idleMinutes: ${(error as Error).message}`);
    }
  }

  /** `sharing.mode`; an unknown value counts as not chosen. */
  mode(): ShareMode | undefined {
    const sharing = this.read()['sharing'];
    const mode = typeof sharing === 'object' && sharing !== null ? (sharing as Record<string, unknown>)['mode'] : undefined;
    return typeof mode === 'string' && isShareMode(mode) ? mode : undefined;
  }

  save(mode: ShareMode): void {
    withFileLock(this.layout.configLock, () => {
      const config = this.read();
      const sharing = typeof config['sharing'] === 'object' && config['sharing'] !== null ? config['sharing'] : {};
      writeYamlAtomic(this.layout.configFile, {
        ...config,
        schemaVersion: config.schemaVersion ?? CONFIG_SCHEMA_VERSION,
        sharing: { ...sharing, mode },
      });
    });
  }

  private loadOrCreateAuthor(): Author {
    const existing = this.read().author?.id;
    if (existing) {
      return Author.of(existing);
    }
    return withFileLock(this.layout.configLock, () => {
      const config = this.read();
      if (config.author?.id) {
        return Author.of(config.author.id);
      }
      const author = Author.of(this.detectAuthorId());
      writeYamlAtomic(this.layout.configFile, {
        ...config,
        schemaVersion: config.schemaVersion ?? CONFIG_SCHEMA_VERSION,
        author: { ...config.author, id: author.id },
      });
      return author;
    });
  }

  private read(): ConfigDocument {
    return parseConfig(readYaml(this.layout.configFile));
  }
}
