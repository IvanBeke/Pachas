export const THEMES = ["auto", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/** Any stored or received value that is not a known theme means "follow the OS". */
export function normalizeTheme(value: unknown): Theme {
  return isTheme(value) ? value : "auto";
}
