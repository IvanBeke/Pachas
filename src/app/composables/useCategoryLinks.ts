import { buildTitleLinkIndex, categoryForTitle as lookup } from "../../shared/category-links";

export interface CategoryLink {
  id: number;
  title: string;
  categoryId: number;
}

let pending: Promise<void> | null = null;

/**
 * Admin-managed title → category links, fetched once and shared like
 * `useCategories()`. The admin tab calls `refresh()` after every change so the
 * cache never goes stale within a session.
 */
export function useCategoryLinks() {
  const links = useState<CategoryLink[]>("category-links", () => []);
  const loaded = useState("category-links-loaded", () => false);
  const index = computed(() => buildTitleLinkIndex(links.value));

  function refresh(): Promise<void> {
    pending = (async () => {
      try {
        links.value = await $fetch<CategoryLink[]>("/api/category-links");
        loaded.value = true;
      } catch {
        // Forms simply don't auto-select a category without links.
      } finally {
        pending = null;
      }
    })();
    return pending;
  }

  function load(): Promise<void> {
    if (loaded.value) return Promise.resolve();
    return pending ?? refresh();
  }

  /** The id of the category linked to `title`, or `null`. */
  const categoryForTitle = (title: string): number | null => lookup(index.value, title);

  return { links, load, refresh, categoryForTitle };
}
