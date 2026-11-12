import { readFileSync } from 'node:fs';

/** Version from package.json, for `--version`, the stamp in generated files and the version of an install. */
export function packageVersion(): string {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
  return manifest.version;
}
