import { normalizeTheme, type Theme } from "../../shared/theme";

export const THEME_STORAGE_KEY = "pachas-theme";

/**
 * Applies a theme to the document. `auto` removes the attribute so the
 * `prefers-color-scheme` rules in style.css take over. The choice is cached in
 * localStorage so the inline head script (nuxt.config.ts) can paint the right
 * theme before the session loads.
 */
export function applyTheme(theme: Theme): void {
  if (!import.meta.client) return;
  const value = normalizeTheme(theme);
  if (value === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = value;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch {
    // Storage can be unavailable (private mode); the server value still applies.
  }
}
