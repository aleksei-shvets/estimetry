import { readdirSync, rmSync } from 'node:fs';
import type { CardStore, StoredCard } from '../../application/ports/card-store.js';
import { CARD_SCHEMA_VERSION, type Card } from '../../domain/card/card.js';
import type { CardV1 } from '../../domain/card/card-v1.js';
import type { CardV2 } from '../../domain/card/card-v2.js';
import { readYaml, writeYamlAtomic } from '../fs/atomic-yaml.js';
import type { StorageLayout } from '../fs/storage-layout.js';
import { TaskId } from '../../domain/task/task-id.js';

const TASK_ID = /^T-\d+$/;
const TASK_FILE = /^T-\d+\.yaml$/;

/** `cards/<task>.yaml`: written whole and atomically; a broken card reads as missing and is rebuilt. */
export class YamlCardStore implements CardStore {
  constructor(private readonly layout: StorageLayout) {}

  write(card: Card): void {
    if (TASK_ID.test(card.task.id)) {
      writeYamlAtomic(this.layout.card(card.task.id), card);
    }
  }

  read(task: TaskId): StoredCard | undefined {
    try {
      return stored(task, readYaml(this.layout.card(task.toString())));
    } catch {
      return undefined;
    }
  }

  remove(task: TaskId): void {
    rmSync(this.layout.card(task.toString()), { force: true });
  }

  list(): StoredCard[] {
    let names: string[];
    try {
      names = readdirSync(this.layout.cardsDir);
    } catch {
      return [];
    }
    return names
      .flatMap((name) => (TASK_FILE.test(name) ? [TaskId.parse(name.slice(0, -'.yaml'.length))] : []))
      .map((task) => this.read(task))
      .filter((card): card is StoredCard => card !== undefined)
      .sort((a, b) => taskOf(a).localeCompare(taskOf(b), undefined, { numeric: true }));
  }
}

function taskOf(card: StoredCard): string {
  return card.schema === 'newer' ? card.task.toString() : card.card.task.id;
}

/** Sorts a card by its schema; a card of a newer schema is named, never dropped silently. */
function stored(task: TaskId, value: unknown): StoredCard | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const version = (value as Record<string, unknown>)['schemaVersion'];
  if (typeof version === 'number' && version > CARD_SCHEMA_VERSION) {
    return { schema: 'newer', task, version };
  }
  if (version === CARD_SCHEMA_VERSION && isCard(value) && isCardV2(value) && 'usage' in value) {
    return { schema: 'current', card: value };
  }
  if (version === 2 && isCard(value) && isCardV2(value)) {
    return { schema: 'v2', card: value as unknown as CardV2 };
  }
  if (version === 1 && isCard(value) && typeof (value as unknown as Record<string, unknown>)['parallel'] === 'object') {
    return { schema: 'v1', card: value as unknown as CardV1 };
  }
  return undefined;
}

/** The fields calibration relies on in every schema. */
function isCard(value: unknown): value is Card {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const card = value as Record<string, unknown>;
  const task = card['task'] as Record<string, unknown> | undefined;
  const fact = card['fact'] as Record<string, unknown> | undefined;
  return (
    typeof card['author'] === 'string' &&
    typeof task?.['id'] === 'string' &&
    typeof task['type'] === 'string' &&
    Array.isArray(task['stack']) &&
    typeof fact?.['totalMinutes'] === 'number' &&
    Array.isArray(card['parts']) &&
    typeof card['extras'] === 'object'
  );
}

function isCardV2(card: Card): boolean {
  const counted = (card.fact as unknown as Record<string, unknown>)['counted'] as Record<string, unknown> | undefined;
  return (
    Array.isArray(card.revisions) &&
    Array.isArray(card.currentParts) &&
    typeof counted?.['totalMinutes'] === 'number' &&
    typeof card.beforeRevisionMinutes === 'number' &&
    typeof card.coveredByRevision === 'object'
  );
}
