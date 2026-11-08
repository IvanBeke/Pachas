import type { LocationQuery, LocationQueryRaw } from "vue-router";

/**
 * The tab named by a `?tab=` query value. A missing, unknown or repeated value
 * (`?tab=a&tab=b`) gives the default tab, which is the first one listed.
 */
export function parseTab<T extends string>(value: unknown, tabs: readonly [T, ...T[]]): T {
  return tabs.find((tab) => tab === value) ?? tabs[0];
}

/**
 * The query to navigate to when `tab` is selected: the current query with `tab`
 * set, or removed for the default tab. Other params are kept.
 */
export function tabQuery(query: LocationQuery, tab: string, defaultTab: string): LocationQueryRaw {
  const { tab: _previous, ...rest } = query;
  return tab === defaultTab ? rest : { ...rest, tab };
}
