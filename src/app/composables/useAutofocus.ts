import type { Ref } from "vue";

/**
 * Focuses a form's name/title input as soon as the form is shown, and selects
 * any text already in it so editing can start by typing over it.
 */
export function useAutofocus(input: Ref<HTMLInputElement | null>) {
  onMounted(async () => {
    await nextTick();
    input.value?.focus({ preventScroll: true });
    input.value?.select();
  });
}
