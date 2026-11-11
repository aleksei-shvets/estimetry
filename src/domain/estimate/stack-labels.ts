/**
 * Labels of a stack as compared everywhere: trimmed, in lower case, without
 * empty ones and repeats. `Flutter` and `flutter` are one technology.
 */
export function stackLabels(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter((value) => value !== ''))];
}

/** The labels of a stack a query names, normalized once as `stackLabels` gives them. */
export class StackLabels {
  private constructor(private readonly labels: readonly string[]) {}

  static of(values: readonly string[]): StackLabels {
    return new StackLabels(stackLabels(values));
  }

  get values(): readonly string[] {
    return this.labels;
  }

  get isEmpty(): boolean {
    return this.labels.length === 0;
  }

  /** The labels also among `others`, in the order of this stack. */
  commonWith(others: readonly string[]): string[] {
    return this.labels.filter((label) => others.includes(label));
  }
}
