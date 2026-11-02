/**
 * Canonical form for comparing and searching user-typed text: accents and case
 * are ignored and runs of whitespace collapse to one space, so "  Mercadoná "
 * and "mercadona" are the same string. Shared so the browser and the server
 * can never disagree about what matches.
 */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
