import type { Ref } from "vue";
import { categoryAfterTitleEdit } from "../../shared/category-links";

/**
 * Owns the category of an expense or recurring-expense form.
 *
 * - When the form has no valid category (a new form, or a stored value that is
 *   not a category id any more) it selects the default one, General.
 * - Bind `onTitleInput` to the title input's `input` event: a linked title
 *   selects its category, and a title with no link returns to General.
 * - Bind `markCategoryTouched` to the category select's `change` event: once the
 *   user picks a category themselves, the title no longer changes it.
 *
 * `onTitleInput` reacts to the user's own typing only (not to the form being
 * filled from an existing record), so opening something for editing never
 * changes its stored category.
 */
export function useFormCategory(category: Ref<string>) {
  const { categories, defaultId, load: loadCategories } = useCategories();
  const { categoryForTitle, load: loadLinks } = useCategoryLinks();
  const touched = ref(false);

  onMounted(async () => {
    void loadLinks();
    await loadCategories();
    const known = categories.value.some((c) => String(c.id) === String(category.value));
    if (!known && defaultId.value !== null) category.value = String(defaultId.value);
  });

  function onTitleInput(e: Event) {
    category.value = categoryAfterTitleEdit(
      category.value,
      touched.value,
      categoryForTitle((e.target as HTMLInputElement).value),
      defaultId.value,
    );
  }

  function markCategoryTouched() {
    touched.value = true;
  }

  return { onTitleInput, markCategoryTouched };
}
