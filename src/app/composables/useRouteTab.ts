import { parseTab, tabQuery } from "~/utils/route-tab";

/**
 * The selected tab of a page, kept in the URL as `?tab=<id>` so it can be shared
 * and navigated with back/forward. The first id is the default and is left out
 * of the URL. Selecting another tab pushes a history entry.
 */
export function useRouteTab<T extends string>(tabs: readonly [T, ...T[]]) {
  const route = useRoute();
  const router = useRouter();
  const defaultTab = tabs[0];

  const tab = computed<T>({
    get: () => parseTab(route.query.tab, tabs),
    set: (value) => {
      if (value === tab.value) return;
      void router.push({ query: tabQuery(route.query, value, defaultTab) });
    },
  });
  const isDefault = computed(() => tab.value === defaultTab);

  return { tab, isDefault };
}
