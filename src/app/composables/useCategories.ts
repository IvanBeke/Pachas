import type { Category } from "~/utils/format";

let pending: Promise<void> | null = null;

/**
 * The category list, fetched once and shared by every component. Admin edits
 * call `refresh()` so the cache never goes stale within a session.
 */
export function useCategories() {
  const categories = useState<Category[]>("categories", () => []);
  const loaded = useState("categories-loaded", () => false);

  function refresh(): Promise<void> {
    pending = (async () => {
      try {
        categories.value = await $fetch<Category[]>("/api/categories");
        loaded.value = true;
      } catch {
        // Callers fall back to default icons.
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

  const iconOf = (id: string): string =>
    categories.value.find((c) => String(c.id) === id)?.icon ?? "🧾";

  return { categories, load, refresh, iconOf };
}
