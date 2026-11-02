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
