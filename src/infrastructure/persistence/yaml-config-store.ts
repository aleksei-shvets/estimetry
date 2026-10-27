import type { AuthorProvider } from '../../application/ports/author-provider.js';
import type { TaskTypeCatalog } from '../../application/ports/task-type-catalog.js';
import { Author } from '../../domain/shared/author.js';
import { DEFAULT_TASK_TYPES } from '../../domain/task/task-type.js';
import { readYaml, writeYamlAtomic } from '../fs/atomic-yaml.js';
import { withFileLock } from '../fs/file-lock.js';
import type { StorageLayout } from '../fs/storage-layout.js';
import { parseConfig, type ConfigDocument } from './records.js';

export const CONFIG_SCHEMA_VERSION = 1;

/**
 * `config.yaml`: the author profile and user-defined task types.
 * The profile is detected once and then kept, so it stays stable across machines
 * even if the detection source changes.
 */
export class YamlConfigStore implements AuthorProvider, TaskTypeCatalog {
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
        author: { id: author.id },
      });
      return author;
    });
  }

  private read(): ConfigDocument {
    return parseConfig(readYaml(this.layout.configFile));
  }
}
