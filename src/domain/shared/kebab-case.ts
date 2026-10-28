/**
 * `My App` → `my-app`, `myApp` → `my-app`; empty when nothing alphanumeric is left.
 * `ascii` drops accents and every other letter (ids that end up in paths);
 * `unicode` keeps letters of any script, so `Анализ требований` → `анализ-требований`.
 */
export function kebabCase(text: string, letters: 'ascii' | 'unicode' = 'ascii'): string {
  const split = (letters === 'ascii' ? text.normalize('NFKD').replace(/[̀-ͯ]/g, '') : text.normalize('NFC'))
    .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, '$1-$2')
    .toLowerCase();
  return (letters === 'ascii' ? split.replace(/[^a-z0-9]+/g, '-') : split.replace(/[^\p{L}\p{N}]+/gu, '-')).replace(/^-+|-+$/g, '');
}
