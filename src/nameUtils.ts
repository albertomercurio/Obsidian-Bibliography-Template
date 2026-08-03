// ---------------------------------------------------------------------------
// Shared name normalisation helpers
//
// Used by VaultIndex (matching) and AuthorMerge (field resolution), so both
// agree on what counts as "the same name".
// ---------------------------------------------------------------------------

export function normName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .toLowerCase()
    .trim();
}

/** "Alberto" → "a"  |  "A." → "a" */
export function initialOf(given: string): string {
  return given.replace(/\.$/, "").charAt(0).toLowerCase();
}

/** "J. W." → ["j", "w"]  |  "Alberto Carlo" → ["alberto", "carlo"] */
export function nameTokens(s: string): string[] {
  return normName(s)
    .split(/[\s.]+/)
    .filter(Boolean);
}

/** True when the string carries accents that normName would strip. */
export function hasDiacritics(s: string): boolean {
  return /[\u0300-\u036f]/.test(s.normalize("NFD"));
}

/**
 * True when `short` is an abbreviated writing of `long`, i.e. every token of
 * `short` is either identical to the matching token of `long` or a single
 * letter standing in for it, and at least one token is actually abbreviated.
 *
 *   "A."      → "Alberto"          ✓
 *   "J. W."   → "John William"     ✓
 *   "A."      → "Alberto Carlo"    ✓ (trailing given names may be dropped)
 *   "Al"      → "Alberto"          ✗ (not a single-letter initial)
 *   "Alberto" → "Alberto"          ✗ (nothing is abbreviated)
 */
export function isAbbreviationOf(short: string, long: string): boolean {
  const s = nameTokens(short);
  const l = nameTokens(long);
  if (s.length === 0 || l.length === 0) return false;
  if (s.length > l.length) return false;

  let abbreviated = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === l[i]) continue;
    if (s[i].length === 1 && s[i] === l[i].charAt(0)) {
      abbreviated = true;
      continue;
    }
    return false;
  }
  // Dropping trailing given names ("A." for "Alberto Carlo") also counts.
  return abbreviated || s.length < l.length;
}
