import { readdirSync, rmSync } from 'node:fs';
import type { CardStore } from '../../application/ports/card-store.js';
import type { Card } from '../../domain/card/card.js';
import { readYaml, writeYamlAtomic } from '../fs/atomic-yaml.js';
import type { StorageLayout } from '../fs/storage-layout.js';

const TASK_ID = /^T-\d+$/;

/** `cards/<task>.yaml`: written whole and atomically; a broken card reads as missing and is rebuilt. */
export class YamlCardStore implements CardStore {
  constructor(private readonly layout: StorageLayout) {}

  write(card: Card): void {
    if (TASK_ID.test(card.task.id)) {
      writeYamlAtomic(this.layout.card(card.task.id), card);
    }
  }

  read(task: string): Card | undefined {
    if (!TASK_ID.test(task)) {
      return undefined;
    }
    try {
      const value = readYaml(this.layout.card(task));
      return isCard(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  remove(task: string): void {
    if (TASK_ID.test(task)) {
      rmSync(this.layout.card(task), { force: true });
    }
  }

  list(): Card[] {
    let names: string[];
    try {
      names = readdirSync(this.layout.cardsDir);
    } catch {
      return [];
    }
    return names
      .filter((name) => name.endsWith('.yaml'))
      .map((name) => this.read(name.slice(0, -'.yaml'.length)))
      .filter((card): card is Card => card !== undefined)
      .sort((a, b) => a.task.id.localeCompare(b.task.id, undefined, { numeric: true }));
  }
}

/** The fields calibration relies on; a card of another schema version is left out. */
function isCard(value: unknown): value is Card {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const card = value as Record<string, unknown>;
  const task = card['task'] as Record<string, unknown> | undefined;
  const fact = card['fact'] as Record<string, unknown> | undefined;
  return (
    card['schemaVersion'] === 1 &&
    typeof card['author'] === 'string' &&
    typeof task?.['id'] === 'string' &&
    typeof task['type'] === 'string' &&
    Array.isArray(task['stack']) &&
    typeof fact?.['totalMinutes'] === 'number' &&
    Array.isArray(card['parts']) &&
    typeof card['extras'] === 'object'
  );
}
