/**
 * Title → category links, shared by the browser and the server so both match
 * titles the same way (see `normalizeText`: case, accents and extra spaces are
 * ignored, and the whole title must match, not part of it).
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

/** The category linked to `title`, or `null` when no link matches. */
export function categoryForTitle(index: TitleLinkIndex, title: string): number | null {
  const key = normalizeText(title);
  return key ? (index.get(key) ?? null) : null;
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
