/**
 * Labels of a stack as compared everywhere: trimmed, in lower case, without
 * empty ones and repeats. `Flutter` and `flutter` are one technology.
 */
export function stackLabels(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter((value) => value !== ''))];
}
