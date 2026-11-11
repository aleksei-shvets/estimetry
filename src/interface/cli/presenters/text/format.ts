export function factText(fact: number, likely: number | null, share: number | null): string {
  return likely === null
    ? `${formatMinutes(fact)} (no estimate)`
    : `${formatMinutes(fact)} of ${formatMinutes(likely * 60)}${share === null ? '' : ` (${percent(share)})`}`;
}

/** `950`, `1.2k`, `3.4M`: token counts at a glance. */
export function tokenCount(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  return n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);
}

/** `1h 40m`, `9h`, `25m`; zero is `0m`. */
export function formatMinutes(minutes: number): string {
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) {
    return `${rest}m`;
  }
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** A moment in local time, in the same `YYYY-MM-DD HH:MM` form that `--at` accepts. */
export function localTime(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function table(rows: readonly (readonly string[])[]): string {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)));
  }
  return rows
    .map((row) => row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0))).join('  '))
    .join('\n');
}
