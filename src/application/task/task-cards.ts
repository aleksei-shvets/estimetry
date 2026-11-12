import type { Card } from '../../domain/card/card.js';
import { CardsTooNew } from '../../domain/card/card-errors.js';
import { upgradeCardV1, type CardV1 } from '../../domain/card/card-v1.js';
import { upgradeCardV2, type CardV2 } from '../../domain/card/card-v2.js';
import { calibrate, type Calibration } from '../../domain/calibration/calibration.js';
import { TaskId } from '../../domain/task/task-id.js';
import type { Task } from '../../domain/task/task.js';
import type { CalibrationSettings } from '../ports/calibration-settings.js';
import type { CalibrationStore } from '../ports/calibration-store.js';
import type { CardStore } from '../ports/card-store.js';
import type { ErrorReporter } from '../ports/error-reporter.js';
import type { AuthorAliases } from './author-aliases.js';
import type { CardBuilder } from './card-builder.js';

/** Stored cards of closed tasks and the calibration derived from them: both are rebuilt from journals. */
export class TaskCards {
  constructor(
    private readonly builder: CardBuilder,
    private readonly cards: CardStore,
    private readonly calibration: CalibrationStore,
    private readonly settings: CalibrationSettings,
    private readonly errors: ErrorReporter,
    private readonly aliases: AuthorAliases,
  ) {}

  /** Writes the card of a closed task, removes the card of any other. */
  refresh(task: Task): Card | undefined {
    if (!task.isClosed) {
      this.cards.remove(task.id.toString());
      return undefined;
    }
    const card = this.builder.build(task);
    this.cards.write(card);
    return card;
  }

  /** The card of a closed task for `emt task show`: a card of an older schema is rebuilt and written. */
  cardOf(task: Task): Card {
    const stored = this.cards.read(task.id.toString());
    if (stored?.schema === 'current') {
      return stored.card;
    }
    // A newer card stays as it is: this binary shows its own reading of the journal.
    return stored?.schema === 'newer' ? this.builder.build(task) : (this.refresh(task) ?? this.builder.build(task));
  }

  /**
   * Calibration from every card. Cards of schema 1 are rebuilt from their
   * journals first; a card newer than this binary stops the recalculation.
   */
  recalculate(): Calibration {
    return this.calibration.recalculate(() => {
      const stored = this.cards.list();
      const newer = stored.flatMap((card) => (card.schema === 'newer' ? [card.task] : []));
      if (newer.length > 0) {
        const error = new CardsTooNew(newer);
        this.errors.report('calibration', error);
        throw error;
      }
      const cards = stored.map((card) =>
        card.schema === 'current' ? card.card : card.schema === 'newer' ? undefined : this.upgrade(card.card),
      );
      // A card that cannot be read even by its fields is left out, as a broken file is.
      return calibrate(
        cards.filter((card): card is Card => card !== undefined),
        { minTasks: this.settings.minTasks(), aliases: this.aliases.toCurrent() },
      );
    });
  }

  /**
   * Every card for a query (`emt similar`, `emt calibrate`), in memory: a card
   * of schema 1 is rebuilt from its journal but not written, a card newer than
   * this binary is named in `skipped`. Nothing is written.
   */
  allCards(): { readonly cards: readonly Card[]; readonly skipped: readonly string[] } {
    const cards: Card[] = [];
    const skipped: string[] = [];
    for (const stored of this.cards.list()) {
      if (stored.schema === 'newer') {
        skipped.push(stored.task);
        continue;
      }
      const card = stored.schema === 'current' ? stored.card : this.upgrade(stored.card, false);
      if (card !== undefined) {
        cards.push(card);
      }
    }
    return { cards, skipped };
  }

  /** A card of an older schema again from the journal of its task; by its fields when the journal is not here. */
  private upgrade(card: CardV1 | CardV2, write = true): Card | undefined {
    let rebuilt: Card | undefined;
    try {
      rebuilt = this.builder.rebuild(TaskId.parse(card.task.id));
    } catch (error) {
      this.errors.report(`rebuilding the card of ${card.task.id}`, error);
    }
    if (rebuilt !== undefined && !write) {
      return rebuilt;
    }
    if (rebuilt !== undefined) {
      try {
        this.cards.write(rebuilt);
      } catch (error) {
        // The card is right in memory; the next recalculation writes it again.
        this.errors.report(`writing the card of ${card.task.id}`, error);
      }
      return rebuilt;
    }
    try {
      return card.schemaVersion === 1 ? upgradeCardV1(card) : upgradeCardV2(card);
    } catch (error) {
      this.errors.report(`reading the card of ${card.task.id}`, error);
      return undefined;
    }
  }
}
