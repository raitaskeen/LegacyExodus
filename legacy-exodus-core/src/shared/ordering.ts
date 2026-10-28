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
