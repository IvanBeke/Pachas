import { createError } from "h3";

const MAX_TRANSLATIONS = 20;
const MAX_TITLE = 30;
const LOCALE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

function capitalize(s: string): string {
  const t = s.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

export interface CategoryInput {
  title: string;
  icon: string;
  /** Locale → title. Empty titles are dropped. */
  translations: [string, string][];
}

/** Validates a category body for both create and update. */
export function readCategoryInput(
  body: Record<string, unknown>,
  defaults: { icon?: string } = {},
): CategoryInput {
  const title = capitalize(String(body.title ?? ""));
  if (!title || title.length > MAX_TITLE) {
    throw createError({
      statusCode: 400,
      message: `A category title is required (max ${MAX_TITLE} characters).`,
    });
  }
  const icon = String(body.icon ?? defaults.icon ?? "").trim().slice(0, 4);
  if (!icon) throw createError({ statusCode: 400, message: "An icon is required." });

  const raw = body.translations ?? {};
  if (typeof raw !== "object" || Array.isArray(raw) || raw === null) {
    throw createError({ statusCode: 400, message: "Invalid translations." });
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_TRANSLATIONS) {
    throw createError({
      statusCode: 400,
      message: `At most ${MAX_TRANSLATIONS} translations per category.`,
    });
  }
  const translations: [string, string][] = [];
  for (const [locale, value] of entries) {
    if (!LOCALE_RE.test(locale)) {
      throw createError({ statusCode: 400, message: `Invalid locale: ${locale}` });
    }
    const text = String(value ?? "").trim();
    if (text.length > MAX_TITLE) {
      throw createError({
        statusCode: 400,
        message: `Translations are limited to ${MAX_TITLE} characters.`,
      });
    }
    if (text) translations.push([locale, text]);
  }
  return { title, icon, translations };
}
