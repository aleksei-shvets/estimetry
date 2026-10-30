import { createInterface, type Interface } from 'node:readline';

export interface Choice<T extends string> {
  readonly value: T;
  readonly label: string;
  /** Shown after the label, e.g. pros and cons. */
  readonly hint?: string;
  /** Listed with "(coming soon)" and cannot be chosen. */
  readonly disabled?: boolean;
}

/**
 * Numbered questions on plain streams: no dependency, and testable without a
 * terminal. Lines are queued as they arrive, so input typed ahead is not lost.
 */
export class Prompts {
  private readonly lines: string[] = [];
  private readonly waiting: ((line: string | undefined) => void)[] = [];
  private ended = false;
  private readonly reader: Interface;

  constructor(
    input: NodeJS.ReadableStream,
    private readonly output: NodeJS.WritableStream,
  ) {
    this.reader = createInterface({ input, terminal: false });
    this.reader.on('line', (line) => {
      const next = this.waiting.shift();
      if (next) {
        next(line);
      } else {
        this.lines.push(line);
      }
    });
    this.reader.on('close', () => {
      this.ended = true;
      for (const next of this.waiting.splice(0)) {
        next(undefined);
      }
    });
  }

  async select<T extends string>(question: string, choices: readonly Choice<T>[], fallback: T): Promise<T> {
    const enabled = this.list(question, choices);
    for (;;) {
      const answer = await this.ask(`Number [${enabled.indexOf(fallback) + 1}]: `);
      if (answer === undefined || answer === '') {
        return fallback;
      }
      const picked = enabled[Number(answer) - 1];
      if (/^\d+$/.test(answer) && picked !== undefined) {
        return picked;
      }
      this.write(`Enter a number from 1 to ${enabled.length}.\n`);
    }
  }

  async multiSelect<T extends string>(question: string, choices: readonly Choice<T>[], fallback: readonly T[]): Promise<T[]> {
    const enabled = this.list(question, choices);
    const preset = fallback.map((value) => enabled.indexOf(value) + 1).join(',');
    for (;;) {
      const answer = await this.ask(`Numbers, comma-separated [${preset}]: `);
      if (answer === undefined || answer === '') {
        return [...fallback];
      }
      const picked = answer.split(',').map((part) => enabled[Number(part.trim()) - 1]);
      if (picked.every((value) => value !== undefined) && answer.split(',').every((part) => /^\s*\d+\s*$/.test(part))) {
        return [...new Set(picked as T[])];
      }
      this.write(`Enter numbers from 1 to ${enabled.length}, separated by commas.\n`);
    }
  }

  async confirm(question: string, fallback: boolean): Promise<boolean> {
    for (;;) {
      const answer = (await this.ask(`${question} ${fallback ? '[Y/n]' : '[y/N]'}: `))?.toLowerCase();
      if (answer === undefined || answer === '') {
        return fallback;
      }
      if (['y', 'yes'].includes(answer)) {
        return true;
      }
      if (['n', 'no'].includes(answer)) {
        return false;
      }
      this.write('Answer y or n.\n');
    }
  }

  close(): void {
    this.reader.close();
  }

  /** Prints the numbered list and returns the values that can be chosen, in their numbering. */
  private list<T extends string>(question: string, choices: readonly Choice<T>[]): T[] {
    this.write(`? ${question}\n`);
    const enabled: T[] = [];
    for (const choice of choices) {
      const hint = choice.hint === undefined ? '' : ` — ${choice.hint}`;
      if (choice.disabled) {
        this.write(`     ${choice.label} (coming soon)\n`);
      } else {
        enabled.push(choice.value);
        this.write(`  ${enabled.length}) ${choice.label}${hint}\n`);
      }
    }
    return enabled;
  }

  /** The next line, or undefined at the end of input: the caller takes the default. */
  private ask(prompt: string): Promise<string | undefined> {
    this.write(prompt);
    const queued = this.lines.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued.trim());
    }
    if (this.ended) {
      return Promise.resolve(undefined);
    }
    return new Promise((resolve) => this.waiting.push((line) => resolve(line?.trim())));
  }

  private write(text: string): void {
    this.output.write(text);
  }
}
