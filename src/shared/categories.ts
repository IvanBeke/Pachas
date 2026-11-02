/**
 * The category a new expense starts in: the seeded "General" one, or the first
 * category when an admin has renamed it. `categories` must be in display order
 * (position, then id), which is how the API returns them. Shared so the browser
 * preselects exactly what the server falls back to.
 */
export const GENERAL_CATEGORY_TITLE = "General";

export function defaultCategory<T extends { title: string }>(
  categories: readonly T[],
): T | undefined {
  return categories.find((c) => c.title === GENERAL_CATEGORY_TITLE) ?? categories[0];
}
