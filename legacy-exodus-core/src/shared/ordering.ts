/**
 * Total, locale-independent string order by UTF-16 code units.
 *
 * Every artifact ordering uses this instead of `localeCompare`, whose result depends on the
 * ICU version and locale, and which returns 0 for distinct strings that collate equally
 * (for example NFC and NFD spellings of the same name). Equal results only for equal strings.
 */
export function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * `items` sorted by `key` in code-point order, a stable sort that computes each key once. A
 * comparator that builds keys builds two per comparison, n log n strings in all (BA-17).
 */
export function sortByKey<T>(items: readonly T[], key: (item: T) => string): T[] {
  const keyed = items.map((item, index) => ({ item, key: key(item), index }));
  keyed.sort((left, right) => compareCodePoints(left.key, right.key) || left.index - right.index);
  return keyed.map((entry) => entry.item);
}
