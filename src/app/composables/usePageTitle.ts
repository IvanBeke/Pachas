import type { MaybeRefOrGetter } from "vue";

/**
 * Sets the page's browser title from its segments, most specific first; empty
 * segments are skipped. The ` · Pachas` suffix comes from the `titleTemplate`
 * in app.vue.
 */
export function usePageTitle(parts: MaybeRefOrGetter<(string | undefined)[]>) {
  useHead({ title: computed(() => toValue(parts).filter(Boolean).join(" · ")) });
}
