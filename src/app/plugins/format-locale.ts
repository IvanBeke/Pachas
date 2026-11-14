import { formatLocale } from "~/utils/format";

export default defineNuxtPlugin((nuxtApp) => {
  const i18n = nuxtApp.$i18n as { locale: Ref<string> };
  watch(i18n.locale, (l) => (formatLocale.value = l), { immediate: true });
});
