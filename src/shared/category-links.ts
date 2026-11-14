/**
 * Title → category links, shared by the browser and the server so both match
 * titles the same way (see `normalizeText`: case, accents and extra spaces are
 * ignored). A link matches when its title appears in the expense title as whole
 * words, so "Compra Mercadona centro" matches the "Mercadona" link but
 * "Gasolina" does not match "Gas".
 */
import { normalizeText } from "./text";

/** Same cap as an expense title, so a link can always match a stored title. */
export const MAX_LINK_TITLE = 80;

export interface TitleLink {
  title: string;
  categoryId: number;
}

export type TitleLinkIndex = ReadonlyMap<string, number>;

export function buildTitleLinkIndex(links: readonly TitleLink[]): TitleLinkIndex {
  const index = new Map<string, number>();
  for (const link of links) {
    const key = normalizeText(link.title);
    if (key && !index.has(key)) index.set(key, link.categoryId);
  }
  return index;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** True when `key` occurs in `text` as whole words (not inside a longer word). */
function containsWords(text: string, key: string): boolean {
  for (let at = text.indexOf(key); at !== -1; at = text.indexOf(key, at + 1)) {
    const before = text[at - 1];
    const after = text[at + key.length];
    if (
      (before === undefined || !WORD_CHAR.test(before)) &&
      (after === undefined || !WORD_CHAR.test(after))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The category of the link whose title appears in `title`, or `null` when none
 * does. When several links match, the longest (most specific) one wins.
 */
export function categoryForTitle(index: TitleLinkIndex, title: string): number | null {
  const text = normalizeText(title);
  if (!text) return null;
  let best: { length: number; categoryId: number } | null = null;
  for (const [key, categoryId] of index) {
    if ((!best || key.length > best.length) && containsWords(text, key)) {
      best = { length: key.length, categoryId };
    }
  }
  return best?.categoryId ?? null;
}

/**
 * The category a form should show after the user edits the title.
 *
 * A choice the user made by hand always wins (`touched`). Otherwise a linked
 * title selects its category, and a title with no link falls back to the
 * default category (General), so the category follows the title in both
 * directions. Without a known default the current category is kept.
 */
export function categoryAfterTitleEdit(
  current: string,
  touched: boolean,
  linked: number | null,
  defaultId: number | null,
): string {
  if (touched) return current;
  const target = linked ?? defaultId;
  return target === null ? current : String(target);
}

/**
 * Category for a Splitwise import row: a title link overrides the category the
 * user mapped the CSV category to, which in turn beats `fallback`.
 */
export function resolveImportCategory(
  index: TitleLinkIndex,
  title: string,
  mapped: string | undefined,
  fallback: string,
): string {
  const linked = categoryForTitle(index, title);
  if (linked !== null) return String(linked);
  return mapped || fallback;
}
