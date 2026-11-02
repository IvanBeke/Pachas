/** An emoji (flag, skin tone, ZWJ family…) can span many UTF-16 units. */
const MAX_UNITS = 32;

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Reads a single emoji from user input: the first grapheme cluster, so
 * multi-codepoint emoji survive intact where `slice(0, n)` would cut them in
 * half. Returns `fallback` when the input is empty or implausibly long.
 */
export function readEmoji(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  const first = segmenter.segment(text)[Symbol.iterator]().next().value;
  const grapheme = first?.segment ?? "";
  if (!grapheme || grapheme.length > MAX_UNITS) return fallback;
  return grapheme;
}
