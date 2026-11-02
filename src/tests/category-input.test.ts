import { describe, expect, it } from "vitest";
import { readCategoryInput } from "../server/utils/category-input";

const err = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected a throw");
};

describe("readCategoryInput icon", () => {
  it("keeps multi-codepoint emoji intact", () => {
    for (const icon of ["🇪🇸", "👨‍👩‍👧", "👍🏽", "✈️"]) {
      expect(readCategoryInput({ title: "Viajes", icon }).icon).toBe(icon);
    }
  });

  it("keeps only the first emoji", () => {
    expect(readCategoryInput({ title: "Comida", icon: "🍜🍕" }).icon).toBe("🍜");
  });

  it("uses the default icon when none is sent", () => {
    expect(readCategoryInput({ title: "Otros" }, { icon: "🧾" }).icon).toBe("🧾");
  });

  it("requires an icon when there is no default", () => {
    expect(err(() => readCategoryInput({ title: "Otros", icon: "  " }))).toMatch(/icon/i);
  });
});
