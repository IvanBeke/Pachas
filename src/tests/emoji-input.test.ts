import { describe, expect, it } from "vitest";
import { readEmoji } from "../server/utils/emoji-input";

describe("readEmoji", () => {
  it("keeps multi-codepoint emoji intact", () => {
    for (const e of ["🧾", "✈️", "🇪🇸", "👨‍👩‍👧", "👍🏽", "🏳️‍🌈"]) {
      expect(readEmoji(e, "x")).toBe(e);
    }
  });

  it("takes only the first emoji", () => {
    expect(readEmoji("🍜🍜", "x")).toBe("🍜");
    expect(readEmoji("🇪🇸🇫🇷", "x")).toBe("🇪🇸");
  });

  it("trims whitespace around the value", () => {
    expect(readEmoji("  🍜 ", "x")).toBe("🍜");
  });

  it("falls back when empty, blank or not a string", () => {
    expect(readEmoji("", "🧾")).toBe("🧾");
    expect(readEmoji("   ", "🧾")).toBe("🧾");
    expect(readEmoji(undefined, "🧾")).toBe("🧾");
    expect(readEmoji(null, "🧾")).toBe("🧾");
    expect(readEmoji(42, "🧾")).toBe("🧾");
  });

  it("falls back for an absurdly long grapheme cluster", () => {
    expect(readEmoji("e" + "\u0301".repeat(60), "🧾")).toBe("🧾");
  });
});
