import type { Ref } from "vue";
import { categoryAfterTitleEdit } from "../../shared/category-links";

/**
 * Keeps a form's category in step with its title through the admin-managed
 * title links. Bind `onTitleInput` to the title input's `input` event and
 * `markCategoryTouched` to the category select's `change` event.
 *
 * It reacts to the user's own typing only (not to the form being filled from an
 * existing record), so opening something for editing never changes its stored
 * category. Once the user picks a category themselves, links stop changing it.
 */
export function useTitleCategory(category: Ref<string>) {
  const { categoryForTitle, load } = useCategoryLinks();
  const touched = ref(false);

  onMounted(() => {
    void load();
  });

  function onTitleInput(e: Event) {
    category.value = categoryAfterTitleEdit(
      category.value,
      touched.value,
      categoryForTitle((e.target as HTMLInputElement).value),
    );
  }

  function markCategoryTouched() {
    touched.value = true;
  }

  return { onTitleInput, markCategoryTouched };
}
